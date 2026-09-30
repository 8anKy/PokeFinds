"""Kör motorn lokalt mot ägarens app-foton (.spike/facit) — samma facit som prototypen."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import Engine

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".spike")
which = sys.argv[1] if len(sys.argv) > 1 else "app"
eng = Engine(os.environ.get("DATA_DIR", ROOT))
if which == "app":
    facit = json.load(open(os.path.join(ROOT, "facit", "facit.json"), encoding="utf-8"))
    items = [(os.path.join(ROOT, "facit", f["file"]), f["truthCardId"]) for f in facit if f["truthCardId"]]
else:
    lab = json.load(open(os.path.join(ROOT, "tradera-facit", os.environ.get("LABELS", "labels-600.json")), encoding="utf-8"))
    items = [(os.path.join(ROOT, "tradera-facit", l["file"]), l["truthCardId"]) for l in lab]
right, times, t0 = 0, [], time.time()
for p, truth in items:
    r = eng.identify(open(p, "rb").read())
    right += r.get("best") == truth
    times.append(r.get("ms", 0))
times.sort()
print(f"{which}: {right}/{len(items)} = {100 * right / len(items):.1f} % · median {times[len(times) // 2]} ms · p90 {times[int(len(times) * 0.9)]} ms (EN tråd)")
