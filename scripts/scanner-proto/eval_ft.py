"""Mät en sparad finjusterad checkpoint (.spike/emb/ft-<tag>.pt) mot testseten, utan att träna.
  .spike/venv-ml/Scripts/python scripts/scanner-proto/eval_ft.py siglip2-base sig [SETS=a,b]
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import torch
import train_embed as T

hf = {"siglip2-base": "google/siglip2-base-patch16-224", "small": "facebook/dinov2-small"}[sys.argv[1]]
tag = sys.argv[2]
ids = sorted(f[:-4] for f in os.listdir(os.path.join(T.ROOT, "refs")) if f.endswith(".jpg"))
pos = {c: i for i, c in enumerate(ids)}
sets = T.test_sets(pos)
only = os.environ.get("SETS")
if only:
    sets = {k: v for k, v in sets.items() if k in only.split(",")}
m = T.Embedder(hf).cuda()
m.load_state_dict(torch.load(os.path.join(T.OUT, f"ft-{tag}.pt"), map_location="cuda"))
T.evaluate(m, ids, pos, sets, os.environ.get("OUTTAG", tag + "-snap"))
