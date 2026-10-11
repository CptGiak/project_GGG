"""
Worked example, stage 1b: the "hand" pass on Zugzwang's head.

The SDF build (chess_master_head.py) gives the primary forms. Here the skin is sculpted with
brush strokes, the way a sculptor finishes a head in ZBrush: planes first (clay strips, flatten),
then the creases of age (crease, pinch), then polish (smooth) and pores. Every stroke is drawn
on an orthographic review view in millimetres, read off the grid of the previous render, and
is replayed from the base mesh on every run, so any stroke can be edited later.

Run (from this folder):
  python chess_master_sculpt.py --out <dir> --stage base      # base skin + context, grid renders
  python chess_master_sculpt.py --out <dir> --stage sculpt    # replay the strokes, clay renders
  python chess_master_sculpt.py --out <dir> --stage paint     # painted face renders (all head parts)
  python chess_master_sculpt.py --out <dir> --stage place --parts <body _parts dir>
                                                              # sculpted skin -> body part cache
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np  # noqa: E402

from charkit import sculpt as K  # noqa: E402
from charkit import sdf as S  # noqa: E402

import chess_master_head as H  # noqa: E402

HEAD_T = np.array((0.0, -0.112, 1.482))
HEAD_R = np.asarray(S.rot(9, 0, 0), np.float64)
HEAD_S = 1.3
VOXEL = 0.00065

# Orthographic views to draw strokes on. Stroke points are absolute (u, w) millimetres as the
# grid labels show them: front u = x, w = z; side (from +X) u = y, w = z.
VIEWS = {
    'front': K.View('front', 0, 0, (0.0, -0.05, -0.01), 0.115),
    'side': K.View('side', 90, 0, (0.0, -0.025, -0.01), 0.12),
    'q34': K.View('q34', 35, 4, (0.0, -0.04, -0.01), 0.115),
    'eye': K.View('eye', 12, 4, (0.034, -0.06, -0.004), 0.034),
    'ear': K.View('ear', 90, 0, (0.07, 0.012, -0.012), 0.04),
    'nose': K.View('nose', 30, 0, (0.0, -0.095, -0.03), 0.034),
    'brow': K.View('brow', 0, 22, (0.0, -0.075, 0.035), 0.06),
}

LANDMARKS = {
    'eye_L': (0.032, -0.0635, 0.0),
    'eye_R': (-0.032, -0.0635, 0.0),
    'nose_tip': (0.0, -0.117, -0.036),
    'ala_L': (0.0215, -0.094, -0.042),
    'glabella': (0.0, -0.0915, 0.016),
    'cheek_L': (0.06, -0.06, -0.018),
    'ear_L': (0.078, 0.012, -0.012),
    'chin': (0.0, -0.086, -0.102),
}


def to_world(v: np.ndarray) -> np.ndarray:
    return HEAD_T + (np.asarray(v, np.float64) * HEAD_S) @ HEAD_R.T


def to_local(v: np.ndarray) -> np.ndarray:
    return ((np.asarray(v, np.float64) - HEAD_T) @ HEAD_R) / HEAD_S


def base_skin_sdf() -> S.SDF:
    """The head-stage skin without its procedural wrinkles and pores: the hand pass replaces
    them."""
    orig = S.SDF.displace
    S.SDF.displace = lambda self, fn, amp: self
    try:
        return H.skin()
    finally:
        S.SDF.displace = orig


def context_parts(parts_dir: str) -> dict:
    """Beard, brows, eyes... from the body build's part cache, moved back to head-local."""
    out = {}
    for name in ('eyes', 'brows', 'beard', 'moustache', 'side_hair', 'cap'):
        p = os.path.join(parts_dir, f'{name}.npz')
        if os.path.exists(p):
            z = np.load(p)
            out[name] = (to_local(z['v']).astype(np.float32), z['f'], z['c'])
    return out


# =============================================================================================
# The strokes. Points are (u, w) millimetres on the named view; `mirror` repeats on the other
# side. Negative strength cuts in. Order matters, as with a real sculpt: big to small.
# =============================================================================================

def offset_line(pts, d: float) -> list:
    """Shifts a 2D polyline sideways by d (mm): positive = to the left of the drawing direction."""
    P = np.asarray(pts, np.float64)
    t = np.gradient(P, axis=0)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
    nrm = np.stack([-t[:, 1], t[:, 0]], axis=1)
    return (P + nrm * d).tolist()


def on(view: str, brush: str, pts, name: str = '', **kw) -> K.Stroke:
    """A stroke drawn on `view` at absolute (u, w) mm, with the Blender preset of `brush`."""
    return K.Stroke(brush, [list(p) for p in pts], name=f'@{view}:{name}', **K.preset(brush, **kw))


def wrinkle(view: str, pts, r: float, depth: float, roll: float = 0.35, side: float = 1.0, name: str = '',
            mirror: bool = True, pinch: float = 0.5) -> list:
    """A sculptor's wrinkle: a crease along the line, relaxed so the pinched triangles even out,
    a soft roll of skin on the overhanging side, a smoothed lower side, and a light polish."""
    r_m = r / 1000.0
    out = [on(view, 'crease', pts, name, radius=r_m, strength=-depth, mirror=mirror, pinch=pinch),
           on(view, 'relax', pts, name + ' relax', radius=1.6 * r_m, strength=0.6, mirror=mirror)]
    if roll > 0:
        out.append(on(view, 'clay_strips', offset_line(pts, side * 1.6 * r), name + ' +roll', radius=2.2 * r_m,
                      strength=roll, mirror=mirror))
        out.append(on(view, 'smooth', offset_line(pts, -side * 1.5 * r), name + ' -soft', radius=2 * r_m,
                      strength=0.3, mirror=mirror))
    out.append(on(view, 'smooth', pts, name + ' polish', radius=r_m, strength=0.12, mirror=mirror))
    return out


def strokes() -> list:
    out = []
    # --- eye (on the 'eye' view; the other eye is the mirror) ---------------------------------
    # hooded upper lid: fold line ~3 mm above the lid margin, drooping at the outer corner
    out += wrinkle('eye', [(7, -2.5), (11, 1.5), (16, 3.0), (21, 3.3), (26, 2.2), (30, 0.0), (33.5, -2.5)],
                   r=1.7, depth=0.6, roll=0.35, pinch=0.45, name='upper lid fold')
    # lower lid margin and the bag below it (tear trough running into the festoon)
    out += wrinkle('eye', [(6, -11), (11, -16), (18, -19.5), (25, -20), (31, -18), (36, -14)],
                   r=2.2, depth=0.6, roll=0.4, name='eye bag')
    out.append(on('eye', 'crease', [(5, -6.5), (3, -9.5)], 'inner corner', radius=0.0011, strength=-0.3, pinch=0.3))
    # crow's feet fanning out of the outer corner
    for k, line in enumerate([[(35.5, 0.5), (39.5, 3.0), (44, 4.5)],
                              [(36, -3.5), (40.5, -4.2), (45, -5.0)],
                              [(35.5, -7.0), (39, -9.5), (42.5, -12.5)]]):
        out += wrinkle('eye', line, r=1.2, depth=0.35, roll=0.15, pinch=0.4, name=f'crow {k}')
    # --- nose (front view: u = x, w = z) -------------------------------------------------------
    out.append(on('front', 'trim', [(0, 7), (0, -8), (0, -22)], 'bridge top plane', radius=0.004, strength=0.6,
                  mirror=False))
    out.append(on('front', 'trim', [(6.5, 4), (7.5, -8), (9, -20)], 'bridge side plane', radius=0.0035, strength=0.5))
    out += wrinkle('front', [(13, -29), (19, -31), (23.5, -36), (24, -42), (21.5, -47)], r=1.6, depth=0.5,
                   roll=0.0, name='alar crease')
    # --- glabella: frown lines and the procerus line --------------------------------------------
    out += wrinkle('front', [(4.5, 27), (4.2, 20), (3.8, 13)], r=1.5, depth=0.6, roll=0.25, name='frown 11')
    out += wrinkle('front', [(-7, 7), (0, 7.8), (7, 7)], r=1.4, depth=0.35, roll=0.0, name='procerus', mirror=False)
    # --- cheek: malar fat over the nasolabial fold --------------------------------------------
    out.append(on('front', 'clay_strips', [(21, -26), (26, -33), (31, -43)], 'malar fat', radius=0.005, strength=0.35))
    out += wrinkle('front', [(24, -38), (28, -46), (32, -55), (34.5, -62)], r=2.8, depth=0.8, roll=0.5,
                   name='nasolabial')
    # --- forehead: two long lines and a broken short one, not mirrored (age is asymmetric) ----
    out += wrinkle('front', [(-42, 35.5), (-25, 38.5), (-10, 39.5), (5, 39), (20, 38.5), (35, 37), (46, 34)],
                   r=2.0, depth=0.75, roll=0.45, name='forehead 1', mirror=False)
    out += wrinkle('front', [(-36, 44.5), (-20, 46.5), (-5, 47.5), (8, 46.5), (22, 47), (39, 45)],
                   r=1.9, depth=0.65, roll=0.4, name='forehead 2', mirror=False)
    out += wrinkle('front', [(-22, 31.5), (-12, 32.8), (-3, 33)], r=1.5, depth=0.5, roll=0.3, name='forehead 3a',
                   mirror=False)
    out += wrinkle('front', [(10, 32.5), (22, 31.5), (30, 30)], r=1.5, depth=0.5, roll=0.3, name='forehead 3b',
                   mirror=False)
    # --- side planes: flat temple, cheekbone ridge and the plane change below it (side view) ---
    out.append(on('side', 'trim', [(-48, 22), (-36, 24), (-24, 26)], 'temple plane', radius=0.009, strength=0.5))
    out.append(on('side', 'clay_strips', [(-62, -13), (-50, -11), (-38, -9.5), (-26, -9)], 'cheekbone',
                  radius=0.005, strength=0.45))
    out += wrinkle('side', [(-60, -20), (-45, -18), (-32, -16)], r=3.0, depth=0.4, roll=0.0, name='under cheekbone')
    # the SDF carved a deep hollow under the cheekbone; an old cheek sags instead: fill it
    # half way and let it hang (fill only lifts what lies below the local plane)
    out.append(on('side', 'fill', [(-58, -32), (-47, -37), (-36, -40)], 'cheek sag', radius=0.012, strength=0.7))
    out.append(on('side', 'clay', [(-54, -30), (-44, -33)], 'cheek fat', radius=0.009, strength=0.35))
    out.append(on('side', 'smooth', [(-58, -32), (-47, -37), (-36, -40)], 'cheek polish', radius=0.012, strength=0.4))
    # --- ear (side view): the ear is a thin plate, so only shallow moves: helix rim, antihelix,
    # a shallow concha, a fuller lobe -----------------------------------------------------------
    out += wrinkle('ear', [(1, 11), (7, 15.5), (14, 16.5), (21, 13.5), (25.5, 6), (27, -4), (26, -14), (23, -23),
                           (18.5, -31), (14, -36)], r=2.0, depth=0.55, roll=0.4, pinch=0.4, name='helix rim')
    out.append(on('ear', 'clay_strips', [(16, -30), (20, -20), (21.5, -9), (20, 1), (16.5, 7.5), (10.5, 10)],
                  'antihelix', radius=0.0026, strength=0.4))
    out.append(on('ear', 'draw', [(8, -10), (10, -18)], 'concha', radius=0.007, strength=-0.2))
    out.append(on('ear', 'inflate', [(12, -42)], 'lobe', radius=0.005, strength=0.3))
    return out


# =============================================================================================

def resolve(sc: K.Sculpt, st: K.Stroke) -> K.Stroke:
    """Strokes drawn on a view: ray-cast their (u, w) mm points onto the current surface."""
    if not st.name.startswith('@'):
        return st
    view = VIEWS[st.name[1:].split(':')[0]]
    uw = view.absolute(np.asarray(st.points, np.float64) / 1000.0)
    pts = sc.on_view(view, uw)
    right, up, fwd = view.basis()
    return K.Stroke(**{**st.__dict__, 'points': pts.tolist(), 'view': tuple(-fwd) if st.view is None else st.view})


def apply_strokes(sc: K.Sculpt, items: list, verbose: bool = True):
    t0 = time.time()
    for i, st in enumerate(items):
        t = time.time()
        sc.stroke(resolve(sc, st))
        if verbose:
            print(f'  {i:3d} {st.brush:11s} {st.name:28s} {time.time() - t:5.2f}s', flush=True)
    print(f'{len(items)} strokes in {time.time() - t0:.1f}s', flush=True)


def pores(v: np.ndarray, n: np.ndarray, amp: float = 0.00012) -> np.ndarray:
    """Tertiary detail: fine pores and skin grain along the normal (the last thing a sculptor
    adds, with a noise alpha)."""
    g = S.fbm(v.astype(np.float32), 260, 3, seed=11).astype(np.float64)
    return v + n * (g * amp)[:, None]


def eyes_only(ctx: dict) -> list:
    return [(ctx['eyes'][0], ctx['eyes'][1], '#e8e4dc')] if 'eyes' in ctx else []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--stage', required=True, choices=['base', 'sculpt', 'paint', 'place'])
    ap.add_argument('--parts', default='', help='body build _parts folder (context parts, and the target of --stage place)')
    ap.add_argument('--views', default='front,side,q34')
    ap.add_argument('--size', type=int, default=1000)
    ap.add_argument('--samples', type=int, default=20)
    ap.add_argument('--tag', default='s1')
    ap.add_argument('--upto', type=int, default=-1, help='replay only the first N strokes')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    base_path = os.path.join(a.out, 'base_skin.npz')
    sculpt_path = os.path.join(a.out, f'sculpt_{a.tag}.npz')
    views = [VIEWS[n] for n in a.views.split(',') if n]

    if a.stage == 'base':
        t = time.time()
        if os.path.exists(base_path):
            z = np.load(base_path)
            v, f = z['v'], z['f']
        else:
            v, f = S.mesh(base_skin_sdf(), voxel=VOXEL)
            np.savez(base_path, v=v, f=f.astype(np.int32))
        print(f'base skin: {len(v)} verts, {len(f)} tris in {time.time() - t:.0f}s', flush=True)
        ctx = context_parts(a.parts)
        K.review(v, f, views, a.out, 'base', size=a.size, samples=a.samples, landmarks=LANDMARKS, extra=eyes_only(ctx))
        hexes = {'eyes': '#e8e4dc', 'brows': '#4a5a8a', 'beard': '#4a5a8a', 'moustache': '#4a5a8a',
                 'side_hair': '#4a5a8a', 'cap': '#3a3f50'}
        K.review(v, f, views, a.out, 'base_ctx', size=a.size, samples=a.samples, landmarks=LANDMARKS,
                 extra=[(pv, pf, hexes[n]) for n, (pv, pf, _) in ctx.items()])
        return

    if a.stage == 'sculpt':
        z = np.load(base_path)
        sc = K.Sculpt(z['v'], z['f'])
        items = strokes()
        if a.upto >= 0:
            items = items[:a.upto]
        apply_strokes(sc, items)
        sc.save(sculpt_path)
        K.review(sc.v, sc.f, views, a.out, a.tag, size=a.size, samples=a.samples, landmarks=LANDMARKS,
                 extra=eyes_only(context_parts(a.parts)))
        return

    if a.stage == 'paint':
        paint_and_render(a, sculpt_path, views)
        return

    if a.stage == 'place':
        place(a, sculpt_path)


def painted_skin(sculpt_path: str) -> tuple:
    from charkit import paint as P

    z = np.load(sculpt_path)
    v, f = z['v'].astype(np.float64), z['f'].astype(np.int64)
    n = K.vertex_normals(v, f)
    v = pores(v, n)
    n = K.vertex_normals(v, f)
    lk = H.looks()['skin']
    shape = K.mesh_sdf(v, f, n)
    col = P.paint(v.astype(np.float32), n.astype(np.float32), shape, lk)
    # fine cavity from the sculpted creases (the SDF curvature in paint() is too coarse for them)
    # broad enough that a crease paints as a soft valley, not as a pen line
    cav = K.cavity(v, f, n, iters=10)
    cav = cav / (np.percentile(np.abs(cav), 99) + 1e-9)
    dark = np.clip(cav, 0, 1)[:, None] ** 1.3
    lite = np.clip(-cav, 0, 1)[:, None]
    tint = P.to_lin(P.hex_rgb('#6e231f'))
    col = col * (1 - 0.3 * dark) + (col * tint * 1.4 - col) * (0.12 * dark)
    col = col * (1 + 0.15 * lite)
    return v.astype(np.float32), f.astype(np.int32), np.clip(col, 0, 1).astype(np.float32)


def paint_and_render(a, sculpt_path: str, views):
    """Face renders with every head part, like chess_master_head.py --face (perspective)."""
    from charkit import studio as ST

    v, f, col = painted_skin(sculpt_path)
    np.savez(os.path.join(a.out, f'skin_painted_{a.tag}.npz'), v=v, f=f, c=col)
    ST.reset()
    objs = []
    ob = ST.mesh_from_arrays('skin', v, f)
    ST.set_vertex_colors(ob, col)
    ST.assign(ob, ST.principled('skin', '#ffffff', rough=0.55, sss=0.12, attr='Col', sss_radius=(1.0, 0.4, 0.25)))
    objs.append(ob)
    rough = {'eyes': 0.12, 'cap': 0.85}
    for name, (pv, pf, pc) in context_parts(a.parts).items():
        if name == 'eyes':      # the body cache looks at the case; the face sheet looks at us
            from charkit import paint as P
            pc = P.eye_colors(pv, [(0.032, -0.051, 0.0), (-0.032, -0.051, 0.0)],
                              [(0.08, -1, -0.12), (-0.03, -1, -0.12)], 0.0125)
        o = ST.mesh_from_arrays(name, pv, pf)
        ST.set_vertex_colors(o, pc)
        ST.assign(o, ST.principled(name, '#ffffff', rough=rough.get(name, 0.7), attr='Col'))
        objs.append(o)
    fr, ln = H.glasses()
    for nm, shp in (('glasses_frame', fr), ('glasses_lens', ln)):
        gv, gf = S.mesh(shp, voxel=0.0004)
        o = ST.mesh_from_arrays(nm, gv, gf)
        if nm == 'glasses_frame':
            ST.assign(o, ST.principled('metal', '#c9a45c', rough=0.3, metal=1.0))
        else:
            m = ST.principled('glass', '#ffffff', rough=0.05)
            m.node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 1.0
            ST.assign(o, m)
        objs.append(o)
    # the same framing as chess_master_head.py --face, for before/after sheets
    box = (np.array([-0.09, -0.13, -0.075]), np.array([0.09, 0.0, 0.06]))
    paths = ST.review(objs, a.out, f'face_{a.tag}', views=['front', 'three_quarter', 'side'], clay=False,
                      width=760, height=760, samples=max(a.samples, 32), lens=100, box=box)
    ST.sheet(paths, os.path.join(a.out, f'face_{a.tag}_sheet.png'), labels=['front', '3/4', 'side'],
             title=f'Zugzwang sculpt {a.tag}', cell_h=640)


def place(a, sculpt_path: str):
    """Writes the painted sculpted skin, in world space, into a body part cache folder."""
    z = np.load(os.path.join(a.out, f'skin_painted_{a.tag}.npz'))
    v = to_world(z['v']).astype(np.float32)
    dst = os.path.join(a.parts, 'skin.npz')
    if os.path.exists(dst):
        os.remove(dst)          # never write through a hard-linked copy of another cache
    np.savez(dst, v=v, f=z['f'], c=z['c'])
    print('skin.npz written to', a.parts)


if __name__ == '__main__':
    main()
