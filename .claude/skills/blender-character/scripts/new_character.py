"""
Template for a new character. Copy it next to your work (not into the skill), rename, fill in
the part functions and `LOOKS`, then iterate:

  PY=/root/blender-venv/bin/python
  $PY my_char.py --out renders --iter v1 --fast --clay          # blockout: ~1 minute
  $PY my_char.py --out renders --iter v2 --face --fast --clay   # face close-up
  $PY my_char.py --out renders --iter v3                         # full resolution + paint
  $PY my_char.py --out renders --iter v4 --rebuild coat,hands   # only the parts you changed

Every run writes <out>/<name>_<iter>_sheet.png (views + silhouette row) and a .blend that
the rig/animation stage loads (see examples/chess_master_anim.py).
Axes: X = character's left, -Y = front, Z = up, metres, feet on z = 0, A-pose.
"""
from __future__ import annotations

import argparse
import os
import sys

def _find_charkit() -> str:
    """$CHARKIT, else the first `.claude/skills/blender-character/scripts` found walking up from
    this file or the working directory (works wherever the template is copied in the repo)."""
    if os.environ.get('CHARKIT'):
        return os.environ['CHARKIT']
    for start in (os.path.dirname(os.path.abspath(__file__)), os.getcwd()):
        d = start
        while True:
            for cand in (os.path.join(d, '.claude', 'skills', 'blender-character', 'scripts'), d):
                if os.path.isdir(os.path.join(cand, 'charkit')):
                    return cand
            if os.path.dirname(d) == d:
                break
            d = os.path.dirname(d)
    raise SystemExit('charkit not found: set CHARKIT=<repo>/.claude/skills/blender-character/scripts')


sys.path.insert(0, _find_charkit())

import numpy as np  # noqa: E402

from charkit import sdf as S  # noqa: E402
from charkit.paint import Look, Zone  # noqa: E402

E, RC = S.ellipsoid, S.round_cone
NAME = 'my_character'

# ---------------------------------------------------------------------------------------------
# 1. Landmarks: the single source of truth for modelling, rig and animation
# ---------------------------------------------------------------------------------------------
J = {
    'hips': (0.0, 0.02, 0.92), 'spine': (0.0, 0.03, 1.04), 'chest': (0.0, 0.03, 1.22),
    'neck': (0.0, 0.0, 1.42), 'head': (0.0, -0.01, 1.5),
    'shoulder_L': (0.18, 0.01, 1.4), 'elbow_L': (0.355, 0.03, 1.2), 'wrist_L': (0.53, -0.01, 1.02),   # wide A-pose (~42°)
    'thigh_L': (0.09, 0.02, 0.9), 'knee_L': (0.1, -0.01, 0.5), 'ankle_L': (0.11, 0.03, 0.08),
}
for k in list(J):
    if k.endswith('_L'):
        x, y, z = J[k]
        J[k[:-2] + '_R'] = (-x, y, z)
HEAD_T = (0.0, -0.02, 1.6)   # head-local origin (eye line centre) in world space
HEAD_R = S.rot(0, 0, 0)
HEAD_S = 1.0                 # caricature: 1.2 to 1.35 for a big-headed hero


def j(name):
    return np.array(J[name], np.float32)


# ---------------------------------------------------------------------------------------------
# 2. Parts: each returns an SDF. Head parts are modelled in head-local space (eye line z = 0)
# ---------------------------------------------------------------------------------------------

def head_skin() -> S.SDF:
    cranium = E((0, 0.012, 0.03), (0.074, 0.097, 0.087))
    face = E((0, -0.033, -0.032), (0.058, 0.06, 0.062))
    jaw = S.tube([(0.057, 0.006, -0.058), (0.04, -0.035, -0.09), (0.017, -0.063, -0.104)], 0.013).mirror_x()
    neck = RC((0, 0.014, -0.05), (0, 0.026, -0.17), 0.047, 0.05)
    head = S.blend(cranium, face, jaw, neck, k=0.018)
    # eyes, nose, ears, mouth: see references/sdf-recipes.md and examples/chess_master_head.py
    return head


def torso() -> S.SDF:
    chest = E((0, 0.0, 1.25), (0.16, 0.11, 0.15))
    belly = E((0, -0.01, 1.08), (0.145, 0.105, 0.12))
    pelvis = E((0, 0.02, 0.95), (0.16, 0.11, 0.1))
    shoulders = S.sphere(j('shoulder_L'), 0.055).mirror_x()
    neck = RC(j('chest') + np.array([0, 0, 0.15], np.float32), j('head'), 0.05, 0.045)
    return S.blend(chest, belly, pelvis, shoulders, neck, k=0.06)


def arms() -> S.SDF:
    return S.smooth_tube([j('shoulder_L'), j('elbow_L'), j('wrist_L')], [0.05, 0.042, 0.035], samples=4).mirror_x()


def legs() -> S.SDF:
    return S.smooth_tube([j('thigh_L'), j('knee_L'), j('ankle_L')], [0.075, 0.055, 0.045], samples=4).mirror_x()


def head_world(fn):
    return lambda: S.place(fn(), t=HEAD_T, R=HEAD_R, s=HEAD_S)


# name: (builder, voxel_m, roughness, subsurface, metallic)
PARTS = {
    'skin': (head_world(head_skin), 0.0009, 0.55, 0.12, 0.0),
    'torso': (torso, 0.003, 0.85, 0.0, 0.0),
    'arms': (arms, 0.0025, 0.85, 0.0, 0.0),
    'legs': (legs, 0.003, 0.85, 0.0, 0.0),
}

# ---------------------------------------------------------------------------------------------
# 3. Paint: one Look per part (references/materials.md)
# ---------------------------------------------------------------------------------------------
LOOKS = {
    'skin': Look('#d7a184', ao_step=0.007, ao_tint='#6e231f', cavity=0.6, edge=0.35, top_light=0.3),
    'torso': Look('#4b4535', ao_step=0.015, ao_tint='#2a2018', curv_scale=0.012),
    'arms': Look('#4b4535', ao_step=0.015, ao_tint='#2a2018', curv_scale=0.012),
    'legs': Look('#3c3c42', ao_step=0.015, ao_tint='#141420', curv_scale=0.012),
}


# ---------------------------------------------------------------------------------------------
# 4. Build + review
# ---------------------------------------------------------------------------------------------

def build(out, tag, clay=False, fast=False, face=False, rebuild=None, samples=32):
    import time

    import bpy
    from charkit import paint as Pt
    from charkit import studio as ST

    ST.reset()
    objs = []
    cache = os.path.join(out, '_parts')
    os.makedirs(cache, exist_ok=True)
    for name, (fn, vox, rough, sss, metal) in PARTS.items():
        t0 = time.time()
        cpath = os.path.join(cache, f'{name}.npz')
        if rebuild is not None and name not in rebuild and os.path.exists(cpath) and not (clay or fast):
            z = np.load(cpath)
            v, f, col = z['v'], z['f'], z['c']
        else:
            shape = fn()
            v, f = S.mesh(shape, voxel=vox * (2 if fast else 1))
            col = None if clay else Pt.paint(v, Pt.mesh_normals(v, f), shape, LOOKS[name])
            if col is not None and not fast:
                np.savez(cpath, v=v, f=f.astype(np.int32), c=col)
        ob = ST.mesh_from_arrays(name, v, f)
        if col is not None:
            ST.set_vertex_colors(ob, col)
            ST.assign(ob, ST.principled(name, '#ffffff', rough=rough, sss=sss, metal=metal, attr='Col'))
        objs.append(ob)
        print(f'{name}: {len(f)} tris {time.time() - t0:.1f}s', flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(out, f'{NAME}_{tag}.blend')))
    if face:
        c = np.array(HEAD_T, np.float32)
        box = (c + np.array([-0.09, -0.13, -0.075]) * HEAD_S, c + np.array([0.09, 0.0, 0.06]) * HEAD_S)
        paths = ST.review(objs, out, f'{NAME}_{tag}_face', views=['front', 'three_quarter', 'side'], clay=clay,
                          width=760, height=760, samples=samples, lens=100, box=box)
        return ST.sheet(paths, os.path.join(out, f'{NAME}_{tag}_face_sheet.png'), labels=['front', '3/4', 'side'], cell_h=640)
    paths = ST.review(objs, out, f'{NAME}_{tag}', views=['front', 'three_quarter', 'side', 'back'], clay=clay,
                      width=720, height=1000, samples=samples, lens=60)
    return ST.sheet(paths, os.path.join(out, f'{NAME}_{tag}_sheet.png'), labels=['front', '3/4', 'side', 'back'],
                    title=f'{NAME} {tag}', cell_h=640, silhouettes=True)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--iter', default='v1')
    ap.add_argument('--clay', action='store_true')
    ap.add_argument('--fast', action='store_true')
    ap.add_argument('--face', action='store_true')
    ap.add_argument('--rebuild', default=None)
    ap.add_argument('--samples', type=int, default=32)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rb = None if a.rebuild is None else [s for s in a.rebuild.split(',') if s]
    print(build(a.out, a.iter, a.clay, a.fast, a.face, rb, a.samples))
