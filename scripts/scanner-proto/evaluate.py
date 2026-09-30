"""
PROTOTYP, skanner utan AI — HELA KEDJAN mot facit (2026-09-30).

  steg A: fotot → visuella ord → tf-idf mot hela katalogen (.spike/index) → topp-K
  steg B: topp-K omrankas på RANSAC-inliers + regionjämförelse (rerank.py)

  python scripts/scanner-proto/evaluate.py tradera      (.spike/tradera-facit, säljarfoton)
  python scripts/scanner-proto/evaluate.py app          (.spike/facit, ägarens app-foton)
  LIMIT=300 python ... tradera

Ingen AI: SIFT, k-means-vokabulär, tf-idf, RANSAC.
"""
import json, os, sys, time
from multiprocessing import Pool
import cv2
import numpy as np
import faiss
from scipy import sparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rerank  # noqa: E402

ROOT = os.path.join(HERE, "..", "..", ".spike")
IDX = os.path.join(ROOT, "index")
K = int(os.environ.get("K", "50"))

_state = {}


NN = os.path.join(ROOT, os.environ.get("NN_DIR", "nn"))
STAGE = os.environ.get("STAGE", "nn")


def init_workers():
    """Steg B-arbetare: bara kortmetadata + SIFT — ALDRIG indexet (8 kopior åt 3,6 GB RAM)."""
    meta = json.load(open(os.path.join(ROOT, "refs", "index.json"), encoding="utf-8"))
    _state["cards"] = {c["id"]: c for c in meta}
    _state["sift"] = cv2.SIFT_create(nfeatures=1500)


def query_desc(path):
    """Fotots RootSIFT-deskriptorer (körs parallellt; skickas till huvudprocessens index)."""
    img = rerank.load_gray(path, 1000)
    if img is None:
        return None
    _, des = cv2.SIFT_create(nfeatures=1500).detectAndCompute(img, None)
    return None if des is None else rerank.root_sift(des)


def init():
    if STAGE == "nn":
        idx = faiss.read_index(os.path.join(NN, "ivfpq.faiss"))
        idx.nprobe = int(os.environ.get("NPROBE", "32"))
        _state["nn"] = idx
        _state["owners"] = np.load(os.path.join(NN, "owners.npy"))
        _state["ids"] = json.load(open(os.path.join(NN, "cards.json")))
        meta = json.load(open(os.path.join(ROOT, "refs", "index.json"), encoding="utf-8"))
        _state["cards"] = {c["id"]: c for c in meta}
        _state["sift"] = cv2.SIFT_create(nfeatures=1500)
        return
    cents = np.load(os.path.join(IDX, "centroids.npy")).astype(np.float32)
    q = faiss.IndexFlatL2(128)
    q.add(cents)
    _state["quant"] = q
    _state["M"] = sparse.load_npz(os.path.join(IDX, "tfidf.npz")).tocsr()
    _state["idf"] = np.load(os.path.join(IDX, "idf.npy"))
    _state["ids"] = json.load(open(os.path.join(IDX, "cards.json")))
    meta = json.load(open(os.path.join(ROOT, "refs", "index.json"), encoding="utf-8"))
    _state["cards"] = {c["id"]: c for c in meta}
    _state["sift"] = cv2.SIFT_create(nfeatures=1500)


def nn_candidates(rs):
    """Steg A v2 i huvudprocessen: närmaste-granne-röstning → topp-K kort-id."""
    if True:
        dist, nb = _state["nn"].search(np.ascontiguousarray(rs * 255), 6)
        own = _state["owners"][np.clip(nb, 0, None)]
        votes = {}
        for r in range(len(nb)):
            d0 = dist[r, 0]
            first = own[r, 0]
            # distinktivitet: första grannen från ett ANNAT kort (Lowes kvot över kort, inte punkter)
            d2 = next((dist[r, k] for k in range(1, nb.shape[1]) if own[r, k] != first), dist[r, -1])
            if nb[r, 0] < 0 or d2 <= 0:
                continue
            w = max(0.0, 1.0 - d0 / d2)
            if w > 0:
                votes[first] = votes.get(first, 0.0) + w
            seen = {first}
            for k in range(1, nb.shape[1]):
                o = own[r, k]
                if nb[r, k] >= 0 and o not in seen:
                    seen.add(o)
                    votes[o] = votes.get(o, 0.0) + 0.05
        top = sorted(votes.items(), key=lambda kv: -kv[1])[:K]
        return [_state["ids"][i] for i, _ in top]


def search(img):
    """Steg A v1 (visuella ord): topp-K kort-id ur hela katalogen."""
    kp, des = _state["sift"].detectAndCompute(img, None)
    if des is None:
        return [], None
    rs = rerank.root_sift(des)
    if False:
        pass
    _, w = _state["quant"].search(rs * 255, 1)
    counts = np.bincount(w[:, 0], minlength=len(_state["idf"])).astype(np.float32)
    v = counts * _state["idf"]
    v /= np.linalg.norm(v) + 1e-7
    scores = _state["M"] @ v
    top = np.argpartition(-scores, K)[:K]
    top = top[np.argsort(-scores[top])]
    return [_state["ids"][i] for i in top], (kp, rs)


def distinctive_scores(q, cands, cards):
    """
    DISTINKTA INLIERS: en fotopunkt räknas bara för det kort den matchar TYDLIGT bättre än alla
    andra kandidater (Lowes kvot över KORT, inte inom ett kort). Tryckmallen — ram, "weakness /
    resistance / retreat", attacktextens layout — är likadan på alla kort från samma era och
    fällde omrankningen: en gammal Bagon fick 338 inliers mot ett Mewtwo-foto, rätt kort 142.
    """
    kq, dq = q
    if dq is None:
        return {}
    feats = {i: rerank.ref_features(cards[i]) for i in cands}
    feats = {i: f for i, f in feats.items() if f is not None and f[1] is not None and len(f[0]) >= 8}
    if not feats:
        return {}
    order = list(feats)
    D = np.vstack([feats[i][1] for i in order])
    own = np.concatenate([np.full(len(feats[i][1]), k) for k, i in enumerate(order)])
    loc = np.concatenate([np.arange(len(feats[i][1])) for i in order])
    pairs = rerank.matcher.knnMatch(dq, D, k=8)
    per = {}
    for ms in pairs:
        if not ms:
            continue
        o1 = own[ms[0].trainIdx]
        d2 = next((m.distance for m in ms[1:] if own[m.trainIdx] != o1), None)
        if d2 is not None and ms[0].distance >= 0.85 * d2:
            continue
        per.setdefault(o1, []).append((ms[0].queryIdx, loc[ms[0].trainIdx]))
    out = {}
    for k, lst in per.items():
        if len(lst) < 8:
            continue
        cid = order[k]
        kr = feats[cid][0]
        src = np.float32([kq[a].pt for a, _ in lst]).reshape(-1, 1, 2)
        dst = np.float32([kr[b].pt for _, b in lst]).reshape(-1, 1, 2)
        H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 6.0)
        if H is not None:
            out[cid] = int(mask.sum())
    return out


def identify(img, given=None):
    if given is not None:
        kp, des = _state["sift"].detectAndCompute(img, None)
        cands, q = given, (kp, rerank.root_sift(des) if des is not None else None)
    else:
        cands, q = search(img)
    if not cands:
        return None, cands, []
    cards = _state["cards"]
    di = distinctive_scores(q, cands, cards)
    scores = sorted(((v, i) for i, v in di.items()), reverse=True)
    if not scores:
        return cands[0], cands, [(0, cands[0])]
    best = scores[0][1]
    # REGIONKONTROLL mot SAMMA-KONST-tvillingar nära ettan (de delar konstens punkter, så deras
    # distinkta inliers är få för båda — skillnadsregionerna avgör).
    mode = os.environ.get("REGION", "gated")
    _, H = rerank.inliers(q, rerank.ref_features(cards[best]), want_h=True)
    if H is not None and mode != "off":
        rivals = cands[:10] if mode == "top10" else [i for v, i in scores[1:6] if v >= 0.5 * scores[0][0]]
        for rival in rivals:
            if rival == best:
                continue
            rc = rerank.region_check(img, H, cards[best], cards[rival])
            if rc and rc[1] < rc[0] * 0.92:
                best = rival
                break
    return best, cands, scores


def job(item):
    path, truth = item[0], item[1]
    given = item[2] if len(item) > 2 else None
    img = rerank.load_gray(path, 1000)
    if img is None:
        return None
    t = time.time()
    best, cands, scores = identify(img, given)
    return {
        "truth": truth,
        "best": best,
        "inA": cands.index(truth) + 1 if truth in cands else 0,
        "inl": scores[0][0] if scores else 0,
        "ms": int((time.time() - t) * 1000),
        "file": os.path.basename(path),
    }


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "tradera"
    if which == "app":
        facit = json.load(open(os.path.join(ROOT, "facit", "facit.json"), encoding="utf-8"))
        items = [(os.path.join(ROOT, "facit", f["file"]), f["truthCardId"]) for f in facit if f["truthCardId"]]
        langs = {}
    else:
        labels = json.load(open(os.path.join(ROOT, "tradera-facit", os.environ.get("LABELS", "labels.json")), encoding="utf-8"))
        items = [(os.path.join(ROOT, "tradera-facit", l["file"]), l["truthCardId"]) for l in labels]
        langs = {l["file"]: l["language"] for l in labels}
    items = items[: int(os.environ.get("LIMIT", len(items)))]
    t0 = time.time()
    if STAGE == "nn":
        # ⛔ I BITAR om 200 och kandidaterna till disk: alla 2 000 fotons deskriptorer samtidigt
        # (~1,5 GB) + obegränsad referenscache dödade körningen på en 16 GB-dator.
        cache = os.path.join(ROOT, f"candsA-{which}-K{K}-{os.environ.get('NN_DIR', 'nn')}-{os.environ.get('LABELS', 'all')}.json")
        done = json.load(open(cache)) if os.path.exists(cache) else {}
        todo = [(p, t) for p, t in items if p not in done]
        if todo:
            init()  # indexet EN gång, i huvudprocessen (faiss söker flertrådat)
            with Pool(4) as pool:
                for s0 in range(0, len(todo), 200):
                    part = todo[s0 : s0 + 200]
                    descs = pool.map(query_desc, [p for p, _ in part], chunksize=8)
                    for (p, _), d in zip(part, descs):
                        done[p] = nn_candidates(d) if d is not None else []
                    json.dump(done, open(cache, "w"))
                    print(f"  steg A {min(s0 + 200, len(todo))}/{len(todo)} ({time.time() - t0:.0f} s)", flush=True)
            _state.clear()
        items = [(p, t, done.get(p, [])) for p, t in items]
        print(f"  steg A klart ({time.time() - t0:.0f} s)", flush=True)
        with Pool(4, initializer=init_workers, maxtasksperchild=100) as pool:
            out = [r for r in pool.imap(job, items, chunksize=4) if r]
    else:
        with Pool(8, initializer=init) as pool:
            out = [r for r in pool.imap(job, items, chunksize=4) if r]
    n = len(out)

    def pct(k):
        return f"{100 * k / n:.1f} %"

    a1 = sum(r["inA"] == 1 for r in out)
    a10 = sum(0 < r["inA"] <= 10 for r in out)
    aK = sum(r["inA"] > 0 for r in out)
    right = sum(r["best"] == r["truth"] for r in out)
    print(f"\n{which}: {n} foton, {time.time() - t0:.0f} s totalt, median {sorted(r['ms'] for r in out)[n // 2]} ms/foto")
    print(f"  steg A (hela katalogen): topp-1 {pct(a1)} · topp-10 {pct(a10)} · topp-{K} {pct(aK)}")
    print(f"  HELA KEDJAN topp-1: {right}/{n} = {pct(right)}")
    if langs:
        for lang in ("EN", "JP"):
            sub = [r for r in out if langs.get(r["file"]) == lang]
            if sub:
                print(f"    {lang}: {sum(r['best'] == r['truth'] for r in sub)}/{len(sub)} = {100 * sum(r['best'] == r['truth'] for r in sub) / len(sub):.1f} %")
    json.dump(out, open(os.path.join(ROOT, f"eval-{which}.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
