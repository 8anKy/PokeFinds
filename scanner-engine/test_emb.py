"""Hela motorn MED bildvektorn (EMB_VERSION) mot facit — samma kod som i drift.
  EMB_VERSION=sig1 DATA_DIR=.spike/engine-data python -I scanner-engine/test_emb.py [LIMIT]
Rapporterar motorns svar (hybrid), bildvektorns etta ensam, hur ofta vektorn avgjorde och hur ofta det var rätt.
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import Engine

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".spike")
limit = int(sys.argv[1]) if len(sys.argv) > 1 else 600
eng = Engine(os.environ.get("DATA_DIR", ROOT))
assert eng.emb, "EMB_VERSION saknas eller filerna finns inte"


def load(fd, name):
    return json.load(open(os.path.join(ROOT, fd, name), encoding="utf-8"))


sets = {
    "app-101": [(os.path.join(ROOT, "facit-0929", f["file"]), f["truthCardId"]) for f in load("facit-0929", "facit.json") if f.get("truthCardId")],
    "jp-255": [(os.path.join(ROOT, "facit", f["file"]), f["truthCardId"]) for f in load("facit", "facit.json") if f.get("truthCardId")],
    "tradera-600": [(os.path.join(ROOT, "tradera-facit", l["file"]), l["truthCardId"]) for l in load("tradera-facit", "labels.json")[:limit]],
    "tradera-hard": [(os.path.join(ROOT, "tradera-hard", l["file"]), l["truthCardId"]) for l in load("tradera-hard", "labels.json")[:limit]],
}
only = os.environ.get("SETS")
for name, items in sets.items():
    if only and name not in only.split(","):
        continue
    items = [(p, t) for p, t in items if os.path.exists(p)]
    ok = emb1 = dec = dec_ok = 0
    ms = []
    for p, truth in items:
        r = eng.identify(open(p, "rb").read())
        ok += r.get("best") == truth
        emb1 += (r.get("embTop") or [None])[0] == truth
        if r.get("embDecided"):
            dec += 1
            dec_ok += r.get("best") == truth
        ms.append(r.get("ms", 0))
    ms.sort()
    n = len(items)
    print(f"{name} n={n}: motorn+vektor {100 * ok / n:.1f} % · vektorn ensam {100 * emb1 / n:.1f} % · "
          f"vektorn avgjorde {dec} ({dec_ok} rätt) · median {ms[n // 2]} ms", flush=True)
