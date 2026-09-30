"""
Packar skannermotorns datamapp (DATA_DIR) ur prototypens byggen:
  nn/        ← .spike/<NN_SRC>   (standard nn300m8: 300 punkter/kort, PQ m=8, ~171 MB — lika träffsäker som 422 MB-versionen)
  refkp/     ← .spike/refkp      (förberäknade referenspunkter för steg B, läses per kandidat)
  cards-meta.json                (id → imageUrl, regionkontrollens referensbilder)

  python scripts/scanner-proto/package_engine_data.py            → .spike/engine-data/
"""
import json, os, shutil

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".spike")
SRC = os.environ.get("NN_SRC", "nn300m8")
OUT = os.path.join(ROOT, "engine-data")
os.makedirs(os.path.join(OUT, "nn"), exist_ok=True)
os.makedirs(os.path.join(OUT, "refkp"), exist_ok=True)
for f in ("ivfpq.faiss", "owners.npy", "cards.json"):
    shutil.copy2(os.path.join(ROOT, SRC, f), os.path.join(OUT, "nn", f))
for f in ("desc.npy", "pts.npy", "meta.json"):
    shutil.copy2(os.path.join(ROOT, "refkp", f), os.path.join(OUT, "refkp", f))
cards = json.load(open(os.path.join(ROOT, "refs", "index.json"), encoding="utf-8"))
json.dump({c["id"]: c["imageUrl"] for c in cards if c.get("imageUrl")}, open(os.path.join(OUT, "cards-meta.json"), "w"))
json.dump({c["id"]: c["language"] for c in cards}, open(os.path.join(OUT, "cards-lang.json"), "w"))
total = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
print(f"{OUT}: {total / 1e9:.2f} GB")
