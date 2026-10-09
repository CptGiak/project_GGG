"""SHIBUYA VELVET: facade tiles, floors and the street / rooftop kit."""
from __future__ import annotations

import math
import os

import numpy as np

import kit
from kit import V, box, cyl, mat, text, torus

THEME = 'city'
PX = 80  # texels per metre on facades


# =============================================================================================
# Facade tiles (2 bays x 2 floors, seamless)
# =============================================================================================

def wall_with_holes(coll, x0, x1, z0, z1, holes, y0, y1, m, name='wall'):
    """Wall slab split into boxes around rectangular holes [(hx0, hx1, hz0, hz1)]."""
    xs = sorted({x0, x1, *[h[0] for h in holes], *[h[1] for h in holes]})
    zs = sorted({z0, z1, *[h[2] for h in holes], *[h[3] for h in holes]})
    k = 0
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            cx = (xs[i] + xs[i + 1]) / 2
            cz = (zs[j] + zs[j + 1]) / 2
            if any(h[0] < cx < h[1] and h[2] < cz < h[3] for h in holes):
                continue
            box(coll, f'{name}{k}', (xs[i], y0, zs[j]), (xs[i + 1], y1, zs[j + 1]), m)
            k += 1


def framed_glass(coll, x0, x1, z0, z1, y_glass, frame_m, glass_m, fw=0.05, mid=False, name='win'):
    """Window frame (and pane unless glass_m is None, for open shop fronts)."""
    if glass_m is not None:
        box(coll, f'{name}_g', (x0, y_glass, z0), (x1, y_glass + 0.02, z1), glass_m)
    yf0, yf1 = y_glass - 0.05, y_glass + 0.01
    box(coll, f'{name}_fl', (x0, yf0, z0), (x0 + fw, yf1, z1), frame_m)
    box(coll, f'{name}_fr', (x1 - fw, yf0, z0), (x1, yf1, z1), frame_m)
    box(coll, f'{name}_fb', (x0, yf0, z0), (x1, yf1, z0 + fw), frame_m)
    box(coll, f'{name}_ft', (x0, yf0, z1 - fw), (x1, yf1, z1), frame_m)
    if mid:
        xm = (x0 + x1) / 2
        box(coll, f'{name}_fm', (xm - fw * 0.6, yf0 - 0.02, z0), (xm + fw * 0.6, yf1, z1), frame_m)


def ac_unit(coll, x, z, y_wall, name='ac', body='#d9d6cf'):
    """Outdoor air-conditioner on a bracket, hanging on the wall (x = centre, z = bottom)."""
    m = mat('ac_body', body, rough=0.6)
    g = mat('ac_grille', '#3b3d42')
    d = 0.3
    box(coll, f'{name}_b', (x - 0.4, y_wall - d, z), (x + 0.4, y_wall, z + 0.56), m, bev=0.025)
    cyl(coll, f'{name}_f', (x - 0.1, y_wall - d - 0.01, z + 0.28), (x - 0.1, y_wall - d + 0.02, z + 0.28), 0.2, n=16, m=g)
    torus(coll, f'{name}_t', (x - 0.1, y_wall - d - 0.012, z + 0.28), 0.2, 0.018, n=16, k=4, m=m, axis='Y')
    for i in range(5):
        box(coll, f'{name}_s{i}', (x + 0.17, y_wall - d - 0.012, z + 0.1 + i * 0.08), (x + 0.36, y_wall - d, z + 0.13 + i * 0.08), g)
    br = mat('steel_dark', '#4a4c52', rough=0.5)
    for sx in (-0.3, 0.3):
        box(coll, f'{name}_br{sx}', (x + sx - 0.02, y_wall - d - 0.02, z - 0.06), (x + sx + 0.02, y_wall, z), br)


def tile_office(coll):
    """Ribbon windows: spandrel bands, mullions every 1.6 m, slab edge."""
    W, FH = 6.4, 3.6
    spandrel = mat('spandrel', '#aaa49b')
    slab = mat('slab', '#8a857e')
    frame = mat('frame_dark', '#2b2e34', rough=0.5)
    glass = mat('glass_office', '#2b394a', rough=0.2)
    blind = mat('dim_blind', '#cfc6b4')
    for f in range(2):
        z = f * FH
        box(coll, f'sp{f}', (0, 0, z), (W, 0.6, z + 1.0), spandrel)
        box(coll, f'sl{f}', (0, -0.05, z + 3.22), (W, 0.6, z + FH), slab)
        box(coll, f'sill{f}', (0, -0.07, z + 0.97), (W, 0.2, z + 1.03), slab, bev=0.01)
        box(coll, f'gl{f}', (0, 0.15, z + 1.0), (W, 0.6, z + 3.22), glass)
        box(coll, f'tr{f}', (0, -0.02, z + 2.6), (W, 0.16, z + 2.66), frame)
        for i in range(5):
            x = i * 1.6
            box(coll, f'mu{f}{i}', (x - 0.035, -0.03, z + 1.0), (x + 0.035, 0.16, z + 3.22), frame)
        # a few blinds half down
        for (bx, bf, h) in ((1, 0, 0.55), (2, 1, 0.35), (3, 1, 0.8)):
            if bf == f:
                x0 = bx * 1.6 + 0.04
                box(coll, f'bl{f}{bx}', (x0, 0.12, z + 3.2 - h * 2.2), (x0 + 1.52, 0.14, z + 3.2), blind)


def tile_tile(coll):
    """Tiled mid-rise: punched windows with reveals, sills, an AC unit and a window grille."""
    W, FH = 7.2, 3.6
    tile = mat('tile_wall', '#b9a083')
    band = mat('tile_band', '#9c856b')
    sill = mat('sill', '#cdc6ba', rough=0.7)
    frame = mat('frame_alu', '#8e949b', rough=0.4)
    glass = mat('glass_res', '#2a3647', rough=0.2)
    curtain = mat('dim_curtain', '#d8c3a3')
    bars = mat('steel_dark', '#4a4c52', rough=0.5)
    holes = []
    for f in range(2):
        for b in range(2):
            holes.append((b * 3.6 + 1.0, b * 3.6 + 2.6, f * FH + 0.95, f * FH + 2.65))
    wall_with_holes(coll, 0, W, 0, 2 * FH, holes, 0.0, 0.6, tile)
    for f in range(2):
        z = f * FH
        box(coll, f'band{f}', (0, -0.03, z + 3.45), (W, 0.6, z + 3.6), band)
        for b in range(2):
            x = b * 3.6
            framed_glass(coll, x + 1.0, x + 2.6, z + 0.95, z + 2.65, 0.2, frame, glass, mid=True, name=f'w{f}{b}')
            box(coll, f'sill{f}{b}', (x + 0.9, -0.08, z + 0.86), (x + 2.7, 0.2, z + 0.95), sill, bev=0.012)
            if (f, b) == (1, 0):
                box(coll, f'cur{f}{b}', (x + 1.05, 0.17, z + 1.0), (x + 1.75, 0.18, z + 2.6), curtain)
                box(coll, f'cur2{f}{b}', (x + 2.05, 0.17, z + 1.0), (x + 2.55, 0.18, z + 2.6), curtain)
            if (f, b) == (1, 1):
                for i in range(7):
                    xx = x + 1.08 + i * 0.24
                    box(coll, f'bar{i}', (xx - 0.015, -0.12, z + 0.95), (xx + 0.015, -0.09, z + 2.65), bars)
                box(coll, 'bar_t', (x + 0.98, -0.13, z + 2.6), (x + 2.62, -0.09, z + 2.65), bars)
                box(coll, 'bar_b', (x + 0.98, -0.13, z + 1.0), (x + 2.62, -0.09, z + 1.05), bars)
    ac_unit(coll, 1.8, 0.12, 0.0, name='ac0')
    # a vent hood
    box(coll, 'vent', (5.9, -0.18, 0.4), (6.4, 0.0, 0.7), sill, bev=0.02)


def tile_mansion(coll):
    """Japanese 'mansion' apartments: recessed balconies with railings and sliding doors."""
    W, FH = 7.2, 3.0
    wall = mat('mansion_wall', '#d8d1c4')
    back = mat('mansion_back', '#c9c1b2')
    slab = mat('mansion_slab', '#bdb5a7')
    part = mat('mansion_part', '#e4ddd0')
    rail = mat('rail_white', '#e9e6df', rough=0.5)
    frame = mat('frame_alu', '#8e949b', rough=0.4)
    glass = mat('glass_res', '#2a3647', rough=0.2)
    curtain = mat('dim_curtain', '#d8c3a3')
    curtain2 = mat('dim_curtain2', '#b7c3c9')
    D = 0.9  # balcony depth
    holes = [(b * 3.6 + 0.45, b * 3.6 + 3.15, f * FH + 0.02, f * FH + 2.2) for f in range(2) for b in range(2)]
    wall_with_holes(coll, 0, W, 0, 2 * FH, holes, D, D + 0.5, back)
    for f in range(2):
        z = f * FH
        box(coll, f'slab{f}', (0, -0.06, z - 0.2), (W, D, z + 0.02), slab)
        for b in range(2):
            x = b * 3.6
            framed_glass(coll, x + 0.45, x + 3.15, z + 0.02, z + 2.2, D + 0.05, frame, glass, mid=True, name=f'd{f}{b}')
            if (f + b) % 2 == 0:
                box(coll, f'cu{f}{b}', (x + 0.5, D + 0.02, z + 0.1), (x + 1.3, D + 0.03, z + 2.15), curtain if b else curtain2)
            # railing: kick plate, bars, handrail
            box(coll, f'kick{f}{b}', (x + 0.08, -0.06, z + 0.02), (x + 3.52, 0.02, z + 0.22), rail)
            box(coll, f'hand{f}{b}', (x + 0.08, -0.09, z + 1.02), (x + 3.52, 0.03, z + 1.1), rail, bev=0.01)
            for i in range(26):
                xx = x + 0.2 + i * 0.128
                box(coll, f'bar{f}{b}{i}', (xx - 0.012, -0.04, z + 0.22), (xx + 0.012, -0.016, z + 1.02), rail)
        for x in (0.0, 3.6, 7.2):
            box(coll, f'part{f}{x}', (x - 0.05, -0.06, z + 0.02), (x + 0.05, D, z + FH - 0.2), part)
        box(coll, f'lintel{f}', (0, D - 0.02, z + 2.2), (W, D + 0.3, z + FH - 0.2), wall)
    ac_unit(coll, 2.7, 0.04, D - 0.02, name='ac0')


def tile_glass(coll):
    """Curtain wall: dark vision glass, spandrel glass, vertical aluminium fins."""
    W, FH = 6.4, 3.6
    vision = mat('glass_tower', '#1b2a31', rough=0.15)
    span = mat('span_glass', '#2a343b', rough=0.2)
    mull = mat('mullion', '#9aa3ab', rough=0.4)
    fin = mat('fin', '#b8bec4', rough=0.4)
    for f in range(2):
        z = f * FH
        box(coll, f'span{f}', (0, 0.0, z), (W, 0.4, z + 0.95), span)
        box(coll, f'vis{f}', (0, 0.02, z + 0.95), (W, 0.4, z + FH), vision)
        box(coll, f'tr{f}', (0, -0.05, z + 0.92), (W, 0.03, z + 0.98), mull)
        box(coll, f'tr2{f}', (0, -0.05, z - 0.03), (W, 0.03, z + 0.03), mull)
    for i in range(5):
        x = i * 1.6
        box(coll, f'mu{i}', (x - 0.03, -0.06, 0), (x + 0.03, 0.03, 2 * FH), mull)
    for x in (0.0, 3.2, 6.4):
        box(coll, f'fin{x}', (x - 0.07, -0.5, 0), (x + 0.07, 0.0, 2 * FH), fin)


SIGNS_A = [('ラーメン', '#f4efe6', '#c8202f'), ('カラオケ', '#2a2f7a', '#ffe9a8'), ('BAR VELVET', '#5e0f22', '#ffd7c2'), ('ドラッグ', '#f7d23e', '#1d4fa3'),
           ('居酒屋', '#2b2422', '#f2c46b'), ('CAFE 2F', '#e9e2d4', '#2f5e3a'), ('ゲーム', '#1d1d26', '#5fd3e8'), ('24H MART', '#f1f4f6', '#d0352f')]
STORE_KINDS = [('shop', 'shop'), ('shutter', 'lobby'), ('shop', 'lobby'), ('shop', 'shutter')]


def storefront(coll, variant: int):
    """Ground floor: two 4 m bays, lit shops or a shutter / lobby, with lightbox signboards."""
    W, H = 8.0, 4.8
    stone = mat('store_stone', '#4b4447')
    frame = mat('frame_dark', '#2b2e34', rough=0.5)
    shutter = mat('shutter', '#9a9da2', rough=0.5)
    floor_in = mat('lit_floor', '#8f7f69', emit=0.3)
    back_wall = mat('lit_wall', '#cdb68c', emit=0.32)
    shelf = mat('lit_shelf', '#8a623e', emit=0.3)
    goods = [mat('lit_goods_a', '#c9504a', emit=0.35), mat('lit_goods_b', '#d6aa45', emit=0.35), mat('lit_goods_c', '#4a86c6', emit=0.35), mat('lit_goods_d', '#d8d2c6', emit=0.35)]
    for x in (0.0, 4.0, 8.0):
        box(coll, f'pil{x}', (x - 0.22, -0.16, 0), (x + 0.22, 0.6, H), stone)
    for b in range(2):
        x = b * 4.0
        kind = STORE_KINDS[variant]
        sign = SIGNS_A[(b + variant * 2) % len(SIGNS_A)]
        # lightbox fascia
        bg = mat(f'lit_sign_{b}_{variant}', sign[1], emit=0.55)
        fg = mat(f'lit_signtx_{b}_{variant}', sign[2], emit=0.55)
        box(coll, f'fas{b}', (x + 0.22, -0.3, 3.75), (x + 3.78, 0.6, 4.65), bg)
        box(coll, f'fasf{b}', (x + 0.22, -0.32, 3.72), (x + 3.78, -0.28, 3.78), frame)
        jp = any(ord(c) > 0x2000 for c in sign[0])
        text(coll, f'st{b}', sign[0], 0.62 if jp else 0.5, (x + 2.0, -0.31, 4.2), fg, jp=True)
        box(coll, f'wall_above{b}', (x + 0.22, 0.0, 3.55), (x + 3.78, 0.6, 3.75), stone)
        box(coll, f'wall_top{b}', (x + 0.22, -0.05, 4.65), (x + 3.78, 0.6, H), stone)
        if kind[b] == 'shop':
            # open shop front with a lit interior behind a thin frame
            box(coll, f'flr{b}', (x + 0.22, 0.0, -0.05), (x + 3.78, 3.0, 0.05), floor_in)
            box(coll, f'bw{b}', (x + 0.22, 2.9, 0), (x + 3.78, 3.2, 3.55), back_wall)
            box(coll, f'ceil{b}', (x + 0.22, 0.0, 3.45), (x + 3.78, 3.0, 3.55), back_wall)
            for s in range(4):
                zz = 0.5 + s * 0.65
                box(coll, f'sh{b}{s}', (x + 0.5, 2.3, zz), (x + 3.5, 2.9, zz + 0.05), shelf)
                for g in range(7):
                    gm = goods[(g + s + b) % 4]
                    gx = x + 0.6 + g * 0.41
                    box(coll, f'gd{b}{s}{g}', (gx, 2.45, zz + 0.05), (gx + 0.3, 2.85, zz + 0.05 + 0.22 + 0.12 * ((g * 7 + s) % 3)), gm)
            framed_glass(coll, x + 0.22, x + 3.78, 0.0, 3.55, -0.02, frame, None, fw=0.06, name=f'sf{b}')
            box(coll, f'mull{b}', (x + 1.97, -0.06, 0), (x + 2.03, 0.0, 3.55), frame)
        elif kind[b] == 'shutter':
            box(coll, f'shut{b}', (x + 0.22, 0.05, 0), (x + 3.78, 0.6, 3.55), shutter)
            for i in range(30):
                zz = 0.05 + i * 0.115
                box(coll, f'rib{b}{i}', (x + 0.22, 0.02, zz), (x + 3.78, 0.05, zz + 0.035), shutter)
            box(coll, f'box{b}', (x + 0.22, -0.1, 3.3), (x + 3.78, 0.2, 3.55), frame)
        else:
            # building lobby: glass doors, lit hall
            box(coll, f'hall{b}', (x + 0.22, 2.0, 0), (x + 3.78, 2.3, 3.55), back_wall)
            for k in range(3):
                box(coll, f'hl{b}{k}', (x + 0.8 + k * 1.0, 0.5, 3.4), (x + 1.2 + k * 1.0, 1.5, 3.45), mat('lit_lamp', '#fff4dc', emit=1.0))
            box(coll, f'hflr{b}', (x + 0.22, 0.0, -0.05), (x + 3.78, 2.0, 0.05), floor_in)
            box(coll, f'hceil{b}', (x + 0.22, 0.0, 3.45), (x + 3.78, 2.0, 3.55), back_wall)
            box(coll, f'lw{b}', (x + 0.22, -0.02, 0), (x + 0.9, 0.6, 3.55), stone)
            box(coll, f'rw{b}', (x + 3.1, -0.02, 0), (x + 3.78, 0.6, 3.55), stone)
            framed_glass(coll, x + 0.9, x + 3.1, 0.0, 2.6, 0.05, frame, None, fw=0.06, mid=True, name=f'ld{b}')
            box(coll, f'trans{b}', (x + 0.9, -0.02, 2.6), (x + 3.1, 0.6, 3.55), stone)
            text(coll, f'no{b}', '1F', 0.3, (x + 2.0, -0.03, 3.1), mat('lit_signtx_lobby', '#f2e6c8', emit=0.6), jp=True)


def tile_far(coll):
    """Distant skyline: small dense windows (very low detail)."""
    W, H = 8.0, 8.0
    wall = mat('far_wall', '#5a5266')
    glass = mat('glass_far', '#262a3a')
    holes = []
    for f in range(3):
        for b in range(4):
            holes.append((b * 2 + 0.45, b * 2 + 1.55, f * 2.667 + 0.7, f * 2.667 + 2.1))
    wall_with_holes(coll, 0, W, 0, H, holes, 0, 0.3, wall)
    for (x0, x1, z0, z1) in holes:
        box(coll, f'g{x0}{z0}', (x0, 0.1, z0), (x1, 0.3, z1), glass)


def tile_pavers(coll):
    """Sidewalk: 30 cm concrete pavers in two tones with bevelled edges (top view)."""
    rng = np.random.default_rng(7)
    a = mat('paver_a', '#9b948c')
    b = mat('paver_b', '#8a847d')
    c = mat('paver_c', '#a59f98')
    grout = mat('grout', '#55504c')
    box(coll, 'base', (0, 0, -0.1), (2.4, 2.4, 0.0), grout)
    for i in range(8):
        for j in range(8):
            m = (a, b, c)[int(rng.integers(0, 3))]
            hz = 0.04 + float(rng.random()) * 0.006
            box(coll, f'p{i}{j}', (i * 0.3 + 0.008, j * 0.3 + 0.008, 0), (i * 0.3 + 0.292, j * 0.3 + 0.292, hz), m, bev=0.012)


TILES = {
    'office': (tile_office, 6.4, 7.2),
    'tile': (tile_tile, 7.2, 7.2),
    'mansion': (tile_mansion, 7.2, 6.0),
    'glass': (tile_glass, 6.4, 7.2),
    'store_a': (lambda c: storefront(c, 0), 8.0, 4.8),
    'store_b': (lambda c: storefront(c, 1), 8.0, 4.8),
    'store_c': (lambda c: storefront(c, 2), 8.0, 4.8),
    'store_d': (lambda c: storefront(c, 3), 8.0, 4.8),
    'far': (tile_far, 8.0, 8.0),
}


def glass_sheen(rgb: np.ndarray, mask: np.ndarray, seed: int) -> np.ndarray:
    """Night-sky reflection on unlit glass: soft diagonal bands, slightly lighter at the top."""
    h, w = mask.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    band = 0.5 + 0.5 * np.sin((xx / w * 2.0 + yy / h * 1.3) * math.tau + seed)
    top = 1.0 - yy / h
    sheen = np.array([92, 108, 140], np.float32)[None, None, :] * (0.35 + 0.35 * band[..., None] + 0.3 * top[..., None])
    g = (mask > 0.9).astype(np.float32)[..., None]
    return rgb * (1 - g * 0.4) + sheen * g * 0.4


def build_textures(out_dir: str, only: list[str] | None = None) -> None:
    for name, (fn, W, H) in TILES.items():
        if only and name not in only:
            continue
        px = PX if name != 'far' else 32
        albedo, mask = kit.render_tile(fn, W, H, px, f'{THEME}_{name}', view='front', samples=64)
        rgb = albedo.astype(np.float32)
        if not name.startswith('store'):
            rgb = glass_sheen(rgb, mask, seed=len(name))
        kit.save_rgba(os.path.join(out_dir, f'{THEME}_{name}.png'), rgb, mask)
        print('tile', name, albedo.shape)
    if only and 'floors' not in only:
        return
    albedo, _ = kit.render_tile(tile_pavers, 2.4, 2.4, 160, f'{THEME}_pavers', view='top', samples=48)
    kit.save_rgba(os.path.join(out_dir, f'{THEME}_pavers.png'), albedo.astype(np.float32))
    asphalt(out_dir)
    roof(out_dir)


def asphalt(out_dir: str) -> None:
    """Tileable asphalt (8 m): fine aggregate, darker oily blotches, a few patched squares."""
    n = 512
    rng = np.random.default_rng(3)
    base = np.array([104, 103, 108], np.float32)
    grain = rng.normal(0, 1, (n, n)).astype(np.float32)
    big = kit.fbm(n, n, 4, 4, 11)
    mid = kit.fbm(n, n, 16, 3, 12)
    lum = 1.0 + grain * 0.03 + (mid - 0.5) * 0.08 - np.clip(big - 0.62, 0, 1) * 0.18
    img = base[None, None, :] * lum[..., None]
    # a couple of patched rectangles (barely darker, sharp edges)
    for _ in range(2):
        x0, y0 = rng.integers(0, n, 2)
        w, h = rng.integers(40, 110, 2)
        ys = (np.arange(y0, y0 + h) % n)[:, None]
        xs = (np.arange(x0, x0 + w) % n)[None, :]
        img[ys, xs] *= 0.95
    kit.save_rgba(os.path.join(out_dir, f'{THEME}_asphalt.png'), img)


def roof(out_dir: str) -> None:
    """Rooftop membrane (6 m): grey panels with seams and grime."""
    n = 256
    rng = np.random.default_rng(5)
    base = np.array([96, 94, 98], np.float32)
    grain = rng.normal(0, 1, (n, n)).astype(np.float32)
    big = kit.fbm(n, n, 4, 4, 21)
    lum = 1.0 + grain * 0.03 + (big - 0.5) * 0.18
    img = base[None, None, :] * lum[..., None]
    for k in range(0, n, n // 4):
        img[k:k + 2, :] *= 0.8
    kit.save_rgba(os.path.join(out_dir, f'{THEME}_roof.png'), img)


# =============================================================================================
# Kit (rooftops, street, rail). Origin at the bottom centre, front towards -Y (game +Z).
# =============================================================================================

def _steel():
    return mat('k_steel', '#5d6068', rough=0.5)


def piece_tank_square(c):
    """Japanese FRP panel water tank on a steel stand (fits the 3.6 m rooftop tank collider)."""
    frp = mat('k_frp', '#cfd3cf')
    rib = mat('k_frp_rib', '#b9beba')
    st = _steel()
    out = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            out.append(box(c, 'leg', (sx * 1.1 - 0.08, sy * 1.1 - 0.08, 0), (sx * 1.1 + 0.08, sy * 1.1 + 0.08, 0.95), st))
    for sy in (-1, 1):
        out.append(box(c, 'beam', (-1.25, sy * 1.1 - 0.1, 0.9), (1.25, sy * 1.1 + 0.1, 1.08), st))
        out.append(kit_beam(c, (-1.1, sy * 1.1, 0.1), (1.1, sy * 1.1, 0.85), 0.06, st))
    for sx in (-1, 1):
        out.append(box(c, 'beamx', (sx * 1.1 - 0.1, -1.25, 0.9), (sx * 1.1 + 0.1, 1.25, 1.08), st))
    out.append(box(c, 'tank', (-1.2, -1.2, 1.08), (1.2, 1.2, 3.45), frp, bev=0.04))
    for k in (-0.6, 0.0, 0.6):
        for sy in (-1, 1):
            out.append(box(c, 'rv', (k - 0.03, sy * 1.2 - 0.03, 1.1), (k + 0.03, sy * 1.2 + 0.03, 3.43), rib))
            out.append(box(c, 'rvx', (sy * 1.2 - 0.03, k - 0.03, 1.1), (sy * 1.2 + 0.03, k + 0.03, 3.43), rib))
    for z in (1.66, 2.26, 2.86):
        out.append(box(c, 'rh', (-1.23, -1.23, z - 0.03), (1.23, 1.23, z + 0.03), rib))
    out.append(cyl(c, 'hatch', (0.4, 0.3, 3.45), (0.4, 0.3, 3.55), 0.32, n=20, m=rib))
    out.append(cyl(c, 'vent', (-0.6, -0.5, 3.45), (-0.6, -0.5, 3.75), 0.06, n=10, m=st))
    # ladder on the +X side
    for dy in (-0.22, 0.22):
        out.append(box(c, 'lr', (1.24, dy - 0.025, 0.0), (1.29, dy + 0.025, 3.6), st))
    for k in range(11):
        out.append(box(c, 'rung', (1.24, -0.22, 0.3 + k * 0.3), (1.29, 0.22, 0.33 + k * 0.3), st))
    return out


def kit_beam(c, p0, p1, w, m):
    return kit.beam(c, 'brace', p0, p1, w, m)


def piece_tank_round(c):
    body = mat('k_tank', '#c7ccc9')
    band = mat('k_tank_band', '#aab0ad')
    st = _steel()
    out = []
    for a in range(4):
        ang = a * math.pi / 2 + math.pi / 4
        x, y = math.cos(ang) * 1.05, math.sin(ang) * 1.05
        out.append(cyl(c, 'leg', (x, y, 0), (x * 0.95, y * 0.95, 1.05), 0.08, n=8, m=st))
    out.append(box(c, 'ring', (-1.2, -1.2, 0.95), (1.2, 1.2, 1.05), st))
    out.append(cyl(c, 'body', (0, 0, 1.05), (0, 0, 3.15), 1.42, n=28, m=body))
    out.append(cyl(c, 'roof', (0, 0, 3.15), (0, 0, 3.6), 1.46, 0.35, n=28, m=body))
    for z in (1.6, 2.4):
        out.append(cyl(c, 'band', (0, 0, z - 0.05), (0, 0, z + 0.05), 1.45, n=28, m=band))
    for dy in (-0.2, 0.2):
        out.append(box(c, 'lr', (1.45, dy - 0.025, 0.0), (1.5, dy + 0.025, 3.3), st))
    for k in range(10):
        out.append(box(c, 'rung', (1.45, -0.2, 0.3 + k * 0.3), (1.5, 0.2, 0.33 + k * 0.3), st))
    return out


def piece_hvac(c):
    """Packaged rooftop unit, 1 x 1 x 1 (scaled to the prop collider)."""
    body = mat('k_hvac', '#bfc3c4')
    dark = mat('k_grille', '#34373c')
    st = _steel()
    out = [box(c, 'skid', (-0.5, -0.5, 0), (0.5, 0.5, 0.08), st)]
    out.append(box(c, 'body', (-0.48, -0.46, 0.08), (0.48, 0.46, 0.86), body, bev=0.015))
    for k in range(7):
        z = 0.16 + k * 0.09
        out.append(box(c, 'lv', (-0.44, -0.475, z), (0.44, -0.46, z + 0.035), dark))
        out.append(box(c, 'lvb', (-0.44, 0.46, z), (0.44, 0.475, z + 0.035), dark))
    for sx in (-0.24, 0.24):
        out.append(cyl(c, 'fan', (sx, 0, 0.86), (sx, 0, 0.92), 0.19, n=16, m=dark))
        out.append(kit.torus(c, 'fanr', (sx, 0, 0.92), 0.2, 0.018, n=16, k=4, m=body))
    out.append(box(c, 'top', (-0.48, -0.46, 0.86), (0.48, 0.46, 0.88), body))
    return out


def piece_stair_hut(c):
    """Rooftop stair housing with a steel door and a small lamp, 1 x 1 x 1 (scaled)."""
    wall = mat('k_hut', '#b9b2a6')
    roof_m = mat('k_hut_roof', '#8b857c')
    door = mat('k_door', '#56606b', rough=0.5)
    lamp = mat('k_lamp_warm', '#ffd9a0', emit=1.2)
    out = [box(c, 'walls', (-0.5, -0.5, 0), (0.5, 0.5, 0.86), wall)]
    out.append(box(c, 'roof', (-0.54, -0.56, 0.86), (0.54, 0.54, 0.95), roof_m))
    out.append(box(c, 'door', (-0.18, -0.515, 0.0), (0.18, -0.5, 0.7), door))
    out.append(box(c, 'frame', (-0.21, -0.52, 0.0), (0.21, -0.505, 0.73), roof_m))
    out.append(box(c, 'lamp', (-0.05, -0.56, 0.76), (0.05, -0.5, 0.8), lamp))
    return out


def piece_mast(c):
    """Lattice antenna, 14 m, red aviation light on top."""
    st = mat('k_mast', '#8d9096', rough=0.4)
    red = mat('k_aviation', '#ff3b3b', emit=1.4)
    out = []
    H = 14.0
    legs = []
    for a in range(3):
        ang = a * math.tau / 3
        legs.append((ang, 0.32, 0.12))
        b0 = V((math.cos(ang) * 0.32, math.sin(ang) * 0.32, 0))
        b1 = V((math.cos(ang) * 0.12, math.sin(ang) * 0.12, H))
        out.append(kit.beam(c, 'leg', b0, b1, 0.07, st))
    levels = 12
    for lv in range(levels):
        t0, t1 = lv / levels, (lv + 1) / levels
        for a in range(3):
            a0 = a * math.tau / 3
            a1 = (a + 1) * math.tau / 3
            r0 = 0.32 + (0.12 - 0.32) * t0
            r1 = 0.32 + (0.12 - 0.32) * t1
            p = V((math.cos(a0) * r0, math.sin(a0) * r0, t0 * H))
            q = V((math.cos(a1) * r1, math.sin(a1) * r1, t1 * H))
            out.append(kit.beam(c, 'br', p, q, 0.03, st))
    out.append(cyl(c, 'top', (0, 0, H), (0, 0, H + 0.6), 0.04, n=8, m=st))
    out.append(kit.cyl(c, 'light', (0, 0, H + 0.6), (0, 0, H + 0.8), 0.09, n=10, m=red))
    out.append(box(c, 'dish_arm', (0, -0.05, H * 0.62), (0.45, 0.05, H * 0.62 + 0.06), st))
    out.append(cyl(c, 'dish', (0.45, -0.1, H * 0.62 + 0.03), (0.45, 0.02, H * 0.62 + 0.03), 0.32, 0.12, n=16, m=mat('k_dish', '#dcdcd8')))
    return out


def piece_ac_rack(c):
    """Three outdoor AC units on a low steel rack (rooftop clutter, ~2.7 x 0.8 x 1.0 m)."""
    st = _steel()
    out = [box(c, 'rack', (-1.35, -0.4, 0.0), (1.35, 0.4, 0.12), st)]
    for sx in (-1.3, 1.3):
        for sy in (-0.35, 0.35):
            out.append(box(c, 'foot', (sx - 0.04, sy - 0.04, 0), (sx + 0.04, sy + 0.04, 0.3), st))
    for k in range(3):
        ac_unit(c, -0.9 + k * 0.9, 0.3, 0.35, name=f'ac{k}')
    return out


def piece_lamp(c):
    """Street lamp: tapered pole, curved arm towards +X, flat LED head."""
    st = mat('k_lamp_pole', '#6a6e78', rough=0.45)
    glow = mat('k_lamp_glow', '#ffe6bc', emit=1.3)
    out = [cyl(c, 'base', (0, 0, 0), (0, 0, 0.45), 0.24, 0.2, n=12, m=st)]
    out.append(cyl(c, 'pole', (0, 0, 0.45), (0, 0, 7.7), 0.13, 0.08, n=12, m=st))
    pts = [V((0, 0, 7.5)), V((0.3, 0, 7.95)), V((0.8, 0, 8.12)), V((1.6, 0, 8.14))]
    for a, b in zip(pts, pts[1:]):
        out.append(kit.beam(c, 'arm', a, b, 0.09, st, n=8))
    out.append(box(c, 'head', (1.35, -0.2, 8.04), (2.25, 0.2, 8.2), st, bev=0.03))
    out.append(box(c, 'led', (1.42, -0.15, 8.02), (2.18, 0.15, 8.04), glow))
    return out


def piece_barrier(c):
    """Road barrier with red / white boards on two feet (2.6 x 0.8 x 1.2)."""
    red = mat('k_red', '#c4243a', rough=0.6)
    white = mat('k_white', '#e9e6e0', rough=0.6)
    foot = mat('k_foot', '#3d3f45')
    lamp = mat('k_warn', '#ffb84a', emit=1.1)
    out = []
    for sx in (-1.15, 1.15):
        out.append(box(c, 'foot', (sx - 0.12, -0.4, 0), (sx + 0.12, 0.4, 0.1), foot, bev=0.02))
        out.append(box(c, 'post', (sx - 0.05, -0.05, 0.1), (sx + 0.05, 0.05, 1.12), white))
    for z0 in (0.45, 0.85):
        for k in range(6):
            x0 = -1.3 + k * (2.6 / 6)
            out.append(box(c, 'board', (x0, -0.06, z0), (x0 + 2.6 / 6, 0.0, z0 + 0.26), red if k % 2 == 0 else white))
    out.append(cyl(c, 'lamp', (1.15, 0, 1.12), (1.15, 0, 1.22), 0.07, n=10, m=lamp))
    return out


def piece_rail_seg(c):
    """2 m of red bridge railing (posts + round rails) along X."""
    red = mat('k_rail_red', '#b8263a', rough=0.5)
    out = []
    for sx in (-1.0, 0.0):
        out.append(box(c, 'post', (sx - 0.04, -0.04, 0), (sx + 0.04, 0.04, 1.1), red))
    for z in (0.5, 1.05):
        out.append(kit.beam(c, 'rail', (-1.0, 0, z), (1.0, 0, z), 0.07, red, n=8))
    return out


def piece_pier_cap(c):
    """Flared concrete cap on top of a viaduct pier (column 2.2 m wide below)."""
    conc = mat('k_concrete', '#9d978e')
    prof = [(-1.1, 0.0), (1.1, 0.0), (1.9, 0.9), (1.9, 1.4), (-1.9, 1.4), (-1.9, 0.9)]
    return [kit.prism(c, 'cap', prof, 'Y', -1.5, 1.5, conc)]


def piece_train_car(c):
    """Commuter car (3.4 x 18 x 3.2): rounded roof, window band, doors, red stripe, bogies."""
    white = mat('k_train_white', '#e6e3dd', rough=0.4)
    red = mat('k_train_red', '#c41f34', rough=0.4)
    dark = mat('k_train_dark', '#2e3036')
    win = mat('k_train_win', '#ffe1b0', emit=0.9)
    glass = mat('k_train_glass', '#26303c', rough=0.2)
    L = 17.8
    prof = [(-1.65, 0.3), (1.65, 0.3), (1.7, 2.65), (1.45, 3.05), (0.9, 3.2), (-0.9, 3.2), (-1.45, 3.05), (-1.7, 2.65)]
    out = [kit.prism(c, 'body', prof, 'Y', -L / 2, L / 2, white)]
    for sx in (-1, 1):
        x = sx * 1.71
        out.append(box(c, 'stripe', (x - 0.02, -L / 2 + 0.2, 0.95), (x + 0.02, L / 2 - 0.2, 1.25), red))
        # windows between the doors
        for k in range(4):
            y0 = -L / 2 + 1.2 + k * 4.2
            out.append(box(c, 'door', (x - 0.025, y0 + 2.25, 0.35), (x + 0.025, y0 + 3.55, 2.45), dark))
            out.append(box(c, 'dwin', (x - 0.03, y0 + 2.4, 1.5), (x + 0.03, y0 + 3.4, 2.3), glass))
            lit = (k + (sx > 0)) % 2 == 0
            out.append(box(c, 'win', (x - 0.03, y0 + 0.2, 1.45), (x + 0.03, y0 + 2.05, 2.35), win if lit else glass))
    for sy in (-1, 1):
        y = sy * (L / 2)
        out.append(box(c, 'end', (-1.5, y - 0.03, 0.4), (1.5, y + 0.03, 2.9), dark))
        out.append(box(c, 'bogie', (-1.2, sy * 6.2 - 1.2, 0.0), (1.2, sy * 6.2 + 1.2, 0.35), dark))
        for wy in (-0.7, 0.7):
            for sx in (-1, 1):
                out.append(cyl(c, 'wheel', (sx * 0.85, sy * 6.2 + wy, 0.3), (sx * 1.0, sy * 6.2 + wy, 0.3), 0.33, n=14, m=dark))
    for k in range(3):
        out.append(box(c, 'roof_ac', (-0.7, -5 + k * 5 - 0.9, 3.15), (0.7, -5 + k * 5 + 0.9, 3.45), white, bev=0.05))
    return out


def piece_lattice(c):
    """1 x 1 x 1 steel lattice segment (stacked and scaled into tall columns)."""
    st = mat('k_lattice', '#7b7f88', rough=0.4)
    out = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            out.append(box(c, 'post', (sx * 0.5 - 0.06 * (sx > 0), sy * 0.5 - 0.06 * (sy > 0), 0), (sx * 0.5 + 0.06 * (sx < 0), sy * 0.5 + 0.06 * (sy < 0), 1.0), st))
    for z in (0.0, 0.97):
        out.append(box(c, 'ring', (-0.5, -0.5, z), (0.5, -0.47, z + 0.03), st))
        out.append(box(c, 'ring', (-0.5, 0.47, z), (0.5, 0.5, z + 0.03), st))
        out.append(box(c, 'ring', (-0.5, -0.5, z), (-0.47, 0.5, z + 0.03), st))
        out.append(box(c, 'ring', (0.47, -0.5, z), (0.5, 0.5, z + 0.03), st))
    for s in (-1, 1):
        out.append(kit.beam(c, 'x', (-0.47, s * 0.485, 0.03), (0.47, s * 0.485, 0.97), 0.025, st))
        out.append(kit.beam(c, 'x', (s * 0.485, -0.47, 0.03), (s * 0.485, 0.47, 0.97), 0.025, st))
    return out


def piece_sign_bracket(c):
    """Steel bracket holding a vertical sign 0.5 m off the wall (wall at +Y)."""
    st = _steel()
    return [box(c, 'arm', (-0.04, -0.5, 0), (0.04, 0.0, 0.08), st), kit.beam(c, 'strut', (0, -0.45, 0.04), (0, -0.02, -0.4), 0.05, st), box(c, 'plate', (-0.12, -0.02, -0.45), (0.12, 0.0, 0.12), st)]


def piece_dish(c):
    st = _steel()
    out = [box(c, 'base', (-0.4, -0.4, 0), (0.4, 0.4, 0.12), mat('k_concrete', '#9d978e'))]
    out.append(cyl(c, 'post', (0, 0, 0.12), (0, 0, 0.9), 0.05, n=8, m=st))
    out.append(cyl(c, 'dish', (0, -0.05, 1.1), (0, 0.15, 1.0), 0.55, 0.2, n=20, m=mat('k_dish', '#dcdcd8')))
    out.append(kit.beam(c, 'lnb', (0, -0.05, 1.1), (0, -0.5, 1.15), 0.03, st))
    return out


PIECES = {
    'tank_square': piece_tank_square,
    'tank_round': piece_tank_round,
    'hvac': piece_hvac,
    'stair_hut': piece_stair_hut,
    'mast': piece_mast,
    'ac_rack': piece_ac_rack,
    'dish': piece_dish,
    'lamp': piece_lamp,
    'barrier': piece_barrier,
    'rail_seg': piece_rail_seg,
    'pier_cap': piece_pier_cap,
    'train_car': piece_train_car,
    'lattice': piece_lattice,
    'sign_bracket': piece_sign_bracket,
}


def build_kit(out_dir: str, export: bool = True, preview: bool = False) -> None:
    kit.reset()
    atlas = kit.Atlas(cells=8, cell_px=8)
    atlas_mat = kit.mat('atlas', '#ffffff')
    glow_mat = kit.mat('glow', '#ffffff')
    pieces = []
    for name, fn in PIECES.items():
        coll = kit.new_collection(f'c_{name}')
        objs = [o for o in fn(coll) if o is not None]
        objs = [o for o in coll.objects]
        ob = kit.join(objs, name)
        for col in list(ob.users_collection):
            col.objects.unlink(ob)
        bpy_scene_link(ob)
        kit.atlas_piece(ob, atlas, atlas_mat, glow_mat)
        pieces.append(ob)
        print(f'  {name}: {kit.tri_count([ob])} tris')
    kit.save_rgba(os.path.join(out_dir, f'{THEME}_atlas.png'), atlas.image())
    if export:
        kit.export_kit(pieces, os.path.join(out_dir, f'{THEME}.glb'))
    if preview:
        # preview with the real colours: swap the atlas material back to per-swatch colours
        for ob in pieces:
            _colorize(ob, atlas)
        kit.contact_sheet(pieces, os.path.join(kit.CACHE_DIR, f'{THEME}_kit.png'))


def bpy_scene_link(ob):
    import bpy
    bpy.context.scene.collection.objects.link(ob)


def _colorize(ob, atlas):
    """Preview only: per-face material from the atlas swatch under its UV."""
    import bpy
    me = ob.data
    uv = me.uv_layers['UVMap']
    cache = {}
    me_mats = list(me.materials)
    me.materials.clear()
    for p in me.polygons:
        u, v = uv.data[p.loop_indices[0]].uv
        cx = int(u * atlas.cells)
        cy = int((1 - v) * atlas.cells)
        idx = cy * atlas.cells + cx
        col = atlas.colors[idx]
        glow = me_mats[p.material_index].name == 'glow'
        key = (idx, glow)
        if key not in cache:
            m = bpy.data.materials.new(f'prev_{idx}_{glow}')
            bsdf = m.node_tree.nodes.get('Principled BSDF')
            bsdf.inputs['Base Color'].default_value = kit.srgb(col)
            if glow:
                bsdf.inputs['Emission Color'].default_value = kit.srgb(col)
                bsdf.inputs['Emission Strength'].default_value = 2.0
            me.materials.append(m)
            cache[key] = len(me.materials) - 1
        p.material_index = cache[key]
