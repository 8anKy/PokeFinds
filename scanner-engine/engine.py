"""
FOILIO SKANNERMOTOR UTAN AI (2026-09-30) — produktionsversionen av scripts/scanner-proto/.

Kedjan, allt ren bildgeometri (OpenCV + faiss, ingen modell, ingen AI):
  1. Fotots RootSIFT-punkter (≤ QUERY_KP) på ≤ QUERY_SIDE px.
  2. STEG A — varje punkt söker sina närmaste grannar i ett IVF-PQ-index över ALLA referensers
     punkter och röstar på kortet bakom (Lowes kvot över KORT: en punkt som liknar två kort lika
     mycket säger ingenting). Topp-K kort.
  3. STEG B — DISTINKTA inliers: fotopunkter som matchar EN kandidat tydligt bättre än alla andra,
     geometriskt verifierade med RANSAC-homografi. Tryckmallen (ram, "weakness/resistance/retreat")
     är likadan på alla kort från samma era och får aldrig räknas — en Bagon fick annars 338 inliers
     mot ett Mewtwo-foto.
  4. REGIONKONTROLL — rivaler nära ettan med SAMMA konst (språktvilling, omtryck med 30th-stämpel)
     avgörs genom att jämföra fotot med båda BARA där referenserna skiljer sig.

Mätt offline (scripts/scanner-proto/evaluate.py): ägarens app-foton 99/99, 2 000 Tradera-säljarfoton
91,4 % (stickprov: ~1/4 av missarna fel etikett, ~1/3 identiska omtryck).

Data (byggs av scripts/scanner-proto/build_nn.py + build_refkp.py), i DATA_DIR:
  nn/ivfpq.faiss, nn/owners.npy, nn/cards.json      — steg A
  refkp/desc.npy, refkp/pts.npy, refkp/meta.json     — steg B (memmap, läses per kandidat)
  cards-meta.json                                    — {id: imageUrl} för regionkontrollens bilder
"""
import json, os, time, urllib.request, zlib
from collections import OrderedDict

import cv2
import numpy as np
import faiss

QUERY_SIDE = int(os.environ.get("QUERY_SIDE", "1000"))
QUERY_KP = int(os.environ.get("QUERY_KP", "1500"))
TOP_K = int(os.environ.get("TOP_K", "20"))
NPROBE = int(os.environ.get("NPROBE", "32"))
# Trådtak (2026-10-08): utan tak startar OpenCV en tråd per synlig kärna på Railway-värden, och varje
# tråd kostar minne. Anropen serialiseras ändå av app.py:s lås. 4 trådar mätt ≈ samma tid som obegränsat.
cv2.setNumThreads(int(os.environ.get("CV_THREADS", "4")))
# INLÄRD BILDVEKTOR (2026-10-08, ägarbeslut "train the system if needed"): finjusterad SigLIP2-base som
# ONNX (int8) på CPU. Föreslår kandidater till steg A och AVGÖR när geometrin inte räcker — mätt offline
# på suddiga/mörka foton 66,5 → 78,7 %, oförändrat på skarpa (scripts/scanner-proto/hybrid_eval.py).
# Ingen extern tjänst, ingen kostnad per skanning. Utan EMB_VERSION eller filerna = motorn som förut.
EMB_VERSION = os.environ.get("EMB_VERSION", "").strip()
EMB_K = int(os.environ.get("EMB_K", "5"))
EMB_FALLBACK_INLIERS = int(os.environ.get("EMB_FALLBACK_INLIERS", "15"))
EMB_SIDE = 224
RATIO = 0.85  # steg B: distinkt = bästa kandidaten < 0,85 × bästa ANDRA kandidaten
REGION_WIN = 0.92  # regionkontroll: rivalen måste ha ≥ 8 % lägre fel i skillnadsregionerna


def _root_sift(des):
    return np.sqrt(des / (np.abs(des).sum(axis=1, keepdims=True) + 1e-7)).astype(np.float32)


def _gray(img, max_side):
    h, w = img.shape[:2]
    s = max_side / max(h, w)
    if s < 1:
        img = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    return img


def _drop_cache(path):
    if hasattr(os, "posix_fadvise"):
        try:
            fd = os.open(path, os.O_RDONLY)
            # Nyss skrivna sidor är "smutsiga" och släpps först när de skrivits till disk.
            os.fdatasync(fd)
            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
            os.close(fd)
        except OSError:
            pass


def _owners_dtype(owners, next_idx=0):
    """Kortindex per indexvektor: uint16 så länge korten ryms, annars int32."""
    top = max(int(owners.max()) if len(owners) else 0, next_idx)
    return owners.astype(np.uint16 if top < 65535 else np.int32, copy=False)


def _norm(img):
    """Lokal kontrastnormalisering — foto och referens har olika ljus, färgton och skärpa."""
    f = cv2.GaussianBlur(img.astype(np.float32), (0, 0), 1.2)
    mu = cv2.GaussianBlur(f, (0, 0), 12)
    sd = np.sqrt(cv2.GaussianBlur((f - mu) ** 2, (0, 0), 12)) + 4.0
    return (f - mu) / sd


class Engine:
    def __init__(self, data_dir):
        self.dir = data_dir
        nn = os.path.join(data_dir, os.environ.get("NN_SUB", "nn"))
        self.nn_dir = nn
        self.index = faiss.read_index(os.path.join(nn, "ivfpq.faiss"))
        self.index.nprobe = NPROBE
        # I minnet, inte memmap: add_cards() förlänger den. uint16 när korten ryms (2026-10-15: 42 541 kort,
        # tak 65 535) — halva minnet, samma värden, samma svar.
        self.owners = _owners_dtype(np.load(os.path.join(nn, "owners.npy")))
        self.ids = json.load(open(os.path.join(nn, "cards.json")))
        # Filerna är inlästa i processen — släpp sidcachen (cgroupen räknar den som minne).
        for f in ("ivfpq.faiss", "owners.npy", "cards.json"):
            _drop_cache(os.path.join(nn, f))
        rk = os.path.join(data_dir, "refkp")
        self.rk_dir = rk
        meta = json.load(open(os.path.join(rk, "meta.json")))
        self.offsets, self.shapes = meta["offsets"], meta["shapes"]
        # Rader bortom basfilen ligger i tilläggsfilerna (add_cards) — rad a ≥ n_base läses därifrån.
        self.n_base = meta["n"]
        self.n_add = meta.get("n_add", 0)
        # KOMPRIMERADE BLOCK (2026-11-24, volymen full): ett kort = ett zlib-block (punkter + beskrivningar)
        # i blocks.bin. FÖRLUSTFRITT — varje byte är densamma efter uppackning, så träffsäkerheten kan inte
        # ändras (mätt: 68 % av rå storlek; att i stället halvera beskrivningarna med PCA kostade 6 av 255
        # foton och förkastades). `blocks[cid] = [byte-offset, längd, antal punkter]` vinner över radvägen.
        self.blocks = meta.get("blocks", {})
        self._blk = os.path.join(rk, "blocks.bin")
        self._blk_fd = None
        # Rader som fysiskt finns kvar i basfilen (migreringen kapar den bakifrån). n_base är ADRESSEN
        # där tilläggsfilernas rader börjar och ändras aldrig.
        self.base_rows = meta.get("base_rows", self.n_base)
        self._add_d = os.path.join(rk, "desc-add.bin")
        self._add_p = os.path.join(rk, "pts-add.bin")
        # OBOKFÖRDA RADER KAPAS (2026-11-24): add_cards skriver raderna FÖRE _persist. Dör _persist
        # (volymen full sedan 11-21: "No space left on device") ligger raderna kvar sist i filen men
        # saknas i meta.json. Nästa tillägg hade hamnat EFTER dem medan offseten räknas från n_add —
        # nya kort hade fått ett annat korts nyckelpunkter — och varje misslyckad natt åt ~8 MB till.
        for path, row in ((self._add_d, 128), (self._add_p, 8)):
            try:
                extra = os.path.getsize(path) - self.n_add * row if os.path.exists(path) else 0
                if extra > 0:
                    os.truncate(path, self.n_add * row)
                    print(f"kapade {extra / 1e6:.1f} MB obokförda rader ur {os.path.basename(path)}", flush=True)
            except OSError as e:
                print(f"kunde inte kapa {path}: {e}", flush=True)
        # Samma sak för blockfilen (svans utan indexrad = ett block som skrevs men aldrig bokfördes).
        end = max((b[0] + b[1] for b in self.blocks.values()), default=0)
        try:
            if os.path.exists(self._blk) and os.path.getsize(self._blk) > end:
                os.truncate(self._blk, end)
        except OSError as e:
            print(f"kunde inte kapa blocks.bin: {e}", flush=True)
        self._blk_size = os.path.getsize(self._blk) if os.path.exists(self._blk) else 0
        print(f"volym: {self.disk_free_mb()} MB ledigt, indexet {os.path.getsize(os.path.join(nn, 'ivfpq.faiss')) // 2**20} MB, "
              f"{len(self.blocks)} kort i block", flush=True)
        # ⛔ INTE memmap på Linux: Railway räknar kärnans sidcache som minne (cgroup), och en memmap
        # över 2,8 GB hade vuxit med varje skanning tills hela filen låg i "minnet". Raderna läses med
        # pread och sidorna släpps direkt (POSIX_FADV_DONTNEED). Windows (lokal mätning) kör memmap.
        self._pread = hasattr(os, "pread") and hasattr(os, "posix_fadvise")
        self._base_d, self._base_p = os.path.join(rk, "desc.npy"), os.path.join(rk, "pts.npy")
        self._fd_d = self._fd_p = None
        self.D = self.P = None
        self._off_d = self._npy_data_offset(self._base_d)
        self._off_p = self._npy_data_offset(self._base_p)
        # Basfilen: en migreringsomgång som bokfördes men dog före kapningen lämnar rader kvar.
        for path, off, row in ((self._base_d, self._off_d, 128), (self._base_p, self._off_p, 8)):
            try:
                if off is not None and os.path.getsize(path) > off + self.base_rows * row:
                    os.truncate(path, off + self.base_rows * row)
            except OSError as e:
                print(f"kunde inte kapa {path}: {e}", flush=True)
        self._open_base()
        cm = os.path.join(data_dir, "cards-meta.json")
        self.image_urls = json.load(open(cm)) if os.path.exists(cm) else {}
        # Kortets språk (EN/JP) — SPRÅKTVILLINGAR avgörs alltid på textytan, se identify().
        cl = os.path.join(data_dir, "cards-lang.json")
        self.langs = json.load(open(cl)) if os.path.exists(cl) else {}
        for f in (os.path.join(rk, "meta.json"), cm, cl):
            _drop_cache(f)
        self.sift = cv2.SIFT_create(nfeatures=QUERY_KP)
        self.matcher = cv2.BFMatcher(cv2.NORM_L2)
        self._grays = OrderedDict()  # regionkontrollens referensbilder, LRU
        self.emb = None
        if EMB_VERSION:
            try:
                self._load_emb(os.path.join(data_dir, "emb", EMB_VERSION))
            except Exception as e:  # motorn ska aldrig dö på en valfri del
                print(f"embedding av: {e}", flush=True)

    # ---------- inlärd bildvektor ----------
    def _load_emb(self, d):
        import onnxruntime as ort
        if not os.path.exists(os.path.join(d, "model.onnx")):
            print(f"embedding saknas i {d}", flush=True)
            return
        so = ort.SessionOptions()
        so.intra_op_num_threads = int(os.environ.get("CV_THREADS", "4"))
        so.inter_op_num_threads = 1
        # Minnet före farten: arenan behåller toppallokeringen för alltid.
        so.enable_cpu_mem_arena = False
        so.enable_mem_pattern = False
        sess = ort.InferenceSession(os.path.join(d, "model.onnx"), so, providers=["CPUExecutionProvider"])
        # Modellen (191 MB) är inläst i sessionen — släpp filens sidcache. Mätt 2026-10-14 i loggarna:
        # cgroupens "file" låg på 200–440 MB ovanpå 650 MB anon, och Railway fakturerar båda.
        _drop_cache(os.path.join(d, "model.onnx"))
        ids = json.load(open(os.path.join(d, "ids.json")))
        G = np.load(os.path.join(d, "gallery.npy"))
        add_ids, add_g = os.path.join(d, "ids-add.json"), os.path.join(d, "gallery-add.npy")
        if os.path.exists(add_ids) and os.path.exists(add_g):
            ids = ids + json.load(open(add_ids))
            G = np.concatenate([G, np.load(add_g)])
        index = faiss.IndexScalarQuantizer(G.shape[1], faiss.ScalarQuantizer.QT_fp16, faiss.METRIC_INNER_PRODUCT)
        index.add(G.astype(np.float32))
        del G
        self.emb = {"sess": sess, "index": index, "ids": ids, "dir": d, "added_ids": [], "added": []}
        for f in ("gallery.npy", "ids.json", "gallery-add.npy", "ids-add.json"):
            _drop_cache(os.path.join(d, f))
        print(f"embedding {EMB_VERSION}: {len(ids)} kort", flush=True)

    def _embed(self, bgr):
        x = cv2.resize(bgr, (EMB_SIDE, EMB_SIDE), interpolation=cv2.INTER_AREA)
        x = (x[:, :, ::-1].astype(np.float32) / 255.0 - 0.5) / 0.5
        return self.emb["sess"].run(None, {"pixel_values": np.ascontiguousarray(x.transpose(2, 0, 1)[None])})[0][0]

    def _emb_top(self, bgr, k):
        sc, ix = self.emb["index"].search(self._embed(bgr)[None].astype(np.float32), k)
        ids = self.emb["ids"]
        return [(ids[i], float(v)) for i, v in zip(ix[0], sc[0]) if i >= 0]

    def emb_missing(self):
        """Kort motorn känner men som saknar bildvektor (tillkomna via add_cards före embeddingen)."""
        if not self.emb:
            return []
        have = set(self.emb["ids"])
        return [c for c in self.ids if c not in have and self.image_urls.get(c)]

    def emb_add(self, cid, bgr):
        v = self._embed(bgr).astype(np.float32)
        self.emb["index"].add(v[None])
        self.emb["ids"].append(cid)
        self.emb["added_ids"].append(cid)
        self.emb["added"].append(v.astype(np.float16))

    def emb_persist(self):
        e = self.emb
        if not e or not e["added_ids"]:
            return
        d = e["dir"]
        ids_path, g_path = os.path.join(d, "ids-add.json"), os.path.join(d, "gallery-add.npy")
        prev_ids = json.load(open(ids_path)) if os.path.exists(ids_path) else []
        new = np.stack(e["added"])
        prev_g = np.load(g_path) if os.path.exists(g_path) else np.zeros((0, new.shape[1]), np.float16)
        np.save(g_path + ".tmp.npy", np.concatenate([prev_g, new]))
        with open(ids_path + ".tmp", "w") as f:
            json.dump(prev_ids + e["added_ids"], f)
        os.replace(g_path + ".tmp.npy", g_path)
        os.replace(ids_path + ".tmp", ids_path)
        e["added_ids"], e["added"] = [], []
        _drop_cache(g_path)
        _drop_cache(ids_path)

    def refresh_urls(self, urls):
        """Byt bild-URL för kort motorn redan känner, när katalogen fått en ny (2026-10-08: 406 JP-kort
        gav 404 — värden hade flyttat bilderna, katalogen hade redan de nya länkarna). Nyckelpunkterna
        räknas INTE om: bilden är samma kort, bara på en ny adress. Utan bytet kan motorn varken ge
        kortet en bildvektor eller hämta referensbilden för geometrikontrollen."""
        changed = 0
        for cid, url in urls.items():
            if url and cid in self.offsets and self.image_urls.get(cid) != url:
                self.image_urls[cid] = url
                self._grays.pop(cid, None)
                changed += 1
        if changed:
            path = os.path.join(self.dir, "cards-meta.json")
            with open(path + ".tmp", "w") as f:
                json.dump(self.image_urls, f)
            os.replace(path + ".tmp", path)
        return changed

    def fetch_bgr(self, cid):
        """Referensbilden i färg (för bildvektorns påfyllning av kort som saknar vektor)."""
        url = self.image_urls.get(cid)
        if not url:
            return None
        req = urllib.request.Request(url, headers={"User-Agent": "Foilio/1.0 (+https://foilio.se)"})
        buf = urllib.request.urlopen(req, timeout=20).read()
        return cv2.imdecode(np.frombuffer(buf, np.uint8), cv2.IMREAD_COLOR)

    # ---------- referenser ----------
    @staticmethod
    def _npy_data_offset(path):
        """Var datat börjar i en .npy-fil (efter huvudet); None om filen saknas."""
        if not os.path.exists(path):
            return None
        with open(path, "rb") as f:
            ver = np.lib.format.read_magic(f)
            (np.lib.format.read_array_header_1_0 if ver == (1, 0) else np.lib.format.read_array_header_2_0)(f)
            return f.tell()

    def _open_base(self):
        """Öppnar basfilerna för läsning. Radantalet tas ur `base_rows`, inte ur .npy-huvudet —
        migreringen kapar filerna bakifrån och huvudet säger då för mycket."""
        if self.base_rows <= 0 or self._off_d is None or self._off_p is None:
            return
        if self._pread:
            self._fd_d = os.open(self._base_d, os.O_RDONLY)
            self._fd_p = os.open(self._base_p, os.O_RDONLY)
        else:
            self.D = np.memmap(self._base_d, dtype=np.uint8, mode="r", offset=self._off_d, shape=(self.base_rows, 128))
            self.P = np.memmap(self._base_p, dtype=np.float32, mode="r", offset=self._off_p, shape=(self.base_rows, 2))

    def _close_base(self):
        for fd in (self._fd_d, self._fd_p):
            if fd is not None:
                os.close(fd)
        self._fd_d = self._fd_p = None
        for arr in (self.D, self.P):
            mm = getattr(arr, "_mmap", None)
            if mm is not None:
                mm.close()
        self.D = self.P = None

    def _read_rows(self, fd, data_off, row_bytes, a, n, dtype, cols):
        start = data_off + a * row_bytes
        buf = os.pread(fd, n * row_bytes, start)
        os.posix_fadvise(fd, start, n * row_bytes, os.POSIX_FADV_DONTNEED)
        return np.frombuffer(buf, dtype=dtype).reshape(n, cols)

    def _raw_rows(self, a, n):
        """Ett korts OKOMPRIMERADE rader (punkter float32, beskrivningar uint8) ur bas- eller tilläggsfilen."""
        if a >= self.n_base:  # tillagt av add_cards före blocken — tilläggsfilerna, läs rakt av
            r = a - self.n_base
            with open(self._add_p, "rb") as fp, open(self._add_d, "rb") as fd:
                fp.seek(r * 8)
                pts = np.frombuffer(fp.read(n * 8), dtype=np.float32).reshape(n, 2)
                fd.seek(r * 128)
                des = np.frombuffer(fd.read(n * 128), dtype=np.uint8).reshape(n, 128)
            return pts, des
        if self._pread:
            return (self._read_rows(self._fd_p, self._off_p, 8, a, n, np.float32, 2),
                    self._read_rows(self._fd_d, self._off_d, 128, a, n, np.uint8, 128))
        return np.array(self.P[a : a + n]), np.array(self.D[a : a + n])

    @staticmethod
    def _pack_block(pts, des):
        """Punkter + beskrivningar → ett zlib-block. Förlustfritt (se `_unpack_block`)."""
        return zlib.compress(np.ascontiguousarray(pts, dtype="<f4").tobytes() + np.ascontiguousarray(des, dtype=np.uint8).tobytes(), 6)

    @staticmethod
    def _unpack_block(blob, n):
        raw = zlib.decompress(blob)
        if len(raw) != n * 136:
            raise ValueError(f"block: {len(raw)} byte, väntade {n * 136}")
        pts = np.frombuffer(raw, dtype="<f4", count=n * 2).reshape(n, 2)
        des = np.frombuffer(raw, dtype=np.uint8, offset=n * 8).reshape(n, 128)
        return pts, des

    def _read_block(self, b):
        off, length, n = b
        if self._pread:
            if self._blk_fd is None:
                self._blk_fd = os.open(self._blk, os.O_RDONLY)
            blob = os.pread(self._blk_fd, length, off)
            os.posix_fadvise(self._blk_fd, off, length, os.POSIX_FADV_DONTNEED)
        else:
            with open(self._blk, "rb") as f:
                f.seek(off)
                blob = f.read(length)
        return self._unpack_block(blob, n)

    def _ref(self, cid):
        b = self.blocks.get(cid)
        if b:
            pts, des = self._read_block(b)
            return pts, des.astype(np.float32) / 255.0
        off = self.offsets.get(cid)
        if not off or off[0] < 0:
            return None
        pts, des = self._raw_rows(off[0], off[1])
        return pts, des.astype(np.float32) / 255.0

    def _persist_meta(self):
        """Bara refkp/meta.json (atomiskt). Migreringen skriver den per omgång — hela `_persist` skriver
        om indexet (230 MB), och det utrymmet finns inte förrän migreringen är klar."""
        path = os.path.join(self.rk_dir, "meta.json")
        with open(path + ".tmp", "w") as f:
            json.dump({"offsets": self.offsets, "shapes": self.shapes, "n": self.n_base, "n_add": self.n_add,
                       "base_rows": self.base_rows, "blocks": self.blocks, "ref_kp": 600}, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(path + ".tmp", path)
        _drop_cache(path)

    def migrate_pending(self):
        """Antal kort som fortfarande ligger okomprimerade."""
        return sum(1 for cid, off in self.offsets.items() if off[0] >= 0 and cid not in self.blocks)

    def migrate_step(self, chunk_bytes=32 * 2**20):
        """
        EN omgång av flytten till komprimerade block (2026-11-24). Tar de SISTA okomprimerade korten i
        filen (först tilläggsfilerna, sedan basfilen), packar dem, KONTROLLERAR att uppackningen ger
        exakt samma byte, skriver blocken, bokför dem i meta.json och kapar FÖRST DÄREFTER originalet.
        Bakifrån, för att en kapning ska ge tillbaka utrymmet direkt — volymen har inte plats för en
        kopia. Tål ett avbrott var som helst: före bokföringen är originalet orört (blockfilens svans
        kapas vid start), efter den kapar starten originalet till det bokförda radantalet.
        Motorn svarar som vanligt under tiden — `_ref` läser blocket om det finns, annars raderna.
        """
        pending = sorted((off[0], off[1], cid) for cid, off in self.offsets.items() if off[0] >= 0 and cid not in self.blocks)
        if not pending:
            return self._migrate_finish()
        free = self.disk_free_mb()
        if free is not None and free < chunk_bytes // 2**20 + 16:
            return {"done": False, "stalled": True, "freeMb": free, "pending": len(pending)}
        in_add = pending[-1][0] >= self.n_base
        tail, size, i = [], 0, len(pending) - 1
        while i >= 0 and size < chunk_bytes and (pending[i][0] >= self.n_base) == in_add:
            tail.append(pending[i])
            size += pending[i][1] * 136
            i -= 1
        new_blocks, blobs, pos = {}, [], self._blk_size
        for a, n, cid in tail:
            pts, des = self._raw_rows(a, n)
            blob = self._pack_block(pts, des)
            p2, d2 = self._unpack_block(blob, n)
            if not (np.array_equal(np.asarray(pts, dtype="<f4"), p2) and np.array_equal(des, d2)):
                raise RuntimeError(f"block för {cid} stämmer inte med originalet — avbryter migreringen")
            new_blocks[cid] = [pos, len(blob), n]
            blobs.append(blob)
            pos += len(blob)
        with open(self._blk, "ab") as f:
            for blob in blobs:
                f.write(blob)
            f.flush()
            os.fsync(f.fileno())
        _drop_cache(self._blk)  # det nyss skrivna ligger annars kvar i sidcachen (räknas som minne)
        first = min(a for a, _, _ in tail)  # allt från den här raden och framåt är nu block
        self.blocks.update(new_blocks)
        self._blk_size = pos
        if in_add:
            self.n_add = first - self.n_base
        else:
            self.base_rows = first
        self._persist_meta()
        if in_add:
            os.truncate(self._add_d, self.n_add * 128)
            os.truncate(self._add_p, self.n_add * 8)
        else:
            self._close_base()  # Windows: en mappad fil går inte att kapa
            os.truncate(self._base_d, self._off_d + self.base_rows * 128)
            os.truncate(self._base_p, self._off_p + self.base_rows * 8)
            self._open_base()
        return {"done": False, "moved": len(tail), "pending": len(pending) - len(tail), "freeMb": self.disk_free_mb()}

    def _migrate_finish(self):
        """Allt ligger i block: ta bort de tömda tilläggsfilerna (basfilerna är bara huvudet kvar)."""
        for path in (self._add_d, self._add_p):
            try:
                if os.path.exists(path) and os.path.getsize(path) == 0:
                    os.remove(path)
            except OSError:
                pass
        return {"done": True, "pending": 0, "freeMb": self.disk_free_mb()}

    def _ref_gray(self, cid):
        if cid in self._grays:
            self._grays.move_to_end(cid)
            return self._grays[cid]
        img = None
        local = os.path.join(self.dir, "refs", f"{cid}.jpg")
        if os.path.exists(local):
            img = cv2.imread(local, cv2.IMREAD_GRAYSCALE)
        elif self.image_urls.get(cid):
            try:
                req = urllib.request.Request(self.image_urls[cid], headers={"User-Agent": "Foilio/1.0 (+https://foilio.se)"})
                buf = urllib.request.urlopen(req, timeout=10).read()
                img = cv2.imdecode(np.frombuffer(buf, np.uint8), cv2.IMREAD_GRAYSCALE)
            except Exception:
                img = None
        if img is not None:
            h, w = img.shape
            img = cv2.resize(img, (int(w * 480 / h), 480), interpolation=cv2.INTER_AREA)
        self._grays[cid] = img
        while len(self._grays) > 64:
            self._grays.popitem(last=False)
        return img

    # ---------- steg A ----------
    def _candidates(self, rs):
        dist, nb = self.index.search(np.ascontiguousarray(rs * 255), 6)
        own = self.owners[np.clip(nb, 0, None)]
        votes = {}
        for r in range(len(nb)):
            if nb[r, 0] < 0:
                continue
            first = own[r, 0]
            d2 = next((dist[r, k] for k in range(1, nb.shape[1]) if own[r, k] != first), dist[r, -1])
            if d2 <= 0:
                continue
            w = 1.0 - dist[r, 0] / d2
            if w > 0:
                votes[first] = votes.get(first, 0.0) + w
            seen = {first}
            for k in range(1, nb.shape[1]):
                o = own[r, k]
                if nb[r, k] >= 0 and o not in seen:
                    seen.add(o)
                    votes[o] = votes.get(o, 0.0) + 0.05
        top = sorted(votes.items(), key=lambda kv: -kv[1])[:TOP_K]
        return [(self.ids[i], v) for i, v in top]

    # ---------- steg B ----------
    def _distinctive(self, kq, dq, cands):
        feats = {c: self._ref(c) for c in cands}
        feats = {c: f for c, f in feats.items() if f is not None and len(f[0]) >= 8}
        if not feats:
            return {}, {}
        order = list(feats)
        D = np.vstack([feats[c][1] for c in order])
        own = np.concatenate([np.full(len(feats[c][1]), k) for k, c in enumerate(order)])
        loc = np.concatenate([np.arange(len(feats[c][1])) for c in order])
        per = {}
        for ms in self.matcher.knnMatch(dq, D, k=8):
            if not ms:
                continue
            o1 = own[ms[0].trainIdx]
            d2 = next((m.distance for m in ms[1:] if own[m.trainIdx] != o1), None)
            if d2 is not None and ms[0].distance >= RATIO * d2:
                continue
            per.setdefault(o1, []).append((ms[0].queryIdx, loc[ms[0].trainIdx]))
        scores, homs = {}, {}
        for k, lst in per.items():
            if len(lst) < 8:
                continue
            c = order[k]
            src = np.float32([kq[a].pt for a, _ in lst]).reshape(-1, 1, 2)
            dst = feats[c][0][[b for _, b in lst]].reshape(-1, 1, 2)
            H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 6.0)
            if H is not None:
                scores[c] = int(mask.sum())
        return scores, feats

    def _full_h(self, kq, dq, cid):
        """Homografi foto → referens på ALLA matchningar (regionkontrollen behöver kortets hela yta)."""
        f = self._ref(cid)
        if f is None:
            return None
        pairs = self.matcher.knnMatch(dq, f[1], k=2)
        good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.8 * n.distance]
        if len(good) < 8:
            return None
        src = np.float32([kq[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
        dst = f[0][[m.trainIdx for m in good]].reshape(-1, 1, 2)
        H, _ = cv2.findHomography(src, dst, cv2.RANSAC, 6.0)
        return H

    def _same_art_h(self, a, b):
        """Homografi referens B → referens A om de har samma konst (≥ 40 inliers), annars None."""
        fa, fb = self._ref(a), self._ref(b)
        if fa is None or fb is None:
            return None
        pairs = self.matcher.knnMatch(fb[1], fa[1], k=2)
        good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.8 * n.distance]
        if len(good) < 40:
            return None
        src = fb[0][[m.queryIdx for m in good]].reshape(-1, 1, 2)
        dst = fa[0][[m.trainIdx for m in good]].reshape(-1, 1, 2)
        H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 6.0)
        return H if H is not None and mask.sum() >= 40 else None

    def _region(self, photo, H_pa, a, b):
        H_ba = self._same_art_h(a, b)
        if H_ba is None:
            return None
        ga, gb = self._ref_gray(a), self._ref_gray(b)
        if ga is None or gb is None:
            return None
        # referenspunkterna är räknade på 480 px höjd — samma skala som ga/gb
        h, w = ga.shape
        wb = cv2.warpPerspective(gb, H_ba, (w, h))
        vb = cv2.warpPerspective(np.full_like(gb, 255), H_ba, (w, h)) > 0
        wp = cv2.warpPerspective(photo, H_pa, (w, h))
        vp = cv2.warpPerspective(np.full_like(photo, 255), H_pa, (w, h)) > 0
        valid = cv2.erode((vb & vp).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
        if valid.sum() < 1000:
            return None
        na, nb, npp = _norm(ga), _norm(wb), _norm(wp)
        d = cv2.GaussianBlur(np.abs(na - nb), (0, 0), 3)
        d[~valid] = 0
        mask = (d >= np.percentile(d[valid], 92)) & valid
        return float(np.abs(npp - na)[mask].mean()), float(np.abs(npp - nb)[mask].mean())

    # ---------- publikt ----------
    def identify(self, image_bytes):
        t0 = time.time()
        color = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if color is None:
            return {"error": "bad-image"}
        arr = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY)
        photo = _gray(arr, QUERY_SIDE)
        emb_top = self._emb_top(color, max(EMB_K, 5)) if self.emb else []
        del color
        kq, des = self.sift.detectAndCompute(photo, None)
        if des is None or len(kq) < 8:
            if emb_top:  # ingen geometri alls — bildvektorn är det enda som finns
                return {"best": emb_top[0][0], "candidates": [{"cardId": c, "inliers": 0} for c, _ in emb_top],
                        "embTop": [c for c, _ in emb_top], "embScore": round(emb_top[0][1], 4), "embDecided": True,
                        "ms": int((time.time() - t0) * 1000)}
            return {"candidates": [], "ms": int((time.time() - t0) * 1000), "reason": "no-features"}
        dq = _root_sift(des)
        stage_a = self._candidates(dq)
        cands = [c for c, _ in stage_a]
        # Bildvektorns förslag FÖRST i kön (de saknar SIFT-röster) — steg B verifierar dem som alla andra.
        cands = [c for c, _ in emb_top[:EMB_K] if c not in cands] + cands
        t_a = time.time()
        scores, _ = self._distinctive(kq, dq, cands)
        ranked = sorted(scores.items(), key=lambda kv: -kv[1])
        best = ranked[0][0] if ranked else (cands[0] if cands else None)
        swapped = None
        if ranked:
            H = self._full_h(kq, dq, best)
            if H is not None:
                for rival, sc in ranked[1:6]:
                    if sc < 0.5 * ranked[0][1]:
                        break
                    rc = self._region(photo, H, best, rival)
                    if rc and rc[1] < rc[0] * REGION_WIN:
                        swapped, best = best, rival
                        break
        # SPRÅKTVILLINGEN (2026-09-30, ägarens JP-batch): samma konst på engelska och japanska ger
        # få DISTINKTA punkter åt båda (konsten delas), så tvillingen klarade inte grinden ovan och
        # motorn valde engelska i 12 av 20 fel. Japansk och latinsk skrift ser helt olika ut i
        # textrutan ⇒ jämför ALLTID mot den bästa tvillingen på det andra språket, oavsett poäng.
        # (Samma-språk-omtryck går fortfarande bara via grinden — ogrindat gjorde Tradera sämre.)
        lang_swap = None
        if best and not swapped and self.langs.get(best):
            H = self._full_h(kq, dq, best)
            if H is not None:
                pool = [c for c, _ in ranked] + [c for c in cands if c not in scores]
                for rival in pool[:TOP_K]:
                    if rival == best or not self.langs.get(rival) or self.langs[rival] == self.langs[best]:
                        continue
                    rc = self._region(photo, H, best, rival)
                    if rc is None:
                        continue  # inte samma konst — inte en tvilling
                    if rc[1] < rc[0] * REGION_WIN:
                        lang_swap, best = best, rival
                    break
        # RESERV: för få geometriska bevis (suddigt, mörkt, bländning) ⇒ bildvektorns etta. Aldrig när
        # en språk-/omtryckskontroll redan bytt — den hade geometri att stå på.
        emb_decided = False
        if emb_top and not swapped and not lang_swap and scores.get(best, 0) < EMB_FALLBACK_INLIERS:
            if best != emb_top[0][0]:
                best, emb_decided = emb_top[0][0], True
        order = [best] + [c for c, _ in ranked if c != best] + [c for c in cands if c != best and c not in scores]
        return {
            "best": best,
            "candidates": [{"cardId": c, "inliers": scores.get(c, 0)} for c in order[:TOP_K]],
            "embTop": [c for c, _ in emb_top[:5]],
            # Bildvektorns likhet (cos) med sin etta (2026-10-14) — andra signalen för "inget kort i bilden".
            "embScore": round(emb_top[0][1], 4) if emb_top else None,
            "embDecided": emb_decided,
            "regionSwapFrom": swapped or lang_swap,
            "msA": int((t_a - t0) * 1000),
            "ms": int((time.time() - t0) * 1000),
        }

    def disk_free_mb(self):
        """Ledigt på volymen i MB; None där statvfs saknas (Windows, lokal mätning)."""
        try:
            st = os.statvfs(self.dir)
            return st.f_bavail * st.f_frsize // 2**20
        except (AttributeError, OSError):
            return None

    # ---------- påfyllning ----------
    def add_cards(self, cards):
        """
        NYA KORT UTAN OMBYGGE (2026-09-30): kort som tillkommit i katalogen läggs till av motorn själv —
        referensbilden hämtas, SIFT räknas (300 punkter till indexet, 600 till refkp) och allt skrivs
        till volymen. IVF-PQ behöver ingen omträning för nya vektorer. Anropas av webbens cron-rutt
        (/api/cron/engine-sync) med de kort motorn saknar. `cards` = [{id, imageUrl, language}].
        """
        # ⛔ Kolla utrymmet FÖRE arbetet: _persist skriver om hela indexet som tmp + replace, alltså en
        # hel kopia till. Utan plats dog anropet mitt i (500 fyra nätter i rad, 2026-11-21 → 11-24) och
        # lämnade obokförda rader efter sig. Hellre ett tydligt "disk-full" som anroparen kan visa.
        free = self.disk_free_mb()
        need = os.path.getsize(os.path.join(self.nn_dir, "ivfpq.faiss")) // 2**20 + 24
        if free is not None and free < need:
            return {"added": 0, "failed": [], "failedCount": 0, "cards": len(self.ids),
                    "error": "disk-full", "freeMb": free, "needMb": need}
        added, failed = [], []
        vecs, owners_add = [], []
        with open(self._blk, "ab") as fb:
            for c in cards:
                cid, url = c.get("id"), c.get("imageUrl")
                if not cid or not url or cid in self.offsets:
                    continue
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "Foilio/1.0 (+https://foilio.se)"})
                    buf = urllib.request.urlopen(req, timeout=20).read()
                    col = cv2.imdecode(np.frombuffer(buf, np.uint8), cv2.IMREAD_COLOR)
                    if col is None:
                        raise ValueError("bild")
                    img = cv2.cvtColor(col, cv2.COLOR_BGR2GRAY)
                    h, w = img.shape
                    img = cv2.resize(img, (int(w * 480 / h), 480), interpolation=cv2.INTER_AREA)
                    _, d_nn = cv2.SIFT_create(nfeatures=300).detectAndCompute(img, None)
                    kp, d_rk = cv2.SIFT_create(nfeatures=600).detectAndCompute(img, None)
                    if d_nn is None or len(d_nn) < 10 or d_rk is None or len(d_rk) < 8:
                        raise ValueError("för få punkter")
                except Exception as e:
                    failed.append({"id": cid, "error": str(e)[:80]})
                    continue
                card_idx = len(self.ids)
                self.ids.append(cid)
                v = (_root_sift(d_nn)[:300] * 255).astype(np.uint8)
                vecs.append(v)
                owners_add.append(np.full(len(v), card_idx, np.int32))
                r = (_root_sift(d_rk)[:600] * 255).astype(np.uint8)
                pts = np.float32([k.pt for k in kp])[:600]
                # Nya kort skrivs direkt som komprimerade block (aldrig mer i tilläggsfilerna).
                blob = self._pack_block(pts, r)
                fb.write(blob)
                self.blocks[cid] = [self._blk_size, len(blob), len(r)]
                self._blk_size += len(blob)
                self.offsets[cid] = [-1, len(r)]  # -1 = finns bara som block
                self.shapes[cid] = [480, int(w * 480 / h)]
                self.image_urls[cid] = url
                if c.get("language"):
                    self.langs[cid] = c["language"]
                if self.emb:
                    self.emb_add(cid, col)
                added.append(cid)
        if added:
            self.index.add(np.vstack(vecs).astype(np.float32))
            self.owners = _owners_dtype(np.concatenate([self.owners.astype(np.int32)] + owners_add), len(self.ids))
            self._persist()
            self.emb_persist()
            # Det nyss skrivna ligger i sidcachen — släpp det (cgroupen räknar den som minne).
            _drop_cache(self._blk)
        return {"added": len(added), "failed": failed[:20], "failedCount": len(failed), "cards": len(self.ids)}

    def _persist(self):
        """Skriv allt atomiskt (tmp + replace) så en omstart mitt i aldrig lämnar halva filer."""
        def dump_json(path, obj):
            with open(path + ".tmp", "w") as f:
                json.dump(obj, f)
            os.replace(path + ".tmp", path)
        faiss.write_index(self.index, os.path.join(self.nn_dir, "ivfpq.faiss.tmp"))
        os.replace(os.path.join(self.nn_dir, "ivfpq.faiss.tmp"), os.path.join(self.nn_dir, "ivfpq.faiss"))
        np.save(os.path.join(self.nn_dir, "owners.tmp.npy"), self.owners)
        os.replace(os.path.join(self.nn_dir, "owners.tmp.npy"), os.path.join(self.nn_dir, "owners.npy"))
        dump_json(os.path.join(self.nn_dir, "cards.json"), self.ids)
        self._persist_meta()
        dump_json(os.path.join(self.dir, "cards-meta.json"), self.image_urls)
        dump_json(os.path.join(self.dir, "cards-lang.json"), self.langs)
        # Skrivna filer stannar i sidcachen (ivfpq ensam 171 MB) — släpp dem, allt är redan i processen.
        for f in (os.path.join(self.nn_dir, "ivfpq.faiss"), os.path.join(self.nn_dir, "owners.npy"),
                  os.path.join(self.nn_dir, "cards.json"), os.path.join(self.rk_dir, "meta.json"),
                  os.path.join(self.dir, "cards-meta.json"), os.path.join(self.dir, "cards-lang.json")):
            _drop_cache(f)
