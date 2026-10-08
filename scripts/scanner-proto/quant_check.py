"""Hur mycket ändrar kvantiseringen bildvektorn? Cosinus torch(fp32) ↔ ONNX-variant på 32 referenser
+ 32 riktiga foton. Mål ≥ 0,98 — annars kostar komprimeringen träff.
  .spike/venv-ml/Scripts/python scripts/scanner-proto/quant_check.py sig-ep0
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cv2, numpy as np, torch, onnxruntime as ort
from onnxruntime.quantization import quantize_dynamic, QuantType
import train_embed as T

ckpt = sys.argv[1]
d = os.path.join(T.ROOT, "emb", "quant"); os.makedirs(d, exist_ok=True)
m = T.Embedder("google/siglip2-base-patch16-224").eval()
m.load_state_dict(torch.load(os.path.join(T.OUT, f"ft-{ckpt}.pt"), map_location="cpu"))
fp32 = os.path.join(d, "fp32.onnx")
if not os.path.exists(fp32):
    torch.onnx.export(m, torch.randn(1, 3, 224, 224), fp32, input_names=["pixel_values"], output_names=["emb"],
                      dynamic_axes={"pixel_values": {0: "n"}, "emb": {0: "n"}}, opset_version=17, dynamo=False)


def prep(img):
    x = cv2.resize(img, (224, 224), interpolation=cv2.INTER_AREA)
    return ((x[:, :, ::-1].astype(np.float32) / 255.0 - 0.5) / 0.5).transpose(2, 0, 1)


ids = sorted(f[:-4] for f in os.listdir(os.path.join(T.ROOT, "refs")) if f.endswith(".jpg"))[::1000][:32]
photos = [os.path.join(T.ROOT, "tradera-hard", l["file"]) for l in json.load(open(os.path.join(T.ROOT, "tradera-hard", "labels.json"), encoding="utf-8"))[:32]]
X = np.stack([prep(cv2.imread(os.path.join(T.ROOT, "refs", c + ".jpg"))) for c in ids] + [prep(cv2.imread(p)) for p in photos])
with torch.no_grad():
    ref = m(torch.from_numpy(X)).numpy()

variants = {
    "fp32": None,
    "int8-per-tensor": dict(per_channel=False),
    "int8-per-channel": dict(per_channel=True),
    "int8-matmul-per-channel": dict(per_channel=True, op_types_to_quantize=["MatMul"]),
    "uint8-matmul-per-channel-reduce": dict(per_channel=True, reduce_range=True, op_types_to_quantize=["MatMul"], weight_type=QuantType.QUInt8),
}
for name, kw in variants.items():
    path = fp32 if kw is None else os.path.join(d, f"{name}.onnx")
    if kw is not None and not os.path.exists(path):
        kw = dict(kw); wt = kw.pop("weight_type", QuantType.QInt8)
        quantize_dynamic(fp32, path, weight_type=wt, **kw)
    s = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    out = s.run(None, {"pixel_values": X})[0]
    out /= np.linalg.norm(out, axis=1, keepdims=True)
    cos = (ref * out).sum(1)
    print(f"{name:34} {os.path.getsize(path)/1e6:5.0f} MB · cos min {cos.min():.4f} · median {np.median(cos):.4f}", flush=True)
