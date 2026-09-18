"""Read-only Gmail import via user-provided OAuth credentials. Never sends or deletes mail."""
import base64
import json
import os
import urllib.parse
import urllib.request
from research import MAX_BYTES


def configured():
    return all(os.environ.get(k) for k in ('GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'))


def request(url, token=None, form=None):
    data = urllib.parse.urlencode(form).encode() if form else None
    headers = {'Authorization': 'Bearer ' + token} if token else {}
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=30) as response:
        raw = response.read(12 * 1024 * 1024 + 1)
        if len(raw) > 12 * 1024 * 1024:
            raise ValueError('Gmail response exceeds size limit')
        return json.loads(raw)


def parts(payload):
    yield payload
    for part in payload.get('parts', []):
        yield from parts(part)


def sync(archive):
    if not configured():
        raise ValueError('Gmail is not configured. Upload JSON or configure server-side OAuth credentials.')
    auth = request('https://oauth2.googleapis.com/token', form={
        'client_id': os.environ['GMAIL_CLIENT_ID'], 'client_secret': os.environ['GMAIL_CLIENT_SECRET'],
        'refresh_token': os.environ['GMAIL_REFRESH_TOKEN'], 'grant_type': 'refresh_token'})
    token = auth['access_token']
    root = 'https://gmail.googleapis.com/gmail/v1/users/me/'
    expected = os.environ.get('GMAIL_ACCOUNT', 'investmalaysia2025@gmail.com').lower()
    if request(root + 'profile', token)['emailAddress'].lower() != expected:
        raise ValueError('OAuth account does not match GMAIL_ACCOUNT')
    query = 'subject:"Bursa Research" has:attachment filename:json'
    page = None
    imported = []
    errors = []
    scanned = 0
    # Bounded sync; each call rescans recent messages safely through content deduplication.
    for _ in range(5):
        params = {'q': query, 'maxResults': 50}
        if page:
            params['pageToken'] = page
        listing = request(root + 'messages?' + urllib.parse.urlencode(params), token)
        for entry in listing.get('messages', []):
            ident = entry['id']
            scanned += 1
            try:
                message = request(root + 'messages/' + ident + '?format=full', token)
                for part in parts(message.get('payload', {})):
                    filename = part.get('filename', '')
                    if not filename.lower().endswith('.json'):
                        continue
                    body = part.get('body', {})
                    if body.get('size', 0) > MAX_BYTES:
                        raise ValueError('Attachment exceeds 5 MB')
                    if body.get('attachmentId'):
                        body = request(root + 'messages/' + ident + '/attachments/' + body['attachmentId'], token)
                    data = body.get('data', '')
                    raw = base64.urlsafe_b64decode(data + '=' * (-len(data) % 4))
                    imported.append(archive.ingest(raw, 'gmail:' + ident + ':' + filename))
            except Exception:
                errors.append({'message_id': ident, 'error': 'Could not read or validate attachment; message retained for retry.'})
        page = listing.get('nextPageToken')
        if not page:
            break
    return {'scanned': scanned, 'results': imported, 'errors': errors, 'more_available': bool(page)}
