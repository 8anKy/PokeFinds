"""Hybrid: embedding (SigLIP) föreslår kandidater, motorn (SIFT + RANSAC + regionkontroll) verifierar.
Mäter mot samma facit som embed_eval.py. Embeddingens topp-20 läses ur .spike/emb/top-<tag>-<set>.npy.

  python -I scripts/scanner-proto/hybrid_eval.py siglip2-base [LIMIT]
"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "scanner-engine"))
import numpy as np
import engine as E

ROOT = os.path.join(HERE, "..", "..", ".spike")
tag = sys.argv[1]
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10 ** 9
ids = sorted(f[:-4] for f in os.listdir(os.path.join(ROOT, "refs")) if f.endswith(".jpg"))
pos = {c: i for i, c in enumerate(ids)}


class Hybrid(E.Engine):
    extra = []
    mode = "union"

    def _candidates(self, rs):
        a = super()._candidates(rs) if self.mode != "emb" else []
        have = {c for c, _ in a}
        if self.mode == "sift":
            return a
        # embeddingens topp-K först i kön (de saknar SIFT-röster), sedan SIFT:s
        return [(c, 0.0) for c in self.extra if c not in have] + a


eng = Hybrid(os.path.join(ROOT, "engine-data"))
sets = {
    "app-101": [(os.path.join(ROOT, "facit-0929", f["file"]), f["truthCardId"]) for f in json.load(open(os.path.join(ROOT, "facit-0929", "facit.json"), encoding="utf-8")) if f.get("truthCardId")],
    "jp-255": [(os.path.join(ROOT, "facit", f["file"]), f["truthCardId"]) for f in json.load(open(os.path.join(ROOT, "facit", "facit.json"), encoding="utf-8")) if f.get("truthCardId")],
    "tradera-2000": [(os.path.join(ROOT, "tradera-facit", l["file"]), l["truthCardId"]) for l in json.load(open(os.path.join(ROOT, "tradera-facit", "labels.json"), encoding="utf-8"))],
        "tradera-hard": [(os.path.join(ROOT, "tradera-hard", l["file"]), l["truthCardId"]) for l in json.load(open(os.path.join(ROOT, "tradera-hard", "labels.json"), encoding="utf-8"))],
}
KE = int(os.environ.get("KE", "10"))
ONLY = os.environ.get("SETS")
for sname, items in sets.items():
    if ONLY and sname not in ONLY.split(","):
        continue
    items = [(p, t) for p, t in items if os.path.exists(p) and t in pos]
    top = np.load(os.path.join(ROOT, "emb", f"top-{tag}-{sname}.npy"))
    assert len(top) == len(items), (sname, len(top), len(items))
    n = min(limit, len(items))
    res = {"sift": 0, "union": 0, "emb1": 0, "fallback": 0}
    t0 = time.time()
    for i in range(n):
        p, truth = items[i]
        raw = open(p, "rb").read()
        emb = [ids[j] for j in top[i][:KE]]
        res["emb1"] += emb[0] == truth
        Hybrid.mode = "sift"; r_s = eng.identify(raw)
        res["sift"] += r_s.get("best") == truth
        Hybrid.mode = "union"; Hybrid.extra = emb; r_u = eng.identify(raw)
        res["union"] += r_u.get("best") == truth
        # reserv: få inliers ⇒ embeddingens etta (motorn har ingen geometri att stå på)
        inl = (r_u.get("candidates") or [{}])[0].get("inliers", 0)
        fb = r_u.get("best") if inl >= int(os.environ.get("MIN_INL", "15")) else emb[0]
        res["fallback"] += fb == truth
    print(f"{tag} {sname} n={n}: SIFT-motorn {100*res['sift']/n:.1f} % · embedding etta {100*res['emb1']/n:.1f} % · "
          f"union-kandidater {100*res['union']/n:.1f} % · union + reserv {100*res['fallback']/n:.1f} % ({(time.time()-t0)/n:.2f} s/foto)", flush=True)
