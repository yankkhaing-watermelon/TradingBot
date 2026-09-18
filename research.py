"""Validated, transactional research archive. Standard library only."""
import hashlib
import json
import re
import sqlite3
from datetime import date, datetime
from urllib.parse import urlparse

MAX_BYTES = 5 * 1024 * 1024


def text(value, name, limit=30000):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f'{name} must be non-empty text (max {limit} characters)')
    return value.strip()


def strings(value, name):
    if value is None:
        return []
    if isinstance(value, str):
        return [text(value, name)] if value.strip() else []
    if not isinstance(value, list) or len(value) > 200:
        raise ValueError(f'{name} must be text or a list of text')
    return [text(v, name) for v in value]


def timestamp(value, name):
    value = text(value, name, 100)
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError()
    except ValueError:
        raise ValueError(f'{name} must be an ISO timestamp with timezone') from None
    return value, parsed


def validate(raw):
    if len(raw) > MAX_BYTES:
        raise ValueError('File exceeds 5 MB limit')
    try:
        report = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise ValueError('Invalid UTF-8 JSON') from None
    if not isinstance(report, dict):
        raise ValueError('Report must be a JSON object')
    if report.get('schema_version') != '1.0' or report.get('market') != 'BURSA':
        raise ValueError('Expected schema_version 1.0 and market BURSA')
    day = text(report.get('report_date'), 'report_date', 10)
    try:
        if date.fromisoformat(day).isoformat() != day:
            raise ValueError()
    except ValueError:
        raise ValueError('report_date must be YYYY-MM-DD') from None
    generated, _ = timestamp(report.get('generated_at'), 'generated_at')
    start, a = timestamp(report.get('coverage_start'), 'coverage_start')
    end, b = timestamp(report.get('coverage_end'), 'coverage_end')
    if a > b:
        raise ValueError('coverage_start must precede coverage_end')
    items = report.get('items')
    if not isinstance(items, list) or len(items) > 500:
        raise ValueError('items must be a list with at most 500 entries')
    normalized = []
    ids = set()
    for item in items:
        if not isinstance(item, dict):
            raise ValueError('Each item must be an object')
        ident = text(item.get('id'), 'item.id', 300)
        if ident in ids:
            raise ValueError(f'Duplicate item ID in report: {ident}')
        ids.add(ident)
        codes = item.get('stock_codes', [])
        if not isinstance(codes, list) or any(not isinstance(c, str) or not re.fullmatch(r'\d{4,6}', c) for c in codes):
            raise ValueError('stock_codes must be an array of 4–6 digit strings; preserve leading zeros')
        sources = item.get('sources')
        if not isinstance(sources, list) or not sources or len(sources) > 50:
            raise ValueError(f'{ident}: at least one source is required')
        src = []
        for source in sources:
            if not isinstance(source, dict):
                raise ValueError('Source must be an object')
            url = text(source.get('url'), 'source.url', 3000)
            p = urlparse(url)
            if p.scheme not in ('https', 'http') or not p.netloc or p.username or p.password:
                raise ValueError('Source URLs must be HTTP(S) links without credentials')
            published = source.get('published_at')
            if published is not None:
                published = text(published, 'source.published_at', 100)
            src.append({'url': url, 'title': text(source.get('title'), 'source.title', 1000), 'published_at': published})
        normalized.append({
            'id': ident, 'stock_codes': sorted(set(codes)),
            'company_names': strings(item.get('company_names'), 'company_names'),
            'category': text(item.get('category'), 'category', 200),
            'headline': text(item.get('headline'), 'headline', 1500),
            **{key: strings(item.get(key), key) for key in ('facts', 'analysis', 'catalysts', 'risks', 'bull_case', 'bear_case')},
            'sources': src,
            'verification_status': text(item.get('verification_status'), 'verification_status', 300),
        })
    return {'schema_version': '1.0', 'market': 'BURSA', 'report_date': day,
            'generated_at': generated, 'coverage_start': start, 'coverage_end': end,
            'summary': strings(report.get('summary'), 'summary'),
            'coverage_gaps': strings(report.get('coverage_gaps'), 'coverage_gaps'), 'items': normalized}


class Archive:
    def __init__(self, path):
        self.path = path
        with self.connect() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS reports (
              hash TEXT PRIMARY KEY, report_date TEXT, generated_at TEXT,
              imported_at TEXT DEFAULT CURRENT_TIMESTAMP, origin TEXT, payload TEXT);
            CREATE TABLE IF NOT EXISTS items (
              hash TEXT PRIMARY KEY, item_id TEXT, payload TEXT);
            CREATE TABLE IF NOT EXISTS report_items (
              report_hash TEXT, item_hash TEXT, PRIMARY KEY(report_hash,item_hash));
            CREATE TABLE IF NOT EXISTS imports (
              id INTEGER PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
              origin TEXT, report_hash TEXT, status TEXT, added INTEGER, repeated INTEGER);
            ''')

    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        return db

    def ingest(self, raw, origin='upload'):
        report = validate(raw)  # Validate the entire batch before any write.
        payload = json.dumps(report, sort_keys=True, ensure_ascii=False)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            added = repeated = 0
            exists = db.execute('SELECT 1 FROM reports WHERE hash=?', (digest,)).fetchone()
            if not exists:
                db.execute('INSERT INTO reports(hash,report_date,generated_at,origin,payload) VALUES(?,?,?,?,?)',
                           (digest, report['report_date'], report['generated_at'], origin, payload))
                for item in report['items']:
                    body = json.dumps(item, sort_keys=True, ensure_ascii=False)
                    # Content identity allows revised facts under an existing item ID to survive.
                    key = hashlib.sha256(body.encode()).hexdigest()
                    changed = db.execute('INSERT OR IGNORE INTO items VALUES(?,?,?)', (key, item['id'], body)).rowcount
                    added += changed
                    repeated += 1 - changed
                    db.execute('INSERT INTO report_items VALUES(?,?)', (digest, key))
            else:
                repeated = len(report['items'])
            status = 'duplicate' if exists else 'imported'
            db.execute('INSERT INTO imports(origin,report_hash,status,added,repeated) VALUES(?,?,?,?,?)',
                       (origin[:500], digest, status, added, repeated))
        return {'status': status, 'added': added, 'repeated': repeated, 'report_hash': digest}

    def snapshot(self):
        with self.connect() as db:
            reports = [dict(r) for r in db.execute('SELECT * FROM reports ORDER BY report_date DESC, generated_at DESC')]
            items = []
            for row in db.execute('''SELECT i.hash,i.payload,MAX(r.report_date) AS report_date,
                COUNT(DISTINCT ri.report_hash) AS report_count FROM items i
                JOIN report_items ri ON ri.item_hash=i.hash JOIN reports r ON r.hash=ri.report_hash
                GROUP BY i.hash ORDER BY report_date DESC,i.hash'''):
                items.append({**json.loads(row['payload']), 'key': row['hash'],
                              'report_date': row['report_date'], 'report_count': row['report_count']})
            history = [dict(r) for r in db.execute('SELECT * FROM imports ORDER BY id DESC LIMIT 100')]
        for r in reports:
            r['data'] = json.loads(r.pop('payload'))
        reports.sort(key=lambda r: (r['report_date'], datetime.fromisoformat(r['generated_at'].replace('Z', '+00:00'))), reverse=True)
        return {'reports': reports, 'items': items, 'history': history}
