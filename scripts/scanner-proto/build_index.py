"""
PROTOTYP, skanner utan AI — steg A: HELA katalogen som sökbart index (2026-09-30).

Klassisk bildåterfinning (samma familj som TinEye): SIFT-nyckelpunkter per referensbild →
"visuella ord" (k-means-vokabulär) → inverterat index med tf-idf. En fråga ger topp-K
kandidater på millisekunder; steg B (rerank.py) verifierar dem geometriskt.

  python scripts/scanner-proto/build_index.py          (läser .spike/refs, skriver .spike/index/)

Ingen AI, ingen inlärd modell: k-means är ren klustring av bilddeskriptorer.
"""
import json, os, sys, time
from multiprocessing import Pool
import cv2
import numpy as np
import faiss
from scipy import sparse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".spike")
REFS = os.path.join(ROOT, "refs")
OUT = os.path.join(ROOT, "index")
PER_REF = 400
VOCAB = 16384


def extract(cid):
    img = cv2.imread(os.path.join(REFS, f"{cid}.jpg"), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return cid, None
    sift = cv2.SIFT_create(nfeatures=PER_REF)
    _, des = sift.detectAndCompute(img, None)
    if des is None or len(des) < 10:
        return cid, None
    des = des / (np.abs(des).sum(axis=1, keepdims=True) + 1e-7)
    des = np.sqrt(des)
    return cid, (des * 255).astype(np.uint8)


def main():
    os.makedirs(OUT, exist_ok=True)
    cards = json.load(open(os.path.join(REFS, "index.json"), encoding="utf-8"))
    ids = [c["id"] for c in cards if os.path.exists(os.path.join(REFS, f"{c['id']}.jpg"))]
    t0 = time.time()
    descs, owners, kept = [], [], []
    with Pool(8) as pool:
        for i, (cid, des) in enumerate(pool.imap(extract, ids, chunksize=64)):
            if des is not None:
                descs.append(des)
                owners.append(np.full(len(des), len(kept), np.int32))
                kept.append(cid)
            if i % 5000 == 0:
                print(f"  deskriptorer {i}/{len(ids)} ({time.time() - t0:.0f} s)", flush=True)
    D = np.concatenate(descs)
    O = np.concatenate(owners)
    print(f"{len(kept)} kort, {len(D)} deskriptorer ({time.time() - t0:.0f} s)", flush=True)

    rng = np.random.default_rng(0)
    sample = D[rng.choice(len(D), size=min(len(D), 1_200_000), replace=False)].astype(np.float32)
    km = faiss.Kmeans(128, VOCAB, niter=12, seed=1, verbose=False)
    km.train(sample)
    print(f"vokabulär {VOCAB} ord ({time.time() - t0:.0f} s)", flush=True)
    faiss.write_index(faiss.IndexFlatL2(128), os.path.join(OUT, "empty.faiss"))
    np.save(os.path.join(OUT, "centroids.npy"), km.centroids)

    quant = faiss.IndexFlatL2(128)
    quant.add(km.centroids)
    words = np.empty(len(D), np.int32)
    step = 500_000
    for s in range(0, len(D), step):
        _, w = quant.search(D[s : s + step].astype(np.float32), 1)
        words[s : s + step] = w[:, 0]
    print(f"ord tilldelade ({time.time() - t0:.0f} s)", flush=True)

    M = sparse.csr_matrix((np.ones(len(words), np.float32), (O, words)), shape=(len(kept), VOCAB))
    M.sum_duplicates()
    df = np.asarray((M > 0).sum(axis=0)).ravel()
    idf = np.log(len(kept) / (df + 1)).astype(np.float32)
    M = M.multiply(idf).tocsr()
    norms = np.sqrt(np.asarray(M.multiply(M).sum(axis=1)).ravel()) + 1e-7
    M = sparse.diags(1 / norms) @ M
    sparse.save_npz(os.path.join(OUT, "tfidf.npz"), M.tocsr())
    np.save(os.path.join(OUT, "idf.npy"), idf)
    json.dump(kept, open(os.path.join(OUT, "cards.json"), "w"))
    print(f"klart ({time.time() - t0:.0f} s) → {OUT}", flush=True)


if __name__ == "__main__":
    main()
