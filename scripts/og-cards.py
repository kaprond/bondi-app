"""Renders the link-preview card (public/og/<id>.jpg) and the first-frame poster
(public/posters/<id>.jpg) for every clip in the feed. Needs ffmpeg and Pillow.
Run after adding a clip:  python3 scripts/og-cards.py"""
import os, re, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, 'node_modules', '@expo-google-fonts')
BALOO = os.path.join(FONTS, 'baloo-2', '800ExtraBold', 'Baloo2_800ExtraBold.ttf')
QUICK = os.path.join(FONTS, 'quicksand', '700Bold', 'Quicksand_700Bold.ttf')
BRAND, DEEP, YELLOW, WHITE = (0, 149, 182), (0, 82, 100), (255, 240, 0), (255, 255, 255)

def feed():
    src = open(os.path.join(ROOT, 'src', 'api.ts')).read()
    for line in src.splitlines():
        if not line.strip().startswith("{ id: '"): continue
        get = lambda k: re.search(rf"{k}: '((?:[^'\\]|\\.)*)'", line).group(1).replace("\\'", "'")
        yield {k: get(k) for k in ('id', 'title', 'question', 'labelA', 'labelB')}

def frame(video, at_end):
    out = tempfile.mktemp(suffix='.png')
    seek = ['-sseof', '-0.05'] if at_end else ['-ss', '0']
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *seek, '-i', video, '-frames:v', '1', out], check=True)
    return Image.open(out).convert('RGB')

def wrap(draw, text, font, width):
    lines, cur = [], ''
    for w in text.split():
        t = f'{cur} {w}'.strip()
        if draw.textlength(t, font=font) <= width: cur = t
        else: lines.append(cur); cur = w
    return lines + [cur]

def card(c, pause):
    W, H = 1200, 630
    grad = Image.linear_gradient('L').rotate(-90).resize((W, H))
    img = Image.composite(Image.new('RGB', (W, H), BRAND), Image.new('RGB', (W, H), DEEP), grad)
    fw = 330; fh = int(fw * pause.height / pause.width)
    fr = pause.resize((fw, fh)).crop((0, (fh - 586) // 2, fw, (fh - 586) // 2 + 586))
    mask = Image.new('L', fr.size, 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, *fr.size), 28, fill=255)
    img.paste(fr, (70, 22), mask)
    d = ImageDraw.Draw(img)
    # pause pill on the frame
    small = ImageFont.truetype(QUICK, 24)
    d.rounded_rectangle((96, 48, 96 + 26 + d.textlength('paused', font=small) + 22, 88), 20, fill=WHITE)
    d.rectangle((110, 58, 116, 78), fill=DEEP); d.rectangle((122, 58, 128, 78), fill=DEEP)
    d.text((138, 52), 'paused', font=small, fill=DEEP)
    x, right = 460, W - 60
    size = 76
    while True:
        q = ImageFont.truetype(BALOO, size)
        lines = wrap(d, c['question'], q, right - x)
        if len(lines) <= 3 or size <= 48: break
        size -= 6
    block = 44 + len(lines) * int(size * 1.08) + 26 + 62 + 30 + 34
    y = max(40, (H - 110 - block) // 2 + 20)
    d.text((x, y), 'CAN YOU CALL IT?', font=ImageFont.truetype(QUICK, 30), fill=YELLOW); y += 44
    for ln in lines:
        d.text((x, y), ln, font=q, fill=WHITE); y += int(size * 1.08)
    pill = ImageFont.truetype(QUICK, 32)
    y += 26; px = x
    for i, lab in enumerate((c['labelA'], c['labelB'])):
        w = d.textlength(lab, font=pill) + 48
        d.rounded_rectangle((px, y, px + w, y + 62), 31, fill=WHITE if i == 0 else None, outline=WHITE, width=3)
        d.text((px + 24, y + 10), lab, font=pill, fill=DEEP if i == 0 else WHITE)
        px += w + 18
        if i == 0:
            d.text((px, y + 10), 'or', font=pill, fill=WHITE); px += d.textlength('or', font=pill) + 18
    d.text((x, y + 92), 'it pauses right before the moment. call it, then watch.', font=ImageFont.truetype(QUICK, 26), fill=(215, 238, 244))
    d.text((x, H - 96), 'bondi', font=ImageFont.truetype(BALOO, 60), fill=WHITE)
    d.text((x + 175, H - 74), 'free coins · no cash', font=ImageFont.truetype(QUICK, 28), fill=(220, 240, 245))
    return img

def main():
    clips = os.path.join(ROOT, 'assets', 'clips')
    os.makedirs(os.path.join(ROOT, 'public', 'og'), exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'public', 'posters'), exist_ok=True)
    for c in feed():
        teaser = os.path.join(clips, f"{c['id']}-teaser.mp4")
        frame(teaser, False).resize((540, 960)).save(os.path.join(ROOT, 'public', 'posters', f"{c['id']}.jpg"), quality=72, optimize=True, progressive=True)
        card(c, frame(teaser, True)).save(os.path.join(ROOT, 'public', 'og', f"{c['id']}.jpg"), quality=84, optimize=True, progressive=True)
        print('ok', c['id'])

if __name__ == '__main__':
    sys.exit(main())
