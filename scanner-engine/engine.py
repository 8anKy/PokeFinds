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
import json, os, time, urllib.request
from collections import OrderedDict

import cv2
import numpy as np
import faiss

QUERY_SIDE = int(os.environ.get("QUERY_SIDE", "1000"))
QUERY_KP = int(os.environ.get("QUERY_KP", "1500"))
TOP_K = int(os.environ.get("TOP_K", "20"))
NPROBE = int(os.environ.get("NPROBE", "32"))
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
        self.index = faiss.read_index(os.path.join(nn, "ivfpq.faiss"))
        self.index.nprobe = NPROBE
        self.owners = np.load(os.path.join(nn, "owners.npy"), mmap_mode="r")
        self.ids = json.load(open(os.path.join(nn, "cards.json")))
        rk = os.path.join(data_dir, "refkp")
        meta = json.load(open(os.path.join(rk, "meta.json")))
        self.offsets, self.shapes = meta["offsets"], meta["shapes"]
        # ⛔ INTE memmap på Linux: Railway räknar kärnans sidcache som minne (cgroup), och en memmap
        # över 2,8 GB hade vuxit med varje skanning tills hela filen låg i "minnet". Raderna läses med
        # pread och sidorna släpps direkt (POSIX_FADV_DONTNEED). Windows (lokal mätning) kör memmap.
        self._pread = hasattr(os, "pread") and hasattr(os, "posix_fadvise")
        if self._pread:
            self._fd_d, self._off_d = self._open_npy(os.path.join(rk, "desc.npy"))
            self._fd_p, self._off_p = self._open_npy(os.path.join(rk, "pts.npy"))
        else:
            self.D = np.load(os.path.join(rk, "desc.npy"), mmap_mode="r")
            self.P = np.load(os.path.join(rk, "pts.npy"), mmap_mode="r")
        cm = os.path.join(data_dir, "cards-meta.json")
        self.image_urls = json.load(open(cm)) if os.path.exists(cm) else {}
        self.sift = cv2.SIFT_create(nfeatures=QUERY_KP)
        self.matcher = cv2.BFMatcher(cv2.NORM_L2)
        self._grays = OrderedDict()  # regionkontrollens referensbilder, LRU

    # ---------- referenser ----------
    @staticmethod
    def _open_npy(path):
        with open(path, "rb") as f:
            ver = np.lib.format.read_magic(f)
            (np.lib.format.read_array_header_1_0 if ver == (1, 0) else np.lib.format.read_array_header_2_0)(f)
            data_off = f.tell()
        return os.open(path, os.O_RDONLY), data_off

    def _read_rows(self, fd, data_off, row_bytes, a, n, dtype, cols):
        start = data_off + a * row_bytes
        buf = os.pread(fd, n * row_bytes, start)
        os.posix_fadvise(fd, start, n * row_bytes, os.POSIX_FADV_DONTNEED)
        return np.frombuffer(buf, dtype=dtype).reshape(n, cols)

    def _ref(self, cid):
        off = self.offsets.get(cid)
        if not off:
            return None
        a, n = off
        if self._pread:
            pts = self._read_rows(self._fd_p, self._off_p, 8, a, n, np.float32, 2)
            des = self._read_rows(self._fd_d, self._off_d, 128, a, n, np.uint8, 128)
            return pts, des.astype(np.float32) / 255.0
        return np.asarray(self.P[a : a + n]), np.asarray(self.D[a : a + n], dtype=np.float32) / 255.0

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
        arr = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_GRAYSCALE)
        if arr is None:
            return {"error": "bad-image"}
        photo = _gray(arr, QUERY_SIDE)
        kq, des = self.sift.detectAndCompute(photo, None)
        if des is None or len(kq) < 8:
            return {"candidates": [], "ms": int((time.time() - t0) * 1000), "reason": "no-features"}
        dq = _root_sift(des)
        stage_a = self._candidates(dq)
        cands = [c for c, _ in stage_a]
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
        order = [best] + [c for c, _ in ranked if c != best] + [c for c in cands if c != best and c not in scores]
        return {
            "best": best,
            "candidates": [{"cardId": c, "inliers": scores.get(c, 0)} for c in order[:TOP_K]],
            "regionSwapFrom": swapped,
            "msA": int((t_a - t0) * 1000),
            "ms": int((time.time() - t0) * 1000),
        }
