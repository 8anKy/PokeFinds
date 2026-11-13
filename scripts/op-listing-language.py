"""
ONE PIECE PÅ TRADERA — ÄR KORTET PÅ BILDEN ENGELSKT? (2026-11-13)

Traderas One Piece-kategori bär inget språkattribut och säljare märker sällan japanska kort i
titeln, men koden ("OP08-098") är densamma på båda språken. Titeln kan alltså inte avgöra — bilden kan.

Metod (mätt på 120 annonser från 2026-11-13, se .claude/rules/marketplace-tradera.md):
  1. Annonsens foto riktas mot vår engelska referensbild (SIFT + RANSAC) och räta upp till kortets ram.
  2. NAMNREMSAN jämförs (kantbild, normaliserad korrelation) mot BÅDE den engelska referensen och
     Bandais officiella japanska bild av samma kod. d = likhet(engelsk) − likhet(japansk).
     Ramen är gemensam och tar ut sig själv; kvar blir namnets tecken.
  3. d >= EN_MIN ⇒ "en" (engelskt OCH rätt kort) · d <= JP_MAX ⇒ "jp" · däremellan ⇒ "unclear"
     (fel kort på bilden, graderad slab, alternativ konst, tom bild). Går fotot inte att rikta ⇒ "noalign".
⛔ Bara "en" får sätta ett pris — allt annat är "vet inte" och fälls av svepet.
⛔ Att jämföra mot ENBART den engelska referensen fungerar inte: japanska kort fick 0,56–0,76 där.

Körs av src/jobs/op-tradera-sweep.ts:  python op-listing-language.py <in.json> <ut.json> [budget-sekunder]
  in:  [{ "itemId", "code", "photo", "ref" }]      ut: { "<itemId>": { "v", "d", "n" } }
Ingen databas, inga nycklar. Poster som inte hinns med inom budgeten utelämnas (prövas nästa natt).
"""
import json
import sys
import time
import urllib.request
from concurrent.futures import ProcessPoolExecutor, as_completed

import cv2
import numpy as np

W, H = 500, 700
EN_MIN = 0.10
JP_MAX = -0.07
MIN_INLIERS = 15
# Namnremsan som andel av kortets ram: y 81,5–89,5 %, x 20–80 %.
NAME = (0.815, 0.895, 0.20, 0.80)
PAD = 7
UA = "Mozilla/5.0 (compatible; FoilioBot/1.0; +https://scoutr.se/om)"
JP_IMAGE = "https://www.onepiece-cardgame.com/images/cardlist/card/{code}.png"


def fetch_image(url, maxside=None):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        data = urllib.request.urlopen(req, timeout=25).read()
    except Exception:
        return None
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return None
    if maxside:
        s = maxside / max(img.shape[:2])
        if s < 1:
            img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    return img


def homography(sift, bf, a, b):
    """Homografin a → b och antalet inliers; (None, n) när den inte håller."""
    k1, d1 = sift.detectAndCompute(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), None)
    k2, d2 = sift.detectAndCompute(cv2.cvtColor(b, cv2.COLOR_BGR2GRAY), None)
    if d1 is None or d2 is None or len(k1) < 20 or len(k2) < 20:
        return None, 0
    pairs = [p for p in bf.knnMatch(d1, d2, k=2) if len(p) == 2]
    good = [m for m, nn in pairs if m.distance < 0.75 * nn.distance]
    if len(good) < 8:
        return None, 0
    src = np.float32([k1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([k2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    hm, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
    n = int(mask.sum()) if mask is not None else 0
    return (hm if hm is not None and n >= MIN_INLIERS else None), n


def edges(gray):
    g = cv2.GaussianBlur(gray, (3, 3), 0)
    return cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1))


def strip_score(ref_gray, photo_gray):
    y0, y1, x0, x1 = NAME
    a = ref_gray[int(H * y0):int(H * y1), int(W * x0):int(W * x1)]
    b = photo_gray[int(H * y0) - PAD:int(H * y1) + PAD, int(W * x0) - PAD:int(W * x1) + PAD]
    return float(cv2.matchTemplate(edges(b), edges(a), cv2.TM_CCOEFF_NORMED).max())


def verdict_from(d):
    return "en" if d >= EN_MIN else "jp" if d <= JP_MAX else "unclear"


def check(item):
    """En annons → (itemId, dom). Kastar aldrig: ett fel är domen "error" (prövas om)."""
    try:
        sift = cv2.SIFT_create(nfeatures=4000)
        bf = cv2.BFMatcher(cv2.NORM_L2)
        en = fetch_image(item["ref"])
        jp = fetch_image(JP_IMAGE.format(code=item["code"]))
        photo = fetch_image(item["photo"], 1400)
        if en is None or photo is None:
            return item["itemId"], {"v": "error", "d": 0, "n": 0}
        if jp is None:
            # Ingen japansk bild att jämföra med ⇒ vi kan inte bevisa språket.
            return item["itemId"], {"v": "nojp", "d": 0, "n": 0}
        en = cv2.resize(en, (W, H), interpolation=cv2.INTER_AREA)
        hj, _ = homography(sift, bf, jp, en)
        jp = cv2.warpPerspective(jp, hj, (W, H)) if hj is not None else cv2.resize(jp, (W, H), interpolation=cv2.INTER_AREA)
        hp, n = homography(sift, bf, en, photo)
        if hp is None:
            return item["itemId"], {"v": "noalign", "d": 0, "n": n}
        warped = cv2.warpPerspective(photo, np.linalg.inv(hp), (W, H))
        g_en, g_jp, g_ph = (cv2.cvtColor(x, cv2.COLOR_BGR2GRAY) for x in (en, jp, warped))
        d = strip_score(g_en, g_ph) - strip_score(g_jp, g_ph)
        return item["itemId"], {"v": verdict_from(d), "d": round(d, 3), "n": n}
    except Exception:
        return item["itemId"], {"v": "error", "d": 0, "n": 0}


def main():
    items = json.load(open(sys.argv[1], encoding="utf-8"))
    budget = float(sys.argv[3]) if len(sys.argv) > 3 else 600.0
    start = time.time()
    out = {}
    with ProcessPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(check, it) for it in items]
        try:
            for f in as_completed(futures, timeout=budget):
                item_id, v = f.result()
                out[item_id] = v
        except Exception:
            # Budgeten slut: det som inte hunnits med prövas nästa natt.
            for f in futures:
                f.cancel()
        json.dump(out, open(sys.argv[2], "w", encoding="utf-8"))
        pool.shutdown(wait=False, cancel_futures=True)
    counts = {}
    for v in out.values():
        counts[v["v"]] = counts.get(v["v"], 0) + 1
    print(f"[op-lang] {len(out)} av {len(items)} annonser bedömda på {time.time() - start:.0f} s: {counts}")


if __name__ == "__main__":
    main()
