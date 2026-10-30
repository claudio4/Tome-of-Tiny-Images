"""Generates the small synthetic images in tests/fixtures (run with python3 -I)."""
import math
import random
import sys
from pathlib import Path

from PIL import Image

out = Path(sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures")
out.mkdir(parents=True, exist_ok=True)
random.seed(1)


def photo(w=320, h=240, phase=0.0):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            r = int(127 + 100 * math.sin(x / 23 + phase) + random.randint(-12, 12))
            g = int(127 + 100 * math.cos(y / 17 + phase) + random.randint(-12, 12))
            b = int((x + y) * 255 / (w + h))
            px[x, y] = (max(0, min(255, r)), max(0, min(255, g)), b)
    return img


base = photo()
base.save(out / "photo.jpg", quality=90)
base.save(out / "photo-progressive.jpg", quality=85, progressive=True, subsampling=0)

rgba = base.convert("RGBA")
alpha = Image.new("L", base.size)
alpha.putdata([min(255, x) for x in range(base.size[0])] * base.size[1])
rgba.putalpha(alpha)
rgba.save(out / "alpha.png")
base.save(out / "opaque.png")
base.save(out / "photo.webp", quality=80)

frames = [photo(64, 48, p).convert("P", palette=Image.ADAPTIVE) for p in (0, 1, 2)]
frames[0].save(out / "static.gif")
frames[0].save(out / "animated.gif", save_all=True, append_images=frames[1:], duration=100, loop=0)
rgb_frames = [f.convert("RGB") for f in frames]
rgb_frames[0].save(out / "animated.webp", save_all=True, append_images=rgb_frames[1:], duration=100)
rgb_frames[0].save(out / "animated.png", save_all=True, append_images=rgb_frames[1:], duration=100)
(out / "not-an-image.txt").write_text("hello\n")
