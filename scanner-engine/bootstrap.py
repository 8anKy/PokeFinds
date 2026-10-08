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
# Små filer som kan läggas till en BEFINTLIG version utan att hela datan hämtas om: hämtas om de saknas
# på volymen, oavsett VERSION. cards-lang.json (EN/JP per kort) kom till 2026-09-30 för språktvillingarna.
OPTIONAL = ["cards-lang.json"]


def _client():
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("S3_REGION", "auto"),
    )


EMB_FILES = ["model.onnx", "gallery.npy", "ids.json"]


def ensure_emb(data_dir):
    """Bildvektorns modell + galleri (EMB_VERSION) — egen version, oberoende av DATA_VERSION.
    Bucket: scanner-engine/emb/<EMB_VERSION>/. Ny modell = ny version, aldrig överskrivning."""
    version = os.environ.get("EMB_VERSION", "").strip()
    if not version:
        return
    d = os.path.join(data_dir, "emb", version)
    missing = [f for f in EMB_FILES if not os.path.exists(os.path.join(d, f))]
    if not missing:
        return
    os.makedirs(d, exist_ok=True)
    s3 = _client()
    for f in missing:
        dest = os.path.join(d, f)
        print(f"hämtar emb/{version}/{f} …", flush=True)
        try:
            s3.download_file(os.environ["S3_BUCKET"], f"scanner-engine/emb/{version}/{f}", dest + ".part")
            os.replace(dest + ".part", dest)
        except Exception as e:  # valfri del — motorn kör utan bildvektor
            print(f"kunde inte hämta emb/{version}/{f}: {e}", flush=True)
            return


def ensure_data(data_dir):
    version = os.environ.get("DATA_VERSION", "").strip()
    if not version:
        return
    marker = os.path.join(data_dir, "VERSION")
    have = open(marker).read().strip() if os.path.exists(marker) else ""
    bucket = os.environ["S3_BUCKET"]
    s3 = None
    for f in OPTIONAL:
        dest = os.path.join(data_dir, f)
        if have == version and not os.path.exists(dest):
            s3 = s3 or _client()
            try:
                s3.download_file(bucket, f"scanner-engine/{version}/{f}", dest + ".part")
                os.replace(dest + ".part", dest)
                print(f"hämtade {f}", flush=True)
            except Exception as e:  # valfri fil — motorn fungerar utan, bara sämre på språktvillingar
                print(f"kunde inte hämta {f}: {e}", flush=True)
    if have == version:
        return
    s3 = s3 or _client()
    for f in FILES + OPTIONAL:
        dest = os.path.join(data_dir, f)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        print(f"hämtar {f} …", flush=True)
        s3.download_file(bucket, f"scanner-engine/{version}/{f}", dest + ".part")
        os.replace(dest + ".part", dest)
    open(marker, "w").write(version)
    print(f"data {version} klar", flush=True)
