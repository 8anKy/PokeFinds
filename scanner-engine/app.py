"""
HTTP-skal runt skannermotorn (engine.py). En endpoint, delad hemlighet, ingen databas.

  POST /identify   header x-engine-secret: <ENGINE_SECRET>, body = JPEG-bytes
                   → {"best": cardId, "candidates": [...], "ms": …}
  GET  /health     → {"ok": true, "cards": N}

Motorn laddas EN gång vid start (indexet ~0,2–0,4 GB i RAM). Ett lås serialiserar anropen:
OpenCV:s SIFT-objekt är inte trådsäkert, och skannervolymen är några hundra per dygn.
"""
import json, os, socket, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from bootstrap import ensure_data
from engine import Engine

DATA_DIR = os.environ.get("DATA_DIR", "/data")
ensure_data(DATA_DIR)
SECRET = os.environ.get("ENGINE_SECRET", "")
MAX_BYTES = 4 * 1024 * 1024

engine = Engine(DATA_DIR)
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "cards": len(engine.ids)})
        self._json(404, {"error": "not-found"})

    def do_POST(self):
        if self.path != "/identify":
            return self._json(404, {"error": "not-found"})
        if not SECRET or self.headers.get("x-engine-secret") != SECRET:
            return self._json(401, {"error": "unauthorized"})
        n = int(self.headers.get("content-length") or 0)
        if n <= 0 or n > MAX_BYTES:
            return self._json(413, {"error": "size"})
        data = self.rfile.read(n)
        with lock:
            res = engine.identify(data)
        self._json(200 if "error" not in res else 400, res)

    def log_message(self, fmt, *args):  # inga bilddata i loggen, bara rad per anrop
        pass


class DualStackServer(ThreadingHTTPServer):
    """Lyssnar på IPv6 OCH IPv4: Railways privata nät kan vara IPv6-only (`*.railway.internal`)."""

    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    print(f"scanner-engine på :{port}, {len(engine.ids)} kort", flush=True)
    DualStackServer(("::", port), Handler).serve_forever()
