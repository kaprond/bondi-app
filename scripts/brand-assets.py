"""Renders the LetsJam app icons, splash, favicon and link-preview card.
Same look as before: Baloo 2 ExtraBold in white on the teal gradient, with the yellow dot.
Needs Pillow and node_modules (for the font). Run:  python3 scripts/brand-assets.py"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, 'node_modules', '@expo-google-fonts')
BALOO = os.path.join(FONTS, 'baloo-2', '800ExtraBold', 'Baloo2_800ExtraBold.ttf')
QUICK = os.path.join(FONTS, 'quicksand', '700Bold', 'Quicksand_700Bold.ttf')
TOP, BOTTOM = (51, 170, 197), (4, 148, 183)
BRAND, DEEP, YELLOW, WHITE = (0, 149, 182), (0, 82, 100), (255, 240, 0), (255, 255, 255)
NAME, MARK = 'letsjam', 'j'


def gradient(w, h):
    im = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / max(h - 1, 1)
        d.line([(0, y), (w, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)))
    return im


def mark(size, color=WHITE, dot=YELLOW, scale=0.56):
    """The 'j.' glyph centred on a transparent square."""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    font = ImageFont.truetype(BALOO, round(size * scale))
    l, t, r, b = d.textbbox((0, 0), MARK, font=font)
    gw, gh = r - l, b - t
    dr = size * 0.075
    total = gw + dr * 0.6 + dr * 2
    x0 = (size - total) / 2 - l
    y0 = (size - gh) / 2 - t
    d.text((x0, y0), MARK, font=font, fill=color)
    cx, cy = x0 + r + dr * 0.6 + dr, y0 + b - dr * 1.15
    d.ellipse([cx - dr, cy - dr, cx + dr, cy + dr], fill=dot)
    return im


def icon(size):
    im = gradient(size, size).convert('RGBA')
    im.alpha_composite(mark(size))
    return im.convert('RGB')


def wordmark(height, color=WHITE, dot=YELLOW):
    """'letsjam.' on transparent, tight to the text."""
    font = ImageFont.truetype(BALOO, height)
    tmp = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
    l, t, r, b = tmp.textbbox((0, 0), NAME, font=font)
    dr = height * 0.085
    w, h = (r - l) + dr * 3 + 4, (b - t) + 4
    im = Image.new('RGBA', (round(w), round(h)), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.text((2 - l, 2 - t), NAME, font=font, fill=color)
    # sit the dot on the x-height midline, like the old wordmark
    cx, cy = 2 + (r - l) + dr * 1.6, 2 + (b - t) * 0.55
    d.ellipse([cx - dr, cy - dr, cx + dr, cy + dr], fill=dot)
    return im


def splash():
    im = Image.new('RGBA', (1200, 480), (0, 0, 0, 0))
    wm = wordmark(220)
    wm.thumbnail((1100, 440))
    im.alpha_composite(wm, ((1200 - wm.width) // 2, (480 - wm.height) // 2))
    return im


def og():
    W, H = 1200, 630
    im = gradient(W, H).convert('RGBA')
    d = ImageDraw.Draw(im)
    wm = wordmark(84)
    im.alpha_composite(wm, (72, 70))
    big = ImageFont.truetype(BALOO, 112)
    d.text((72, 165), 'call it with', font=big, fill=WHITE)
    x = 72
    d.text((x, 280), 'your ', font=big, fill=WHITE)
    x += d.textlength('your ', font=big)
    d.text((x, 280), 'crew', font=big, fill=YELLOW)
    sub = ImageFont.truetype(QUICK, 40)
    d.text((72, 445), 'friend pools on anything. winners split the pot.', font=sub, fill=WHITE)
    pill = ImageFont.truetype(QUICK, 34)
    label = 'free coins · no cash · 18+'
    pw = d.textlength(label, font=pill) + 64
    d.rounded_rectangle([72, 520, 72 + pw, 586], radius=33, fill=WHITE)
    d.text((72 + 32, 530), label, font=pill, fill=BRAND)
    # right side: a big mark
    m = mark(380)
    im.alpha_composite(m, (W - 380 - 50, 125))
    return im.convert('RGB')


def main():
    out = lambda p: os.path.join(ROOT, p)
    for path, size in [('assets/icon.png', 1024), ('public/icon-512.png', 512), ('public/icon-192.png', 192),
                       ('public/apple-touch-icon.png', 180), ('assets/favicon.png', 48)]:
        icon(size).save(out(path))
    # Android adaptive icon: glyph inside the 66% safe zone, flat brand background
    mark(1024, scale=0.40).save(out('assets/android-icon-foreground.png'))
    Image.new('RGB', (1024, 1024), BRAND).save(out('assets/android-icon-background.png'))
    mono = mark(1024, color=(0, 0, 0), dot=(0, 0, 0), scale=0.40)
    mono.save(out('assets/android-icon-monochrome.png'))
    splash().save(out('assets/splash-icon.png'))
    og().save(out('public/og.png'))
    print('brand assets written')


if __name__ == '__main__':
    main()
