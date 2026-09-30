"""
PROTOTYP, skanner utan AI — steg "avgör mellan kandidater" (2026-09-30).

Givet en kortlista kandidater (dagens skanners visade lista + bildens topp-15 + facit),
rangordna dem på GEOMETRISKT VERIFIERADE nyckelpunkter: SIFT-punkter i fotot matchas mot
varje kandidats officiella bild, en homografi skattas med RANSAC, och poängen = antal
inliers. Hela kortet räknas — textrutan (japansk skrift vs latinsk), numret, setsymbolen —
så en språktvilling med SAMMA konst förlorar på texten.

  python scripts/scanner-proto/rerank.py            (ägarens app-foton, .spike/facit)

Ingen AI, ingen modell: bara bildgeometri (OpenCV).
"""
import json, os, sys, urllib.request
import cv2
import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", ".spike")
REFS = os.path.join(ROOT, "refs")
os.makedirs(REFS, exist_ok=True)

sift = cv2.SIFT_create(nfeatures=2000)
matcher = cv2.BFMatcher(cv2.NORM_L2)


def load_gray(path, max_side):
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return None
    h, w = img.shape
    s = max_side / max(h, w)
    if s < 1:
        img = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    return img


def root_sift(des):
    if des is None:
        return None
    des = des / (np.abs(des).sum(axis=1, keepdims=True) + 1e-7)
    return np.sqrt(des).astype(np.float32)


from collections import OrderedDict

# LRU, inte en växande dict: 2 000 foton × 20 kandidater fyllde flera GB per arbetare (dödades av RAM-brist).
_ref_cache = OrderedDict()
REF_CACHE_MAX = int(os.environ.get("REF_CACHE_MAX", "200"))


def ref_features(card):
    cid = card["id"]
    if cid in _ref_cache:
        _ref_cache.move_to_end(cid)
        return _ref_cache[cid]
    while len(_ref_cache) >= REF_CACHE_MAX:
        _ref_cache.popitem(last=False)
    path = os.path.join(REFS, f"{cid}.jpg")
    if not os.path.exists(path) and card.get("imageUrl"):
        try:
            req = urllib.request.Request(card["imageUrl"], headers={"User-Agent": "Foilio/1.0"})
            data = urllib.request.urlopen(req, timeout=30).read()
            arr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            h, w = arr.shape[:2]
            s = 480 / h
            arr = cv2.resize(arr, (int(w * s), 480), interpolation=cv2.INTER_AREA)
            cv2.imwrite(path, arr, [cv2.IMWRITE_JPEG_QUALITY, 88])
        except Exception:
            _ref_cache[cid] = None
            return None
    img = load_gray(path, 480)
    if img is None:
        _ref_cache[cid] = None
        return None
    kp, des = sift.detectAndCompute(img, None)
    _ref_cache[cid] = (kp, root_sift(des), img.shape)
    return _ref_cache[cid]


def inliers(q, ref, want_h=False):
    """Antal RANSAC-inliers mellan fotot (q) och en referens. 0 om ingen rimlig homografi."""
    if ref is None or q[1] is None or ref[1] is None or len(ref[0]) < 8:
        return (0, None) if want_h else 0
    kq, dq = q
    kr, dr, _ = ref
    pairs = matcher.knnMatch(dq, dr, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < 0.8 * n.distance]
    if len(good) < 8:
        return (0, None) if want_h else 0
    src = np.float32([kq[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kr[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 6.0)
    if H is None:
        return (0, None) if want_h else 0
    return (int(mask.sum()), H) if want_h else int(mask.sum())


def ref_gray(card):
    return load_gray(os.path.join(REFS, f"{card['id']}.jpg"), 480)


def norm_img(img):
    """Lokal kontrastnormalisering — foto och referens har olika ljus, färgton och skärpa."""
    f = cv2.GaussianBlur(img.astype(np.float32), (0, 0), 1.2)
    mu = cv2.GaussianBlur(f, (0, 0), 12)
    sd = np.sqrt(cv2.GaussianBlur((f - mu) ** 2, (0, 0), 12)) + 4.0
    return (f - mu) / sd


def region_check(photo, H_photo_to_a, card_a, card_b):
    """
    REGIONJÄMFÖRELSE mellan två kandidater med SAMMA konst: jämför fotot med båda BARA där
    de två referenserna skiljer sig (stämpel, setsymbol, nummer, textruta). Allt i A:s ram.
    Returnerar (fel_a, fel_b, andel_pixlar) — lägre fel = bättre; None om B inte går att lägga på A.
    """
    ga, gb = ref_gray(card_a), ref_gray(card_b)
    fa, fb = ref_features(card_a), ref_features(card_b)
    if ga is None or gb is None or fa is None or fb is None:
        return None
    n_ab, H_ba = inliers((fb[0], fb[1]), fa, want_h=True)  # B → A
    if H_ba is None or n_ab < 40:
        return None  # inte samma konst — regionjämförelsen gäller bara tvillingar
    h, w = ga.shape
    wb = cv2.warpPerspective(gb, H_ba, (w, h))
    vb = cv2.warpPerspective(np.full_like(gb, 255), H_ba, (w, h)) > 0
    wp = cv2.warpPerspective(photo, H_photo_to_a, (w, h))
    vp = cv2.warpPerspective(np.full_like(photo, 255), H_photo_to_a, (w, h)) > 0
    valid = vb & vp
    valid = cv2.erode(valid.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    na, nb, npp = norm_img(ga), norm_img(wb), norm_img(wp)
    d = cv2.GaussianBlur(np.abs(na - nb), (0, 0), 3)
    d[~valid] = 0
    if valid.sum() < 1000:
        return None
    thr = np.percentile(d[valid], 92)
    mask = (d >= thr) & valid
    ea = float(np.abs(npp - na)[mask].mean())
    eb = float(np.abs(npp - nb)[mask].mean())
    return ea, eb, float(mask.mean())


def main():
    facit = json.load(open(os.path.join(ROOT, "facit", "facit.json"), encoding="utf-8"))
    cand = json.load(open(os.path.join(ROOT, "facit", "candidates.json"), encoding="utf-8"))
    cards = {c["id"]: c for c in cand["cards"]}
    right_old = right_new = n = 0
    for f in facit:
        truth = f["truthCardId"]
        if not truth:
            continue
        j = cand["jobs"].get(f["jobId"], {"shown": [], "art": []})
        ids = list(dict.fromkeys(j["shown"] + j["art"] + ([] if os.environ.get("NO_TRUTH") else [truth])))
        img = load_gray(os.path.join(ROOT, "facit", f["file"]), 1000)
        kq, dq = sift.detectAndCompute(img, None)
        q = (kq, root_sift(dq))
        res = {i: inliers(q, ref_features(cards[i]), want_h=True) for i in ids if i in cards}
        scores = sorted(((v[0], i) for i, v in res.items()), reverse=True)
        best = scores[0][1] if scores else None
        # REGIONKONTROLL: rivaler nära ettan som har SAMMA konst avgörs på skillnadsregionerna.
        if best and scores[0][0] > 0:
            for sc, rival in scores[1:6]:
                if sc < 0.5 * scores[0][0]:
                    break
                rc = region_check(img, res[best][1], cards[best], cards[rival])
                if rc and rc[1] < rc[0] * 0.92:
                    best = rival
        n += 1
        right_old += f["scannerRight"]
        right_new += best == truth
        if best != truth or not f["scannerRight"]:
            t = cards[truth]
            b = cards.get(best, {})
            ts = next((s for s, i in scores if i == truth), 0)
            print(
                f"#{f['n']:>3} {'RÄTT' if best == truth else 'FEL '} (skannern {'rätt' if f['scannerRight'] else 'fel'}) "
                f"facit {t['name']} {t['number']} {t['language']} [{ts}] · prototyp {b.get('name')} {b.get('number')} {b.get('language')} [{scores[0][0]}] · {len(ids)} kand."
            )
        sys.stdout.flush()
    print(f"\nÄgarens app-foton med facit: {n} · dagens skanner {right_old}/{n} · nyckelpunkter {right_new}/{n}")


if __name__ == "__main__":
    main()
