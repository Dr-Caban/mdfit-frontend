# Makes web-sized WebP copies of the program posters (assets/programs/*.png, ~2.5 MB each) for account.js:
# 192px for phone thumbnails, 640px for cards, 1200px for full-width banners. High quality settings because the posters
# carry small text. Run after adding or replacing a
# poster:  python3 scripts/program-images.py   (needs Pillow)
import pathlib
from PIL import Image

SRC = pathlib.Path(__file__).resolve().parent.parent / "assets" / "programs"
OUT = SRC / "web"
WIDTHS = (192, 640, 1200)
QUALITY = {192: 85, 640: 90, 1200: 90}

OUT.mkdir(exist_ok=True)
for png in sorted(SRC.glob("*.png")):
    with Image.open(png) as im:
        im = im.convert("RGB")
        for w in WIDTHS:
            h = round(im.height * w / im.width)
            dest = OUT / f"{png.stem}-{w}.webp"
            im.resize((w, h), Image.LANCZOS).save(dest, "WEBP", quality=QUALITY[w], method=6)
    sizes = ", ".join(f"{w}px {(OUT / f'{png.stem}-{w}.webp').stat().st_size // 1024} KB" for w in WIDTHS)
    print(f"{png.name} ({png.stat().st_size // 1024} KB) -> {sizes}")
