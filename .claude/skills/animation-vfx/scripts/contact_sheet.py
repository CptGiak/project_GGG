#!/usr/bin/env python3
"""
Contact sheets and onion skins from captured frames (PIL only).

  python3 contact_sheet.py --out sheet.png [--cols 6] [--crop x,y,w,h] [--every 2] [--start 0] f0000.png f0002.png ...
  python3 contact_sheet.py --onion --out onion.png [--crop ...] frames...

Sheet: frames in a grid, each labelled with its frame index and time at 60 fps (t = frame / 60).
Onion: every frame's foreground (pixels that differ from the first frame's border colour) is laid over
the last frame, tinted from cyan (oldest) to magenta (newest) with rising opacity, so spacing and arcs
read in one image: even gaps = linear motion, bunched = ease, a broken arc = a pop.
"""
import argparse
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFont


def load(paths, crop):
    imgs = []
    for p in paths:
        im = Image.open(p).convert('RGB')
        if crop:
            x, y, w, h = crop
            im = im.crop((x, y, x + w, y + h))
        imgs.append(im)
    return imgs


def font(size):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def frame_index(path, fallback):
    base = os.path.basename(path)
    digits = ''.join(c for c in base if c.isdigit())
    return int(digits) if digits else fallback


def sheet(paths, imgs, cols, out, scale):
    w, h = imgs[0].size
    tw, th = int(w * scale), int(h * scale)
    rows = (len(imgs) + cols - 1) // cols
    pad = 4
    canvas = Image.new('RGB', (cols * (tw + pad) + pad, rows * (th + pad) + pad), (12, 10, 16))
    draw = ImageDraw.Draw(canvas)
    fnt = font(max(12, th // 18))
    for i, (p, im) in enumerate(zip(paths, imgs)):
        r, c = divmod(i, cols)
        x, y = pad + c * (tw + pad), pad + r * (th + pad)
        canvas.paste(im.resize((tw, th), Image.LANCZOS), (x, y))
        f = frame_index(p, i)
        label = f'#{f}  {f / 60:.3f}s'
        draw.rectangle((x, y, x + int(fnt.size * len(label) * 0.62) + 8, y + fnt.size + 6), fill=(0, 0, 0))
        draw.text((x + 4, y + 2), label, fill=(255, 235, 120), font=fnt)
    canvas.save(out)
    print('wrote', out)


def onion(imgs, out):
    base = imgs[-1].copy()
    ref = imgs[0]
    w, h = ref.size
    # background colour = median of the border of the first frame
    border = [ref.getpixel((x, 0)) for x in range(0, w, max(1, w // 64))] + [ref.getpixel((0, y)) for y in range(0, h, max(1, h // 64))]
    border.sort(key=lambda c: sum(c))
    bg = border[len(border) // 2]
    bg_img = Image.new('RGB', (w, h), bg)
    n = len(imgs)
    acc = Image.new('RGB', (w, h), (0, 0, 0))
    for i, im in enumerate(imgs[:-1]):
        k = i / max(1, n - 1)
        diff = ImageChops.difference(im, bg_img).convert('L').point(lambda v: 255 if v > 26 else 0)
        tint = (int(40 + 215 * k), int(230 - 200 * k), int(255 - 40 * k))
        layer = Image.new('RGB', (w, h), tint)
        alpha = diff.point(lambda v, a=int(70 + 120 * k): a if v else 0)
        acc.paste(layer, (0, 0), alpha)
    mask = acc.convert('L').point(lambda v: 255 if v > 0 else 0)
    out_img = Image.composite(Image.blend(base, acc, 0.55), base, mask)
    out_img.save(out)
    print('wrote', out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('frames', nargs='+')
    ap.add_argument('--out', required=True)
    ap.add_argument('--cols', type=int, default=6)
    ap.add_argument('--crop', default=None)
    ap.add_argument('--every', type=int, default=1)
    ap.add_argument('--start', type=int, default=0)
    ap.add_argument('--onion', action='store_true')
    ap.add_argument('--scale', type=float, default=0)
    a = ap.parse_args()
    crop = tuple(int(v) for v in a.crop.split(',')) if a.crop else None
    imgs = load(a.frames, crop)
    if not imgs:
        sys.exit('no frames')
    if a.onion:
        onion(imgs, a.out)
    else:
        scale = a.scale or min(1.0, 1800 / (imgs[0].size[0] * min(a.cols, len(imgs))))
        sheet(a.frames, imgs, min(a.cols, len(imgs)), a.out, scale)


if __name__ == '__main__':
    main()
