"""
HTTP-skal runt skannermotorn (engine.py). En endpoint, delad hemlighet, ingen databas.

  POST /identify   header x-engine-secret: <ENGINE_SECRET>, body = JPEG-bytes
                   → {"best": cardId, "candidates": [...], "ms": …}
  GET  /health     → {"ok": true, "cards": N}

Motorn laddas EN gång vid start (indexet ~0,2–0,4 GB i RAM). Ett lås serialiserar anropen:
OpenCV:s SIFT-objekt är inte trådsäkert, och skannervolymen är några hundra per dygn.
"""
import ctypes, json, os, socket, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from bootstrap import clean_volume, ensure_data, ensure_emb
from engine import Engine

DATA_DIR = os.environ.get("DATA_DIR", "/data")
clean_volume(DATA_DIR)
ensure_data(DATA_DIR)
ensure_emb(DATA_DIR)
SECRET = os.environ.get("ENGINE_SECRET", "")
MAX_BYTES = 4 * 1024 * 1024

engine = Engine(DATA_DIR)
lock = threading.Lock()

# MINNET (2026-10-08): tjänsten låg på 1,2–1,5 GB vaken mot väntade ~0,4 GB, dvs ~85 kr/mån.
# ThreadingHTTPServer startar en NY tråd per anrop och faiss/OpenCV en per kärna — glibc ger varje
# tråd en egen arena, och frigjort minne lämnas sällan tillbaka. MALLOC_ARENA_MAX (Dockerfile) kapar
# arenorna; malloc_trim efter varje anrop lämnar tillbaka det som frigjorts.
try:
    _libc = ctypes.CDLL("libc.so.6")
except OSError:
    _libc = None


def _trim():
    if _libc is not None:
        _libc.malloc_trim(0)


_backfill_busy = threading.Lock()


def _emb_backfill():
    """Kort som kom in via add_cards innan bildvektorn fanns får sin vektor i bakgrunden — bilden
    hämtas UTANFÖR låset, bara själva tillägget sker under det. Körs vid start och efter
    /refresh-urls; aldrig två samtidigt."""
    if not _backfill_busy.acquire(blocking=False):
        return
    try:
        _emb_backfill_run()
    finally:
        _backfill_busy.release()


def _emb_backfill_run():
    todo = engine.emb_missing()
    if not todo:
        return
    print(f"bildvektor saknas för {len(todo)} kort — fyller på", flush=True)
    # 2026-10-08: 406 kort gav 0/406 vid VARJE start, utan ett ord om varför — samma URL:er laddas
    # och avkodas felfritt utanför Railway. Felet loggas nu, och ett 403/429 betyder att bildvärden
    # bromsar oss: sluta i stället för att skicka resten av kön rakt in i spärren (och hålla den vid
    # liv till nattens add-cards, som hämtar från samma värd). Artigt tempo mellan hämtningarna.
    done, reasons = 0, {}
    for cid in todo:
        try:
            bgr = engine.fetch_bgr(cid)
            if bgr is None:
                reasons["avkodning/ingen url"] = reasons.get("avkodning/ingen url", 0) + 1
        except Exception as e:
            bgr = None
            key = f"{type(e).__name__}: {str(e)[:80]}"
            reasons[key] = reasons.get(key, 0) + 1
            if getattr(e, "code", None) in (403, 429):
                print(f"bildvärden svarar {e.code} — avbryter påfyllningen, nästa start försöker igen", flush=True)
                break
        time.sleep(0.2)
        if bgr is None:
            continue
        with lock:
            engine.emb_add(cid, bgr)
        done += 1
    with lock:
        engine.emb_persist()
        _trim()
    print(f"bildvektor påfylld: {done}/{len(todo)}", flush=True)
    for why, n in sorted(reasons.items(), key=lambda kv: -kv[1])[:5]:
        print(f"  misslyckad hämtning ×{n}: {why}", flush=True)


def _mem():
    """Processens RSS + cgroupens minne (det Railway fakturerar), anon vs sidcache. Bara för mätning."""
    out = {}
    try:
        for line in open("/proc/self/status"):
            if line.startswith("VmRSS:"):
                out["rssMb"] = int(line.split()[1]) // 1024
    except OSError:
        pass
    try:
        out["cgroupMb"] = int(open("/sys/fs/cgroup/memory.current").read()) // 2**20
        for line in open("/sys/fs/cgroup/memory.stat"):
            k, v = line.split()
            if k in ("anon", "file"):
                out[k + "Mb"] = int(v) // 2**20
    except OSError:
        pass
    return out


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        return bool(SECRET) and self.headers.get("x-engine-secret") == SECRET

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "cards": len(engine.ids), "mem": _mem(),
                                    "emb": len(engine.emb["ids"]) if engine.emb else None})
        if self.path == "/cards":  # vilka kort motorn känner — webbens påfyllning diffar mot katalogen
            if not self._authed():
                return self._json(401, {"error": "unauthorized"})
            # urls: webbens påfyllning byter ut länkar som katalogen ändrat (/refresh-urls).
            return self._json(200, {"ids": engine.ids, "urls": engine.image_urls})
        self._json(404, {"error": "not-found"})

    def do_POST(self):
        if self.path not in ("/identify", "/add-cards", "/refresh-urls"):
            return self._json(404, {"error": "not-found"})
        if not self._authed():
            return self._json(401, {"error": "unauthorized"})
        n = int(self.headers.get("content-length") or 0)
        if n <= 0 or n > MAX_BYTES:
            return self._json(413, {"error": "size"})
        data = self.rfile.read(n)
        if self.path == "/refresh-urls":
            try:
                urls = json.loads(data)["urls"]
            except Exception:
                return self._json(400, {"error": "bad-json"})
            with lock:
                changed = engine.refresh_urls(urls)
            if changed:
                threading.Thread(target=_emb_backfill, daemon=True).start()
            return self._json(200, {"changed": changed})
        if self.path == "/add-cards":
            try:
                cards = json.loads(data)["cards"]
            except Exception:
                return self._json(400, {"error": "bad-json"})
            with lock:
                res = engine.add_cards(cards[:300])
                _trim()
            return self._json(200, res)
        with lock:
            res = engine.identify(data)
            _trim()
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
    threading.Thread(target=_emb_backfill, daemon=True).start()
    _trim()
    print(f"scanner-engine på :{port}, {len(engine.ids)} kort, minne {_mem()}", flush=True)
    DualStackServer(("::", port), Handler).serve_forever()
