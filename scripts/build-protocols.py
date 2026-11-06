# Builds Dr. Jared's week-by-week protocols for the app from data/protocols/<id>.json (the sheets written out in full).
#  - downloads each week's sheet from Google Drive (by its driveId) and saves web copies:
#      assets/protocols/<id>/<week key>-960.webp and -1600.webp   (skips ones already there unless --force)
#  - checks every protocol file has what the app needs, and writes data/protocols/index.json
#      { "version": <hash of all protocol files>, "ids": [...], "weeks": { id: number of weeks } }
# Run after adding or editing a protocol file:  python3 scripts/build-protocols.py   (needs Pillow)
import hashlib, io, json, pathlib, sys, urllib.request
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA, ASSETS = ROOT / "data" / "protocols", ROOT / "assets" / "protocols"
FORCE = "--force" in sys.argv
WIDTHS = (960, 1600)

def check(p, f):
    errs = []
    for k in ("id", "title", "weeks"):
        if not p.get(k): errs.append(f"{f.name}: missing {k}")
    if p.get("id") != f.stem: errs.append(f"{f.name}: id {p.get('id')!r} doesn't match the file name")
    keys = [w.get("key") for w in p.get("weeks", [])]
    if len(set(keys)) != len(keys): errs.append(f"{f.name}: duplicate week keys {keys}")
    for w in p.get("weeks", []):
        if not w.get("label"): errs.append(f"{f.name}: week {w.get('key')} has no label")
        for x in w.get("exercises", []):
            if not x.get("name"): errs.append(f"{f.name}: week {w.get('key')} has an exercise without a name")
    return errs

def sheet(pid, w):
    if not w.get("driveId"): return 0
    out = ASSETS / pid; out.mkdir(parents=True, exist_ok=True)
    dests = [out / f"{w['key']}-{width}.webp" for width in WIDTHS]
    if not FORCE and all(d.exists() for d in dests): return 0
    url = f"https://drive.google.com/thumbnail?id={w['driveId']}&sz=w2400"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "MDFit-build/1.0"}), timeout=60) as r:
        im = Image.open(io.BytesIO(r.read())).convert("RGB")
    for width, d in zip(WIDTHS, dests):
        h = round(im.height * min(width, im.width) / im.width)
        im.resize((min(width, im.width), h), Image.LANCZOS).save(d, "WEBP", quality=86, method=6)
    return len(dests)

files = sorted(f for f in DATA.glob("*.json") if f.name != "index.json")
errors, ids, weeks, h = [], [], {}, hashlib.sha1()
for f in files:
    raw = f.read_bytes(); h.update(raw)
    p = json.loads(raw)
    errors += check(p, f)
    ids.append(p["id"]); weeks[p["id"]] = len(p["weeks"])
    made = sum(sheet(p["id"], w) for w in p["weeks"])
    print(f"{p['id']}: {len(p['weeks'])} weeks, {sum(len(w.get('exercises', [])) for w in p['weeks'])} exercises, {made} sheet images written")
if errors:
    print("\n".join(errors)); sys.exit(1)
(DATA / "index.json").write_text(json.dumps({"version": h.hexdigest()[:10], "ids": ids, "weeks": weeks}, indent=1) + "\n")
print("index:", ids)
