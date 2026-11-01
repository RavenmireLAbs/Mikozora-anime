#!/usr/bin/env python3
"""Generate the Windows app icon (build/icon.png + build/icon.ico).

Redraws the Dawn torii mark from its source of truth, public/favicon.svg
(108-unit grid), at high resolution with Pillow — upscaling the 192px
Android launcher PNG would look soft, and SVG rasterizers made the
gradients unreliable (same approach as the Android launcher PNGs).
Drawn full-bleed without the SVG's rounded-corner clip; Windows presents
icons as small squares.

Usage: python3 scripts/generate-icon.py  (requires Pillow)
"""
from pathlib import Path
from PIL import Image, ImageDraw

GRID = 108
SIZE = 1024
S = SIZE / GRID

SKY_TOP = (0x21, 0x1E, 0x59)
SKY_MID = (0x9E, 0x5A, 0x7D)
SKY_BOT = (0xF9, 0xB0, 0x6C)
SUN = (0xFF, 0xF1, 0xDC)
INK = (0x17, 0x15, 0x2E)
STAR = (0xFF, 0xFF, 0xFF)


def xy(points):
    return [(x * S, y * S) for x, y in points]


def cubic(p0, p1, p2, p3, n=28):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append((
            u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
        ))
    return out


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def main():
    out_dir = Path(__file__).resolve().parent.parent / "build"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Sky gradient: #211E59 -> #9E5A7D (55%) -> #F9B06C.
    strip = Image.new("RGB", (1, SIZE))
    for y in range(SIZE):
        t = y / (SIZE - 1)
        color = lerp(SKY_TOP, SKY_MID, t / 0.55) if t <= 0.55 else lerp(SKY_MID, SKY_BOT, (t - 0.55) / 0.45)
        strip.putpixel((0, y), color)
    img = strip.resize((SIZE, SIZE))
    d = ImageDraw.Draw(img)

    # Sun, then ground over its lower half.
    d.ellipse(xy([(54 - 16, 88 - 16), (54 + 16, 88 + 16)]), fill=SUN)
    d.rectangle([0, 88 * S, SIZE, SIZE], fill=INK)

    # Four-point star.
    d.polygon(xy([(54, 10.5), (55.2, 14.8), (59.5, 16), (55.2, 17.2),
                  (54, 21.5), (52.8, 17.2), (48.5, 16), (52.8, 14.8)]), fill=STAR)

    # Kasagi (curved top beam) — beziers sampled from the SVG path.
    kasagi = (
        cubic((14, 41), (30, 44.5), (40, 46), (54, 46))
        + cubic((54, 46), (68, 46), (78, 44.5), (94, 41))
        + [(92.5, 48.5)]
        + cubic((92.5, 48.5), (78, 51), (68, 52), (54, 52))
        + cubic((54, 52), (40, 52), (30, 51), (15.5, 48.5))
    )
    d.polygon(xy(kasagi), fill=INK)

    # Shimaki, center strut, nuki (lower beam), pillars.
    d.rectangle(xy([(27, 49.5), (81, 54.5)]), fill=INK)
    d.rectangle(xy([(51.5, 54.5), (56.5, 62)]), fill=INK)
    d.rectangle(xy([(23, 62), (85, 67.5)]), fill=INK)
    d.polygon(xy([(33, 53), (41, 53), (42, 88), (32, 88)]), fill=INK)
    d.polygon(xy([(67, 53), (75, 53), (76, 88), (66, 88)]), fill=INK)

    png = img.resize((512, 512), Image.LANCZOS)
    png.save(out_dir / "icon.png")
    img.save(out_dir / "icon.ico", format="ICO",
             sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)])
    print("wrote", out_dir / "icon.png", "and", out_dir / "icon.ico")


if __name__ == "__main__":
    main()
