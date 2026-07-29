#!/usr/bin/env python3
"""
EzSync Server - Simple Polling
=================================
API:
  GET  /ping              - health check
  GET  /poll/<roomId>     - get current room state (code + version)
  POST /sync/<roomId>     - push code update for this room
  GET  /*                 - serve static files

Works across: normal Chrome, Incognito, Firefox, mobile, LAN devices.
Zero external dependencies.
"""

import json
import threading
import time
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

rooms = {}          # { roomId: {code, version, ts, peerId, name, color, lang} }
rooms_lock = threading.Lock()


class Handler(SimpleHTTPRequestHandler):

    def log_message(self, fmt, *args):
        path = getattr(self, 'path', '')
        if any(p in path for p in ['/poll/', '/sync/', '/ping']):
            print(f"  [{time.strftime('%H:%M:%S')}] {fmt % args}", flush=True)

    def send_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors()
        self.end_headers()

    # Custom mime map for Linux/Render compatibility
    extensions_map = {
        '':        'application/octet-stream',
        '.html':   'text/html; charset=utf-8',
        '.css':    'text/css; charset=utf-8',
        '.js':     'application/javascript; charset=utf-8',
        '.png':    'image/png',
        '.jpg':    'image/jpeg',
        '.jpeg':   'image/jpeg',
        '.gif':    'image/gif',
        '.svg':    'image/svg+xml',
        '.ico':    'image/x-icon',
        '.woff':   'font/woff',
        '.woff2':  'font/woff2',
        '.ttf':    'font/ttf',
    }

    STATIC_EXTS = {'.css', '.js', '.html', '.ico', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.woff', '.woff2', '.ttf'}

    def do_GET(self):
        parsed = urlparse(self.path)
        raw_path = parsed.path.rstrip('/')

        # ── Health check ────────────────────────────────────────────
        if raw_path == '/ping':
            with rooms_lock:
                room_count = len(rooms)
            self._json(200, {'status': 'ok', 'rooms': room_count})
            return

        # ── Poll for updates: GET /poll/<roomId> ────────────────────
        if raw_path.startswith('/poll/'):
            room_id = raw_path[len('/poll/'):].strip('/')
            with rooms_lock:
                room = dict(rooms.get(room_id, {}))
            if not room:
                self._json(200, {'version': 0, 'code': '', 'lang': 'javascript', 'peerId': '', 'name': '', 'color': '#4f8ef7'})
            else:
                self._json(200, room)
            return

        # ── Root → landing page ─────────────────────────────────────
        if raw_path == '' or raw_path == '/':
            self.path = '/index.html'
            super().do_GET()
            return

        # ── Existing Static File (e.g. /logo.png, /style.css, /app.js) ──
        rel_file = raw_path.lstrip('/')
        if rel_file and os.path.isfile(rel_file):
            self.path = '/' + rel_file
            super().do_GET()
            return

        # ── Extension-based static file fallback ────────────────────
        ext = os.path.splitext(raw_path)[1].lower()
        if ext in self.STATIC_EXTS:
            super().do_GET()
            return

        # ── Everything else → Room ID → serve editor.html ───────────
        # e.g. /aditya  /team-alpha  /abc12
        self.path = '/editor.html'
        super().do_GET()
        return


    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # Push update: POST /sync/<roomId>
        if path.startswith('/sync/'):
            room_id = path[len('/sync/'):].strip('/')
            if not room_id:
                self._json(400, {'error': 'missing roomId'})
                return

            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                data = json.loads(body)
            except Exception:
                self._json(400, {'error': 'invalid JSON'})
                return

            with rooms_lock:
                current = rooms.get(room_id, {})
                old_version = current.get('version', 0)
                new_version = old_version + 1
                rooms[room_id] = {
                    'code':    data.get('code', ''),
                    'lang':    data.get('lang', 'javascript'),
                    'peerId':  data.get('peerId', ''),
                    'name':    data.get('name', 'Peer'),
                    'color':   data.get('color', '#4f8ef7'),
                    'version': new_version,
                    'ts':      int(time.time() * 1000),
                }

            print(f"  [{time.strftime('%H:%M:%S')}] Room {room_id!r}: v{new_version} from {data.get('name','?')}", flush=True)
            self._json(200, {'ok': True, 'version': new_version})
            return

        self._json(404, {'error': 'not found'})

    def _json(self, status, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_cors()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache, no-store')
        self.end_headers()
        self.wfile.write(body)


class ThreadedServer(HTTPServer):
    """One thread per request so concurrent polls don't block each other."""
    def process_request(self, request, client_address):
        t = threading.Thread(
            target=self._handle,
            args=(request, client_address),
            daemon=True,
        )
        t.start()

    def _handle(self, request, client_address):
        try:
            self.finish_request(request, client_address)
        except Exception:
            pass
        finally:
            self.shutdown_request(request)


if __name__ == '__main__':
    PORT = int(os.environ.get('PORT', 3000))
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    server = ThreadedServer(('', PORT), Handler)

    print('', flush=True)
    print('=' * 52, flush=True)
    print(f'  EzSync Server   http://localhost:{PORT}', flush=True)
    print('=' * 52, flush=True)
    print(f'  Serving : {os.getcwd()}', flush=True)
    print(f'  Sync    : HTTP Polling (300ms) - no external deps', flush=True)
    print(f'  Works   : Chrome / Incognito / Firefox / mobile', flush=True)
    print('  Stop    : Ctrl+C', flush=True)
    print('=' * 52, flush=True)
    print('', flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('Server stopped.', flush=True)
        sys.exit(0)
