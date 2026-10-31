"""Generates the small synthetic images in tests/fixtures (run with python3 -I)."""
import math
import random
import sys
from pathlib import Path

from PIL import Image

out = Path(sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures")
out.mkdir(parents=True, exist_ok=True)
random.seed(1)


def photo(w=320, h=240, phase=0.0, noise=12):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            r = int(127 + 100 * math.sin(x / 23 + phase) + random.randint(-noise, noise))
            g = int(127 + 100 * math.cos(y / 17 + phase) + random.randint(-noise, noise))
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

# Color-managed JPEGs. Profiles come from the libjxl checkout (scripts/build-jxl.sh).
import io  # noqa: E402

from PIL import ImageCms, ImageOps  # noqa: E402

profiles = Path(__file__).resolve().parent.parent / ".cache/libjxl/third_party/skcms/profiles"
p3 = (profiles / "mobile/Display_P3_parametric.icc").read_bytes()
big_srgb = (profiles / "color.org/sRGB_v4_ICC_preference.icc").read_bytes()  # ~61 KB, LUT-based
exif = Image.Exif()
exif[0x0112] = 6  # stored sideways: rotate 90° clockwise to display
exif[0x010F] = "FixtureCam"  # Make: metadata that only the lossless transcode should keep
xmp = b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>'

# Display P3 pixels, rotated via EXIF. The reference is what a color-managed
# viewer shows: upright and converted to sRGB. Noise-free, so compression error
# stays small next to color shifts.
smooth = photo(noise=0)
smooth.save(out / "p3-rotated.jpg", quality=95, subsampling=0, icc_profile=p3, exif=exif.tobytes(), xmp=xmp)
with Image.open(out / "p3-rotated.jpg") as decoded:
    srgb = ImageCms.profileToProfile(
        ImageOps.exif_transpose(decoded), ImageCms.ImageCmsProfile(io.BytesIO(p3)), ImageCms.createProfile("sRGB"),
        renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
    )
    (out / "p3-rotated.srgb.rgba").write_bytes(srgb.convert("RGBA").tobytes())

base.save(out / "big-icc.jpg", quality=95, subsampling=0, icc_profile=big_srgb)
base.convert("L").save(out / "gray.jpg", quality=90)
base.convert("CMYK").save(out / "cmyk.jpg", quality=90)
