"""
Mäter vad MINDRE LAGRING per kort gör med motorns träffsäkerhet (2026-11-24, volymen full).

Motorn lagrar 600 nyckelpunkter × 128 byte per kort (refkp) = ~82 kB/kort, 80 % av volymen.
Här körs SAMMA motor (scanner-engine/engine.py) mot facit-seten med referensdatat nedskuret i
minnet — ingenting skrivs om på disk:
  k<N>     högst N punkter per kort (slumpat urval, fast frö per kort = pessimistiskt: ett riktigt
           bygge väljer de starkaste)
  pca<D>   beskrivningarna projicerade till D dimensioner + kvantiserade till uint8 (som de skulle
           lagras); fotots beskrivningar projiceras i flyttal vid matchningen
Indexet (kandidatsöket) rörs inte — bara geometrikontrollens referensdata.

  .spike/venv-engine/Scripts/python.exe scripts/scanner-proto/storage_eval.py [variant,variant…]
Resultat: .spike/storage-eval.json (skrivs efter varje variant × set) + rader på stdout.
"""
import json, os, sys, time, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..", ".spike")
sys.path.insert(0, os.path.join(HERE, "..", "..", "scanner-engine"))
os.environ.setdefault("EMB_VERSION", "sig1")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import engine as E  # noqa: E402

OUT = os.path.join(ROOT, "storage-eval.json")
VARIANTS = {
    "base": (0, 0),
    "k400": (400, 0),
    "k300": (300, 0),
    "pca64": (0, 64),
    "pca48": (0, 48),
    "pca64k400": (400, 64),
}
SETS = {
    "app": ("facit", "facit.json"),
    "tradera": ("tradera-facit", "labels-600.json"),
    "hard": ("tradera-hard", "labels.json"),
}


def load_set(name):
    d, f = SETS[name]
    rows = json.load(open(os.path.join(ROOT, d, f), encoding="utf-8"))
    out = []
    for r in rows:
        truth = r.get("truthCardId")
        p = os.path.join(ROOT, d, r["file"])
        if truth and os.path.exists(p):
            out.append((p, truth))
    return out


def main():
    want = sys.argv[1].split(",") if len(sys.argv) > 1 else list(VARIANTS)
    sets = sys.argv[2].split(",") if len(sys.argv) > 2 else list(SETS)
    eng = E.Engine(os.environ.get("DATA_DIR", os.path.join(ROOT, "engine-data")))
    print(f"motor: {len(eng.ids)} kort", flush=True)

    # PCA ur ett urval av referensbeskrivningarna (samma /255-skala som motorn matchar i).
    D = np.load(os.path.join(eng.rk_dir, "desc.npy"), mmap_mode="r")
    rs = np.random.RandomState(7)
    idx = np.sort(rs.choice(D.shape[0], 400_000, replace=False))
    X = np.asarray(D[idx], dtype=np.float32) / 255.0
    mean = X.mean(axis=0)
    cov = np.cov((X - mean).T)
    w, v = np.linalg.eigh(cov)
    order = np.argsort(w)[::-1]
    W_all = v[:, order].astype(np.float32)
    var = w[order] / w.sum()
    print("PCA: förklarad varians 32/48/64/96 dim = " + " / ".join(f"{var[:d].sum():.3f}" for d in (32, 48, 64, 96)), flush=True)
    Y = (X - mean) @ W_all
    lo_all, hi_all = np.percentile(Y, 0.05, axis=0).astype(np.float32), np.percentile(Y, 99.95, axis=0).astype(np.float32)
    del X, Y

    orig_ref = eng._ref
    bf = cv2.BFMatcher(cv2.NORM_L2)
    state = {"K": 0, "dim": 0}

    def project(des):
        d = state["dim"]
        return (des - mean) @ W_all[:, :d]

    def stored(des):
        """Som det skulle ligga på disk: uint8 per dimension, och tillbaka till flyttal vid läsning."""
        d = state["dim"]
        y = project(des)
        lo, hi = lo_all[:d], hi_all[:d]
        q = np.clip(np.rint((y - lo) / (hi - lo) * 255.0), 0, 255)
        return (q / 255.0 * (hi - lo) + lo).astype(np.float32)

    def ref(cid):
        f = orig_ref(cid)
        if f is None:
            return None
        pts, des = f
        K = state["K"]
        if K and len(des) > K:
            pick = np.sort(np.random.RandomState(zlib.crc32(cid.encode()) & 0x7FFFFFFF).choice(len(des), K, replace=False))
            pts, des = pts[pick], des[pick]
        if state["dim"]:
            des = stored(des)
        return pts, des

    class Matcher:
        def knnMatch(self, q, t, k=2):
            if state["dim"] and q.shape[1] == 128:
                q = project(q).astype(np.float32)
            return bf.knnMatch(np.ascontiguousarray(q, dtype=np.float32), np.ascontiguousarray(t, dtype=np.float32), k=k)

    eng._ref = ref
    eng.matcher = Matcher()

    results = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {}
    data = {s: load_set(s) for s in sets}
    for name in want:
        K, dim = VARIANTS[name]
        state["K"], state["dim"] = K, dim
        eng._grays.clear()
        per_card_kb = ((K or 600) * ((dim or 128) + 8)) / 1000
        for s in sets:
            items = data[s]
            right, wrong, times, t0 = 0, [], [], time.time()
            for p, truth in items:
                cv2.setRNGSeed(0)
                r = eng.identify(open(p, "rb").read())
                ok = r.get("best") == truth
                right += ok
                if not ok:
                    wrong.append(os.path.basename(p))
                times.append(r.get("ms", 0))
            times.sort()
            results.setdefault(name, {})[s] = {
                "right": right, "n": len(items), "pct": round(100 * right / max(1, len(items)), 2),
                "medianMs": times[len(times) // 2] if times else 0, "wrong": wrong, "kbPerCard": per_card_kb,
            }
            json.dump(results, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
            print(f"{name:10s} {s:8s} {right}/{len(items)} = {100 * right / max(1, len(items)):.1f} % · median {results[name][s]['medianMs']} ms · {per_card_kb:.1f} kB/kort · {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    main()
