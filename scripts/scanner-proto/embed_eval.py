"""Nollskottstest: global bild-embedding (DINOv2 / SigLIP2) som kandidatkälla — ingen träning.
Bäddar in alla referenser (.spike/refs) och testfoton, mäter topp-1/5/20 mot facit.
  .spike/venv-ml/Scripts/python scripts/scanner-proto/embed_eval.py dinov2-base
"""
import json, os, sys, time
import numpy as np, torch
from PIL import Image, ImageOps
from transformers import AutoModel, AutoImageProcessor

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".spike")
MODELS = {
    "dinov2-small": "facebook/dinov2-small", "dinov2-base": "facebook/dinov2-base",
    "siglip2-base": "google/siglip2-base-patch16-224", "siglip2-b384": "google/siglip2-base-patch16-384",
}
name = sys.argv[1]; dev = "cuda"
proc = AutoImageProcessor.from_pretrained(MODELS[name])
model = AutoModel.from_pretrained(MODELS[name], torch_dtype=torch.float16).to(dev).eval()
SIDE = 384 if "384" in name else 224

def load(p):
    im = ImageOps.exif_transpose(Image.open(p)).convert("RGB")
    return im.resize((SIDE, SIDE), Image.BICUBIC)  # kvadrat-squash, samma för ref och foto

@torch.no_grad()
def embed(paths, bs=64):
    out = []
    for i in range(0, len(paths), bs):
        ims = [load(p) for p in paths[i:i+bs]]
        x = proc(images=ims, return_tensors="pt", do_resize=False, do_center_crop=False)["pixel_values"].to(dev, torch.float16)
        if name.startswith("siglip"):
            f = model.get_image_features(pixel_values=x)
            f = f.pooler_output if hasattr(f, "pooler_output") else f
        else:
            h = model(pixel_values=x).last_hidden_state
            f = torch.cat([h[:, 0], h[:, 1:].mean(1)], 1)
        out.append(torch.nn.functional.normalize(f.float(), dim=1).cpu().numpy())
        if i % 6400 == 0: print(f"  {i}/{len(paths)}", flush=True)
    return np.concatenate(out)

cache = os.path.join(ROOT, "emb", f"refs-{name}.npz")
if os.path.exists(cache):
    z = np.load(cache); ids, R = list(z["ids"]), z["R"]
else:
    files = sorted(f for f in os.listdir(os.path.join(ROOT, "refs")) if f.endswith(".jpg"))
    ids = [f[:-4] for f in files]; t = time.time()
    R = embed([os.path.join(ROOT, "refs", f) for f in files]); print(f"refs {len(ids)} på {time.time()-t:.0f} s")
    np.savez(cache, ids=np.array(ids), R=R.astype(np.float16))
R = torch.tensor(np.asarray(R, np.float32), device=dev); pos = {c: i for i, c in enumerate(ids)}

sets = {
    "app-101": [(os.path.join(ROOT, "facit-0929", f["file"]), f["truthCardId"]) for f in json.load(open(os.path.join(ROOT, "facit-0929", "facit.json"), encoding="utf-8")) if f.get("truthCardId")],
    "jp-255": [(os.path.join(ROOT, "facit", f["file"]), f["truthCardId"]) for f in json.load(open(os.path.join(ROOT, "facit", "facit.json"), encoding="utf-8")) if f.get("truthCardId")],
    "tradera-2000": [(os.path.join(ROOT, "tradera-facit", l["file"]), l["truthCardId"]) for l in json.load(open(os.path.join(ROOT, "tradera-facit", "labels.json"), encoding="utf-8"))],
}
for sname, items in sets.items():
    items = [(p, t) for p, t in items if os.path.exists(p) and t in pos]
    Q = torch.tensor(embed([p for p, _ in items]), device=dev)
    S = Q @ R.T; top = S.topk(20, dim=1).indices.cpu().numpy()
    tr = np.array([pos[t] for _, t in items])
    r1 = (top[:, 0] == tr).mean(); r5 = (top[:, :5] == tr[:, None]).any(1).mean(); r20 = (top == tr[:, None]).any(1).mean()
    print(f"{name} {sname} n={len(items)}: topp-1 {100*r1:.1f} % · topp-5 {100*r5:.1f} % · topp-20 {100*r20:.1f} %", flush=True)
    np.save(os.path.join(ROOT, "emb", f"top-{name}-{sname}.npy"), top)
