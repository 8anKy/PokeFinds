"""
MOTORNS FASTA TESTMÄNGD (2026-10-14) — varje ändring av motorn/modellen/datan körs mot den FÖRE drift.
Noggrannhet före fart: en ändring som sänker någon mängd går inte ut.

  EMB_VERSION=sig1 DATA_DIR=.spike/engine-data python -I scanner-engine/benchmark.py --save base
  EMB_VERSION=sig1 DATA_DIR=.spike/engine-data python -I scanner-engine/benchmark.py --compare base

Mängder (.spike/, gitignorerat):
  app-101, jp-255         ägarens egna app-foton
  tradera-600, -hard      säljarfoton, och samma suddade/mörka/JPEG45
  field-strong            RIKTIGA skanningar med starkt facit (rättat/aktivt valt), scripts/scanner-photo-export.ts
                          med OUT=field-facit. ⛔ Samtyckta foton: BARA mätning, aldrig träning (policyn).
  nocard                  foton utan kort (field-facit/nocard.json) — ska ge noll geometri
Mått: etta, rätt kort bland de sex första olika korten (valstegets platser), noll-geometri-andel, median ms.
Ett facitkort som motorn inte har i sitt index räknas för sig (ingen ändring av motorn kan laga det).
"""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import Engine

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".spike")
OUT = os.path.join(ROOT, "bench")


def load(fd, name):
    p = os.path.join(ROOT, fd, name)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else []


def sets():
    field = load("field-facit", "labels.json")
    return {
        "app-101": [(os.path.join(ROOT, "facit-0929", f["file"]), f["truthCardId"]) for f in load("facit-0929", "facit.json") if f.get("truthCardId")],
        "jp-255": [(os.path.join(ROOT, "facit", f["file"]), f["truthCardId"]) for f in load("facit", "facit.json") if f.get("truthCardId")],
        "tradera-600": [(os.path.join(ROOT, "tradera-facit", l["file"]), l["truthCardId"]) for l in load("tradera-facit", "labels.json")[:600]],
        "tradera-hard": [(os.path.join(ROOT, "tradera-hard", l["file"]), l["truthCardId"]) for l in load("tradera-hard", "labels.json")[:600]],
        "field-strong": [(os.path.join(ROOT, "field-facit", l["file"]), l["truth"]["cardId"]) for l in field if l.get("strength") == "strong" and l.get("truth")],
        "nocard": [(os.path.join(ROOT, "field-facit", f), None) for f in load("field-facit", "nocard.json")],
    }


def top6(r):
    out = []
    for c in r.get("candidates") or []:
        if c["cardId"] not in out:
            out.append(c["cardId"])
        if len(out) >= 6:
            break
    return out


def run(eng, only):
    known = set(eng.ids)
    res = {}
    for name, items in sets().items():
        if only and name not in only:
            continue
        items = [(p, t) for p, t in items if os.path.exists(p)]
        if not items:
            continue
        n = len(items)
        ok1 = ok6 = zero = unknown = 0
        ms = []
        for p, truth in items:
            r = eng.identify(open(p, "rb").read())
            ms.append(r.get("ms", 0))
            cands = r.get("candidates") or []
            if not cands or (cands[0].get("inliers") or 0) <= 0:
                zero += 1
            if truth is None:
                continue
            if truth not in known:
                unknown += 1
                continue
            ok1 += r.get("best") == truth
            ok6 += truth in top6(r)
        ms.sort()
        res[name] = {"n": n, "top1": ok1, "top6": ok6, "zeroGeom": zero, "notInIndex": unknown, "medianMs": ms[n // 2]}
        judged = n - unknown
        if name == "nocard":
            print(f"{name:13} n={n}: noll geometri {zero}/{n} (ska vara alla) · median {ms[n // 2]} ms", flush=True)
        else:
            print(f"{name:13} n={n}: etta {100 * ok1 / max(judged, 1):5.1f} % · i sexlistan {100 * ok6 / max(judged, 1):5.1f} % · "
                  f"noll geometri {zero} · saknas i index {unknown} · median {ms[n // 2]} ms", flush=True)
    return res


def compare(res, base):
    """Faller om någon mängd tappar mer än max(1 kort, 1 %) i etta eller sexlista, eller nocard tappar en."""
    bad = []
    for name, r in res.items():
        b = base.get(name)
        if not b or b["n"] != r["n"]:
            print(f"  {name}: ingen jämförbar baslinje")
            continue
        tol = max(1, round(0.01 * r["n"]))
        for k in ("top1", "top6"):
            d = r[k] - b[k]
            flag = "" if d >= -tol else "  ⛔ SÄMRE"
            if name != "nocard":
                print(f"  {name:13} {k}: {b[k]} → {r[k]} ({d:+d}){flag}")
            if d < -tol:
                bad.append(f"{name}.{k}")
        if name == "nocard" and r["zeroGeom"] < b["zeroGeom"]:
            bad.append("nocard.zeroGeom")
        print(f"  {name:13} median ms: {b['medianMs']} → {r['medianMs']}")
    return bad


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--save")
    ap.add_argument("--compare")
    ap.add_argument("--sets", default="")
    a = ap.parse_args()
    eng = Engine(os.environ.get("DATA_DIR", ROOT))
    t0 = time.time()
    res = run(eng, [s for s in a.sets.split(",") if s])
    print(f"klar på {int(time.time() - t0)} s")
    os.makedirs(OUT, exist_ok=True)
    if a.save:
        json.dump(res, open(os.path.join(OUT, f"{a.save}.json"), "w"), indent=2)
        print(f"sparad som baslinje '{a.save}'")
    if a.compare:
        bad = compare(res, json.load(open(os.path.join(OUT, f"{a.compare}.json"))))
        print("GODKÄND" if not bad else f"UNDERKÄND: {', '.join(bad)}")
        sys.exit(1 if bad else 0)
