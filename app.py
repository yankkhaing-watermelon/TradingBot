"""Local Bursa research application. Run: python app.py"""
import hmac
import json
import os
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from research import Archive, MAX_BYTES
import gmail_sync

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('DATA_DIR', ROOT / 'data'))
DATA.mkdir(parents=True, exist_ok=True)
archive = Archive(DATA / 'research.sqlite3')
TOKEN = os.environ.get('APP_TOKEN') or secrets.token_urlsafe(24)
LOCK = threading.Lock()


def poll_gmail(interval):
    while True:
        if LOCK.acquire(blocking=False):
            try:
                result = gmail_sync.sync(archive)
                print(f"Gmail poll: {len(result['results'])} attachments, {len(result['errors'])} errors", flush=True)
            except Exception:
                print('Gmail poll failed; check configuration or connectivity. Will retry.', flush=True)
            finally:
                LOCK.release()
        time.sleep(interval)


class Handler(BaseHTTPRequestHandler):
    def send(self, status, content, kind='application/json'):
        raw = json.dumps(content).encode() if kind == 'application/json' else content
        self.send_response(status)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        self.end_headers()
        self.wfile.write(raw)

    def authorized(self):
        return hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + TOKEN)

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith('/api/'):
            if not self.authorized():
                return self.send(401, {'error': 'Enter the app access token printed by the server.'})
            if path == '/api/research':
                return self.send(200, archive.snapshot())
            if path == '/api/status':
                return self.send(200, {'gmail_configured': gmail_sync.configured(), 'version': '0.1.0'})
            return self.send(404, {'error': 'Not found'})
        assets = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/style.css': ('style.css', 'text/css; charset=utf-8')}
        if path not in assets:
            return self.send(404, {'error': 'Not found'})
        name, mime = assets[path]
        self.send(200, (ROOT / 'static' / name).read_bytes(), mime)

    def do_POST(self):
        if not self.authorized():
            return self.send(401, {'error': 'Invalid app access token'})
        path = urlparse(self.path).path
        if path not in ('/api/import', '/api/gmail/sync'):
            return self.send(404, {'error': 'Not found'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 0 or size > MAX_BYTES:
                return self.send(413, {'error': 'File exceeds 5 MB'})
            if path == '/api/import':
                if 'application/json' not in self.headers.get('Content-Type', ''):
                    return self.send(415, {'error': 'Use application/json'})
                return self.send(200, archive.ingest(self.rfile.read(size)))
            if not LOCK.acquire(blocking=False):
                return self.send(409, {'error': 'Gmail sync already running'})
            try:
                result = gmail_sync.sync(archive)
                return self.send(200, result)
            finally:
                LOCK.release()
        except ValueError as exc:
            self.send(400, {'error': str(exc)})
        except Exception:
            self.send(502, {'error': 'Operation failed. Check server configuration or connectivity; credentials are not included in this error.'})

    def log_message(self, fmt, *args):
        # Do not log headers, research content, or credentials.
        print('%s %s' % (self.address_string(), fmt % args))


if __name__ == '__main__':
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', '8080'))
    print(f'Bursa Research: http://{host}:{port}', flush=True)
    print(f'App access token: {TOKEN}', flush=True)
    interval = int(os.environ.get('GMAIL_POLL_SECONDS', '900'))
    if gmail_sync.configured() and interval > 0:
        threading.Thread(target=poll_gmail, args=(max(60, interval),), daemon=True).start()
    ThreadingHTTPServer((host, port), Handler).serve_forever()
