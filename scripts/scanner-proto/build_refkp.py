"""
PROTOTYP, skanner utan AI — FÖRBERÄKNADE referenspunkter för steg B (2026-09-30).

Steg B räknade SIFT på varje kandidats referensbild vid varje skanning (~40 ms × 20 kandidater).
Här räknas de EN gång och läggs på disk: per kort upp till REF_KP RootSIFT-deskriptorer (uint8) +
punktkoordinater (float32), sammanlagda med offset-tabell. Läses med memmap ⇒ bara de ~20
kandidaternas rader läses per skanning, inget hålls i RAM.

  python scripts/scanner-proto/build_refkp.py        (REF_KP=600 standard) → .spike/refkp/
"""
import json, os, time
from multiprocessing import Pool
import cv2
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".spike")
REFS = os.path.join(ROOT, "refs")
OUT = os.path.join(ROOT, os.environ.get("REFKP_DIR", "refkp"))
REF_KP = int(os.environ.get("REF_KP", "600"))


def extract(cid):
    img = cv2.imread(os.path.join(REFS, f"{cid}.jpg"), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return cid, None, None, None
    kp, des = cv2.SIFT_create(nfeatures=REF_KP).detectAndCompute(img, None)
    if des is None or len(des) < 8:
        return cid, None, None, None
    des = np.sqrt(des / (np.abs(des).sum(axis=1, keepdims=True) + 1e-7))
    pts = np.float32([k.pt for k in kp])
    return cid, (des[:REF_KP] * 255).astype(np.uint8), pts[:REF_KP], img.shape


def main():
    os.makedirs(OUT, exist_ok=True)
    cards = json.load(open(os.path.join(REFS, "index.json"), encoding="utf-8"))
    ids = [c["id"] for c in cards if os.path.exists(os.path.join(REFS, f"{c['id']}.jpg"))]
    cap = len(ids) * REF_KP
    D = np.lib.format.open_memmap(os.path.join(OUT, "desc.npy"), mode="w+", dtype=np.uint8, shape=(cap, 128))
    P = np.lib.format.open_memmap(os.path.join(OUT, "pts.npy"), mode="w+", dtype=np.float32, shape=(cap, 2))
    offsets, shapes, n, t0 = {}, {}, 0, time.time()
    with Pool(6) as pool:
        for i, (cid, des, pts, shape) in enumerate(pool.imap(extract, ids, chunksize=32)):
            if des is not None:
                D[n : n + len(des)] = des
                P[n : n + len(des)] = pts
                offsets[cid] = [n, len(des)]
                shapes[cid] = list(shape)
                n += len(des)
            if i % 5000 == 0:
                print(f"  {i}/{len(ids)} ({time.time() - t0:.0f} s)", flush=True)
    D.flush()
    P.flush()
    json.dump({"offsets": offsets, "shapes": shapes, "n": n, "ref_kp": REF_KP}, open(os.path.join(OUT, "meta.json"), "w"))
    print(f"klart: {len(offsets)} kort, {n} punkter ({time.time() - t0:.0f} s) → {OUT}", flush=True)


if __name__ == "__main__":
    main()
