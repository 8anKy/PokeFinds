"""Exporterar en finjusterad SigLIP2-checkpoint till ONNX (fp32 + int8) för skannermotorns CPU och
bygger referensgalleriet (en vektor per kort) MED SAMMA ONNX-MODELL som motorn kör — så att fråga och
galleri aldrig räknas av två olika implementationer.

  .spike/venv-ml/Scripts/python scripts/scanner-proto/export_embed.py sig-ep0 sig1 [--int8]

Utdata: .spike/engine-data/emb/<version>/{model.onnx, gallery.npy (float16 N×D), ids.json}
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cv2, numpy as np, torch
import train_embed as T

ckpt, version = sys.argv[1], sys.argv[2]
int8 = "--int8" in sys.argv
out = os.path.join(T.ROOT, "engine-data", "emb", version)
os.makedirs(out, exist_ok=True)

m = T.Embedder("google/siglip2-base-patch16-224").eval()
m.load_state_dict(torch.load(os.path.join(T.OUT, f"ft-{ckpt}.pt"), map_location="cpu"))
x = torch.randn(2, 3, T.SIDE, T.SIDE)
fp32 = os.path.join(out, "model-fp32.onnx")
torch.onnx.export(m, x, fp32, input_names=["pixel_values"], output_names=["emb"],
                  dynamic_axes={"pixel_values": {0: "n"}, "emb": {0: "n"}}, opset_version=17, dynamo=False)
final = os.path.join(out, "model.onnx")
if int8:
    # ⛔ Full int8 FÖRSTÖR SigLIP (cos 0,4–0,6 mot fp32, mätt 2026-10-08 — extrema aktiveringar i MLP:ns fc2
    # och poolningshuvudet). fc2 + head lämnas i fp32: cos median 0,990, 201 MB i stället för 372.
    import onnx
    g = onnx.load(fp32, load_external_data=False).graph
    keep = [n.name for n in g.node if n.op_type in ("MatMul", "Gemm") and ("fc2" in n.name or "head" in n.name)]
    from onnxruntime.quantization import quantize_dynamic, QuantType
    quantize_dynamic(fp32, final, weight_type=QuantType.QInt8, per_channel=True,
                     op_types_to_quantize=["MatMul"], nodes_to_exclude=keep)
    os.remove(fp32)
else:
    os.replace(fp32, final)
print(f"modell {os.path.getsize(final) / 1e6:.0f} MB", flush=True)

import onnxruntime as ort
so = ort.SessionOptions(); so.intra_op_num_threads = os.cpu_count()
sess = ort.InferenceSession(final, so, providers=["CPUExecutionProvider"])


def prep(img):  # EXAKT motorns förbehandling (scanner-engine/engine.py _embed_input)
    x = cv2.resize(img, (T.SIDE, T.SIDE), interpolation=cv2.INTER_AREA)
    x = (x[:, :, ::-1].astype(np.float32) / 255.0 - 0.5) / 0.5
    return x.transpose(2, 0, 1)


# kontroll: torch mot ONNX på riktiga referenser
ids = sorted(f[:-4] for f in os.listdir(os.path.join(T.ROOT, "refs")) if f.endswith(".jpg"))
probe = np.stack([prep(cv2.imread(os.path.join(T.ROOT, "refs", c + ".jpg"))) for c in ids[:8]])
with torch.no_grad():
    a = m(torch.from_numpy(probe)).numpy()
b = sess.run(None, {"pixel_values": probe})[0]
print(f"cosinus torch↔onnx: min {(a * b).sum(1).min():.4f}", flush=True)

t0 = time.time(); G = []
for i in range(0, len(ids), 64):
    batch = np.stack([prep(cv2.imread(os.path.join(T.ROOT, "refs", c + ".jpg"))) for c in ids[i:i + 64]])
    G.append(sess.run(None, {"pixel_values": batch})[0].astype(np.float16))
    if i % 6400 == 0:
        print(f"  galleri {i}/{len(ids)} {(time.time() - t0) / 60:.1f} min", flush=True)
np.save(os.path.join(out, "gallery.npy"), np.concatenate(G))
json.dump(ids, open(os.path.join(out, "ids.json"), "w"))
print(f"klart: {len(ids)} kort, {(time.time() - t0) / 60:.1f} min", flush=True)
