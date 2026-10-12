#!/usr/bin/env python3
"""
Motion paths + stick-figure key poses from tools/anim_report.ts --json output (PIL only).

  python3 plot_paths.py report.json --out paths.png [--points muzzle,handR,head,hips] [--poses 0,0.1,0.15]

Two panels: SIDE (z right, y up: the character faces right) and FRONT (x left/right, y up, seen from
the front). Each tracked point draws one dot per frame, cyan (start) -> magenta (end): the gap
between dots is the spacing — wide gaps = fast, bunched = slow-in/out, uneven jumps = pops.
Key times are ringed in white, events in yellow. Stick figures are drawn at the key times (or
--poses), so line of action and silhouette can be judged per key.
"""
import argparse
import json

from PIL import Image, ImageDraw, ImageFont

BONES_LINKS = [
    ('hips', 'spine'), ('spine', 'chest'), ('chest', 'neck'), ('neck', 'head'),
    ('chest', 'shoulderL'), ('shoulderL', 'upperArmL'), ('upperArmL', 'foreArmL'), ('foreArmL', 'handL'),
    ('chest', 'shoulderR'), ('shoulderR', 'upperArmR'), ('upperArmR', 'foreArmR'), ('foreArmR', 'handR'),
    ('hips', 'thighL'), ('thighL', 'shinL'), ('shinL', 'footL'),
    ('hips', 'thighR'), ('thighR', 'shinR'), ('shinR', 'footR'),
]


def font(size):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu/DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def lerp_col(k):
    return (int(40 + 215 * k), int(230 - 190 * k), int(255 - 30 * k))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('json')
    ap.add_argument('--out', required=True)
    ap.add_argument('--points', default='muzzle,handR,handL,head,hips')
    ap.add_argument('--poses', default=None)
    ap.add_argument('--size', type=int, default=620)
    a = ap.parse_args()
    data = json.load(open(a.json))
    frames = data['frames']
    pts = [p for p in a.points.split(',') if p in frames[0]['pts']]
    key_t = data.get('keys') or []
    ev = data.get('events') or []
    pose_t = [float(x) for x in a.poses.split(',')] if a.poses else (key_t or [frames[0]['t'], frames[len(frames) // 2]['t'], frames[-1]['t']])

    S = a.size
    W, H = S * 2 + 30, S + 70
    img = Image.new('RGB', (W, H), (14, 11, 20))
    d = ImageDraw.Draw(img)
    fnt = font(14)
    title = f"{data['champ']} · {data['clip']}   dots = 1/60 s   rings: keys (white) events (yellow)"
    d.text((12, 8), title, fill=(255, 235, 140), font=fnt)

    # world bounds (y, z for side; x, y for front)
    allp = [fr['joints'][j] for fr in frames for j in fr['joints']] + [fr['pts'][p] for fr in frames for p in pts]
    ymin, ymax = min(p[1] for p in allp) - 0.1, max(p[1] for p in allp) + 0.1
    zmin, zmax = min(p[2] for p in allp) - 0.1, max(p[2] for p in allp) + 0.1
    xmin, xmax = min(p[0] for p in allp) - 0.1, max(p[0] for p in allp) + 0.1
    span = max(ymax - ymin, zmax - zmin, xmax - xmin)
    scale = (S - 40) / span

    def to_side(p, ox):
        return (ox + 20 + (p[2] - zmin) * scale, 50 + (ymax - p[1]) * scale)

    def to_front(p, ox):
        # seen from the front: the character's left (+x) is on the viewer's right
        return (ox + 20 + (p[0] - xmin) * scale, 50 + (ymax - p[1]) * scale)

    panels = [('SIDE (facing right)', to_side, 10), ('FRONT', to_front, S + 20)]
    n = len(frames)
    for name, proj, ox in panels:
        d.rectangle((ox, 40, ox + S, 40 + S), outline=(60, 50, 80))
        d.text((ox + 8, 44), name, fill=(200, 190, 230), font=fnt)
        # ground line
        g0 = proj([xmin, 0, zmin], ox)
        g1 = proj([xmax, 0, zmax], ox)
        d.line((ox + 4, g0[1], ox + S - 4, g1[1]), fill=(70, 60, 90))
        # stick figures at key times
        for t in pose_t:
            fr = min(frames, key=lambda f: abs(f['t'] - t))
            j = fr['joints']
            k = fr['t'] / max(frames[-1]['t'], 1e-6)
            col = tuple(int(c * 0.75) for c in lerp_col(k))
            for b0, b1 in BONES_LINKS:
                if b0 in j and b1 in j:
                    d.line((*proj(j[b0], ox), *proj(j[b1], ox)), fill=col, width=2)
            hx, hy = proj(j['head'], ox)
            d.ellipse((hx - 6, hy - 12, hx + 6, hy), outline=col, width=2)
        # dotted paths
        for p in pts:
            for i, fr in enumerate(frames):
                x, y = proj(fr['pts'][p], ox)
                c = lerp_col(i / max(1, n - 1))
                d.ellipse((x - 2.2, y - 2.2, x + 2.2, y + 2.2), fill=c)
            x, y = proj(frames[-1]['pts'][p], ox)
            d.text((x + 5, y - 7), p, fill=(220, 220, 240), font=fnt)
            for t in key_t:
                fr = min(frames, key=lambda f: abs(f['t'] - t))
                x, y = proj(fr['pts'][p], ox)
                d.ellipse((x - 5, y - 5, x + 5, y + 5), outline=(255, 255, 255), width=1)
            for e in ev:
                fr = min(frames, key=lambda f: abs(f['t'] - e['t']))
                x, y = proj(fr['pts'][p], ox)
                d.ellipse((x - 7, y - 7, x + 7, y + 7), outline=(255, 220, 60), width=2)
    img.save(a.out)
    print('wrote', a.out)


if __name__ == '__main__':
    main()
