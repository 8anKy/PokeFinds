"""
Laddar upp .spike/engine-data till bucketen under scanner-engine/<DATA_VERSION>/ (motorns
bootstrap.py hämtar därifrån). Kör: DATA_VERSION=v1 railway run python scripts/scanner-proto/upload_engine_data.py
"""
import os, sys
import boto3

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scanner-engine"))
from bootstrap import FILES

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".spike", "engine-data")
version = os.environ["DATA_VERSION"]
s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["S3_ENDPOINT"],
    aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
    region_name=os.environ.get("S3_REGION", "auto"),
)
for f in FILES:
    path = os.path.join(ROOT, f)
    print(f"laddar upp {f} ({os.path.getsize(path) / 1e6:.0f} MB) …", flush=True)
    s3.upload_file(path, os.environ["S3_BUCKET"], f"scanner-engine/{version}/{f}")
print("klart", flush=True)
