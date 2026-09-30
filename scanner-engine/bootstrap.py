"""
Hämtar motorns data ur Railway-bucketen till volymen vid start — bara om den saknas eller är en
annan version. Volymer går inte att ladda upp till direkt; bucketen (samma som forumbilderna,
prefix `scanner-engine/<DATA_VERSION>/`) är vägen in. Env: DATA_VERSION + S3_* (samma
variabelreferenser som webbtjänsten).
"""
import os

FILES = [
    "nn/ivfpq.faiss", "nn/owners.npy", "nn/cards.json",
    "refkp/desc.npy", "refkp/pts.npy", "refkp/meta.json",
    "cards-meta.json",
]


def ensure_data(data_dir):
    version = os.environ.get("DATA_VERSION", "").strip()
    marker = os.path.join(data_dir, "VERSION")
    have = open(marker).read().strip() if os.path.exists(marker) else ""
    if not version or have == version:
        return
    import boto3
    s3 = boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("S3_REGION", "auto"),
    )
    bucket = os.environ["S3_BUCKET"]
    for f in FILES:
        dest = os.path.join(data_dir, f)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        print(f"hämtar {f} …", flush=True)
        s3.download_file(bucket, f"scanner-engine/{version}/{f}", dest + ".part")
        os.replace(dest + ".part", dest)
    open(marker, "w").write(version)
    print(f"data {version} klar", flush=True)
