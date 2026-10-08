"""Finjusterad bild-embedding för skannern — tränad ENBART på katalogens referensbilder med syntetiska
"mobilfoto"-förvanskningar (perspektiv, bländning, hylsa, oskärpa, ljus, JPEG, bakgrund). Riktiga foton
(ägarens app-foton, Tradera) används BARA som mätning, aldrig i träningen.

  .spike/venv-ml/Scripts/python scripts/scanner-proto/train_embed.py [modell] [epoker]

Förlust: kontrastiv (InfoNCE) foto-vy ↔ ren referens i samma batch; batcherna packas med NAMNTVILLINGAR
(samma Pokémon, andra set/språk/tryck) så att modellen tvingas skilja nära varianter åt.
"""
import json, math, os, random, sys, time
import cv2, numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader, Sampler
from transformers import AutoModel

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".spike")
OUT = os.path.join(ROOT, "emb")
SIDE = 224
MEAN = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)
if any("siglip" in a for a in sys.argv[1:2]):  # SigLIP normaliserar till [-1, 1]
    MEAN = np.array([0.5, 0.5, 0.5], np.float32); STD = np.array([0.5, 0.5, 0.5], np.float32)


def to_tensor(img):  # BGR uint8 SIDE×SIDE → CHW float
    x = (img[:, :, ::-1].astype(np.float32) / 255.0 - MEAN) / STD
    return torch.from_numpy(x.transpose(2, 0, 1).copy())


def clean_view(img):
    return cv2.resize(img, (SIDE, SIDE), interpolation=cv2.INTER_AREA)


def background(h, w, rng):
    k = rng.random()
    if k < 0.35:  # bordsyta/duk: enfärg + brus
        c = rng.integers(0, 255, 3)
        bg = np.full((h, w, 3), c, np.uint8)
        bg = cv2.add(bg, rng.normal(0, rng.uniform(2, 18), (h, w, 3)).astype(np.int16).clip(-40, 40).astype(np.uint8))
    elif k < 0.7:  # gradient
        a, b = rng.integers(0, 255, 3), rng.integers(0, 255, 3)
        t = np.linspace(0, 1, h)[:, None, None]
        bg = (a * (1 - t) + b * t).astype(np.uint8).repeat(w, 1)
    else:  # mönster: suddiga färgfläckar (trä, matta, pärmsida)
        small = rng.integers(0, 255, (rng.integers(3, 12), rng.integers(3, 12), 3)).astype(np.uint8)
        bg = cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
    return bg


def glare(img, rng):
    h, w = img.shape[:2]
    out = img.astype(np.float32)
    for _ in range(rng.integers(1, 4)):
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        sx, sy = rng.uniform(0.05, 0.45) * w, rng.uniform(0.03, 0.25) * h
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        ang = rng.uniform(0, np.pi)
        xr = (xx - cx) * np.cos(ang) + (yy - cy) * np.sin(ang)
        yr = -(xx - cx) * np.sin(ang) + (yy - cy) * np.cos(ang)
        m = np.exp(-(xr ** 2 / (2 * sx ** 2) + yr ** 2 / (2 * sy ** 2)))[..., None] * rng.uniform(0.3, 0.95)
        out = out * (1 - m) + 255 * m
    return out.clip(0, 255).astype(np.uint8)


def photo_view(img, rng):
    """Referens → syntetiskt mobilfoto av kortet, utsnitt runt kortet som appens ram."""
    h, w = img.shape[:2]
    x = img
    if rng.random() < 0.35:  # hylsa/toploader: tonad + svag spegling
        tint = np.full_like(x, rng.integers(180, 255, 3))
        x = cv2.addWeighted(x, rng.uniform(0.8, 0.95), tint, rng.uniform(0.05, 0.2), 0)
    if rng.random() < 0.5:
        x = glare(x, rng)
    # placera på bakgrund med marginal, perspektiv + rotation
    m = rng.uniform(0.02, 0.3)
    H, W = int(h * (1 + 2 * m)), int(w * (1 + 2 * m))
    canvas = background(H, W, rng)
    oy, ox = int(h * m), int(w * m)
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    j = rng.uniform(0, 0.12)
    dst = src + np.float32([[ox, oy]]) + rng.uniform(-j, j, (4, 2)).astype(np.float32) * np.float32([w, h])
    ang = rng.normal(0, 4) + (180 if rng.random() < 0.03 else 0)
    R = cv2.getRotationMatrix2D((W / 2, H / 2), ang, 1.0)
    dst = (np.hstack([dst, np.ones((4, 1), np.float32)]) @ R.T).astype(np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(x, M, (W, H))
    mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), M, (W, H))
    canvas[mask > 0] = warped[mask > 0]
    # utsnitt: kortets omslutande ruta ± jitter (appen skär ut ramen, Tradera gör det inte)
    xs, ys = dst[:, 0], dst[:, 1]
    pad = rng.uniform(-0.03, 0.15)
    x0, x1 = xs.min() - pad * w, xs.max() + pad * w
    y0, y1 = ys.min() - pad * h, ys.max() + pad * h
    x0, y0 = int(max(0, x0)), int(max(0, y0)); x1, y1 = int(min(W, x1)), int(min(H, y1))
    x = canvas[y0:y1, x0:x1] if (x1 - x0 > 20 and y1 - y0 > 20) else canvas
    # ljus
    x = x.astype(np.float32)
    x = x * rng.uniform(0.55, 1.3) + rng.uniform(-35, 25)
    x = x * (1 + rng.normal(0, 0.06, 3))  # färgtemperatur
    g = rng.uniform(0.7, 1.4)
    x = 255 * (np.clip(x, 0, 255) / 255) ** g
    if rng.random() < 0.3:  # vinjett
        hh, ww = x.shape[:2]
        yy, xx = np.mgrid[0:hh, 0:ww]
        r = np.sqrt(((xx - ww / 2) / ww) ** 2 + ((yy - hh / 2) / hh) ** 2)
        x = x * (1 - rng.uniform(0.2, 0.6) * r ** 2)[..., None]
    x = x.clip(0, 255).astype(np.uint8)
    # oskärpa
    k = rng.random()
    if k < 0.35:
        x = cv2.GaussianBlur(x, (0, 0), rng.uniform(0.3, 2.8))
    elif k < 0.55:
        L = int(rng.integers(3, 15)); ker = np.zeros((L, L), np.float32); ker[L // 2] = 1 / L
        Rm = cv2.getRotationMatrix2D((L / 2 - 0.5, L / 2 - 0.5), rng.uniform(0, 180), 1)
        x = cv2.filter2D(x, -1, cv2.warpAffine(ker, Rm, (L, L)))
    # låg upplösning + brus + JPEG
    s = rng.uniform(110, 520) / max(x.shape[:2])
    if s < 1:
        x = cv2.resize(x, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    x = cv2.add(x.astype(np.int16), rng.normal(0, rng.uniform(0, 7), x.shape).astype(np.int16)).clip(0, 255).astype(np.uint8)
    q = int(rng.integers(25, 92))
    x = cv2.imdecode(cv2.imencode(".jpg", x, [cv2.IMWRITE_JPEG_QUALITY, q])[1], 1)
    return cv2.resize(x, (SIDE, SIDE), interpolation=cv2.INTER_AREA)


class Refs(Dataset):
    def __init__(self, ids):
        self.ids = ids

    def __len__(self):
        return len(self.ids)

    def __getitem__(self, i):
        rng = np.random.default_rng((os.getpid() * 7919 + i * 104729 + int(time.time() * 1e6)) % 2 ** 32)
        img = cv2.imread(os.path.join(ROOT, "refs", self.ids[i] + ".jpg"))
        return to_tensor(photo_view(img, rng)), to_tensor(clean_view(img)), i


class TwinSampler(Sampler):
    """Batcher med namngrupper (≤ 4 kort per namn) — svåra negativ i varje batch."""

    def __init__(self, ids, names, bs):
        self.bs = bs
        groups = {}
        for i, c in enumerate(ids):
            groups.setdefault(names.get(c, c), []).append(i)
        self.groups = list(groups.values())
        self.n = len(ids)

    def __iter__(self):
        order = []
        gs = self.groups[:]
        random.shuffle(gs)
        for g in gs:
            g = g[:]; random.shuffle(g)
            for k in range(0, len(g), 4):
                order.append(g[k:k + 4])
        random.shuffle(order)
        batch = []
        for chunk in order:
            batch.extend(chunk)
            if len(batch) >= self.bs:
                yield batch[:self.bs]; batch = []

    def __len__(self):
        return self.n // self.bs


class Embedder(nn.Module):
    def __init__(self, hf, dim=256):
        super().__init__()
        self.siglip = "siglip" in hf
        if self.siglip:  # bara bildtornet; embedding = SigLIP:s egen poolning (startar i nollskottsläget)
            full = AutoModel.from_pretrained(hf)
            full.gradient_checkpointing_enable()
            self.backbone = full.vision_model
            self.logit_scale = nn.Parameter(torch.tensor(math.log(1 / 0.05)))
            self.head = nn.Identity()
            return
        self.backbone = AutoModel.from_pretrained(hf)
        hd = self.backbone.config.hidden_size
        self.head = nn.Sequential(nn.Linear(2 * hd, 1024), nn.GELU(), nn.Linear(1024, dim))
        self.logit_scale = nn.Parameter(torch.tensor(math.log(1 / 0.05)))

    def forward(self, x):
        if self.siglip:
            return F.normalize(self.backbone(pixel_values=x).pooler_output, dim=1)
        h = self.backbone(pixel_values=x).last_hidden_state
        f = torch.cat([h[:, 0], h[:, 1:].mean(1)], 1)
        return F.normalize(self.head(f), dim=1)


def load_query(p):
    img = cv2.imread(p)
    if img is None:
        from PIL import Image, ImageOps
        img = np.array(ImageOps.exif_transpose(Image.open(p)).convert("RGB"))[:, :, ::-1].copy()
    return to_tensor(clean_view(img))


@torch.no_grad()
def embed_paths(model, paths, loader_fn, bs=128):
    model.eval(); out = []
    for i in range(0, len(paths), bs):
        x = torch.stack([loader_fn(p) for p in paths[i:i + bs]]).cuda()
        with torch.autocast("cuda", dtype=torch.float16):
            out.append(model(x).float().cpu())
    return torch.cat(out)


def test_sets(pos):
    s = {
        "app-101": [(os.path.join(ROOT, "facit-0929", f["file"]), f["truthCardId"]) for f in json.load(open(os.path.join(ROOT, "facit-0929", "facit.json"), encoding="utf-8")) if f.get("truthCardId")],
        "jp-255": [(os.path.join(ROOT, "facit", f["file"]), f["truthCardId"]) for f in json.load(open(os.path.join(ROOT, "facit", "facit.json"), encoding="utf-8")) if f.get("truthCardId")],
        "tradera-2000": [(os.path.join(ROOT, "tradera-facit", l["file"]), l["truthCardId"]) for l in json.load(open(os.path.join(ROOT, "tradera-facit", "labels.json"), encoding="utf-8"))],
        "tradera-hard": [(os.path.join(ROOT, "tradera-hard", l["file"]), l["truthCardId"]) for l in json.load(open(os.path.join(ROOT, "tradera-hard", "labels.json"), encoding="utf-8"))],
    }
    return {k: [(p, t) for p, t in v if os.path.exists(p) and t in pos] for k, v in s.items()}


def evaluate(model, ids, pos, sets, tag):
    G = embed_paths(model, ids, lambda c: to_tensor(clean_view(cv2.imread(os.path.join(ROOT, "refs", c + ".jpg"))))).cuda()
    res = {}
    for name, items in sets.items():
        Q = embed_paths(model, [p for p, _ in items], load_query).cuda()
        top = (Q @ G.T).topk(20, dim=1).indices.cpu().numpy()
        tr = np.array([pos[t] for _, t in items])
        r1, r5, r20 = (top[:, 0] == tr).mean(), (top[:, :5] == tr[:, None]).any(1).mean(), (top == tr[:, None]).any(1).mean()
        res[name] = (r1, r5, r20)
        print(f"[{tag}] {name} n={len(items)}: topp-1 {100*r1:.1f} % · topp-5 {100*r5:.1f} % · topp-20 {100*r20:.1f} %", flush=True)
        np.save(os.path.join(OUT, f"top-ft-{tag}-{name}.npy"), top)
    return G, res


def main():
    hf = {"small": "facebook/dinov2-small", "base": "facebook/dinov2-base", "siglip2-base": "google/siglip2-base-patch16-224"}[sys.argv[1] if len(sys.argv) > 1 else "small"]
    epochs = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    bs = int(os.environ.get("BS", "96"))
    tag = os.environ.get("TAG", hf.split("/")[-1])
    torch.manual_seed(0); random.seed(0)
    ids = sorted(f[:-4] for f in os.listdir(os.path.join(ROOT, "refs")) if f.endswith(".jpg"))
    pos = {c: i for i, c in enumerate(ids)}
    meta = json.load(open(os.path.join(ROOT, "engine-data", "cards-meta.json"), encoding="utf-8"))
    names = {}
    try:  # namn för tvillinggrupper ur id-listan i prototypens kandidatfil om den finns; annars bara id
        nm = json.load(open(os.path.join(ROOT, "emb", "names.json"), encoding="utf-8"))
        names = {c: n.replace(" (JP)", "").lower() for c, n in nm.items()}
    except FileNotFoundError:
        print("⚠ names.json saknas — slumpbatcher utan tvillinggrupper")
    sets = test_sets(pos)
    model = Embedder(hf).cuda()
    if hasattr(model.backbone, "gradient_checkpointing_enable"):
        model.backbone.gradient_checkpointing_enable()
    if os.environ.get("EVAL0"):
        evaluate(model, ids, pos, sets, f"{tag}-zero")
    opt = torch.optim.AdamW([
        {"params": model.backbone.parameters(), "lr": float(os.environ.get("LR_BB", "2e-5"))},
        {"params": list(model.head.parameters()) + [model.logit_scale], "lr": 1e-3 if not model.siglip else 1e-4},
    ], weight_decay=0.05)
    dl = DataLoader(Refs(ids), batch_sampler=TwinSampler(ids, names, bs), num_workers=int(os.environ.get("WORKERS", "4")), persistent_workers=True, prefetch_factor=2)
    steps = epochs * len(dl)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=[g["lr"] for g in opt.param_groups], total_steps=steps, pct_start=0.05)
    scaler = torch.amp.GradScaler()
    step = 0
    for ep in range(epochs):
        model.train(); t0 = time.time(); tot = 0
        for q, g, _ in dl:
            q, g = q.cuda(non_blocking=True), g.cuda(non_blocking=True)
            with torch.autocast("cuda", dtype=torch.float16):
                zq, zg = model(q), model(g)
                logits = model.logit_scale.exp().clamp(max=100) * zq.float() @ zg.float().T
                lab = torch.arange(len(q), device="cuda")
                loss = (F.cross_entropy(logits, lab) + F.cross_entropy(logits.T, lab)) / 2
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward(); scaler.step(opt); scaler.update(); sched.step()
            tot += loss.item(); step += 1
            if step % 100 == 0:
                print(f"ep {ep} steg {step}/{steps} loss {tot/100:.3f} {(time.time()-t0)/60:.1f} min", flush=True); tot = 0
        torch.save(model.state_dict(), os.path.join(OUT, f"ft-{tag}.pt"))
        evaluate(model, ids, pos, sets, f"{tag}-ep{ep}")


if __name__ == "__main__":
    main()
