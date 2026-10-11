"""
Worked example, stage 2b: cloth folds on Zugzwang's coat with the sculpt brushes.

A heavy wool coat hanging from the shoulders and flaring to the knees folds in a few predictable
ways (the fold types of Hogarth and Bridgman): pipe folds on the skirt, hanging from the waist and
widening to the hem; drag folds from the armpits; compression folds at the inner elbows and the
cuffs; gathered folds above and below the half-belt at the back.

The pipes are procedural (an even rhythm with irregular spacing and depth: the "superhuman" part,
cheap to tune), the rest are brush strokes drawn on orthographic full-body views in world mm.

Run (from this folder):
  python chess_master_folds.py --parts <body _parts dir> --out <dir> [--views front,side,back]
writes <out>/coat_folds.npz (world space, painted) and clay review renders.
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

import chess_master_body as B  # noqa: E402

VIEWS = {
    'front': K.View('front', 0, 0, (0.0, 0.0, 0.8), 0.62),
    'side': K.View('side', 90, 0, (0.0, 0.0, 0.8), 0.62),
    'back': K.View('back', 180, 0, (0.0, 0.0, 0.8), 0.62),
    'q34': K.View('q34', 35, 4, (0.0, 0.0, 0.8), 0.62),
    'skirt': K.View('skirt', 0, 0, (0.0, 0.0, 0.6), 0.32),
    'arm': K.View('arm', 0, 0, (0.36, 0.0, 1.05), 0.2),
}


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def skirt_pipes(v: np.ndarray, n: np.ndarray, count: int = 8, depth: float = 0.026, seed: int = 2) -> np.ndarray:
    """Pipe folds: tubes hanging from the waist, deeper and wider toward the hem. Rounded ridges,
    narrow valleys, irregular spacing and depth, a little drift with height. The skirt is a shell,
    so both of its surfaces move along the same radial direction (along their own normals they
    would move apart in the valleys and cross)."""
    sleeves = B.sleeves_shape()
    away = smoothstep(0.0, 0.03, sleeves(v.astype(np.float32)).astype(np.float64))   # 0 on the sleeves
    t = smoothstep(0.86, 0.36, v[:, 2])                                                # 0 waist .. 1 hem
    phi = np.arctan2(v[:, 0], v[:, 1] - 0.012)
    rng = np.random.RandomState(seed)
    a1, a2 = rng.uniform(0, 2 * np.pi, 2)
    phase = count * phi + 0.9 * np.sin(2 * phi + a1) + 0.5 * np.sin(3 * phi + a2) + 1.2 * (0.86 - v[:, 2])
    f = 0.5 + 0.5 * np.cos(phase)
    profile = 2 * f ** 0.55 - 1                     # wide rounded ridges, sharp valleys
    amp = depth * t ** 1.3 * (0.65 + 0.35 * np.sin(3 * phi + a2)) * away
    radial = np.stack([v[:, 0], v[:, 1] - 0.012, np.zeros(len(v))], axis=1)
    radial /= np.maximum(np.linalg.norm(radial, axis=1, keepdims=True), 1e-9)
    return v + radial * (amp * profile)[:, None]


def strokes() -> list:
    def on(view, brush, pts, name, **kw):
        return K.Stroke(brush, [list(p) for p in pts], name=f'@{view}:{name}', **K.preset(brush, **kw))

    out = []

    def fold(view, pts, name, r, depth, pinch=0.5, mirror=True):
        out.append(on(view, 'crease', pts, name, radius=r, strength=-depth, pinch=pinch, mirror=mirror,
                      spacing=0.12))
        out.append(on(view, 'relax', pts, name + ' relax', radius=1.6 * r, strength=0.6, mirror=mirror))

    # drag folds from the armpit across the chest side (front view: u = x, w = z, mm)
    for k, (a, b) in enumerate([((150, 1215), (95, 1110)), ((165, 1185), (120, 1060)), ((172, 1150), (140, 1010))]):
        fold('front', [a, ((a[0] + b[0]) / 2 + 6, (a[1] + b[1]) / 2), b], f'armpit drag {k}', 0.011, 0.5)
    # compression folds across the inner elbow, perpendicular to the arm, curving toward the
    # shoulder (arm view = front view of the left arm: u = x, w = z; mirrored to the right arm)
    axis = np.array([0.665, -0.747])            # elbow -> wrist in (x, z)
    perp = np.array([0.747, 0.665])
    elbow = np.array([335.0, 1100.0])
    for k, d in enumerate((-28.0, 0.0, 28.0)):
        c = elbow + axis * d
        a, b = c - perp * 30, c + perp * 30
        m = c - axis * 6
        fold('arm', [a, m, b], f'elbow {k}', 0.009, 0.6)
        out.append(on('arm', 'clay_strips', [a - axis * 9, m - axis * 9, b - axis * 9], f'elbow roll {k}',
                      radius=0.011, strength=0.35))
    # cuff bunching: two soft rings above the cuff
    for k, tt in enumerate((0.58, 0.68)):
        c = elbow + axis * (tt * 248.0)
        fold('arm', [c - perp * 27, c - axis * 4, c + perp * 27], f'cuff {k}', 0.008, 0.5)
    # back: gathers fanning up from the half-belt (z 0.91-0.95), back view u = -x
    for k, x in enumerate([-90, -45, 0, 45, 90]):
        fold('back', [(x * 0.55, 965), (x * 0.8, 1010), (x * 1.05, 1065)], f'belt gather {k}', 0.01, 0.5,
             mirror=False)
    return out


def resolve(sc: K.Sculpt, st: K.Stroke) -> K.Stroke:
    if not st.name.startswith('@'):
        return st
    view = VIEWS[st.name[1:].split(':')[0]]
    uw = view.absolute(np.asarray(st.points, np.float64) / 1000.0)
    pts = sc.on_view(view, uw)
    return K.Stroke(**{**st.__dict__, 'points': pts.tolist(), 'view': tuple(-view.basis()[2])})


def painted(v: np.ndarray, f: np.ndarray) -> np.ndarray:
    from charkit import paint as P

    n = K.vertex_normals(v, f)
    lk = B.looks()['coat']
    col = P.paint(v.astype(np.float32), n.astype(np.float32), K.mesh_sdf(v, f, n), lk)
    cav = K.cavity(v, f, n, iters=6)
    cav = cav / (np.percentile(np.abs(cav), 98) + 1e-9)
    col = col * (1 - 0.4 * np.clip(cav, 0, 1)[:, None]) * (1 + 0.22 * np.clip(-cav, 0, 1)[:, None])
    return np.clip(col, 0, 1).astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--parts', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--views', default='front,side,back')
    ap.add_argument('--size', type=int, default=900)
    ap.add_argument('--samples', type=int, default=16)
    ap.add_argument('--no-strokes', action='store_true')
    ap.add_argument('--tag', default='f1')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    z = np.load(os.path.join(a.parts, 'coat.npz'))
    v, f = z['v'].astype(np.float64), z['f'].astype(np.int64)
    t = time.time()
    n = K.vertex_normals(v, f)
    v = skirt_pipes(v, n)
    sc = K.Sculpt(v, f)
    print(f'pipes + init {time.time() - t:.1f}s', flush=True)
    if not a.no_strokes:
        for st in strokes():
            t = time.time()
            sc.stroke(resolve(sc, st))
            print(f'  {st.brush:11s} {st.name:24s} {time.time() - t:5.2f}s', flush=True)
    col = painted(sc.v, sc.f)
    np.savez(os.path.join(a.out, f'coat_{a.tag}.npz'), v=sc.v.astype(np.float32), f=sc.f.astype(np.int32), c=col)
    views = [VIEWS[k] for k in a.views.split(',') if k]
    K.review(sc.v, sc.f, views, a.out, f'coat_{a.tag}', size=a.size, samples=a.samples, grid_mm=50)


if __name__ == '__main__':
    main()
