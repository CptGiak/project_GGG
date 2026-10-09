"""TRUE NOTE ARENA: pit floor, stands, stage and rig textures, and the concert kit.

Comfort notes: surfaces sit in the mid-tones (no black voids, no white planes); the only light
sources are small (lenses, LED ribbons) and stay under the bloom threshold in game.
"""
from __future__ import annotations

import math
import os

import numpy as np

import kit
from kit import V, box, cyl, mat, rotate, text, torus

THEME = 'stage'

# seat / ribbon-board colour by side of the bowl (orientation): east teal, south violet, west rose
SIDES = {
    'e': {'seat': '#2f7d8b', 'led': '#73e4ef'},
    's': {'seat': '#664c99', 'led': '#c8a6ff'},
    'w': {'seat': '#a24a72', 'led': '#ff93c4'},
}


# =============================================================================================
# Floors (top view: tile on XY, +Z up, image up = +Y)
# =============================================================================================

def tile_floor(c):
    """Pit floor: 2 x 1 m interlocking protection panels with a raised pad grid, staggered rows."""
    rng = np.random.default_rng(11)
    grout = mat('fl_grout', '#2a2730')
    tones = [mat('fl_a', '#57525f'), mat('fl_b', '#514c59'), mat('fl_c', '#5c5765')]
    box(c, 'base', (0, 0, -0.1), (4, 4, 0.0), grout)
    for j in range(4):
        for x0 in ((0.0, 2.0) if j % 2 == 0 else (1.0, 3.0)):
            m = tones[int(rng.integers(0, 3))]
            box(c, f'p{j}{x0}', (x0 + 0.012, j + 0.012, 0), (x0 + 1.988, j + 0.988, 0.035), m, bev=0.01)
            for a in range(8):
                for b in range(4):
                    px = x0 + 0.125 + a * 0.25
                    py = j + 0.125 + b * 0.25
                    box(c, f'd{j}{x0}{a}{b}', (px - 0.085, py - 0.085, 0.035), (px + 0.085, py + 0.085, 0.043), m)


def tile_seats(c, side: str):
    """Tier top (3 m along the row x 4.2 m deep): amber nosing, walkway, four rows of seats.
    y = 0 is the front edge over the pit, spectators face -Y."""
    seat = mat(f'seat_{side}', SIDES[side]['seat'], rough=0.6)
    seat_dk = mat(f'seatb_{side}', _shade(SIDES[side]['seat'], 0.82), rough=0.6)
    conc = mat('st_conc', '#7d7985')
    step = mat('st_step', '#706c78')
    nosing = mat('st_nosing', '#b08a3c')
    arm = mat('st_arm', '#34323a', rough=0.5)
    box(c, 'deck', (0, 0, -0.1), (3, 4.2, 0.0), conc)
    box(c, 'nose', (0, 0, 0.0), (3, 0.1, 0.012), nosing)
    for k in range(4):
        y0 = 1.1 + k * 0.775
        box(c, f'step{k}', (0, y0, 0.0), (3, y0 + 0.05, 0.01), step)
        for s in range(6):
            x = 0.25 + s * 0.5
            box(c, f'pan{k}{s}', (x - 0.21, y0 + 0.24, 0.38), (x + 0.21, y0 + 0.6, 0.44), seat, bev=0.03)
            box(c, f'back{k}{s}', (x - 0.22, y0 + 0.6, 0.4), (x + 0.22, y0 + 0.68, 0.86), seat_dk, bev=0.03)
            box(c, f'arm{k}{s}', (x + 0.23, y0 + 0.3, 0.52), (x + 0.27, y0 + 0.66, 0.58), arm)
            cyl(c, f'ped{k}{s}', (x, y0 + 0.5, 0.0), (x, y0 + 0.5, 0.38), 0.035, n=8, m=arm)


def tile_deck(c):
    """Stage deck: black-painted plywood sheets with seams, spike tape marks and a gaffer strip."""
    tones = [mat('dk_a', '#38343f'), mat('dk_b', '#3c3843'), mat('dk_c', '#35313b')]
    seam = mat('dk_seam', '#1d1b21')
    gaffer = mat('dk_gaffer', '#4a4752', rough=0.5)
    tape = [mat('tp_y', '#c9b25a'), mat('tp_w', '#d9d4cb'), mat('tp_p', '#c25184')]
    box(c, 'base', (0, 0, -0.1), (4.8, 2.4, 0.0), seam)
    k = 0
    for i in range(2):
        for j in range(2):
            box(c, f's{i}{j}', (i * 2.4 + 0.005, j * 1.2 + 0.005, 0), (i * 2.4 + 2.395, j * 1.2 + 1.195, 0.02), tones[k % 3])
            k += 1
    box(c, 'gaffer', (0.6, 1.17, 0.02), (2.0, 1.23, 0.024), gaffer)
    for n, (x, y) in enumerate([(1.1, 0.55), (3.6, 1.8), (3.2, 0.4)]):
        m = tape[n]
        box(c, f'tx{n}', (x - 0.09, y - 0.018, 0.02), (x + 0.09, y + 0.018, 0.023), m)
        box(c, f'ty{n}', (x - 0.018, y - 0.09, 0.02), (x + 0.018, y + 0.09, 0.023), m)


def tile_grate(c):
    """Steel deck of the drone platforms: 1 m plates with an embossed pad pattern."""
    plate = mat('gr_plate', '#6f727b', rough=0.45)
    pad = mat('gr_pad', '#7c7f88', rough=0.45)
    gap = mat('gr_gap', '#34363c')
    box(c, 'base', (0, 0, -0.1), (2, 2, 0.0), gap)
    for i in range(2):
        for j in range(2):
            box(c, f'pl{i}{j}', (i + 0.01, j + 0.01, 0), (i + 0.99, j + 0.99, 0.02), plate, bev=0.005)
            for a in range(5):
                for b in range(5):
                    cx = i + 0.1 + a * 0.2
                    cy = j + 0.1 + b * 0.2
                    rot = 0.5 if (a + b) % 2 else -0.5
                    kit.cbox(c, f'pd{i}{j}{a}{b}', (cx, cy, 0.024), (0.11, 0.035, 0.008), pad, rot_z=rot)


# =============================================================================================
# Walls (front view: tile on XZ, facing -Y)
# =============================================================================================

def tile_riser(c, side: str):
    """Front of a tier (6 x 4.4 m): plinth, precast panels, an LED ribbon board, coping + nosing."""
    plinth = mat('rs_plinth', '#5f5b67')
    panel = mat('rs_panel', '#8b8794')
    joint = mat('rs_joint', '#4a4752')
    housing = mat('rs_housing', '#24222a', rough=0.5)
    led_bg = mat(f'dim_led_{side}', '#2a1838')
    led_tx = mat(f'lit_led_{side}', SIDES[side]['led'])
    coping = mat('rs_coping', '#a9a5b0')
    nosing = mat('st_nosing', '#b08a3c')
    box(c, 'back', (0, 0.02, 0), (6, 0.5, 4.4), joint)
    box(c, 'plinth', (0, -0.03, 0), (6, 0.5, 0.35), plinth)
    for x0 in (0.0, 3.0):
        for z0, z1 in ((0.35, 1.8), (1.8, 3.25)):
            box(c, f'pn{x0}{z0}', (x0 + 0.012, 0.0, z0 + 0.012), (x0 + 2.988, 0.5, z1 - 0.012), panel, bev=0.01)
    # ribbon board
    box(c, 'housing', (0, -0.12, 3.25), (6, 0.5, 4.05), housing)
    box(c, 'ledbg', (0, -0.125, 3.33), (6, -0.12, 3.97), led_bg)
    text(c, 'tn', 'TRUE NOTE', 0.4, (1.7, -0.128, 3.65), led_tx, latin=True, extrude=0.001)
    text(c, 'lv', 'LIVE', 0.4, (4.65, -0.128, 3.65), led_tx, latin=True, extrude=0.001)
    for x in (3.45, 5.88):
        rotate(kit.cbox(c, f'dia{x}', (x, -0.128, 3.65), (0.17, 0.004, 0.17), led_tx), 'Y', 45, (x, -0.128, 3.65))
    box(c, 'coping', (0, -0.08, 4.05), (6, 0.5, 4.4), coping, bev=0.01)
    box(c, 'nose', (0, -0.085, 4.33), (6, -0.07, 4.4), nosing)


def tile_speaker(c):
    """Speaker wall (3.6 x 4 m): 2 x 2 cabinets with twin woofers, corner caps and a badge."""
    cab = mat('sp_cab', '#3a3741', rough=0.7)
    cone = mat('sp_cone', '#4a4752', rough=0.8)
    surround = mat('sp_surround', '#1d1c22', rough=0.9)
    cap = mat('sp_cap', '#7a7682', rough=0.5)
    corner = mat('sp_corner', '#9a9ea7', rough=0.4)
    badge = mat('sp_badge', '#c9c3b5')
    box(c, 'back', (0, 0.3, 0), (3.6, 0.6, 4), mat('sp_gap', '#141317'))
    for i in range(2):
        for j in range(2):
            x0, z0 = i * 1.8, j * 2.0
            body = box(c, f'cab{i}{j}', (x0 + 0.015, 0.0, z0 + 0.015), (x0 + 1.785, 0.6, z0 + 1.985), cab, bev=0.02)
            holes = []
            for k in range(2):
                cx, cz = x0 + 0.9, z0 + 0.55 + k * 0.9
                holes.append(cyl(c, f'hole{i}{j}{k}', (cx, -0.1, cz), (cx, 0.2, cz), 0.37, n=32, m=cab))
                cyl(c, f'cone{i}{j}{k}', (cx, 0.17, cz), (cx, 0.01, cz), 0.1, 0.37, n=32, m=cone, cap=False)
                torus(c, f'sur{i}{j}{k}', (cx, 0.012, cz), 0.36, 0.03, n=32, k=6, m=surround, axis='Y')
                cyl(c, f'cap{i}{j}{k}', (cx, 0.15, cz), (cx, 0.1, cz), 0.11, 0.09, n=16, m=cap)
            kit.cut(body, holes)
            for cx0, cx1 in ((x0 + 0.015, x0 + 0.135), (x0 + 1.665, x0 + 1.785)):
                for cz0, cz1 in ((z0 + 0.015, z0 + 0.135), (z0 + 1.865, z0 + 1.985)):
                    box(c, f'cn{i}{j}{cx0}{cz0}', (cx0, -0.012, cz0), (cx1, 0.02, cz1), corner, bev=0.01)
            box(c, f'bd{i}{j}', (x0 + 1.3, -0.008, z0 + 0.06), (x0 + 1.62, 0.0, z0 + 0.12), badge)


def tile_truss(c):
    """Box truss seen from the side (2 m of truss, 1.6 m deep): silver chords and lacing in front,
    the far face darker behind, a dark core between."""
    near = mat('tr_near', '#b4b8c2', rough=0.45)
    far = mat('tr_far', '#5d5f69', rough=0.6)
    core = mat('tr_core', '#1b1a20')
    box(c, 'core', (0.0, 1.56, 0.0), (2.0, 1.66, 1.6), core)
    lo, hi = 0.065, 1.535
    # far face (y = 1.47), mirrored lacing
    for z in (lo, hi):
        cyl(c, f'fch{z}', (0, 1.47, z), (2, 1.47, z), 0.05, n=10, m=far, cap=False)
    kit.beam(c, 'fd1', (0, 1.47, hi), (1, 1.47, lo), 0.045, far, n=8)
    kit.beam(c, 'fd2', (1, 1.47, lo), (2, 1.47, hi), 0.045, far, n=8)
    # near face
    for z in (lo, hi):
        cyl(c, f'ch{z}', (0, 0.065, z), (2, 0.065, z), 0.06, n=12, m=near, cap=False)
    kit.beam(c, 'v0', (0, 0.065, lo), (0, 0.065, hi), 0.05, near, n=8)
    kit.beam(c, 'd1', (0, 0.065, lo), (1, 0.065, hi), 0.05, near, n=8)
    kit.beam(c, 'd2', (1, 0.065, hi), (2, 0.065, lo), 0.05, near, n=8)


def tile_skirt(c):
    """Stage skirt: pleated black fabric with a hem band and a thin brass trim on top."""
    fab = mat('sk_fabric', '#2d2934', rough=0.95)
    hem = mat('sk_hem', '#36313d', rough=0.9)
    trim = mat('sk_trim', '#9a7a3e', rough=0.4)
    n = 80
    verts, faces = [], []
    for i in range(n + 1):
        x = i * 2.0 / n
        y = 0.04 * math.sin(x / 0.2 * math.tau)
        verts += [(x, y, 0.0), (x, y, 2.45)]
    for i in range(n):
        faces.append((i * 2, i * 2 + 2, i * 2 + 3, i * 2 + 1))
    kit.mesh(c, 'pleats', verts, faces, fab, smooth=True)
    box(c, 'hem', (0, -0.06, 2.4), (2, 0.1, 2.56), hem)
    box(c, 'trim', (0, -0.07, 2.56), (2, 0.1, 2.6), trim)


TILES = {
    # name: (builder, W, H, px/m, view)
    'floor': (tile_floor, 4.0, 4.0, 64, 'top'),
    'deck': (tile_deck, 4.8, 2.4, 64, 'top'),
    'grate': (tile_grate, 2.0, 2.0, 96, 'top'),
    'seats_e': (lambda c: tile_seats(c, 'e'), 3.0, 4.2, 80, 'top'),
    'seats_s': (lambda c: tile_seats(c, 's'), 3.0, 4.2, 80, 'top'),
    'seats_w': (lambda c: tile_seats(c, 'w'), 3.0, 4.2, 80, 'top'),
    'riser_e': (lambda c: tile_riser(c, 'e'), 6.0, 4.4, 64, 'front'),
    'riser_s': (lambda c: tile_riser(c, 's'), 6.0, 4.4, 64, 'front'),
    'riser_w': (lambda c: tile_riser(c, 'w'), 6.0, 4.4, 64, 'front'),
    'speaker': (tile_speaker, 3.6, 4.0, 80, 'front'),
    'truss': (tile_truss, 2.0, 1.6, 128, 'front'),
    'skirt': (tile_skirt, 2.0, 2.6, 64, 'front'),
}


def _shade(hex_color: str, k: float) -> str:
    r, g, b = kit.hex_rgb(hex_color)
    return '#%02x%02x%02x' % (int(r * 255 * k), int(g * 255 * k), int(b * 255 * k))


def build_textures(out_dir: str, only: list[str] | None = None) -> None:
    for name, (fn, W, H, px, view) in TILES.items():
        if only and name not in only and name.split('_')[0] not in only:
            continue
        sun_dir = (-0.35, -0.5, 1.0) if view == 'front' else (-0.3, -0.55, 1.0)
        albedo, mask = kit.render_tile(fn, W, H, px, f'{THEME}_{name}', view=view, samples=64, sun_dir=sun_dir)
        has_glow = name.startswith('riser')
        kit.save_rgba(os.path.join(out_dir, f'{THEME}_{name}.png'), albedo.astype(np.float32), mask if has_glow else None)
        print('tile', name, albedo.shape)


# =============================================================================================
# Kit. Origin at the bottom centre, front towards -Y (game +Z); hanging pieces have their
# origin at the top (they extend downwards).
# =============================================================================================

def _steel():
    return mat('k_steel', '#5d6068', rough=0.5)


def piece_flood_head(c):
    """Stadium floodlight head (7 x 2 x 3): two rows of six lamps aimed down at the pit."""
    st = _steel()
    housing = mat('k_housing', '#2f2e35', rough=0.5)
    lens = mat('k_flood', '#fff0d2', emit=1.2)
    box(c, 'frame', (-3.5, 0.9, 0.0), (3.5, 1.2, 2.0), st)
    for z in (0.08, 1.92):
        box(c, f'rail{z}', (-3.5, -1.5, z - 0.06), (3.5, 1.2, z + 0.06), st)
    for x in (-3.44, 3.44):
        box(c, f'side{x}', (x - 0.06, -1.5, 0.0), (x + 0.06, 1.2, 2.0), st)
    for row in range(2):
        for k in range(6):
            x = -2.9 + k * 1.16
            z = 0.52 + row * 0.98
            parts = [
                box(c, 'hous', (x - 0.46, -0.9, z - 0.4), (x + 0.46, 0.9, z + 0.4), housing, bev=0.04),
                box(c, 'lens', (x - 0.38, -0.92, z - 0.32), (x + 0.38, -0.9, z + 0.32), lens),
                box(c, 'visor', (x - 0.46, -1.25, z + 0.34), (x + 0.46, -0.9, z + 0.4), housing),
            ]
            for p in parts:
                rotate(p, 'X', 25, (x, 0.0, z))


def piece_moving_head(c):
    """Moving-head fixture, hung upside down under the rig (origin at the clamp, extends down)."""
    body = mat('k_fixture', '#2a2930', rough=0.5)
    yoke = mat('k_yoke', '#3d3c44', rough=0.5)
    lens = mat('k_mh_lens', '#efe0ff', emit=0.9)
    box(c, 'clamp', (-0.08, -0.08, -0.12), (0.08, 0.08, 0.0), yoke)
    box(c, 'base', (-0.3, -0.24, -0.36), (0.3, 0.24, -0.12), body, bev=0.04)
    for sx in (-1, 1):
        box(c, f'arm{sx}', (sx * 0.26 - 0.045, -0.07, -0.78), (sx * 0.26 + 0.045, 0.07, -0.36), yoke)
    cyl(c, 'head', (0, 0, -0.5), (0, 0, -0.95), 0.2, 0.17, n=16, m=body)
    cyl(c, 'lens', (0, 0, -0.95), (0, 0, -0.96), 0.14, n=16, m=lens)


def piece_par_bar(c):
    """2 m pipe with four PAR cans (hangs under a truss, origin at the top)."""
    st = _steel()
    can = mat('k_can', '#24232a', rough=0.5)
    lens_a = mat('k_par_gold', '#ffd98c', emit=0.8)
    lens_b = mat('k_par_violet', '#d2a8ff', emit=0.8)
    kit.beam(c, 'pipe', (-1.0, 0, -0.05), (1.0, 0, -0.05), 0.05, st, n=8)
    for k, x in enumerate((-0.75, -0.25, 0.25, 0.75)):
        box(c, f'clamp{k}', (x - 0.04, -0.04, -0.12), (x + 0.04, 0.04, -0.02), st)
        box(c, f'yoke{k}', (x - 0.14, -0.02, -0.4), (x + 0.14, 0.02, -0.12), st)
        p0 = V((x, 0.08, -0.3))
        p1 = V((x, -0.16, -0.62))
        cyl(c, f'can{k}', p0, p1, 0.13, n=14, m=can)
        d = (p1 - p0).normalized()
        cyl(c, f'lens{k}', p1, p1 + d * 0.01, 0.11, n=14, m=lens_a if k % 2 == 0 else lens_b)


def piece_wedge(c):
    """Stage monitor wedge (0.9 x 0.6 x 0.45), sloped face towards the performer (front)."""
    body = mat('k_cab_dark', '#2b2931', rough=0.7)
    grille = mat('k_grille_dark', '#1c1b20', rough=0.8)
    prof = [(-0.3, 0.0), (0.3, 0.0), (0.3, 0.45), (0.15, 0.45), (-0.3, 0.16)]
    kit.prism(c, 'body', prof, 'X', -0.45, 0.45, body)
    # grille on the slope
    p0, p1 = V((0, -0.3, 0.16)), V((0, 0.15, 0.45))
    a = p0.lerp(p1, 0.07)
    b = p0.lerp(p1, 0.93)
    n = V((0, -(b.z - a.z), b.y - a.y)).normalized() * 0.006
    verts = [(-0.4, a.y + n.y, a.z + n.z), (0.4, a.y + n.y, a.z + n.z), (0.4, b.y + n.y, b.z + n.z), (-0.4, b.y + n.y, b.z + n.z)]
    kit.mesh(c, 'grille', verts, [(0, 1, 2, 3)], grille)


def _road_case(c, x0, y0, z0, x1, y1, z1, name, label: str | None = None):
    """Flight case: body, aluminium edge extrusions, ball corners, lid seam, latches, handles.
    (Text labels cost thousands of triangles per stack: the kit pieces go without.)"""
    body = mat('k_case', '#4a4755', rough=0.6)
    alu = mat('k_alu_edge', '#8c909a', rough=0.4)
    dark = mat('k_case_dark', '#26242c')
    stencil = mat('k_stencil', '#d6d0c2')
    box(c, name, (x0, y0, z0), (x1, y1, z1), body)
    e = 0.035
    xs, ys, zs = (x0, x1), (y0, y1), (z0, z1)
    for y in ys:
        for z in zs:
            box(c, f'{name}ex', (x0, y - e, z - e), (x1, y + e, z + e), alu)
    for x in xs:
        for z in zs:
            box(c, f'{name}ey', (x - e, y0, z - e), (x + e, y1, z + e), alu)
    for x in xs:
        for y in ys:
            box(c, f'{name}ez', (x - e, y - e, z0), (x + e, y + e, z1), alu)
    for x in xs:
        for y in ys:
            for z in zs:
                box(c, f'{name}bc', (x - 0.055, y - 0.055, z - 0.055), (x + 0.055, y + 0.055, z + 0.055), alu)
    # lid seam, latches and recessed handles on the front (-Y)
    zl = z0 + (z1 - z0) * 0.78
    box(c, f'{name}lid', (x0, y0 - 0.012, zl - 0.018), (x1, y0, zl + 0.018), alu)
    w = x1 - x0
    for fx in (0.22, 0.78):
        xc = x0 + w * fx
        box(c, f'{name}latch', (xc - 0.07, y0 - 0.025, zl - 0.06), (xc + 0.07, y0, zl + 0.06), alu)
        box(c, f'{name}hdl', (xc - 0.14, y0 - 0.006, z0 + (z1 - z0) * 0.42), (xc + 0.14, y0, z0 + (z1 - z0) * 0.52), dark)
    if label:
        text(c, f'{name}lbl', label, min(0.2, (z1 - z0) * 0.14), ((x0 + x1) / 2, y0 - 0.008, z0 + (z1 - z0) * 0.25), stencil, latin=True, extrude=0.001)


def piece_case_stack(c):
    """Road cases stacked into a 4 x 3 x 4.5 block (scaled in height to the cover collider)."""
    wheel = mat('k_wheel', '#1d1c21')
    for x in (-1.0, 1.0):
        for y in (-1.2, 1.2):
            for dx in (-0.7, 0.7):
                cyl(c, 'caster', (x + dx, y, 0.0), (x + dx, y, 0.12), 0.07, n=8, m=wheel)
    _road_case(c, -1.98, -1.48, 0.12, -0.02, 1.48, 1.6, 'a')
    _road_case(c, 0.02, -1.48, 0.12, 1.98, 1.48, 1.6, 'b')
    _road_case(c, -1.98, -1.48, 1.62, 1.98, 1.48, 3.0, 'c')
    _road_case(c, -1.98, -1.48, 3.02, -0.08, 1.48, 4.5, 'd')
    _road_case(c, 0.08, -1.48, 3.02, 1.98, 1.48, 4.5, 'e')


def piece_barricade(c):
    """Crowd barrier (6 x 0.6 x 1.4): foot plate on the pit side, aluminium frame, brass-painted top rail."""
    alu = mat('k_alu', '#aeb2ba', rough=0.4)
    panel = mat('k_alu_panel', '#8f939c', rough=0.5)
    plate = mat('k_plate', '#585b63', rough=0.6)
    gold = mat('k_brass', '#b8914a', rough=0.4)
    box(c, 'foot', (-3.0, -0.3, 0.0), (3.0, 0.3, 0.035), plate)
    for k in range(7):
        x = -2.96 + k * (5.92 / 6)
        box(c, f'post{k}', (x - 0.04, 0.12, 0.035), (x + 0.04, 0.2, 1.3), alu)
        kit.beam(c, f'brace{k}', (x, 0.2, 1.0), (x, 0.29, 0.04), 0.05, alu)
    box(c, 'panel', (-3.0, 0.13, 0.08), (3.0, 0.17, 0.95), panel)
    kit.beam(c, 'mid', (-3.0, 0.16, 0.95), (3.0, 0.16, 0.95), 0.05, alu, n=8)
    kit.beam(c, 'top', (-3.0, 0.16, 1.33), (3.0, 0.16, 1.33), 0.1, gold, n=10)


def piece_drone_fan(c):
    """Ducted lift fan for the floating platforms (2 m wide, origin at the top, hangs below)."""
    duct = mat('k_duct', '#3b3a43', rough=0.5)
    disc = mat('k_blur', '#25242b', rough=0.9)
    led = mat('k_led_cyan', '#7fe6f0', emit=0.9)
    torus(c, 'duct', (0, 0, -0.32), 1.0, 0.13, n=24, k=6, m=duct)
    cyl(c, 'disc', (0, 0, -0.34), (0, 0, -0.3), 0.92, n=24, m=disc)
    cyl(c, 'hub', (0, 0, -0.5), (0, 0, -0.12), 0.18, 0.14, n=12, m=duct)
    box(c, 'mount', (-0.1, -0.1, -0.12), (0.1, 0.1, 0.0), duct)
    for k in range(3):
        a = k * math.tau / 3
        kit.beam(c, f'strut{k}', (0, 0, -0.32), (math.cos(a) * 0.96, math.sin(a) * 0.96, -0.32), 0.06, duct)
    for k in range(4):
        a = k * math.tau / 4 + math.pi / 4
        cyl(c, f'led{k}', (math.cos(a) * 1.0, math.sin(a) * 1.0, -0.47), (math.cos(a) * 1.0, math.sin(a) * 1.0, -0.44), 0.05, n=8, m=led)


def piece_light_cap(c):
    """Cap on the speaker towers (7.2 x 0.4 x 7.2): steel lid with a recessed warm LED line."""
    st = _steel()
    led = mat('k_led_warm', '#ffd48a', emit=0.9)
    box(c, 'lid', (-3.6, -3.6, 0.0), (3.6, 3.6, 0.3), st, bev=0.03)
    box(c, 'led', (-3.5, -3.62, 0.1), (3.5, -3.6, 0.18), led)
    for k in range(4):
        x = -2.7 + k * 1.8
        box(c, f'rig{k}', (x - 0.2, -0.2, 0.3), (x + 0.2, 0.2, 0.42), st)


PIECES = {
    'flood_head': piece_flood_head,
    'moving_head': piece_moving_head,
    'par_bar': piece_par_bar,
    'wedge': piece_wedge,
    'case_stack': piece_case_stack,
    'barricade': piece_barricade,
    'drone_fan': piece_drone_fan,
    'light_cap': piece_light_cap,
}


def build_kit(out_dir: str, export: bool = True, preview: bool = False) -> None:
    kit.build_kit(THEME, PIECES, out_dir, export=export, preview=preview)
