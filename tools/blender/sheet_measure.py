"""
Character-sheet measurements with PIL + numpy (+ scipy.ndimage).

Everything the Blender build needs from the Gemini model sheets: the figure silhouette, the
scale (metres per pixel, from the real height of the character), width profiles, flat colours
sampled per material, the back emblem cut out as a texture and a few traced shapes (mask,
hair spikes).

Conventions: sheet pixels have y down. Measurements are returned in metres with h = height
above the soles and lat = lateral offset from the body centre line, positive = viewer's right
on the FRONT sheet (= character's left) and viewer's left on the BACK sheet (the back view is
mirrored so lat always means "character's left").

Run standalone to print a summary and write a debug overlay:
  python tools/blender/sheet_measure.py kaiser
"""
from __future__ import annotations

import json
import math
import os
import sys
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SHEETS = os.path.join(ROOT, 'docs', 'art', 'sheets')


def load_rgb(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert('RGB')).astype(np.int32)


def srgb_hex(c) -> str:
    return '#%02x%02x%02x' % tuple(int(round(v)) for v in c)


@dataclass
class Sheet:
    """One view of a character sheet with its pixel <-> metre mapping."""
    name: str
    view: str  # 'front' | 'back'
    img: np.ndarray
    mask: np.ndarray
    bg: tuple
    cx: float = 0.0  # body centre line (px)
    sole: float = 0.0  # y of the soles (px)
    top: float = 0.0  # y of the highest pixel (hair tips)
    skull: float = 0.0  # y of the top of the skull (px)
    s: float = 0.0  # metres per pixel
    extra: dict = field(default_factory=dict)

    @property
    def size(self):
        return self.img.shape[1], self.img.shape[0]

    # pixel -> metres ------------------------------------------------------------------------
    def h(self, y):
        return (self.sole - np.asarray(y, dtype=float)) * self.s

    def lat(self, x):
        d = (np.asarray(x, dtype=float) - self.cx) * self.s
        return d if self.view == 'front' else -d

    # metres -> pixel -------------------------------------------------------------------------
    def y(self, h):
        return self.sole - np.asarray(h, dtype=float) / self.s

    def x(self, lat):
        lat = np.asarray(lat, dtype=float)
        return self.cx + (lat if self.view == 'front' else -lat) / self.s


def figure_mask(img: np.ndarray, bg, blanks=(), thr=36) -> np.ndarray:
    """Foreground = colour far from the flat background; keep the largest blob, fill holes."""
    d = np.abs(img - np.array(bg)[None, None, :]).sum(2)
    fg = d > thr
    for (x0, y0, x1, y1) in blanks:
        fg[y0:y1, x0:x1] = False
    lab, n = ndimage.label(fg)
    if n == 0:
        return fg
    sizes = ndimage.sum(fg, lab, index=np.arange(1, n + 1))
    keep = lab == (1 + int(np.argmax(sizes)))
    return ndimage.binary_fill_holes(keep)


def border_bg(img: np.ndarray) -> tuple:
    h, w, _ = img.shape
    patches = [img[4:30, 4:30], img[4:30, w - 30:w - 4], img[h - 30:h - 4, 4:30], img[h - 30:h - 4, w - 30:w - 4]]
    return tuple(int(v) for v in np.median(np.concatenate([p.reshape(-1, 3) for p in patches]), 0))


def find_insets(img: np.ndarray, min_len=110) -> list:
    """Detects annotation boxes (dark rectangular frames) drawn around the figure."""
    dark = img.sum(2) < 200
    h, w = dark.shape
    # long horizontal dark runs
    rows = []
    for y in range(h):
        r = dark[y]
        if r.sum() < min_len:
            continue
        # longest run
        dif = np.diff(np.concatenate([[0], r.view(np.int8), [0]]))
        starts = np.nonzero(dif == 1)[0]
        ends = np.nonzero(dif == -1)[0]
        lens = ends - starts
        k = int(np.argmax(lens))
        if lens[k] >= min_len:
            rows.append((y, starts[k], ends[k]))
    # frames are thin lines: the run must not continue a few pixels above / below (belts,
    # hems and other thick dark shapes of the figure do)
    thin = []
    for (y, a, b) in rows:
        above = dark[max(0, y - 4), a:b].mean()
        below = dark[min(h - 1, y + 4), a:b].mean()
        if min(above, below) < 0.5:
            thin.append((y, a, b))
    rows = thin
    boxes = []
    used = set()
    for i, (y0, a0, b0) in enumerate(rows):
        for j, (y1, a1, b1) in enumerate(rows):
            if j <= i or (i, j) in used:
                continue
            if abs(a0 - a1) < 4 and abs(b0 - b1) < 4 and 60 < y1 - y0 < 600:
                # vertical borders must exist at both ends and be thin as well
                col0 = dark[y0:y1, a0:a0 + 4].any(1).mean()
                col1 = dark[y0:y1, b0 - 4:b0].any(1).mean()
                out0 = dark[y0:y1, max(0, a0 - 5)].mean()
                out1 = dark[y0:y1, min(w - 1, b0 + 4)].mean()
                if col0 > 0.9 and col1 > 0.9 and out0 < 0.5 and out1 < 0.5:
                    boxes.append((int(a0), int(y0), int(b0), int(y1)))
                    used.add((i, j))
    # dedupe overlapping boxes
    out = []
    for bx in sorted(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True):
        if not any(abs(bx[0] - o[0]) < 8 and abs(bx[2] - o[2]) < 8 and (bx[1] >= o[1] - 8 and bx[3] <= o[3] + 8) for o in out):
            out.append(bx)
    return out


def runs(row: np.ndarray, merge: int = 0):
    xs = np.nonzero(row)[0]
    if len(xs) == 0:
        return []
    out = []
    st = pv = xs[0]
    for x in xs[1:]:
        if x > pv + 1 + merge:
            out.append((st, pv))
            st = x
        pv = x
    out.append((st, pv))
    return out


def load_sheet(char: str, view: str, height_m: float, skull_ratio: float | None = None) -> Sheet:
    """Loads <char>_<view>.png, segments the figure and fixes the pixel -> metre mapping.

    The skull top is not visible under spiky hair, so it is estimated from the face: the eye
    line sits at the middle of an anime head and the chin closes it (see face_landmarks()).
    For the back view (no face) the front sheet's ratio (skull - top) / (sole - top) is reused.
    """
    path = os.path.join(SHEETS, f'{char}_{view}.png')
    img = load_rgb(path)
    bg = border_bg(img)
    insets = find_insets(img)
    blanks = []
    for (x0, y0, x1, y1) in insets:
        # also blank the caption under / above the box
        blanks.append((max(0, x0 - 6), max(0, y0 - 45), x1 + 6, y1 + 40))
    mask = figure_mask(img, bg, blanks)
    ys, xs = np.nonzero(mask)
    sh = Sheet(char, view, img, mask, bg)
    sh.extra['insets'] = insets
    sh.top = float(ys.min())
    sh.sole = float(ys.max())
    # body centre: middle of the silhouette over the hips (coat / belt rows)
    H = sh.sole - sh.top
    mids = []
    for f in np.linspace(0.42, 0.52, 11):
        y = int(sh.top + f * H)
        r = runs(mask[y], merge=6)
        if r:
            big = max(r, key=lambda q: q[1] - q[0])
            mids.append((big[0] + big[1]) / 2)
    sh.cx = float(np.median(mids))
    if skull_ratio is None:
        lm = face_landmarks(sh)
        skull = lm['eye_y'] - (lm['chin_y'] - lm['eye_y'])
        sh.extra['face'] = lm
        skull_ratio = (skull - sh.top) / (sh.sole - sh.top)
    sh.skull = sh.top + skull_ratio * (sh.sole - sh.top)
    sh.extra['skull_ratio'] = skull_ratio
    sh.s = height_m / (sh.sole - sh.skull)
    return sh


def face_landmarks(sh: Sheet) -> dict:
    """Eye line + chin on a front sheet.

    The eye line is the middle of the dark band of the domino mask across the face; the chin is
    the narrowest skin row between the face and the neck (the jaw shadow under the chin).
    """
    img = sh.img
    R, G, B = img[..., 0], img[..., 1], img[..., 2]
    skin = (R > 200) & (G > 140) & (G < 215) & (B > 110) & (B < 200) & (R - B > 40)
    dark = (R + G + B) < 200
    H = sh.sole - sh.top
    y0 = int(sh.top + 0.08 * H)
    y1 = int(sh.top + 0.30 * H)
    x0 = int(sh.cx - 0.09 * H)
    x1 = int(sh.cx + 0.09 * H)
    dcount = dark[y0:y1, x0:x1].sum(1)
    scount = skin[y0:y1, x0:x1].sum(1)
    # core of the mask band: the first rows that are mostly dark across the face (hair line art
    # above it is sparse), then grown while the rows stay fairly dark
    core = np.nonzero(dcount > 0.35 * (x1 - x0))[0]
    lo = hi = int(core[0])
    while hi + 1 < len(dcount) and (hi + 1 in core or dcount[hi + 1] > 0.18 * (x1 - x0)):
        hi += 1
    while lo - 1 >= 0 and dcount[lo - 1] > 0.18 * (x1 - x0) and scount[lo - 1] > 0:
        lo -= 1
    blk = list(range(lo, hi + 1))
    eye_y = float(np.median(blk) + y0)
    # face = skin rows under the mask; chin = minimum skin count before the neck widens again
    start = blk[-1] + 1
    face = scount[start:]
    k_face = int(np.argmax(face[: max(3, len(face) // 3)]))
    best_k = None
    for k in range(k_face + 1, len(face)):
        if best_k is None or face[k] < face[best_k]:
            best_k = k
        elif face[k] > face[best_k] * 2.0 and k > best_k + 3:
            break
    chin_y = float(start + best_k + y0)
    return {'chin_y': chin_y, 'eye_y': eye_y, 'mask_rows': [int(blk[0] + y0), int(blk[-1] + y0)]}


def width_profile(sh: Sheet, step_m=0.01, merge_m=0.03):
    out = []
    hmax = float(sh.h(sh.top))
    h = 0.0
    while h <= hmax:
        y = int(round(float(sh.y(h))))
        y = min(max(y, 0), sh.mask.shape[0] - 1)
        rr = runs(sh.mask[y], merge=int(merge_m / sh.s))
        lat = [(float(sh.lat(a)), float(sh.lat(b))) for a, b in rr]
        lat = [tuple(sorted(p)) for p in lat]
        out.append((round(h, 3), sorted(lat)))
        h += step_m
    return out


def median_color(img: np.ndarray, sel: np.ndarray):
    px = img[sel]
    if len(px) == 0:
        return None
    return tuple(int(v) for v in np.median(px, 0))


def sample_box(sh: Sheet, lat0, h0, lat1, h1, pred=None):
    """Median colour of figure pixels inside a box given in metres (optionally filtered)."""
    xa, xb = sorted([float(sh.x(lat0)), float(sh.x(lat1))])
    ya, yb = sorted([float(sh.y(h0)), float(sh.y(h1))])
    xa, xb, ya, yb = int(xa), int(math.ceil(xb)), int(ya), int(math.ceil(yb))
    sub = sh.img[ya:yb, xa:xb]
    m = sh.mask[ya:yb, xa:xb].copy()
    # drop outline pixels
    m &= sub.sum(2) > 45
    if pred is not None:
        m &= pred(sub)
    return median_color(sub, m)


def lit_and_shade(sh: Sheet, lat0, h0, lat1, h1, pred=None):
    """Two-tone split of a material region: brightest and darkest luminance clusters."""
    xa, xb = sorted([float(sh.x(lat0)), float(sh.x(lat1))])
    ya, yb = sorted([float(sh.y(h0)), float(sh.y(h1))])
    sub = sh.img[int(ya):int(math.ceil(yb)), int(xa):int(math.ceil(xb))]
    m = sh.mask[int(ya):int(math.ceil(yb)), int(xa):int(math.ceil(xb))].copy()
    m &= sub.sum(2) > 45
    if pred is not None:
        m &= pred(sub)
    px = sub[m].astype(float)
    if len(px) < 8:
        return None, None
    lum = px @ np.array([0.299, 0.587, 0.114])
    lo, hi = np.percentile(lum, [20, 80])
    lit = np.median(px[lum >= hi], 0)
    shade = np.median(px[lum <= lo], 0)
    return tuple(int(v) for v in lit), tuple(int(v) for v in shade)


# ---------------------------------------------------------------------------------------------
# Shapes traced from the sheets
# ---------------------------------------------------------------------------------------------

def cut_emblem(sh: Sheet, out_png: str, coat_rgb, centre_h: float, half_w_m=0.16, half_h_m=0.11, pad=6):
    """Crops the back crest and turns the coat cloth around it transparent.

    Keeps gold / magenta pixels plus their dark outlines (dilated), so the decal carries its own
    anime line art. Returns the crop rectangle in metres (lat0, h0, lat1, h1) for UV placement.
    """
    img = sh.img
    x0 = int(sh.x(half_w_m if sh.view == 'back' else -half_w_m))
    x1 = int(sh.x(-half_w_m if sh.view == 'back' else half_w_m))
    xa, xb = sorted([x0, x1])
    ya = int(sh.y(centre_h + half_h_m))
    yb = int(sh.y(centre_h - half_h_m))
    sub = img[ya:yb, xa:xb]
    R, G, B = sub[..., 0], sub[..., 1], sub[..., 2]
    gold = (R > 150) & (G > 100) & (B < 140) & (R - B > 55)
    mag = (R > 120) & (B > 70) & (G < 100) & (R - G > 60)
    paint = gold | mag
    # keep only blobs near the crest centre (drops the pauldron and arm bands)
    lab, n = ndimage.label(ndimage.binary_dilation(paint, iterations=2))
    cy, cxp = (yb - ya) * 0.5, (xb - xa) * 0.5
    keep = np.zeros_like(paint)
    for i in range(1, n + 1):
        ys, xs = np.nonzero(lab == i)
        if len(ys) < 30:
            continue
        # distance from the crest centre
        d = np.hypot(ys.mean() - cy, xs.mean() - cxp)
        if d < 0.95 * min(cy, cxp) * 1.6 and xs.min() > 2 and xs.max() < (xb - xa) - 3:
            keep |= lab == i
    alpha = ndimage.binary_dilation(keep & (paint | ndimage.binary_dilation(paint, iterations=3)), iterations=pad // 2)
    # outline pixels (dark) touching the paint stay opaque
    dark = sub.sum(2) < 160
    alpha |= dark & ndimage.binary_dilation(keep, iterations=3)
    alpha = ndimage.binary_closing(alpha, iterations=2)
    rgba = np.zeros(sub.shape[:2] + (4,), np.uint8)
    rgba[..., :3] = sub.clip(0, 255).astype(np.uint8)
    # background (coat) pixels: replace colour with the coat colour so filtering at the alpha
    # edge does not bleed light grey
    rgba[~alpha, :3] = np.array(coat_rgb, np.uint8)
    rgba[..., 3] = (alpha * 255).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    # power-of-two texture, crest centred
    side = 256
    W, Hh = im.size
    scale = side / max(W, Hh)
    im = im.resize((max(1, int(W * scale)), max(1, int(Hh * scale))), Image.LANCZOS)
    tex = Image.new('RGBA', (side, side), tuple(coat_rgb) + (0,))
    tex.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2))
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    tex.save(out_png)
    # rectangle actually covered by the texture (metres)
    half = 0.5 * max(xb - xa, yb - ya) * sh.s
    lat_c = float(sh.lat((xa + xb) / 2))
    h_c = float(sh.h((ya + yb) / 2))
    return {'lat_c': lat_c, 'h_c': h_c, 'half': half}


def trace_region(sh: Sheet, pred, seed_lat, seed_h, box):
    """Binary region of pixels matching pred connected to a seed point, inside a metre box."""
    lat0, h0, lat1, h1 = box
    xa, xb = sorted([int(sh.x(lat0)), int(sh.x(lat1))])
    ya, yb = sorted([int(sh.y(h1)), int(sh.y(h0))])
    sub = sh.img[ya:yb, xa:xb]
    m = pred(sub)
    lab, n = ndimage.label(m)
    sx = int(sh.x(seed_lat)) - xa
    sy = int(sh.y(seed_h)) - ya
    i = lab[sy, sx]
    if i == 0:
        # nearest labelled pixel
        ys, xs = np.nonzero(lab)
        k = int(np.argmin((ys - sy) ** 2 + (xs - sx) ** 2))
        i = lab[ys[k], xs[k]]
    reg = lab == i
    return reg, (xa, ya)


def contour_polygon(reg: np.ndarray, origin, sh: Sheet, n_pts=64):
    """Outer contour of a binary region as a polygon in metres (lat, h), resampled by angle."""
    ys, xs = np.nonzero(reg)
    cy, cx = ys.mean(), xs.mean()
    edge = reg & ~ndimage.binary_erosion(reg)
    ey, ex = np.nonzero(edge)
    ang = np.arctan2(-(ey - cy), ex - cx)
    rad = np.hypot(ey - cy, ex - cx)
    pts = []
    for a in np.linspace(-math.pi, math.pi, n_pts, endpoint=False):
        d = np.abs((ang - a + math.pi) % (2 * math.pi) - math.pi)
        sel = d < (math.pi / n_pts) * 1.5
        if not sel.any():
            continue
        k = np.argmax(np.where(sel, rad, -1))
        pts.append((float(sh.lat(ex[k] + origin[0])), float(sh.h(ey[k] + origin[1]))))
    return pts


def hair_tips(sh: Sheet, centre_h: float, min_r_m=0.12, below_h=1.62, win_deg=6, prominence=0.012):
    """Spike tips on the hair silhouette: local maxima of the contour radius around the head."""
    m = sh.mask
    cy = float(sh.y(centre_h))
    cx = sh.cx
    # silhouette above the collar only
    ycut = int(sh.y(below_h))
    sub = m[:ycut].copy()
    edge = sub & ~ndimage.binary_erosion(sub)
    ey, ex = np.nonzero(edge)
    ang = np.degrees(np.arctan2(-(ey - cy), ex - cx))
    rad = np.hypot(ey - cy, ex - cx) * sh.s
    prof = np.zeros(360)
    pos = [None] * 360
    for a, r, x, y in zip(ang, rad, ex, ey):
        k = int(round(a)) % 360
        if r > prof[k]:
            prof[k] = r
            pos[k] = (x, y)
    tips = []
    for k in range(360):
        r = prof[k]
        if r < min_r_m or pos[k] is None:
            continue
        win = [prof[(k + d) % 360] for d in range(-win_deg, win_deg + 1)]
        if r >= max(win) and r > min(win) + prominence:
            x, y = pos[k]
            tips.append({'ang': k, 'r': float(r), 'lat': float(sh.lat(x)), 'h': float(sh.h(y))})
    # merge tips closer than 4 degrees
    out = []
    for t in tips:
        if out and abs(t['ang'] - out[-1]['ang']) < 5:
            if t['r'] > out[-1]['r']:
                out[-1] = t
            continue
        out.append(t)
    return out, prof


# ---------------------------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------------------------

def measure(char='kaiser', height_m=1.85, debug_png=None):
    front = load_sheet(char, 'front', height_m)
    back = load_sheet(char, 'back', height_m, skull_ratio=front.extra['skull_ratio'])
    res = {
        'front': {'size': front.size, 'cx': front.cx, 'sole': front.sole, 'top': front.top, 'skull': front.skull, 's': front.s, 'bg': front.bg, 'insets': front.extra['insets'], 'face': front.extra.get('face')},
        'back': {'size': back.size, 'cx': back.cx, 'sole': back.sole, 'top': back.top, 'skull': back.skull, 's': back.s, 'bg': back.bg},
        'hair_top_m': float(front.h(front.top)),
    }
    if debug_png:
        im = Image.fromarray(front.img.astype(np.uint8)).convert('RGB')
        d = ImageDraw.Draw(im)
        W = im.size[0]
        for hh in np.arange(0, 2.05, 0.1):
            y = float(front.y(hh))
            d.line([(0, y), (W, y)], fill=(255, 0, 0) if abs(hh % 0.5) < 1e-6 else (255, 160, 160))
            d.text((2, y - 10), f'{hh:.1f}', fill=(255, 0, 0))
        d.line([(front.cx, 0), (front.cx, im.size[1])], fill=(0, 160, 255))
        d.line([(0, front.skull), (W, front.skull)], fill=(0, 200, 0))
        im.save(debug_png)
    return front, back, res


if __name__ == '__main__':
    char = sys.argv[1] if len(sys.argv) > 1 else 'kaiser'
    f, b, r = measure(char, debug_png=os.path.join(os.path.dirname(__file__), f'_{char}_measure_debug.png'))
    print(json.dumps(r, indent=1, default=float))
