# Makes web-sized WebP copies of the program posters (assets/programs/*.png, ~2.5 MB each) for account.js:
#   192px / 640px / 1200px   the whole poster (phone thumbnails, cards, full-width banners)
#   thumb-192px / thumb-384px   a square crop of the person's upper body, for the small list thumbnails (44-64px):
#                             the posters put the person to one side with empty blurred space beside them, so the
#                             whole poster shrunk to 64px shows a tiny off-centre figure. The person is sharp and the
#                             background blurred, so the crop is found automatically from image sharpness.
# High quality settings because the posters carry small text. Run after adding or replacing a poster:
#   python3 scripts/program-images.py            (needs Pillow and numpy; skips files already up to date)
#   python3 scripts/program-images.py --force    (rebuild everything)
#   python3 scripts/program-images.py --preview out.png   (also writes a contact sheet of the detected crops)
import pathlib, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = pathlib.Path(__file__).resolve().parent.parent / "assets" / "programs"
OUT = SRC / "web"
WIDTHS = (192, 640, 1200)
THUMB_WIDTHS = (192, 384)
QUALITY = {192: 85, 384: 88, 640: 90, 1200: 90}
FORCE = "--force" in sys.argv
PREVIEW = sys.argv[sys.argv.index("--preview") + 1] if "--preview" in sys.argv else None


def subject_box(im, block=16, frac=0.18):
    """Bounding box of the sharp region (the person) in a photo with a blurred background."""
    edges = np.abs(np.asarray(im.convert("L").filter(ImageFilter.FIND_EDGES), dtype=np.float32))
    h, w = edges.shape
    bh, bw = h // block, w // block
    blocks = edges[:bh * block, :bw * block].reshape(bh, block, bw, block).mean(axis=(1, 3))
    mask = blocks > blocks.max() * frac
    pad = np.pad(mask, 1)  # drop isolated specks: a sharp block needs two sharp neighbours
    neighbours = sum(pad[1 + dy:1 + dy + bh, 1 + dx:1 + dx + bw] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) - mask
    mask &= neighbours >= 2
    ys, xs = np.where(mask)
    if not len(ys):
        return (0, 0, w, h)
    return (int(xs.min()) * block, int(ys.min()) * block, int(xs.max() + 1) * block, int(ys.max() + 1) * block)


def thumb_crop(size, box):
    """Square crop for a small thumbnail: the person's upper body, centred on them, anchored near the head."""
    w, h = size
    x0, y0, x1, y1 = box
    sw, sh = x1 - x0, y1 - y0
    side = sw * 1.35                      # a bit wider than the person
    side = min(max(side, min(w, h) * 0.38), min(w, h))
    cx = (x0 + x1) / 2
    top = (y0 + y1) / 2 - side / 2 if sh <= side else y0 - side * 0.04  # whole person if they fit, else from the head down
    left = cx - side / 2                   # may run past the edge: the person is centred, and the gap is filled by crop_padded
    top = min(max(top, -side * 0.08), h - side)
    return (int(left), int(top), int(left + side), int(top + side))


def crop_padded(im, box):
    """Crop a box that may extend past the image; the missing strip is a mirror of the blurred background, so the
    person stays centred instead of being pushed to one side when they stand at the poster's edge."""
    x0, y0, x1, y1 = box
    w, h = im.size
    pad = max(0, -x0, -y0, x1 - w, y1 - h)
    if not pad:
        return im.crop(box)
    # Fill from the opposite side of the poster (pure blurred background, not a mirror of the person's own edge),
    # then soften the fill and feather the seam so nothing reads as a hard line.
    a = np.asarray(im)
    padded = Image.fromarray(np.pad(a, ((pad, pad), (pad, pad), (0, 0)), mode="wrap"))
    soft = padded.filter(ImageFilter.GaussianBlur(max(12, pad // 6)))
    mask = Image.new("L", padded.size, 255)
    inner = Image.new("L", (w, h), 0)
    mask.paste(inner, (pad, pad))
    mask = mask.filter(ImageFilter.GaussianBlur(max(10, pad // 8)))   # feathered boundary between poster and fill
    out = Image.composite(soft, padded, mask)
    return out.crop((x0 + pad, y0 + pad, x1 + pad, y1 + pad))


# Posters whose text is part of the picture (the app draws no caption over them): the sharp text would be mistaken
# for the person, so the thumbnail crop is set by hand (x0, y0, x1, y1).
MANUAL_CROP = {"ski.png": (20, 10, 670, 660), "mobility-ladder-poster.png": (10, 110, 690, 790),
               "golfers-elbow.png": (20, 90, 720, 790), "tennis-elbow.png": (10, 90, 710, 790), "plantar.png": (60, 240, 780, 960), "knee.png": (30, 100, 730, 800)}


def stale(dest, src):
    return FORCE or not dest.exists() or dest.stat().st_mtime < src.stat().st_mtime


OUT.mkdir(exist_ok=True)
tiles = []
for png in sorted(SRC.glob("*.png")):
    with Image.open(png) as im:
        im = im.convert("RGB")
        written = []
        for w in WIDTHS:
            dest = OUT / f"{png.stem}-{w}.webp"
            if stale(dest, png):
                im.resize((w, round(im.height * w / im.width)), Image.LANCZOS).save(dest, "WEBP", quality=QUALITY[w], method=6)
                written.append(dest)
        box = subject_box(im)
        crop = MANUAL_CROP.get(png.name) or thumb_crop(im.size, box)
        for w in THUMB_WIDTHS:
            dest = OUT / f"{png.stem}-thumb-{w}.webp"
            if stale(dest, png):
                crop_padded(im, crop).resize((w, w), Image.LANCZOS).save(dest, "WEBP", quality=QUALITY[w], method=6)
                written.append(dest)
        if PREVIEW:
            dbg = im.copy()
            d = ImageDraw.Draw(dbg)
            d.rectangle(box, outline="lime", width=6)
            d.rectangle(crop, outline="red", width=6)
            dbg.thumbnail((260, 260))
            tile = Image.new("RGB", (260, 440), "white")
            tile.paste(dbg, (0, 0))
            tile.paste(crop_padded(im, crop).resize((160, 160), Image.LANCZOS), (50, 270))
            ImageDraw.Draw(tile).text((4, 430), png.stem, fill="black")
            tiles.append(tile)
    print(f"{png.name}: subject {box} thumb crop {crop}; wrote {len(written)} file(s)")

if PREVIEW:
    cols = 4
    sheet = Image.new("RGB", (260 * cols, 440 * ((len(tiles) + cols - 1) // cols)), "white")
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * 260, (i // cols) * 440))
    sheet.save(PREVIEW)
    print("preview:", PREVIEW)
