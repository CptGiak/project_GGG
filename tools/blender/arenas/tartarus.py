"""MIDNIGHT TARTARUS: stone, checkered floors, island rims, runed obelisks, and the tower kit.

The Dark Hour palette stays green, but in values instead of light: grey-green stone in the
mid-tones, a muted checker, brass trims that catch the moon. Glow is limited to the tower windows,
the obelisk runes and a few lanterns, all dim.
"""
from __future__ import annotations

import math
import os

import numpy as np

import kit
from kit import V, box, cyl, mat, rotate, torus

THEME = 'tartarus'


# =============================================================================================
# Walls (front view: tile on XZ, facing -Y)
# =============================================================================================

def _ashlar(c, x0, x1, z0, z1, course, unit, tones, rng, hole=None, name='blk', depth=0.04, gap=0.012):
    """Running-bond block veneer over [x0,x1] x [z0,z1], tileable along X: a block crossing the
    tile edge is modelled whole on the left side only (the neighbouring copy supplies the right
    side), so nothing overlaps in the 3 x 3 tiled render and the joints stay regular.
    `hole` = (hx0, hx1, hz0, hz1): courses crossing it stop at its sides (window bays)."""
    rows = int(round((z1 - z0) / course))
    for r in range(rows):
        za, zb = z0 + r * course, z0 + (r + 1) * course
        off = (r % 2) * unit / 2
        x = x0 - off
        k = 0
        while x < x1 - 1e-6:
            a, b = x + gap, x + unit - gap
            x += unit
            k += 1
            if b > x1 + gap + 1e-6:
                continue
            parts = [(a, b)]
            if hole and zb > hole[2] + 1e-6 and za < hole[3] - 1e-6:
                parts = []
                if a < hole[0]:
                    parts.append((a, min(b, hole[0] - gap)))
                if b > hole[1]:
                    parts.append((max(a, hole[1] + gap), b))
            m = tones[int(rng.integers(0, len(tones)))]
            for i, (pa, pb) in enumerate(parts):
                if pb - pa < 0.05:
                    continue
                box(c, f'{name}{r}_{k}_{i}', (pa, -depth, za + gap), (pb, 0.0, zb - gap), m, bev=0.01)


def tile_tower(c, red: bool = False):
    """One tier face of the tower (6 x 12 m): ashlar, edge pilasters, a tall arched window in a
    framed bay, and a frieze (dentils, band, brass line, cornice). `red` adds the maroon band with
    brass lozenges (every third tier)."""
    rng = np.random.default_rng(31 if red else 30)
    mortar = mat('tw_mortar', '#363f3c')
    tones = [mat('tw_a', '#6f7b75'), mat('tw_b', '#67736d'), mat('tw_c', '#76827c'), mat('tw_d', '#6a756f')]
    light = mat('tw_light', '#88948e')
    panel = mat('tw_panel', '#5d6964')
    brass = mat('tw_brass', '#9a8650', rough=0.4)
    iron = mat('tw_iron', '#2b302f', rough=0.5)
    glass = mat('lit_window', '#86eac4')
    core = box(c, 'core', (0.0, 0.0, 0), (6.0, 0.8, 12), mortar)
    # window: x 2.2..3.8, z 2.0..6.8 + half circle (r 0.8) on top; framed bay 1.6..4.4 x 1.5..8.25
    wx0, wx1, wz0, wz1 = 2.2, 3.8, 2.0, 6.8
    cx, cz, r = 3.0, wz1, 0.8
    bay = (1.6, 4.4, 1.5, 8.25)
    kit.cut(core, [box(c, 'core_cut', (bay[0], -1.0, bay[2]), (bay[1], 0.6, bay[3]), mortar)])
    _ashlar(c, 0.0, 6.0, 0.0, 10.5, 0.75, 1.5, tones, rng, hole=bay, name='a')
    # pilasters on the tile edges (half on each side -> whole when tiled), with base and capital
    box(c, 'pil', (-0.35, -0.24, 0.5), (0.35, 0.0, 10.2), light)
    box(c, 'pilb', (-0.43, -0.3, 0.0), (0.43, 0.0, 0.5), light, bev=0.02)
    box(c, 'pilc', (-0.41, -0.3, 10.2), (0.41, 0.0, 10.42), light, bev=0.02)
    # bay panel with the window opening cut through
    pan = box(c, 'panel', bay[:1] + (-0.08,) + bay[2:3], (bay[1], 0.5, bay[3]), panel)
    cutters = [box(c, 'cut_rect', (wx0, -1.0, wz0), (wx1, 1.0, wz1 + 0.01), panel),
               cyl(c, 'cut_arch', (cx, -1.0, cz), (cx, 1.0, cz), r, n=24, m=panel, smooth=False)]
    kit.cut(pan, cutters)
    box(c, 'glass', (wx0 - 0.1, 0.5, wz0 - 0.1), (wx1 + 0.1, 0.56, cz + r + 0.1), glass)
    for x in (2.73, 3.27):
        box(c, f'mul{x}', (x - 0.03, 0.42, wz0), (x + 0.03, 0.5, cz + r), iron)
    for z in (3.6, 5.2, 6.8):
        box(c, f'tr{z}', (wx0, 0.42, z - 0.03), (wx1, 0.5, z + 0.03), iron)
    # jambs, sill, voussoirs and keystone
    box(c, 'jamb_l', (wx0 - 0.22, -0.14, wz0 - 0.1), (wx0, 0.45, wz1), light)
    box(c, 'jamb_r', (wx1, -0.14, wz0 - 0.1), (wx1 + 0.22, 0.45, wz1), light)
    box(c, 'sill', (wx0 - 0.32, -0.2, wz0 - 0.24), (wx1 + 0.32, 0.45, wz0), light, bev=0.02)
    n = 9
    for k in range(n):
        a0 = math.pi * k / n
        a1 = math.pi * (k + 1) / n
        p = [(cx + math.cos(a0) * r, cz + math.sin(a0) * r), (cx + math.cos(a1) * r, cz + math.sin(a1) * r),
             (cx + math.cos(a1) * (r + 0.24), cz + math.sin(a1) * (r + 0.24)), (cx + math.cos(a0) * (r + 0.24), cz + math.sin(a0) * (r + 0.24))]
        kit.prism(c, f'vous{k}', p, 'Y', -0.14 + 0.01 * (k % 2), 0.45, light)
    box(c, 'key', (cx - 0.15, -0.2, cz + r - 0.04), (cx + 0.15, 0.45, cz + r + 0.38), light, bev=0.02)
    # frieze: dentils, band, brass line, cornice
    for k in range(20):
        x = 0.15 + k * 0.3
        box(c, f'dent{k}', (x - 0.08, -0.2, 10.42), (x + 0.08, 0.0, 10.6), light)
    box(c, 'band', (0.0, -0.16, 10.6), (6.0, 0.0, 11.65), mat('tw_red', '#6b2531') if red else light)
    if red:
        for k in range(10):
            x = 0.3 + k * 0.6
            kit.cbox(c, f'dia{k}', (x, -0.17, 11.12), (0.28, 0.02, 0.28), brass)
            rotate(c.objects[-1], 'Y', 45, (x, -0.17, 11.12))
    box(c, 'brass', (0.0, -0.2, 11.65), (6.0, 0.0, 11.72), brass)
    box(c, 'cornice', (0.0, -0.34, 11.72), (6.0, 0.0, 12.0), light)


def tile_rim(c):
    """Edge of a floating island (4 x 3.2 m): moulded top, ashlar band, rough chamfered base."""
    rng = np.random.default_rng(41)
    tones = [mat('rm_a', '#5f6b66'), mat('rm_b', '#58645f'), mat('rm_c', '#65716b')]
    light = mat('tw_light', '#88948e')
    brass = mat('tw_brass', '#9a8650', rough=0.4)
    base = mat('rm_base', '#454f4b')
    box(c, 'core', (0, 0.0, 0), (4, 0.6, 3.2), mat('tw_mortar', '#363f3c'))
    _ashlar(c, 0.0, 4.0, 0.9, 2.8, 0.95, 2.0, tones, rng, name='r')
    for k in range(4):
        box(c, f'base{k}', (k + 0.02, -0.02, 0.0), (k + 0.98, 0.0, 0.9), base, bev=0.06)
    box(c, 'mould1', (0.0, -0.12, 2.8), (4.0, 0.0, 2.95), light)
    box(c, 'brass', (0.0, -0.13, 2.95), (4.0, 0.0, 3.0), brass)
    box(c, 'mould2', (0.0, -0.2, 3.0), (4.0, 0.0, 3.2), light)


def tile_stone(c):
    """Generic ashlar (3 x 3 m) for pillars, the spire and plinths."""
    rng = np.random.default_rng(51)
    tones = [mat('st_a', '#6c7872'), mat('st_b', '#65716b'), mat('st_c', '#737f79')]
    box(c, 'core', (0, 0.0, 0), (3, 0.6, 3), mat('tw_mortar', '#363f3c'))
    _ashlar(c, 0.0, 3.0, 0.0, 3.0, 0.5, 1.0, tones, rng, name='s')


def tile_obelisk(c):
    """Monolith face (2 x 6 m): dark polished stone, a carved band down the middle with one rune per
    metre (a stem and two or three branches), faintly glowing."""
    rng = np.random.default_rng(61)
    stone = mat('ob_stone', '#3f4946', rough=0.5)
    edge = mat('ob_edge', '#4b5552', rough=0.5)
    band = mat('ob_band', '#343e3b', rough=0.5)
    rune = mat('lit_rune', '#7fe8c0')
    box(c, 'face', (0, 0.0, 0), (2, 0.4, 6), stone)
    for xa, xb in ((0.0, 0.12), (1.88, 2.0)):
        box(c, f'edge{xa}', (xa, -0.04, 0), (xb, 0.0, 6), edge)
    box(c, 'band', (0.6, -0.008, 0), (1.4, 0.0, 6), band)
    # branch = (height on the stem 0..1, side -1/1, angle: +45 slopes down, -45 up, 0 flat)
    shapes = [(0.85, 1, 45), (0.85, -1, 45), (0.55, 1, -45), (0.55, -1, -45), (0.2, 1, 45), (0.2, -1, -45), (0.65, 1, 0), (0.35, -1, 0)]
    for gi in range(6):
        z0, h, cx = gi + 0.2, 0.6, 1.0
        box(c, f'stem{gi}', (cx - 0.03, -0.014, z0), (cx + 0.03, -0.008, z0 + h), rune)
        picks = rng.choice(len(shapes), size=int(rng.integers(2, 4)), replace=False)
        for k in picks:
            f, side, ang = shapes[k]
            pz = z0 + f * h
            L = 0.26 if ang else 0.2
            x0, x1 = (cx, cx + L) if side > 0 else (cx - L, cx)
            ob = box(c, f'br{gi}{k}', (x0, -0.014, pz - 0.025), (x1, -0.008, pz + 0.025), rune)
            if ang:
                rotate(ob, 'Y', ang * side, (cx, -0.011, pz))
        if rng.random() < 0.35:
            kit.cbox(c, f'dot{gi}', (cx, -0.011, z0 + h + 0.12), (0.08, 0.006, 0.08), rune)
            rotate(c.objects[-1], 'Y', 45, (cx, -0.011, z0 + h + 0.12))


# =============================================================================================
# Floors (top view)
# =============================================================================================

def tile_checker(c):
    """Island tops: 0.5 m checkered tiles, muted cream and deep teal, thin dark grout."""
    rng = np.random.default_rng(71)
    grout = mat('ck_grout', '#202826')
    light = [mat('ck_l1', '#839082'), mat('ck_l2', '#7e8b7d'), mat('ck_l3', '#889587')]
    dark = [mat('ck_d1', '#42564f'), mat('ck_d2', '#3e524b'), mat('ck_d3', '#465a4f')]
    box(c, 'base', (0, 0, -0.1), (2, 2, 0.0), grout)
    for i in range(4):
        for j in range(4):
            m = (light if (i + j) % 2 == 0 else dark)[int(rng.integers(0, 3))]
            box(c, f't{i}{j}', (i * 0.5 + 0.01, j * 0.5 + 0.01, 0), (i * 0.5 + 0.49, j * 0.5 + 0.49, 0.02), m, bev=0.006)


def tile_slab(c):
    """Big stone pavers (4 x 4 m, 2 x 1 m running bond) for the tower terraces and spawn plinths."""
    rng = np.random.default_rng(81)
    grout = mat('sl_grout', '#2c3532')
    tones = [mat('sl_a', '#6a756f'), mat('sl_b', '#636e68'), mat('sl_c', '#707b75')]
    box(c, 'base', (0.0, 0.0, -0.1), (4.0, 4.0, 0.0), grout)
    g = 0.015
    for i in range(4):
        y0 = i * 1.0
        wrap = tones[int(rng.integers(0, 3))]
        if i % 2 == 0:
            for k in range(2):
                m = tones[int(rng.integers(0, 3))]
                box(c, f's{i}{k}', (k * 2.0 + g, y0 + g, 0), (k * 2.0 + 2.0 - g, y0 + 1.0 - g, 0.03), m, bev=0.01)
        else:
            # 1..3 whole; the paver across the edge is modelled whole on the left (-1..1)
            box(c, f's{i}m', (1.0 + g, y0 + g, 0), (3.0 - g, y0 + 1.0 - g, 0.03), tones[int(rng.integers(0, 3))], bev=0.01)
            box(c, f's{i}w', (-1.0 + g, y0 + g, 0), (1.0 - g, y0 + 1.0 - g, 0.03), wrap, bev=0.01)


def tile_water(c):
    """Unused placeholder so `--only water` does not fail (the water is procedural in game)."""


TILES = {
    'tower': (lambda c: tile_tower(c, False), 6.0, 12.0, 48, 'front'),
    'tower_red': (lambda c: tile_tower(c, True), 6.0, 12.0, 48, 'front'),
    'rim': (tile_rim, 4.0, 3.2, 64, 'front'),
    'stone': (tile_stone, 3.0, 3.0, 64, 'front'),
    'obelisk': (tile_obelisk, 2.0, 6.0, 64, 'front'),
    'checker': (tile_checker, 2.0, 2.0, 96, 'top'),
    'slab': (tile_slab, 4.0, 4.0, 48, 'top'),
}

GLOWING = ('tower', 'tower_red', 'obelisk')


def build_textures(out_dir: str, only: list[str] | None = None) -> None:
    for name, (fn, W, H, px, view) in TILES.items():
        if only and name not in only:
            continue
        # cool moonlight from the upper right
        sun_dir = (0.4, -0.5, 1.0) if view == 'front' else (0.35, -0.5, 1.0)
        albedo, mask = kit.render_tile(fn, W, H, px, f'{THEME}_{name}', view=view, samples=64, sun_dir=sun_dir, sky=0.65)
        kit.save_rgba(os.path.join(out_dir, f'{THEME}_{name}.png'), albedo.astype(np.float32), mask if name in GLOWING else None)
        print('tile', name, albedo.shape)


# =============================================================================================
# Kit
# =============================================================================================

def piece_rock(c):
    """Underside of a floating island: a jagged inverted spire, 1 x 1 at the top, 0.7 deep (scaled
    by the island size). Origin at the top centre, hangs below."""
    rng = np.random.default_rng(5)
    top = mat('k_rock_top', '#4f544c')
    low = mat('k_rock_low', '#3d423c')
    n = 9
    rings = [(0.0, 0.54, 0.04), (-0.1, 0.5, 0.07), (-0.28, 0.38, 0.09), (-0.46, 0.24, 0.07), (-0.62, 0.1, 0.04)]
    verts = []
    for k, (z, r, jit) in enumerate(rings):
        ph = rng.random() * 0.6
        for i in range(n):
            a = (i + ph) / n * math.tau
            rr = r * (1 + (rng.random() - 0.5) * jit * 4)
            verts.append(V((math.cos(a) * rr, math.sin(a) * rr, z + (rng.random() - 0.5) * jit)))
    tip = len(verts)
    verts.append(V((0.03, -0.02, -0.72)))
    cap = len(verts)
    verts.append(V((0, 0, 0.0)))
    faces = []
    for k in range(len(rings) - 1):
        for i in range(n):
            a = k * n + i
            b = k * n + (i + 1) % n
            faces.append((a, b, b + n, a + n)[::-1])
    for i in range(n):
        a = (len(rings) - 1) * n + i
        b = (len(rings) - 1) * n + (i + 1) % n
        faces.append((a, b, tip)[::-1])
        faces.append((cap, (i + 1) % n, i)[::-1])
    ob = kit.mesh(c, 'rock', verts, faces, top)
    ob.data.materials.append(low)
    for p in ob.data.polygons:
        if p.center.z < -0.25:
            p.material_index = 1
    # a few stalactites
    for k in range(4):
        a = rng.random() * math.tau
        r = 0.2 + rng.random() * 0.15
        z0 = -0.3 - rng.random() * 0.1
        cyl(c, f'stal{k}', (math.cos(a) * r, math.sin(a) * r, z0), (math.cos(a) * r * 0.9, math.sin(a) * r * 0.9, z0 - 0.18 - rng.random() * 0.12), 0.05, 0.0, n=5, m=low, smooth=False)


def piece_pillar_base(c):
    """Plinth under the island pillars (1.9 x 0.55 x 1.9)."""
    light = mat('k_stone_light', '#87938d')
    stone = mat('k_stone', '#6c7872')
    box(c, 'p0', (-0.95, -0.95, 0.0), (0.95, 0.95, 0.2), stone, bev=0.03)
    box(c, 'p1', (-0.88, -0.88, 0.2), (0.88, 0.88, 0.36), light, bev=0.04)
    box(c, 'p2', (-0.82, -0.82, 0.36), (0.82, 0.82, 0.55), stone, bev=0.02)


def piece_pillar_cap(c):
    """Capital on the island pillars (1.9 x 0.6 x 1.9) with a brass ring."""
    light = mat('k_stone_light', '#87938d')
    stone = mat('k_stone', '#6c7872')
    brass = mat('k_brass', '#9a8650', rough=0.4)
    box(c, 'c0', (-0.84, -0.84, 0.0), (0.84, 0.84, 0.12), brass)
    box(c, 'c1', (-0.86, -0.86, 0.12), (0.86, 0.86, 0.32), stone, bev=0.02)
    box(c, 'c2', (-0.95, -0.95, 0.32), (0.95, 0.95, 0.6), light, bev=0.04)


def _lantern(c, o=(0.0, 0.0, 0.0), k: float = 1.0):
    """Iron lantern with a dim green flame, foot at `o`, scaled by `k` (0.92 m tall at k = 1)."""
    iron = mat('k_iron', '#2d3231', rough=0.5)
    flame = mat('k_flame', '#9cf2cf', emit=0.9)
    ox, oy, oz = o

    def P(x, y, z):
        return (ox + x * k, oy + y * k, oz + z * k)

    box(c, 'foot', P(-0.22, -0.22, 0.0), P(0.22, 0.22, 0.08), iron)
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(c, 'post', P(sx * 0.17 - 0.025, sy * 0.17 - 0.025, 0.08), P(sx * 0.17 + 0.025, sy * 0.17 + 0.025, 0.62), iron)
    box(c, 'glass', P(-0.14, -0.14, 0.12), P(0.14, 0.14, 0.56), flame)
    cyl(c, 'roof', P(0, 0, 0.62), P(0, 0, 0.86), 0.27 * k, 0.03 * k, n=4, m=iron, smooth=False)
    torus(c, 'ring', P(0, 0, 0.92), 0.06 * k, 0.015 * k, n=10, k=4, m=iron, axis='Y')


def piece_lantern(c):
    """Standing lantern (spawn plinths)."""
    _lantern(c)


def piece_wall_lantern(c):
    """Lantern on an iron bracket: origin on the wall at the foot of the back plate, the arm points
    out of the wall (+Z in game) and the lantern hangs 0.8 m out."""
    iron = mat('k_iron', '#2d3231', rough=0.5)
    box(c, 'plate', (-0.12, -0.04, 0.0), (0.12, 0.0, 0.56), iron, bev=0.01)
    box(c, 'arm', (-0.03, -0.9, 0.44), (0.03, -0.04, 0.5), iron)
    kit.beam(c, 'brace', (0, -0.05, 0.1), (0, -0.62, 0.46), 0.045, iron)
    kit.cbox(c, 'tip', (0, -0.9, 0.47), (0.09, 0.09, 0.09), iron)
    _lantern(c, (0.0, -0.8, 0.44 - 0.86 * 0.8), 0.8)


def piece_chain(c):
    """2.4 m of heavy forged chain (four links, 0.6 m pitch, alternating planes), hangs from its
    origin; pieces stack every 2.4 m. Low-poly links (hexagonal ring, triangular section)."""
    from mathutils import Matrix
    iron = mat('k_chain', '#4a524f', rough=0.45)
    for k in range(4):
        ob = torus(c, f'link{k}', (0, 0, 0), 0.2, 0.055, n=6, k=3, m=iron, axis='Y')
        ob.data.transform(Matrix.Diagonal((1.0, 1.0, 1.9, 1.0)))
        if k % 2:
            ob.data.transform(Matrix.Rotation(math.pi / 2, 4, 'Z'))
        ob.data.transform(Matrix.Translation((0, 0, -0.5 - k * 0.6)))
        kit.flat(ob)


def piece_shackle(c):
    """Ring at the end of a chain (hangs from its origin)."""
    iron = mat('k_chain', '#4a524f', rough=0.45)
    torus(c, 'ring', (0, 0, -0.42), 0.36, 0.08, n=14, k=5, m=iron, axis='Y')


def piece_coffin(c):
    """Standing coffin (0.75 x 0.45 x 2.05): lacquered wood, raised lid, brass handles."""
    wood = mat('k_coffin', '#3a2f33', rough=0.45)
    lid = mat('k_coffin_lid', '#46393e', rough=0.4)
    brass = mat('k_brass', '#9a8650', rough=0.4)
    # outline in the XZ plane (x across, z up), extruded along Y (depth)
    prof = [(-0.24, 0.0), (0.24, 0.0), (0.37, 1.45), (0.27, 2.05), (-0.27, 2.05), (-0.37, 1.45)]
    kit.prism(c, 'body', prof, 'Y', -0.2, 0.2, wood)
    inner = [(x * 0.86, 0.08 + z * 0.93) for x, z in prof]
    kit.prism(c, 'lid', inner, 'Y', -0.24, -0.2, lid)
    for z in (0.6, 1.2):
        for sx in (-1, 1):
            x = sx * (0.3 if z > 1 else 0.27)
            box(c, f'h{z}{sx}', (x - 0.03, -0.12, z - 0.04), (x + 0.03, 0.12, z + 0.04), brass)


def piece_pyramidion(c):
    """Cap of the monoliths: unit pyramid (1 x 0.6 x 1) with a brass tip."""
    stone = mat('k_obelisk', '#46504d', rough=0.5)
    brass = mat('k_brass', '#9a8650', rough=0.4)
    cyl(c, 'pyr', (0, 0, 0), (0, 0, 0.5), 0.71, 0.08, n=4, m=stone, smooth=False)
    rotate(c.objects[-1], 'Z', 45)
    cyl(c, 'tip', (0, 0, 0.5), (0, 0, 0.62), 0.08, 0.0, n=4, m=brass, smooth=False)
    rotate(c.objects[-1], 'Z', 45)


PIECES = {
    'rock': piece_rock,
    'pillar_base': piece_pillar_base,
    'pillar_cap': piece_pillar_cap,
    'lantern': piece_lantern,
    'wall_lantern': piece_wall_lantern,
    'chain': piece_chain,
    'shackle': piece_shackle,
    'coffin': piece_coffin,
    'pyramidion': piece_pyramidion,
}


def build_kit(out_dir: str, export: bool = True, preview: bool = False) -> None:
    kit.build_kit(THEME, PIECES, out_dir, export=export, preview=preview)
