"""
PROTOTYP, skanner utan AI — steg A v2: NÄRMASTE-GRANNE-RÖSTNING över hela katalogen (2026-09-30).

v1 (visuella ord, build_index.py) hittade rätt kort i topp-50 bara 16 % av gångerna på ägarens
app-foton: hård avrundning till 16 384 ord skiljer fotots och referensens nyckelpunkter åt.
v2 lägger ALLA referensernas SIFT-deskriptorer i ett komprimerat index (IVF-PQ) och låter varje
nyckelpunkt i fotot rösta på korten bakom sina närmaste grannar.

⛔ MINNESSNÅLT (första försöket dödades av RAM-brist på en 16 GB-dator): deskriptorerna skrivs
direkt till en fil på disk (memmap) i stället för att hållas i minnet, och indexet byggs ur filen
i bitar. Toppen är ~1 GB i stället för ~5 GB.

  python scripts/scanner-proto/build_nn.py            (PER_REF=300 standard)
Ingen AI: produktkvantisering är komprimering, inte inlärning av vad ett kort är.
"""
import json, os, time
from multiprocessing import Pool
import cv2
import numpy as np
import faiss

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".spike")
REFS = os.path.join(ROOT, "refs")
OUT = os.path.join(ROOT, os.environ.get("NN_DIR", "nn"))
PQ_M = int(os.environ.get("PQ_M", "32"))
NLIST = int(os.environ.get("NLIST", "8192"))
PER_REF = int(os.environ.get("PER_REF", "300"))
CHUNK = 250_000


def extract(cid):
    img = cv2.imread(os.path.join(REFS, f"{cid}.jpg"), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return cid, None
    _, des = cv2.SIFT_create(nfeatures=PER_REF).detectAndCompute(img, None)
    if des is None or len(des) < 10:
        return cid, None
    des = np.sqrt(des / (np.abs(des).sum(axis=1, keepdims=True) + 1e-7))
    return cid, (des[:PER_REF] * 255).astype(np.uint8)


def main():
    os.makedirs(OUT, exist_ok=True)
    cards = json.load(open(os.path.join(REFS, "index.json"), encoding="utf-8"))
    ids = [c["id"] for c in cards if os.path.exists(os.path.join(REFS, f"{c['id']}.jpg"))]
    t0 = time.time()

    cap = len(ids) * PER_REF
    D = np.lib.format.open_memmap(os.path.join(OUT, "desc.npy"), mode="w+", dtype=np.uint8, shape=(cap, 128))
    owners = np.empty(cap, np.int32)
    kept, n = [], 0
    with Pool(6) as pool:
        for i, (cid, des) in enumerate(pool.imap(extract, ids, chunksize=32)):
            if des is not None:
                D[n : n + len(des)] = des
                owners[n : n + len(des)] = len(kept)
                n += len(des)
                kept.append(cid)
            if i % 5000 == 0:
                print(f"  {i}/{len(ids)} ({time.time() - t0:.0f} s)", flush=True)
    D.flush()
    np.save(os.path.join(OUT, "owners.npy"), owners[:n])
    json.dump(kept, open(os.path.join(OUT, "cards.json"), "w"))
    json.dump({"n": n, "per_ref": PER_REF}, open(os.path.join(OUT, "meta.json"), "w"))
    del owners
    print(f"{len(kept)} kort, {n} deskriptorer ({time.time() - t0:.0f} s)", flush=True)

    rng = np.random.default_rng(0)
    pick = np.sort(rng.choice(n, size=min(n, 500_000), replace=False))
    train = D[pick].astype(np.float32)
    index = faiss.IndexIVFPQ(faiss.IndexFlatL2(128), 128, NLIST, PQ_M, 8)
    index.train(train)
    del train
    print(f"tränat ({time.time() - t0:.0f} s)", flush=True)
    for s in range(0, n, CHUNK):
        index.add(np.ascontiguousarray(D[s : min(n, s + CHUNK)], dtype=np.float32))
    faiss.write_index(index, os.path.join(OUT, "ivfpq.faiss"))
    print(f"klart: {index.ntotal} vektorer ({time.time() - t0:.0f} s) → {OUT}", flush=True)


if __name__ == "__main__":
    main()
