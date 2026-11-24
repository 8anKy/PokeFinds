"""
BEVIS att flytten till komprimerade block är FÖRLUSTFRI (2026-11-24) — körs lokalt mot en KOPIA.

  1. Kopierar DATA (default .spike/engine-data) till <DATA>-blocktest och klipper av de sista korten
     ur basfilen till tilläggsfiler, så layouten är produktionens (bas + desc-add.bin/pts-add.bin).
  2. Svarar på facit-fotona FÖRE flytten.
  3. Flyttar i omgångar, med en simulerad omstart mitt i (ny Engine-instans).
  4. Jämför varje korts referensdata byte för byte mot originalet, och svaren på samma foton EFTER.

  .spike/venv-engine/Scripts/python.exe scanner-engine/test_blocks.py [antal foton]
"""
import json, os, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
FLAGS = {a for a in sys.argv[1:] if a.startswith("--")}
sys.argv = [a for a in sys.argv if not a.startswith("--")]

if "--pread" in FLAGS and not hasattr(os, "pread"):
    # LINUX-VÄGEN PÅ WINDOWS: servern läser med os.pread + fil-deskriptorer, den lokala vägen med
    # memmap. Skenorna nedan låter testet gå genom serverns gren (öppna/stänga/kapa/läsa om).
    _open = os.open

    def _pread(fd, n, off):
        os.lseek(fd, off, os.SEEK_SET)
        out = b""
        while len(out) < n:
            part = os.read(fd, n - len(out))
            if not part:
                break
            out += part
        return out

    os.open = lambda path, flags, *a, **k: _open(path, flags | getattr(os, "O_BINARY", 0), *a, **k)
    os.pread = _pread
    os.posix_fadvise = lambda *a: None
    os.POSIX_FADV_DONTNEED = 4
    os.fdatasync = lambda fd: None
sys.path.insert(0, HERE)
ROOT = os.path.join(HERE, "..", ".spike")
os.environ.setdefault("EMB_VERSION", "sig1")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from engine import Engine  # noqa: E402

SRC = os.environ.get("DATA_DIR", os.path.join(ROOT, "engine-data"))
DST = SRC.rstrip("/\\") + "-blocktest"
N_PHOTOS = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 120
ADD_CARDS = 3000  # så många av de sista korten flyttas till tilläggsfilerna (produktionens layout)


def du(path):
    return sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(path) for f in fs)


def answers(eng, photos):
    out = []
    for p in photos:
        cv2.setRNGSeed(0)
        r = eng.identify(open(p, "rb").read())
        out.append((r.get("best"), [(c.get("cardId"), c.get("inliers")) for c in (r.get("candidates") or [])][:5]))
    return out


def main():
    if os.path.exists(DST):
        shutil.rmtree(DST)
    t0 = time.time()
    shutil.copytree(SRC, DST)
    print(f"kopia klar ({time.time() - t0:.0f} s)", flush=True)

    # Produktionens layout: de sista ADD_CARDS korten ur basfilen → tilläggsfilerna.
    rk = os.path.join(DST, "refkp")
    meta = json.load(open(os.path.join(rk, "meta.json")))
    cut = sorted(v[0] for v in meta["offsets"].values())[-ADD_CARDS]
    for name, add, row in (("desc.npy", "desc-add.bin", 128), ("pts.npy", "pts-add.bin", 8)):
        off = Engine._npy_data_offset(os.path.join(rk, name))
        with open(os.path.join(rk, name), "rb") as f, open(os.path.join(rk, add), "wb") as g:
            f.seek(off + cut * row)
            shutil.copyfileobj(f, g)
        os.truncate(os.path.join(rk, name), off + cut * row)
    total = meta["n"]
    meta["n"], meta["n_add"] = cut, total - cut
    json.dump(meta, open(os.path.join(rk, "meta.json"), "w"))

    facit = json.load(open(os.path.join(ROOT, "facit", "facit.json"), encoding="utf-8"))
    photos = [os.path.join(ROOT, "facit", f["file"]) for f in facit if f.get("truthCardId")][:N_PHOTOS]

    orig = Engine(SRC)  # orört original = facit för bytejämförelsen
    eng = Engine(DST)
    assert eng.migrate_pending() == len(eng.offsets), "allt ska vara okomprimerat från början"
    size_before = du(rk)
    before = answers(eng, photos)
    print(f"före: {len(photos)} foton besvarade, refkp {size_before / 1e6:.0f} MB", flush=True)

    if "--kill" in FLAGS:
        # HÅRT AVBROTT: flytten körs i en egen process som dödas mitt i (som när Railway söver
        # behållaren). Nästa start ska städa upp och fortsätta utan att ett enda kort går förlorat.
        eng._close_base()
        for secs in (7, 19):
            child = subprocess.Popen(
                [sys.executable, "-c",
                 "import os,sys;sys.path.insert(0,sys.argv[1]);"
                 + ("import test_blocks;" if "--pread" in FLAGS else "")
                 + "from engine import Engine;e=Engine(sys.argv[2])\nwhile not e.migrate_step(8*2**20).get('done'):pass",
                 HERE, DST] + (["--pread"] if "--pread" in FLAGS else []),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            time.sleep(secs + 12)  # ~12 s går åt till att ladda motorn
            child.kill()
            child.wait()
            left = Engine(DST)
            print(f"dödad efter ~{secs} s: {left.migrate_pending()} kort kvar okomprimerade, {len(left.blocks)} i block", flush=True)
            left._close_base()
        eng = Engine(DST)

    # Flytt i omgångar, med omstart mitt i (i tilläggsfilerna) och en gång till i basfilen.
    t0, rounds, restarts = time.time(), 0, 0
    while True:
        r = eng.migrate_step()
        rounds += 1
        if r.get("done"):
            break
        assert not r.get("stalled"), r
        if rounds in (2, 40):
            eng._close_base()
            eng = Engine(DST)
            restarts += 1
    print(f"flytt klar: {rounds} omgångar, {restarts} omstarter, {time.time() - t0:.0f} s", flush=True)

    eng._close_base()
    eng = Engine(DST)  # som efter en omstart
    assert eng.migrate_pending() == 0
    size_after = du(rk)

    # 1) Byte för byte: varje korts referensdata är identiskt med originalets.
    bad = 0
    for i, cid in enumerate(orig.offsets):
        a, b = orig._ref(cid), eng._ref(cid)
        if not (np.array_equal(a[0], b[0]) and np.array_equal(a[1], b[1])):
            bad += 1
    print(f"bytejämförelse: {len(orig.offsets)} kort, {bad} avviker", flush=True)

    # 2) Samma svar på samma foton.
    after = answers(eng, photos)
    diff = sum(1 for x, y in zip(before, after) if x != y)
    print(f"svar: {len(photos)} foton, {diff} skiljer sig", flush=True)
    print(f"refkp: {size_before / 1e6:.0f} MB → {size_after / 1e6:.0f} MB ({100 * size_after / size_before:.1f} %)", flush=True)
    ok = bad == 0 and diff == 0
    print("RESULTAT: " + ("FÖRLUSTFRITT — identiska data och identiska svar" if ok else "FEL — se ovan"), flush=True)
    orig._close_base()
    eng._close_base()
    if ok:
        shutil.rmtree(DST, ignore_errors=True)
    sys.exit(0 if ok else 1)


if __name__ == "__main__" and sys.argv[0].endswith("test_blocks.py"):
    main()
