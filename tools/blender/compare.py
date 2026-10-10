"""
Render | sheet comparison images and silhouette metrics (PIL + numpy, no bpy).

compose(): [render front | sheet front | render back | sheet back] at a common height, with a
silhouette-difference strip under each pair (red = model only, cyan = sheet only).
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from sheet_measure import Sheet


def flatten(render_rgba: Image.Image, bg) -> Image.Image:
    bgim = Image.new('RGBA', render_rgba.size, tuple(bg) + (255,))
    return Image.alpha_composite(bgim, render_rgba).convert('RGB')


def model_mask(render_rgba: Image.Image) -> np.ndarray:
    return np.asarray(render_rgba)[..., 3] > 127


def resize_mask(m: np.ndarray, size) -> np.ndarray:
    im = Image.fromarray((m * 255).astype(np.uint8)).resize(size, Image.BILINEAR)
    return np.asarray(im) > 127


def metrics(sheet: Sheet, render_rgba: Image.Image) -> dict:
    """IoU of the silhouettes + mean absolute width error per 2 cm band (metres)."""
    W, H = sheet.size
    mm = resize_mask(model_mask(render_rgba), (W, H))
    sm = sheet.mask
    inter = (mm & sm).sum()
    union = (mm | sm).sum()
    iou = inter / max(union, 1)
    errs = []
    worst = []
    for h in np.arange(0.02, float(sheet.h(sheet.top)) - 0.02, 0.02):
        y = int(round(float(sheet.y(h))))
        a = np.nonzero(sm[y])[0]
        b = np.nonzero(mm[y])[0]
        if len(a) == 0 and len(b) == 0:
            continue
        wa = (a.max() - a.min()) * sheet.s if len(a) else 0.0
        wb = (b.max() - b.min()) * sheet.s if len(b) else 0.0
        errs.append(abs(wa - wb))
        worst.append((abs(wa - wb), round(float(h), 2), round(wa, 3), round(wb, 3)))
    worst.sort(reverse=True)
    # colour error inside the shared silhouette (sRGB distance)
    return {'iou': float(iou), 'width_err_mean': float(np.mean(errs)), 'worst_rows': worst[:6]}


def diff_image(sheet: Sheet, render_rgba: Image.Image) -> Image.Image:
    W, H = sheet.size
    mm = resize_mask(model_mask(render_rgba), (W, H))
    sm = sheet.mask
    out = np.full((H, W, 3), 245, np.uint8)
    out[mm & sm] = (150, 150, 160)
    out[mm & ~sm] = (230, 40, 60)
    out[~mm & sm] = (40, 200, 230)
    return Image.fromarray(out)


def compose(path: str, title: str, pairs, panel_h: int = 1000) -> None:
    """pairs: list of (sheet, render_rgba, label)."""
    panels = []
    for sheet, rgba, label in pairs:
        W, H = sheet.size
        r = flatten(rgba, sheet.bg).resize((W, H), Image.LANCZOS)
        s = Image.fromarray(sheet.img.astype(np.uint8))
        d = diff_image(sheet, rgba)
        k = panel_h / H
        sz = (int(W * k), panel_h)
        panels.append((r.resize(sz, Image.LANCZOS), s.resize(sz, Image.LANCZOS), d.resize((sz[0] // 2, panel_h // 2), Image.LANCZOS), label, metrics(sheet, rgba)))
    pw = panels[0][0].size[0]
    gap = 12
    head = 56
    width = len(panels) * (2 * pw + gap) + gap
    height = head + panel_h + panel_h // 2 + 3 * gap
    canvas = Image.new('RGB', (width, height), (24, 22, 28))
    dr = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 26)
        small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 20)
    except OSError:
        font = small = ImageFont.load_default()
    dr.text((gap, 12), title, fill=(255, 220, 120), font=font)
    x = gap
    for r, s, d, label, met in panels:
        canvas.paste(r, (x, head))
        canvas.paste(s, (x + pw, head))
        dr.text((x + 8, head + 6), f'{label}: render', fill=(30, 30, 30), font=small)
        dr.text((x + pw + 8, head + 6), f'{label}: scheda', fill=(30, 30, 30), font=small)
        y2 = head + panel_h + gap
        canvas.paste(d, (x, y2))
        txt = [f'IoU sagoma {met["iou"] * 100:.1f}%', f'errore larghezza medio {met["width_err_mean"] * 100:.1f} cm',
               'rosso = solo modello', 'azzurro = solo scheda']
        for i, t in enumerate(txt):
            dr.text((x + d.size[0] + 16, y2 + 10 + i * 28), t, fill=(230, 230, 230), font=small)
        x += 2 * pw + gap
    canvas.save(path)
    return [p[4] for p in panels]
