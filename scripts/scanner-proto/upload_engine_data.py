"""
Laddar upp .spike/engine-data till bucketen under scanner-engine/<DATA_VERSION>/ (motorns
bootstrap.py hämtar därifrån). Kör: DATA_VERSION=v1 railway run python scripts/scanner-proto/upload_engine_data.py
"""
import os, sys
import boto3

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scanner-engine"))
from bootstrap import FILES, OPTIONAL

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".spike", "engine-data")
# Bildvektorn (2026-10-08): EMB_VERSION=sig1 ⇒ laddar BARA upp emb/<v>/ till scanner-engine/emb/<v>/.
emb = os.environ.get("EMB_VERSION")
version = os.environ.get("DATA_VERSION", "")
s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["S3_ENDPOINT"],
    aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
    region_name=os.environ.get("S3_REGION", "auto"),
)
if emb:
    from bootstrap import EMB_FILES
    for f in EMB_FILES:
        path = os.path.join(ROOT, "emb", emb, f)
        print(f"laddar upp emb/{emb}/{f} ({os.path.getsize(path) / 1e6:.0f} MB) …", flush=True)
        s3.upload_file(path, os.environ["S3_BUCKET"], f"scanner-engine/emb/{emb}/{f}")
    print("klart", flush=True)
    sys.exit(0)
for f in FILES + OPTIONAL if not os.environ.get("ONLY") else os.environ["ONLY"].split(","):
    path = os.path.join(ROOT, f)
    print(f"laddar upp {f} ({os.path.getsize(path) / 1e6:.0f} MB) …", flush=True)
    s3.upload_file(path, os.environ["S3_BUCKET"], f"scanner-engine/{version}/{f}")
print("klart", flush=True)
