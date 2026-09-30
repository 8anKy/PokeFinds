"""
VECKOVIS PÅFYLLNING av skannermotorns data: kort som tillkommit sedan senaste bygget läggs till i
indexet (`index.add` — IVF-PQ behöver ingen omträning för nya vektorer) och i refkp/, utan att
bygga om 36 000 kort. Borttagna kort ligger kvar i datan; webben ignorerar id:n den inte känner.

  python scripts/scanner-proto/scanner-refs-download (ts) först — hämtar bara saknade referenser
  python scripts/scanner-proto/update_engine_data.py      (DATA_DIR=.spike/engine-data standard)

Samma parametrar som bygget: 300 punkter/kort i indexet, 600 i refkp.
"""
import json, os
import cv2
import numpy as np
import faiss

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".spike")
DATA = os.environ.get("DATA_DIR", os.path.join(ROOT, "engine-data"))
REFS = os.path.join(ROOT, "refs")
NN_KP, REF_KP = 300, 600


def root_sift(des):
    return np.sqrt(des / (np.abs(des).sum(axis=1, keepdims=True) + 1e-7))


def main():
    nn = os.path.join(DATA, "nn")
    ids = json.load(open(os.path.join(nn, "cards.json")))
    known = set(ids)
    catalog = json.load(open(os.path.join(REFS, "index.json"), encoding="utf-8"))
    new = [c for c in catalog if c["id"] not in known and os.path.exists(os.path.join(REFS, f"{c['id']}.jpg"))]
    print(f"{len(new)} nya kort med referensbild")
    if not new:
        return

    index = faiss.read_index(os.path.join(nn, "ivfpq.faiss"))
    owners = list(np.load(os.path.join(nn, "owners.npy")))
    rk = os.path.join(DATA, "refkp")
    meta = json.load(open(os.path.join(rk, "meta.json")))
    old_d = np.load(os.path.join(rk, "desc.npy"), mmap_mode="r")
    old_p = np.load(os.path.join(rk, "pts.npy"), mmap_mode="r")
    n_old = meta["n"]

    add_nn, add_d, add_p = [], [], []
    n_rows = n_old
    for c in new:
        img = cv2.imread(os.path.join(REFS, f"{c['id']}.jpg"), cv2.IMREAD_GRAYSCALE)
        if img is None:
            continue
        _, d_nn = cv2.SIFT_create(nfeatures=NN_KP).detectAndCompute(img, None)
        kp, d_rk = cv2.SIFT_create(nfeatures=REF_KP).detectAndCompute(img, None)
        if d_nn is None or len(d_nn) < 10 or d_rk is None or len(d_rk) < 8:
            continue
        card_idx = len(ids)
        ids.append(c["id"])
        v = (root_sift(d_nn)[:NN_KP] * 255).astype(np.uint8)
        add_nn.append(v)
        owners.extend([card_idx] * len(v))
        r = (root_sift(d_rk)[:REF_KP] * 255).astype(np.uint8)
        pts = np.float32([k.pt for k in kp])[:REF_KP]
        add_d.append(r)
        add_p.append(pts)
        meta["offsets"][c["id"]] = [n_rows, len(r)]
        meta["shapes"][c["id"]] = list(img.shape)
        n_rows += len(r)

    if not add_nn:
        print("inga användbara referenser")
        return
    index.add(np.vstack(add_nn).astype(np.float32))
    faiss.write_index(index, os.path.join(nn, "ivfpq.faiss"))
    np.save(os.path.join(nn, "owners.npy"), np.asarray(owners, np.int32))
    json.dump(ids, open(os.path.join(nn, "cards.json"), "w"))

    # refkp: ny fil med plats för de nya raderna, gamla rader kopieras i bitar (ingen 2,8 GB i RAM)
    for name, old, add, cols, dt in (("desc.npy", old_d, add_d, 128, np.uint8), ("pts.npy", old_p, add_p, 2, np.float32)):
        tmp = os.path.join(rk, name + ".new")
        out = np.lib.format.open_memmap(tmp, mode="w+", dtype=dt, shape=(n_rows, cols))
        for s in range(0, n_old, 1_000_000):
            out[s : min(n_old, s + 1_000_000)] = old[s : min(n_old, s + 1_000_000)]
        out[n_old:n_rows] = np.vstack(add)
        out.flush()
        del out
    # ⛔ Släpp VARJE referens till de gamla memmapparna (även loopvariabeln) — annars vägrar
    # Windows ersätta filen och påfyllningen blir halvgjord.
    del old, old_d, old_p
    for name in ("desc.npy", "pts.npy"):
        os.replace(os.path.join(rk, name + ".new"), os.path.join(rk, name))
    meta["n"] = n_rows
    json.dump(meta, open(os.path.join(rk, "meta.json"), "w"))
    cm_path = os.path.join(DATA, "cards-meta.json")
    cm = json.load(open(cm_path)) if os.path.exists(cm_path) else {}
    cm.update({c["id"]: c["imageUrl"] for c in new if c.get("imageUrl")})
    json.dump(cm, open(cm_path, "w"))
    print(f"lade till {len(add_nn)} kort ({index.ntotal} vektorer, {n_rows} refkp-rader)")


if __name__ == "__main__":
    main()
