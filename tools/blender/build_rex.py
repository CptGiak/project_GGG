"""
REX — The Headliner, rebuilt with the blender-character skill: SDF sculpting (charkit/sdf.py),
then the hand pass (charkit/sculpt.py), then the game skeleton, weights and a GLB like
build_kaiser.py.

  PY=/root/blender-venv/bin/python
  $PY tools/blender/build_rex.py --out <dir> --stage parts [--rebuild hoodie,head]   # meshes + renders
  $PY tools/blender/build_rex.py --out <dir> --stage sculpt                          # hand pass + renders
  $PY tools/blender/build_rex.py --out <dir> --stage export --glb <file.glb>         # rig + GLB

Modelled in T-pose on the 'heavy' body spec of src/fighter/Rig.ts (Blender axes: X = the
character's left, -Y = front, Z = up, metres). Every part has one flat material named like the
procedural model's (src/champions/rex.ts): the game's toon shader lights them, as for Kaiser.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, '.claude', 'skills', 'blender-character', 'scripts'))
sys.path.insert(0, os.path.join(ROOT, '.claude', 'skills', 'blender-character', 'scripts', 'examples'))

import numpy as np  # noqa: E402

from charkit import sdf as S  # noqa: E402

E = S.ellipsoid
RC = S.round_cone
F32 = np.float32

# =============================================================================================
# Skeleton: bodySpec('heavy') of src/fighter/Rig.ts, joints with the same formula as
# bl_kit.game_joints (T-pose: arms along +-X)
# =============================================================================================

SPEC = {
    'hipHeight': 0.99, 'spineLen': 0.11, 'chestLen': 0.18, 'neckLen': 0.19, 'clavicle': 0.205,
    'shoulderDrop': 0.15, 'upperArm': 0.29, 'foreArm': 0.27, 'hipWidth': 0.105, 'thigh': 0.44,
    'shin': 0.44, 'footHeight': 0.08, 'bulk': 1.12, 'female': False,
}


def joints(spec=SPEC) -> dict:
    s = spec
    leg = 0.045 + s['thigh'] + s['shin'] + s['footHeight']
    hips = np.array([0.0, 0.0, leg])
    spine = hips + [0, 0.005, s['spineLen']]
    chest = spine + [0, 0.0, s['chestLen']]
    neck = chest + [0, 0.01, s['shoulderDrop'] + 0.045]
    head = neck + [0, -0.012, s['neckLen'] - 0.11]
    J = {'hips': hips, 'spine': spine, 'chest': chest, 'neck': neck, 'head': head}
    for sx, side in ((1, 'L'), (-1, 'R')):
        sh = chest + [sx * 0.035, 0.01, s['shoulderDrop']]
        ua = sh + [sx * (s['clavicle'] - 0.035), 0, -0.01]
        fa = ua + [sx * s['upperArm'], 0, 0]
        hd = fa + [sx * s['foreArm'], 0, 0]
        th = hips + [sx * s['hipWidth'], 0, -0.045]
        sn = th + [0, 0, -s['thigh']]
        ft = sn + [0, 0, -s['shin']]
        J.update({f'shoulder{side}': sh, f'upperArm{side}': ua, f'foreArm{side}': fa, f'hand{side}': hd,
                  f'thigh{side}': th, f'shin{side}': sn, f'foot{side}': ft})
    return {k: v.astype(F32) for k, v in J.items()}


J = joints()
ARM_Z = float(J['upperArmL'][2])
ARM_Y = float(J['upperArmL'][1])
HEAD_T = np.array([0.0, -0.006, 1.684], F32)     # head-local origin: eye line, centre


def j(name):
    return J[name]


def at(x, y, z):
    return np.array([x, y, z], F32)


def arm_pt(x, dy=0.0, dz=0.0, side=1):
    """Point on the left arm axis at distance x from the body centre (mirror with side=-1)."""
    return at(side * x, ARM_Y + dy, ARM_Z + dz)


# =============================================================================================
# Palette: the procedural model's colours (src/champions/rex.ts)
# =============================================================================================

PALETTE = {
    'skin': '#b47a56', 'hair': '#1c1a24', 'teal': '#2ad6c8', 'hoodie': '#5b2fb4', 'tee': '#1c1b22',
    'pants': '#2c2a36', 'pocket': '#24222c', 'shoe': '#f3f0e8', 'sole': '#f3c24f', 'glove': '#17161d',
    'gold': '#f3c24f', 'black': '#16141c', 'gear': '#1d1c26', 'neon': '#a46bff', 'lens': '#a46bff',
}

# =============================================================================================
# Head (head-local: eye line at z = 0, front = -Y)
# =============================================================================================


def ear() -> S.SDF:
    """Right/left ear in its own frame: X = outwards, -Y = towards the face, Z = up."""
    base = E((0.004, 0.0, 0.0), (0.0055, 0.016, 0.028))
    helix = S.intersect(S.torus((0.006, 0.002, 0.004), 0.0148, 0.0037, R=S.rot(0, 90, 0), sx=1.0, sy=0.62),
                        S.plane((0, -0.004, 0), (0, -1, 0)), k=0.0035)
    lobe = E((0.005, -0.002, -0.025), (0.0045, 0.008, 0.009))
    tragus = E((0.002, -0.0145, -0.005), (0.0035, 0.0035, 0.005))
    shell = S.blend(base, helix, lobe, tragus, k=0.005)
    concha = E((0.0105, -0.004, -0.004), (0.005, 0.0095, 0.012))
    fossa = E((0.0105, 0.002, 0.012), (0.0035, 0.007, 0.008))
    return S.carve(shell, concha, fossa, k=0.0026)


def head_local() -> S.SDF:
    cranium = E((0, 0.014, 0.032), (0.074, 0.094, 0.088))
    forehead = E((0, -0.04, 0.042), (0.06, 0.045, 0.05))
    face = E((0, -0.03, -0.03), (0.06, 0.06, 0.07))
    cheek = E((0.05, -0.05, -0.02), (0.019, 0.021, 0.014)).mirror_x()
    brow = E((0.03, -0.072, 0.021), (0.03, 0.013, 0.011), R=S.rot(0, -10, 0)).mirror_x()
    jaw = S.tube([(0.061, 0.002, -0.045), (0.05, -0.038, -0.088), (0.022, -0.07, -0.106)], [0.015, 0.016, 0.015]).mirror_x()
    chin = S.round_box((0, -0.075, -0.104), (0.02, 0.014, 0.014), 0.012)
    muzzle = E((0, -0.068, -0.064), (0.033, 0.026, 0.026))
    neck = RC((0, 0.014, -0.06), (0, 0.026, -0.21), 0.051, 0.058)
    # nose: straight bridge, broad tip and wings
    bridge = S.smooth_tube([(0, -0.077, 0.012), (0, -0.089, -0.008), (0, -0.098, -0.028)], [0.0072, 0.0082, 0.0094], samples=4, k=0.003)
    tip = E((0, -0.1, -0.035), (0.0125, 0.0108, 0.0108), R=S.rot(-15, 0, 0))
    ala = E((0.0148, -0.09, -0.04), (0.0088, 0.0098, 0.0082), R=S.rot(0, 0, 20)).mirror_x()
    nose = S.blend(bridge, tip, ala, k=0.006)
    nose = S.carve(nose, E((0.0078, -0.095, -0.047), (0.0038, 0.0058, 0.0026), R=S.rot(0, 0, 20)).mirror_x(), k=0.0015)
    # lips (the hand pass cuts the mouth line and the philtrum)
    upper = E((0, -0.087, -0.0625), (0.022, 0.0085, 0.0055))
    lower = E((0, -0.085, -0.0735), (0.0185, 0.0095, 0.0062))
    head = S.blend(cranium, forehead, face, cheek, brow, jaw, chin, muzzle, neck, k=0.017)
    head = S.blend(head, nose, k=0.007)
    head = S.blend(head, upper, lower, k=0.006)
    # shallow sockets (the shades cover the eyes) and temples
    head = S.carve(head, E((0.032, -0.074, 0.001), (0.017, 0.011, 0.0105)).mirror_x(), k=0.008)
    head = S.carve(head, E((0.068, -0.028, 0.03), (0.008, 0.02, 0.02)).mirror_x(), k=0.012)
    ears = S.place(ear(), t=(0.069, 0.008, -0.012), R=S.rot(-10, 0, 0)).mirror_x()
    return S.blend(head, ears, k=0.005)


def place_head(a: S.SDF) -> S.SDF:
    return S.place(a, t=tuple(HEAD_T))


def head() -> S.SDF:
    return place_head(head_local())


def hair_local() -> S.SDF:
    """Spiky black top: a short cap over the crown and seven tapered spikes, up and back."""
    cap = S.intersect(S.grow(E((0, 0.014, 0.035), (0.074, 0.094, 0.088)), 0.006),
                      S.plane((0, 0, 0.046), (0, 0.18, -1)), k=0.008)
    # hairline: the hair comes further forward the higher it is on the head
    cap = S.intersect(cap, S.plane((0.0, -0.07, 0.05), (0, -1, -0.4)), k=0.01)
    spikes = []
    # (root on the crown, tip, root radius): anime spikes, long and sharp, leaning up and back
    specs = [((0.0, -0.062, 0.098), (0.004, -0.06, 0.168), 0.024),
             ((0.032, -0.042, 0.108), (0.05, -0.03, 0.178), 0.024),
             ((-0.032, -0.042, 0.108), (-0.05, -0.03, 0.178), 0.024),
             ((0.0, -0.012, 0.122), (0.003, 0.012, 0.2), 0.027),
             ((0.044, 0.008, 0.112), (0.072, 0.03, 0.172), 0.024),
             ((-0.044, 0.008, 0.112), (-0.072, 0.03, 0.172), 0.024),
             ((0.022, 0.045, 0.112), (0.034, 0.1, 0.17), 0.025),
             ((-0.022, 0.045, 0.112), (-0.034, 0.1, 0.17), 0.025),
             ((0.0, 0.075, 0.096), (0.0, 0.135, 0.125), 0.025)]
    for (r, t, rad) in specs:
        r = np.array(r, F32)
        t = np.array(t, F32)
        mid = r + (t - r) * 0.42 + np.array([0, 0, 0.006], F32)
        spikes.append(S.lock([r - (t - r) * 0.15, mid, t], rad, rad * 0.5, 0.0006, samples=6))
    # the back of the head is black too (the teal undercut is only on the sides)
    back = S.intersect(S.grow(E((0, 0.014, 0.032), (0.074, 0.094, 0.088)), 0.005), S.plane((0, 0.035, 0), (0, -1, 0)), k=0.012)
    back = S.intersect(back, S.plane((0, 0, -0.075), (0, 0, -1)), k=0.012)
    return S.blend(cap, back, *spikes, k=0.012)


def hair() -> S.SDF:
    return place_head(hair_local())


def undercut() -> S.SDF:
    """Teal shaved sides: a thin skin over the cranium sides, around the ears."""
    skull = E((0, 0.014, 0.032), (0.074, 0.094, 0.088))
    sk = S.shell(S.grow(skull, 0.0016), 0.0012)
    side = S.intersect(S.plane((0.046, 0, 0), (-1, 0, 0)), S.plane((0, 0, 0.062), (0, 0, 1)))
    side = S.intersect(side, S.plane((0, 0, -0.03), (0, 0, -1)))
    side = S.intersect(side, S.plane((0, -0.045, 0), (0, -1, 0.0)))
    side = S.intersect(side, S.plane((0, 0.04, 0), (0, 1, 0.0)))        # sides only: the back is hair
    band = S.intersect(sk, side.mirror_x(), k=0.004)
    band = S.carve(band, S.place(S.grow(ear(), 0.004), t=(0.069, 0.008, -0.012), R=S.rot(-10, 0, 0)).mirror_x(), k=0.002)
    return place_head(band)


def shades() -> tuple:
    """Wraparound holo shades (lens band) and their thin gold frame with temple arms."""
    shell = S.shell(E((0, -0.006, 0.004), (0.079, 0.097, 0.05)), 0.0018)
    band = S.intersect(shell, S.plane((0, 0, 0.0175), (0, 0, 1)), k=0.001)
    band = S.intersect(band, S.plane((0, 0, -0.016), (0, 0, -1)), k=0.001)
    band = S.intersect(band, S.plane((0, -0.035, 0), (0, 1, 0)), k=0.003)
    # slight brow dip at the nose
    band = S.carve(band, E((0, -0.1, -0.03), (0.012, 0.02, 0.016)), k=0.002)
    lens = place_head(band)
    pts = []
    for t in np.linspace(-1, 1, 15):
        a = t * 1.05
        pts.append((0.081 * np.sin(a), -0.006 - 0.099 * np.cos(a), 0.0185))
    top = S.tube(pts, 0.0016)
    arms = S.tube([(0.074, -0.04, 0.012), (0.077, -0.005, 0.01), (0.075, 0.02, -0.005)], 0.0016).mirror_x()
    frame = place_head(S.union(top, arms))
    return lens, frame


def studs() -> S.SDF:
    return place_head(S.sphere((0.075, 0.004, -0.04), 0.0032).mirror_x())


# =============================================================================================
# Torso, tee, hoodie
# =============================================================================================

def torso() -> S.SDF:
    b = SPEC['bulk']
    chest = E((0, 0.0, 1.335), (0.152 * b, 0.105 * b, 0.13))
    pecs = E((0.072, -0.052, 1.35), (0.072, 0.052, 0.058)).mirror_x()
    belly = E((0, -0.012, 1.17), (0.14 * b, 0.1 * b, 0.13))
    pelvis = E((0, 0.0, 1.01), (0.145 * b, 0.1 * b, 0.1))
    delts = S.sphere((0.215, ARM_Y, 1.425), 0.062).mirror_x()
    trap = RC((0, 0.03, 1.475), (0.17, 0.02, 1.445), 0.05, 0.047).mirror_x()
    neck = RC((0, 0.015, 1.46), (0, 0.015, 1.54), 0.06, 0.055)
    return S.blend(chest, pecs, belly, pelvis, delts, trap, neck, k=0.045)


def tee() -> S.SDF:
    t = S.intersect(S.grow(torso(), 0.004), S.plane((0, 0, 1.505), (0, 0.25, 1)), k=0.01)
    collar = S.torus((0, 0.012, 1.497), 0.057, 0.007, R=S.rot(-14, 0, 0))
    return S.blend(t, collar, k=0.006)


def hoodie_solid() -> S.SDF:
    body = S.grow(torso(), 0.026)
    body = S.intersect(body, S.plane((0, 0, 0.955), (0, 0, -1)), k=0.012)
    sleeves = S.smooth_tube([arm_pt(0.17), arm_pt(0.32, dz=-0.004), arm_pt(0.455, dz=-0.004)], [0.082, 0.075, 0.071],
                            samples=5, k=0.012).mirror_x()
    # pushed-up sleeves: three bunched rolls just above the elbow
    rolls = []
    for x, R, r in ((0.425, 0.07, 0.019), (0.448, 0.066, 0.018), (0.47, 0.06, 0.016)):
        rolls.append(S.torus(arm_pt(x), R, r, R=S.rot(0, 90, 0)))
    bunch = S.union(*rolls).mirror_x()
    hood = S.smooth_tube([(0.095, -0.03, 1.49), (0.085, 0.06, 1.53), (0.0, 0.11, 1.545), (-0.085, 0.06, 1.53), (-0.095, -0.03, 1.49)],
                         [0.032, 0.042, 0.048, 0.042, 0.032], samples=4, k=0.01)
    hood_back = E((0, 0.135, 1.445), (0.1, 0.028, 0.078), R=S.rot(-12, 0, 0))   # the hood lying flat
    band = S.scale(S.torus((0, 0, 0), 0.172 * SPEC['bulk'], 0.022), (1.0, 0.78, 1.0))
    band = S.place(band, t=(0, 0.004, 0.975))
    h = S.blend(body, sleeves, k=0.04)
    h = S.blend(h, bunch, k=0.01)
    h = S.blend(h, hood, hood_back, k=0.025)
    h = S.blend(h, band, k=0.012)
    return h


def opening() -> S.SDF:
    """The open zip: a wedge in front, 7 cm wide at the waist, 12 cm at the collar."""
    w0, w1, z0, z1 = 0.035, 0.06, 0.94, 1.52
    k = (w1 - w0) / (z1 - z0)
    left = S.plane((w0 - k * z0, 0, 0), (1, 0, -k))
    right = S.plane((-(w0 - k * z0), 0, 0), (-1, 0, -k))
    wedge = S.intersect(left, right)
    wedge = S.intersect(wedge, S.plane((0, -0.02, 0), (0, 1, 0)))     # front half only
    return wedge


def hoodie() -> S.SDF:
    h = hoodie_solid()
    shell = S.shell(h, 0.006)
    shell = S.carve(shell, opening(), k=0.004)
    # sleeve ends open around the forearm
    shell = S.carve(shell, RC(arm_pt(0.46), arm_pt(0.56), 0.042, 0.042).mirror_x(), k=0.004)
    # neck hole
    shell = S.carve(shell, RC((0, 0.014, 1.45), (0, 0.02, 1.62), 0.064, 0.07), k=0.01)
    return shell


def zipper() -> S.SDF:
    """Gold zip edges along both sides of the opening (snapped onto the hoodie)."""
    h = hoodie_solid()
    w0, w1, z0, z1 = 0.035, 0.06, 0.94, 1.52
    out = []
    for sx in (1, -1):
        guess = [(sx * (w0 + (w1 - w0) * (z - z0) / (z1 - z0) + 0.006), -0.25, z) for z in np.linspace(0.96, 1.49, 9)]
        pts = S.snap(h, guess, offset=0.006)
        out.append(S.smooth_tube(list(pts), 0.0055, samples=4))
    return S.union(*out)


def strings() -> tuple:
    """White drawstrings from the hood opening down the chest, gold tips."""
    cords, tips = [], []
    for sx in (1, -1):
        p = [at(sx * 0.058, -0.075, 1.5), at(sx * 0.064, -0.12, 1.42), at(sx * 0.062, -0.138, 1.33), at(sx * 0.06, -0.14, 1.27)]
        cords.append(S.smooth_tube(p, 0.0045, samples=4))
        tips.append(S.capsule(at(sx * 0.06, -0.14, 1.27), at(sx * 0.06, -0.141, 1.245), 0.007))
    return S.union(*cords), S.union(*tips)


def music_note(c, size: float, R=None) -> S.SDF:
    """Flat music note (eighth note) in its local XZ plane, thickness along Y."""
    t = 0.022 * size + 0.0008         # a print: 2-3 mm proud of the cloth
    head_ = E((0, 0, 0), (0.28 * size, t, 0.2 * size), R=S.rot(0, -25, 0))
    stem = S.round_box((0.24 * size, 0, 0.5 * size), (0.04 * size, t, 0.52 * size), 0.02 * size)
    flag = S.smooth_tube([(0.24 * size, 0, 1.0 * size), (0.42 * size, 0, 0.85 * size), (0.5 * size, 0, 0.62 * size)],
                         [0.07 * size, 0.06 * size, 0.035 * size], samples=4)
    flag = S.scale(flag, (1.0, t / (0.06 * size), 1.0))
    note = S.union(head_, stem, flag)
    return S.place(note, t=tuple(c), R=R)


def crown(c, size: float) -> S.SDF:
    t = 0.02 * size + 0.0006
    base = S.round_box((0, 0, 0), (0.5 * size, t, 0.12 * size), min(t, 0.03 * size))
    pts = []
    for x, h in ((-0.45, 0.42), (-0.22, 0.3), (0.0, 0.5), (0.22, 0.3), (0.45, 0.42)):
        pts.append(S.scale(RC((x * size, 0, 0.0), (x * size, 0, h * size), 0.09 * size, 0.035 * size), (1.0, t / (0.09 * size), 1.0)))
    return S.place(S.union(base, *pts), t=tuple(c))


def tee_print() -> S.SDF:
    t = tee()
    p = S.snap(t, [(0.0, -0.3, 1.2)], offset=0.0)[0]
    return music_note(p + at(-0.012, -0.002, -0.02), 0.07)


def back_print() -> tuple:
    h = hoodie_solid()      # the shell's outer surface is 6 mm out
    pc = S.snap(h, [(0.0, 0.4, 1.35)], offset=0.006)[0]
    pn = S.snap(h, [(0.0, 0.4, 1.26)], offset=0.006)[0]
    pl = S.snap(h, [(0.0, 0.4, 1.165)], offset=0.006)[0]
    # turned 180 deg about Z: it reads the right way round from behind
    gold = S.union(crown(pc, 0.11), music_note(pn + at(0.015, 0, -0.03), 0.12, R=S.rot(0, 0, 180)))
    line = S.round_box(pl, (0.055, 0.004, 0.004), 0.003)
    return gold, line


# =============================================================================================
# Arms, hands, wrist gear
# =============================================================================================

def forearms() -> S.SDF:
    fa = RC(arm_pt(0.44), arm_pt(0.76), 0.047, 0.034)
    muscle = E(arm_pt(0.54, dz=0.006), (0.07, 0.04, 0.042))
    return S.blend(fa, muscle, k=0.02).mirror_x()


def hand(curl: float = 0.3) -> S.SDF:
    """Left hand in local space: wrist at the origin, fingers along -Z, palm facing +Y."""
    palm = S.round_box((0.0, 0.0, -0.055), (0.044, 0.015, 0.045), 0.013)
    heel = E((0.0, 0.005, -0.02), (0.039, 0.018, 0.026))
    parts = [palm, heel]
    for i, (x, L, s) in enumerate([(-0.031, 0.045, 0.95), (-0.0105, 0.05, 1.07), (0.0105, 0.048, 1.0), (0.03, 0.04, 0.82)]):
        base = np.array([x, 0.0, -0.098], F32)
        d = np.array([x * 0.08, 0.0, -1.0], F32)
        d /= np.linalg.norm(d)
        p, pts, ang = base, [base], 0.0
        for k, sl in enumerate([0.42, 0.33, 0.25]):
            ang += curl * (0.5 + 0.3 * k)
            p = p + np.array([d[0], -np.sin(ang), -np.cos(ang)], F32) * (L * 1.45 * sl * s)
            pts.append(p)
        r0 = 0.0112 * (1.0 if i in (1, 2) else 0.93)
        parts.append(S.tube(pts, [r0, r0 * 0.95, r0 * 0.88, r0 * 0.78], k=0.0025))
    t0 = np.array([-0.041, 0.01, -0.03], F32)
    t1 = t0 + np.array([-0.022, -0.02, -0.03], F32)
    t2 = t1 + np.array([-0.006, -0.022, -0.024], F32)
    t3 = t2 + np.array([0.004, -0.02, -0.016], F32)
    parts.append(S.tube([t0, t1, t2, t3], [0.017, 0.013, 0.0115, 0.01], k=0.004))
    h = S.blend(*parts, k=0.008)
    cuff = RC((0, 0.0, 0.03), (0, 0.0, -0.02), 0.034, 0.036)
    return S.blend(h, cuff, k=0.012)


HAND_S = 1.0
# The hand recipe is a right hand: fingers along local -Z, palm (curl side) local -Y, thumb on
# local -X. On the right arm in T-pose: fingers -> world -X, palm down, thumb forward.
HAND_R = np.stack([[0, 1, 0], [0, 0, 1], [1, 0, 0]], axis=1).astype(F32)   # columns: local x, y, z


def gloves() -> S.SDF:
    # mirror_x copies the +X half, so the left hand is placed with the reflected frame instead
    right = S.place(hand(0.3), t=tuple(arm_pt(0.752, side=-1)), R=HAND_R, s=HAND_S)
    left = S.place(hand(0.3), t=tuple(arm_pt(0.752)), R=(np.diag([-1.0, 1.0, 1.0]) @ HAND_R).astype(F32), s=HAND_S)
    return S.union(left, right)


def bracer() -> tuple:
    body = S.place(S.cylinder((0, 0, 0), 0.047, 0.05, r=0.008), t=tuple(arm_pt(0.69)), R=S.rot(0, 90, 0))
    light = S.round_box(arm_pt(0.69, dz=0.045), (0.034, 0.011, 0.005), 0.003)
    return body, light


def bracelet() -> S.SDF:
    return S.torus(arm_pt(0.738, side=-1), 0.039, 0.0075, R=S.rot(0, 90, 0))


# =============================================================================================
# Headphones, chain
# =============================================================================================

def headphones() -> tuple:
    band = S.torus((0, 0.015, 1.505), 0.1, 0.0125, R=S.rot(-22, 0, 0), sy=0.92)
    band = S.intersect(band, S.plane((0, -0.035, 0), (0, -1, 0.0)), k=0.006)
    arms = []
    cups, rings, centres = [], [], []
    for sx in (1, -1):
        c = at(sx * 0.108, -0.06, 1.455)
        arms.append(S.smooth_tube([at(sx * 0.098, -0.03, 1.49), at(sx * 0.105, -0.05, 1.475), c + at(0, 0, 0.012)], 0.011, samples=4))
        cups.append(S.place(S.cylinder((0, 0, 0), 0.048, 0.019, r=0.012), t=tuple(c), R=S.rot(0, 90, 0)))
        rings.append(S.torus(c + at(sx * 0.02, 0, 0), 0.046, 0.0065, R=S.rot(0, 90, 0)))
        centres.append(S.place(S.cylinder((0, 0, 0), 0.026, 0.003, r=0.0015), t=tuple(c + at(sx * 0.021, 0, 0)), R=S.rot(0, 90, 0)))
    black = S.blend(band, *arms, *cups, k=0.008)
    return black, S.union(*rings), S.union(*centres)


def chain() -> S.SDF:
    pts = [at(0.072, 0.03, 1.5), at(0.075, -0.05, 1.47), at(0.045, -0.118, 1.4), at(0.0, -0.132, 1.37),
           at(-0.045, -0.118, 1.4), at(-0.075, -0.05, 1.47), at(-0.072, 0.03, 1.5)]
    links = S.smooth_tube(pts, 0.0042, samples=5)
    pendant = music_note(at(-0.008, -0.142, 1.315), 0.05)
    return S.union(links, pendant)


# =============================================================================================
# Legs, shoes, gear belt
# =============================================================================================

def pants() -> S.SDF:
    # an exact chain of round cones: the Catmull-Rom tube ripples at every joint on long limbs
    hip, knee, ank = j('thighL') + at(0.004, 0, 0.035), j('shinL') + at(0.006, -0.012, 0), j('footL') + at(0, 0.0, 0.075)
    leg = S.blend(RC(hip, knee, 0.106, 0.086), RC(knee, ank, 0.086, 0.074), k=0.03)
    thigh_bag = E((hip + knee) / 2 + at(0.012, 0.0, 0.03), (0.09, 0.088, 0.17))
    stack = S.torus(j('footL') + at(0, 0.0, 0.09), 0.07, 0.013)
    leg = S.blend(leg, thigh_bag, k=0.04)
    leg = S.blend(leg, stack, k=0.02)
    seat = E((0, 0.018, 0.955), (0.17, 0.122, 0.11))
    return S.blend(leg.mirror_x(), seat, k=0.05)


def pockets() -> tuple:
    p = pants()
    bags, flaps = [], []
    for sx in (1, -1):
        c = S.snap(p, [(sx * 0.3, -0.005, 0.7)], offset=-0.004)[0]
        bags.append(S.round_box(c, (0.022, 0.058, 0.07), 0.014))
        flaps.append(S.round_box(c + at(sx * 0.008, 0, 0.068), (0.017, 0.062, 0.012), 0.005))
    return S.union(*bags), S.union(*flaps)


def knee_straps() -> S.SDF:
    return S.torus(j('shinL') + at(0.005, -0.012, -0.075), 0.08, 0.009, sy=0.95).mirror_x()


def shoes() -> tuple:
    """Chunky sneakers: rounded upper with heel counter, toe box, padded collar and tongue; the
    sole is the upper's outline grown and cut flat (thick, slightly flared)."""
    a = j('footL')
    x = a[0] + 0.004
    heel = E((x, 0.04, 0.07), (0.047, 0.042, 0.06))
    vamp = S.round_box((x, -0.07, 0.062), (0.05, 0.1, 0.04), 0.034)
    toe = E((x + 0.003, -0.168, 0.052), (0.049, 0.05, 0.032))
    ankle = RC((x, 0.012, 0.07), (x, 0.012, 0.13), 0.05, 0.047)
    raw = S.blend(heel, vamp, toe, ankle, k=0.025)
    upper = S.intersect(raw, S.plane((0, 0, 0.03), (0, 0, -1)), k=0.003)
    collar = S.torus((x, 0.014, 0.132), 0.05, 0.012, R=S.rot(-8, 0, 0))
    tongue = S.round_box((x, -0.07, 0.1), (0.026, 0.05, 0.009), 0.006, R=S.rot(-24, 0, 0))
    upper = S.carve(upper, E((x, 0.012, 0.16), (0.036, 0.04, 0.03)), k=0.008)     # opening
    upper = S.blend(upper, collar, tongue, k=0.008).mirror_x()
    sole = S.intersect(S.grow(raw, 0.0065), S.plane((0, 0, 0.036), (0, 0, 1)), k=0.004)
    sole = S.intersect(sole, S.plane((0, 0, 0.0), (0, 0, -1)), k=0.002)
    return upper, sole.mirror_x()


def gear() -> tuple:
    belt = S.place(S.scale(S.torus((0, 0, 0), 0.205, 0.016), (1.0, 0.76, 1.0)), t=(0, 0.006, 0.99))
    cans, caps, glow = [], [], []
    for sx in (1, -1):
        c = at(sx * 0.215, -0.03, 0.955)
        cans.append(S.capsule(c + at(0, 0, -0.05), c + at(0, 0, 0.05), 0.034))
        caps.append(S.torus(c + at(0, 0, 0.05), 0.03, 0.006))
        caps.append(S.torus(c + at(0, 0, -0.05), 0.03, 0.006))
        glow.append(S.torus(c, 0.0345, 0.004))
    unit = S.round_box((0, 0.15, 0.99), (0.07, 0.03, 0.035), 0.012)
    nozzle = S.capsule((0, 0.165, 0.99), (0, 0.2, 0.985), 0.014)
    dark = S.blend(belt, *cans, unit, nozzle, k=0.01)
    return dark, S.union(*caps), S.union(*glow)


# =============================================================================================
# Parts table: name -> (builder, voxel, material)
# =============================================================================================

def _first(fn, i):
    cache = {}

    def f():
        if 'v' not in cache:
            cache['v'] = fn()
        return cache['v'][i]
    return f


_shades = (lambda: shades())
_strings = (lambda: strings())
_bp = (lambda: back_print())
_br = (lambda: bracer())
_hp = (lambda: headphones())
_po = (lambda: pockets())
_sh = (lambda: shoes())
_ge = (lambda: gear())

PARTS = {
    'head': (head, 0.0011, 'skin'),
    'hair': (hair, 0.0012, 'hair'),
    'undercut': (undercut, 0.0009, 'teal'),
    'lens': (_first(_shades, 0), 0.0009, 'lens'),
    'frame': (_first(_shades, 1), 0.0006, 'gold'),
    'studs': (studs, 0.0006, 'gold'),
    'tee': (tee, 0.0025, 'tee'),
    'tee_print': (tee_print, 0.0009, 'gold'),
    'hoodie': (hoodie, 0.0024, 'hoodie'),
    'zipper': (zipper, 0.0012, 'gold'),
    'strings': (_first(_strings, 0), 0.001, 'shoe'),
    'string_tips': (_first(_strings, 1), 0.001, 'gold'),
    'back_print': (_first(_bp, 0), 0.001, 'gold'),
    'back_line': (_first(_bp, 1), 0.001, 'neon'),
    'forearms': (forearms, 0.0018, 'skin'),
    'gloves': (gloves, 0.0012, 'glove'),
    'bracer': (_first(_br, 0), 0.0015, 'black'),
    'bracer_light': (_first(_br, 1), 0.001, 'neon'),
    'bracelet': (bracelet, 0.0012, 'gold'),
    'phones': (_first(_hp, 0), 0.0016, 'black'),
    'phone_rings': (_first(_hp, 1), 0.0012, 'gold'),
    'phone_centres': (_first(_hp, 2), 0.0012, 'neon'),
    'chain': (chain, 0.0009, 'gold'),
    'pants': (pants, 0.0026, 'pants'),
    'pockets': (_first(_po, 0), 0.0018, 'pocket'),
    'pocket_flaps': (_first(_po, 1), 0.0014, 'gold'),
    'knee_straps': (knee_straps, 0.0014, 'black'),
    'shoes': (_first(_sh, 0), 0.0018, 'shoe'),
    'soles': (_first(_sh, 1), 0.0018, 'sole'),
    'gear': (_first(_ge, 0), 0.0018, 'gear'),
    'gear_trim': (_first(_ge, 1), 0.0012, 'gold'),
    'gear_glow': (_first(_ge, 2), 0.0012, 'neon'),
}

ROUGH = {'lens': 0.15, 'gold': 0.3, 'neon': 0.5, 'shoe': 0.5, 'sole': 0.4, 'black': 0.45, 'gear': 0.45, 'glove': 0.5}


# =============================================================================================
# Stages
# =============================================================================================

def build_parts(out: str, rebuild=None) -> dict:
    """Meshes every part (cached as npz in <out>/_parts; `rebuild` = names to redo)."""
    cdir = os.path.join(out, '_parts')
    os.makedirs(cdir, exist_ok=True)
    meshes = {}
    for name, (fn, vox, mat) in PARTS.items():
        path = os.path.join(cdir, f'{name}.npz')
        if os.path.exists(path) and (rebuild is None or name not in rebuild) and rebuild != ['all']:
            z = np.load(path)
            meshes[name] = (z['v'], z['f'], mat)
            continue
        t = time.time()
        v, f = S.mesh(fn(), voxel=vox)
        np.savez(path, v=v, f=f.astype(np.int32))
        meshes[name] = (v, f, mat)
        print(f'{name:14s} {len(f):8d} tris {time.time() - t:6.1f}s', flush=True)
    return meshes


def render(meshes: dict, out: str, tag: str, clay: bool, views=('front', 'three_quarter', 'side', 'back'),
           samples: int = 24, width: int = 700, height: int = 1000, box=None, lens: float = 60) -> list:
    from charkit import studio as ST

    ST.reset()
    objs = []
    for name, (v, f, mat) in meshes.items():
        ob = ST.mesh_from_arrays(name, np.asarray(v, F32), np.asarray(f, np.int32))
        if not clay:
            m = ST.principled(mat, PALETTE[mat], rough=ROUGH.get(mat, 0.65))
            if mat in ('neon', 'lens'):
                bsdf = m.node_tree.nodes['Principled BSDF']
                bsdf.inputs['Emission Color'].default_value = bsdf.inputs['Base Color'].default_value
                bsdf.inputs['Emission Strength'].default_value = 2.5 if mat == 'neon' else 0.8
            ST.assign(ob, m)
        objs.append(ob)
    box = box or (np.array([-0.95, -0.3, 0.0]), np.array([0.95, 0.3, 1.9]))
    return ST.review(objs, out, f'rex_{tag}', views=list(views), clay=clay, width=width, height=height,
                     samples=samples, lens=lens, box=box)


# =============================================================================================
# Hand pass: strokes per part, drawn on orthographic views in absolute millimetres
# =============================================================================================

def views():
    from charkit import sculpt as K
    return {
        'front': K.View('front', 0, 0, (0.0, 0.0, 1.0), 0.95),
        'torso': K.View('torso', 0, 0, (0.0, 0.0, 1.25), 0.34),
        'torso_back': K.View('torso_back', 180, 0, (0.0, 0.0, 1.25), 0.34),
        'torso_side': K.View('torso_side', 90, 0, (0.0, 0.0, 1.25), 0.34),
        'arm': K.View('arm', 0, 0, (0.42, 0.0, 1.43), 0.16),
        'arm_top': K.View('arm_top', 0, 80, (0.42, 0.0, 1.43), 0.16),
        'legs': K.View('legs', 0, 0, (0.0, 0.0, 0.52), 0.5),
        'legs_side': K.View('legs_side', 90, 0, (0.0, 0.0, 0.52), 0.5),
        'face': K.View('face', 0, 0, (0.0, -0.08, 1.67), 0.12),
        'face_side': K.View('face_side', 90, 0, (0.0, -0.03, 1.67), 0.13),
    }


def _on(view: str, brush: str, pts, name: str = '', **kw):
    from charkit import sculpt as K
    return K.Stroke(brush, [list(map(float, p)) for p in pts], name=f'@{view}:{name}', **K.preset(brush, **kw))


def _offset(pts, d: float) -> list:
    P = np.asarray(pts, np.float64)
    t = np.gradient(P, axis=0)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
    return (P + np.stack([-t[:, 1], t[:, 0]], axis=1) * d).tolist()


def fold(view: str, pts, r: float, depth: float, ridge: float = 0.35, side: float = 1.0, name: str = '',
         mirror: bool = True) -> list:
    """A cloth fold: a valley (crease, relaxed so the triangles even out), a ridge of fabric on one
    side (clay strips) and a softened other side. r in mm."""
    rm = r / 1000.0
    out = [_on(view, 'crease', pts, name, radius=rm, strength=-depth, pinch=0.45, mirror=mirror, spacing=0.1),
           _on(view, 'relax', pts, name + ' relax', radius=1.6 * rm, strength=0.6, mirror=mirror)]
    if ridge > 0:
        out.append(_on(view, 'clay_strips', _offset(pts, side * 1.8 * r), name + ' ridge', radius=2.2 * rm,
                       strength=ridge, mirror=mirror))
        out.append(_on(view, 'smooth', _offset(pts, -side * 1.6 * r), name + ' soft', radius=2 * rm,
                       strength=0.3, mirror=mirror))
    return out


def strokes() -> dict:
    """part -> strokes, drawn on the grid renders (u, w in mm; mirror = both sides)."""
    hood = []
    # --- front panels (torso view: u = x, w = z) -------------------------------------------------
    hood += fold('torso', [(85, 1330), (90, 1200), (95, 1060)], 7, 0.45, name='drape near the zip')
    hood += fold('torso', [(150, 1310), (158, 1190), (168, 1065)], 8, 0.5, name='drape on the side')
    hood += fold('torso', [(215, 1395), (175, 1320), (128, 1255)], 7, 0.4, name='armpit drag')
    hood += fold('torso', [(80, 1045), (130, 1038), (185, 1048)], 6, 0.4, ridge=0.3, name='waist bunch 1')
    hood += fold('torso', [(95, 1078), (140, 1070), (190, 1082)], 5, 0.3, ridge=0.25, name='waist bunch 2')
    # --- back (torso_back view: u = -x) ------------------------------------------------------------
    hood += fold('torso_back', [(150, 1360), (90, 1220), (50, 1090)], 8, 0.45, name='back V')
    hood += fold('torso_back', [(160, 1060), (80, 1045), (8, 1040)], 6, 0.35, ridge=0.25, name='back bunch')
    # the hood: a layer edge where it lies on the back, and creases radiating from the neck
    hood += fold('torso_back', [(-110, 1440), (-55, 1422), (0, 1416), (55, 1422), (110, 1440)], 6, 0.45,
                 ridge=0.0, name='hood edge', mirror=False)
    for k, (a, b) in enumerate([((25, 1550), (35, 1446)), ((65, 1535), (95, 1455))]):
        hood += fold('torso_back', [a, ((a[0] + b[0]) / 2 + 4, (a[1] + b[1]) / 2), b], 6, 0.5, ridge=0.3,
                     name=f'hood crease {k}')
    # --- sleeves (arm view: front of the left arm, u = x, w = z) -----------------------------------
    for k, x in enumerate((425.0, 458.0)):
        hood += fold('arm', [(x, 1528), (x - 2, 1440), (x, 1352)], 4.5, 0.4, ridge=0.0, name=f'between rolls {k}')
    hood += fold('arm', [(300, 1500), (345, 1468), (390, 1440)], 6, 0.35, name='sleeve twist 1')
    hood += fold('arm', [(290, 1405), (335, 1392), (380, 1380)], 6, 0.3, name='sleeve twist 2')
    # --- cargo pants (legs view: u = x, w = z) ------------------------------------------------------
    legs = []
    legs += fold('legs', [(40, 860), (70, 720), (92, 620)], 8, 0.35, name='thigh drape')
    legs += fold('legs', [(65, 592), (105, 577), (150, 587)], 7, 0.45, name='knee 1')
    legs += fold('legs', [(70, 546), (110, 536), (150, 549)], 7, 0.4, name='knee 2')
    legs += fold('legs', [(96, 430), (100, 335), (103, 272)], 7, 0.3, name='shin drape')
    legs += fold('legs', [(60, 252), (105, 241), (160, 254)], 6, 0.4, ridge=0.3, name='stack 1')
    legs += fold('legs', [(62, 216), (105, 208), (158, 219)], 6, 0.4, ridge=0.3, name='stack 2')
    # --- face (face view: u = x, w = z; face_side: u = y) ---------------------------------------------
    face = []
    face += fold('face', [(-21, 1618), (-10, 1616.5), (0, 1617), (10, 1616.5), (21, 1618)], 1.6, 0.5, ridge=0.0,
                 name='mouth line', mirror=False)
    face.append(_on('face', 'crease', [(-18, 1625), (-6, 1627.5), (0, 1626.5), (6, 1627.5), (18, 1625)], 'upper lip edge',
                    radius=0.0012, strength=-0.25, pinch=0.4, mirror=False))
    face.append(_on('face', 'crease', [(3.5, 1640), (4, 1629)], 'philtrum', radius=0.001, strength=-0.25, pinch=0.4))
    face += fold('face', [(-14, 1602), (0, 1599), (14, 1602)], 2.2, 0.4, ridge=0.0, name='under lip', mirror=False)
    face += fold('face', [(16, 1640), (24, 1625), (27, 1610)], 2.2, 0.25, ridge=0.2, name='nasolabial')
    face += fold('face', [(11, 1648), (17, 1650), (21, 1643), (19, 1636)], 1.4, 0.35, ridge=0.0, name='alar crease')
    face.append(_on('face', 'trim', [(48, 1662), (58, 1645), (62, 1625)], 'cheek plane', radius=0.007, strength=0.4))
    face += fold('face_side', [(-85, 1578), (-60, 1586), (-35, 1600), (-20, 1622)], 3, 0.45, ridge=0.3, name='jaw line')
    return {'hoodie': hood, 'pants': legs, 'head': face}


def resolve(sc, st, vw: dict):
    from charkit import sculpt as K
    if not st.name.startswith('@'):
        return st
    view = vw[st.name[1:].split(':')[0]]
    uw = view.absolute(np.asarray(st.points, np.float64) / 1000.0)
    pts, tid = K.RayCaster(sc.v, sc.f, view).hit(uw)
    ok = tid >= 0
    if ok.sum() < min(2, len(uw)):       # the pen left the clay: drop the stroke
        print(f'  skipped {st.name}: misses the mesh', flush=True)
        return None
    return K.Stroke(**{**st.__dict__, 'points': pts[ok].tolist(), 'view': tuple(-view.basis()[2])})


def sculpt_parts(out: str, only=None) -> dict:
    """Replays the stroke lists on the part meshes; results in <out>/_sculpt (others untouched)."""
    from charkit import sculpt as K
    sdir = os.path.join(out, '_sculpt')
    os.makedirs(sdir, exist_ok=True)
    vw = views()
    for name, items in strokes().items():
        if only and name not in only:
            continue
        z = np.load(os.path.join(out, '_parts', f'{name}.npz'))
        sc = K.Sculpt(z['v'], z['f'])
        t = time.time()
        for st in items:
            r = resolve(sc, st, vw)
            if r is not None:
                sc.stroke(r)
        sc.save(os.path.join(sdir, f'{name}.npz'))
        print(f'{name}: {len(items)} strokes in {time.time() - t:.1f}s', flush=True)


def load_meshes(out: str, sculpted: bool = True) -> dict:
    meshes = {}
    for name, (_, _, mat) in PARTS.items():
        p = os.path.join(out, '_sculpt', f'{name}.npz')
        if not (sculpted and os.path.exists(p)):
            p = os.path.join(out, '_parts', f'{name}.npz')
        z = np.load(p)
        meshes[name] = (z['v'], z['f'], mat)
    return meshes


# =============================================================================================
# Export: decimation, game skeleton, weights per part, GLB
# =============================================================================================

TRI_BUDGET = {
    'head': 5000, 'hair': 2400, 'undercut': 700, 'lens': 500, 'frame': 300, 'studs': 80, 'tee': 2200,
    'tee_print': 1200, 'hoodie': 8000, 'zipper': 500, 'strings': 260, 'string_tips': 80, 'back_print': 3000,
    'back_line': 200, 'forearms': 1400, 'gloves': 2600, 'bracer': 500, 'bracer_light': 80, 'bracelet': 240,
    'phones': 1600, 'phone_rings': 400, 'phone_centres': 160, 'chain': 1500, 'pants': 4000, 'pockets': 400,
    'pocket_flaps': 240, 'knee_straps': 260, 'shoes': 2400, 'soles': 1200, 'gear': 1400, 'gear_trim': 300,
    'gear_glow': 160,
}
TORSO = ['hips', 'spine', 'chest', 'neck', 'shoulderL', 'shoulderR']
ARMS = ['upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR']
LEGS = ['hips', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']
HANDS = ['foreArmL', 'handL', 'fingersL', 'fingertipsL', 'thumbL', 'foreArmR', 'handR', 'fingersR', 'fingertipsR', 'thumbR']
AUTO = {
    'head': ['neck', 'head'],
    'tee': TORSO + ['upperArmL', 'upperArmR'],
    # the pushed-up sleeves end at the elbow: they ride on the upper arm only, or the bunched
    # rolls balloon when the elbow folds (aim pose); the forearm turns inside the sleeve end
    'hoodie': TORSO + ['upperArmL', 'upperArmR'],
    'forearms': ARMS,
    'gloves': HANDS,
    'pants': LEGS,
    'shoes': ['shinL', 'footL', 'shinR', 'footR'],
}
TRANSFER = {'zipper': 'hoodie', 'back_print': 'hoodie', 'back_line': 'hoodie', 'tee_print': 'tee', 'pockets': 'pants',
            'pocket_flaps': 'pants', 'knee_straps': 'pants', 'soles': 'shoes'}
RIGID = {'hair': 'head', 'undercut': 'head', 'lens': 'head', 'frame': 'head', 'studs': 'head', 'strings': 'chest',
         'string_tips': 'chest', 'chain': 'chest', 'phones': 'chest', 'phone_rings': 'chest', 'phone_centres': 'chest',
         'bracer': 'foreArmL', 'bracer_light': 'foreArmL', 'bracelet': 'foreArmR', 'gear': 'hips',
         'gear_trim': 'hips', 'gear_glow': 'hips'}
# per material: outline width factor read by the game (glbModels.ts, GlbMaterialSpec.outline)
SOCKETS = {'gearL': (0.215, -0.03, 0.955), 'gearR': (-0.215, -0.03, 0.955), 'nozzle': (0.0, 0.2, 0.985),
           'eyes': (0.0, -0.09, float(HEAD_T[2]))}


def build_armature():
    import bl_kit as BK
    from mathutils import Vector as V

    jn = BK.game_joints(SPEC, tpose=True)
    for k in BK.GAME_BONES:
        assert np.allclose(np.array(jn[k]), J[k], atol=1e-4), (k, tuple(jn[k]), J[k])
    tails = {'head': V((0, 0.0, 1.86)), 'shoulderL': jn['upperArmL'], 'shoulderR': jn['upperArmR'],
             'thighL': jn['shinL'], 'thighR': jn['shinR']}
    extra = []
    for sx, s in ((1, 'L'), (-1, 'R')):
        w = np.array(jn[f'hand{s}'])
        tails[f'hand{s}'] = V((w[0] + sx * 0.098 * HAND_S, w[1], w[2] - 0.003))
        tails[f'foot{s}'] = V((sx * 0.105, -0.17, 0.03))
        hs = HAND_S
        k0 = V((w[0] + sx * 0.098 * hs, w[1], w[2] - 0.003))
        k1 = V((w[0] + sx * 0.134 * hs, w[1], w[2] - 0.011))
        k2 = V((w[0] + sx * 0.165 * hs, w[1], w[2] - 0.028))
        extra += [{'name': f'fingers{s}', 'head': k0, 'tail': k1, 'parent': f'hand{s}'},
                  {'name': f'fingertips{s}', 'head': k1, 'tail': k2, 'parent': f'fingers{s}'},
                  {'name': f'thumb{s}', 'head': V((w[0] + sx * 0.03 * hs, w[1] - 0.041 * hs, w[2] + 0.01 * hs)),
                   'tail': V((w[0] + sx * 0.1 * hs, w[1] - 0.065 * hs, w[2] - 0.052 * hs)), 'parent': f'hand{s}'}]
    return BK.build_armature('rex_rig', jn, extra, tails)


def decimate(ob, target: int) -> None:
    import bl_kit as BK
    n = len(ob.data.polygons)
    if n <= target:
        return
    md = ob.modifiers.new('dec', 'DECIMATE')
    md.ratio = target / n
    md.use_collapse_triangulate = True
    BK.apply_modifiers(ob)


def export(out: str, glb: str, preview: bool = True) -> None:
    import bpy

    import bl_kit as BK

    BK.reset_scene()
    meshes = load_meshes(out)
    mats = {k: BK.make_material(k, PALETTE[k], emissive=k in ('neon', 'lens')) for k in PALETTE}
    objs = {}
    t0 = time.time()
    from charkit import studio as ST
    for name, (v, f, mat) in meshes.items():
        ob = ST.mesh_from_arrays(name, np.asarray(v, F32), np.asarray(f, np.int32))
        ob.data.materials.append(mats[mat])
        decimate(ob, TRI_BUDGET[name])
        objs[name] = ob
    print(f'[export] meshes + decimation {time.time() - t0:.1f}s, {BK.tri_count(objs.values())} tris', flush=True)
    arm = build_armature()
    t0 = time.time()
    for name, bones in AUTO.items():
        BK.bind_auto(objs[name], arm, bones)
        BK.clean_weights(objs[name])
    for name, bone in RIGID.items():
        BK.bind_rigid(objs[name], arm, bone)
    for name, src in TRANSFER.items():
        BK.transfer_weights(objs[src], objs[name], arm)
    print(f'[export] weights {time.time() - t0:.1f}s', flush=True)
    if preview:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'rex_rigged.blend'))
        toon_previews(list(objs.values()), arm, out)
    BK.pose_reset(arm)
    BK.material_mode('export')
    model = BK.join(list(objs.values()), 'rex')
    arm['ggg_spec'] = json.dumps(SPEC)
    arm['ggg_chains'] = json.dumps([])
    arm['ggg_sockets'] = json.dumps({k: [round(c, 5) for c in BK.b2g(v)] for k, v in SOCKETS.items()})
    BK.export_glb(glb, [model, arm])
    print('[export]', glb, os.path.getsize(glb) // 1024, 'KB', flush=True)


OUTLINE = {'lens': 0.6, 'frame': 0.5, 'studs': 0.0, 'chain': 0.5, 'zipper': 0.5, 'strings': 0.5, 'string_tips': 0.4,
           'tee_print': 0.0, 'back_print': 0.0, 'back_line': 0.0, 'bracer_light': 0.0, 'phone_centres': 0.0,
           'gear_glow': 0.0, 'phone_rings': 0.5, 'gear_trim': 0.5, 'bracelet': 0.5, 'pocket_flaps': 0.6}


def pose_down(arm, deg: float = 72.0) -> None:
    """Arms lowered from the T-pose (rest-like stance for the preview and the deformation check)."""
    import bl_kit as BK
    BK.pose_reset(arm)
    BK.pose_rotate(arm, 'upperArmL', (0, 1, 0), deg)
    BK.pose_rotate(arm, 'upperArmR', (0, 1, 0), -deg)
    BK.pose_rotate(arm, 'foreArmL', (0, 0, 1), 18)
    BK.pose_rotate(arm, 'foreArmR', (0, 0, 1), -18)


def toon_previews(objs, arm, out: str, tag: str = 'toon') -> list:
    """Game-like renders: flat toon materials + inverted-hull outlines, T-pose and arms down."""
    import bl_kit as BK
    for o in objs:
        o['outline'] = OUTLINE.get(o.name, 1.0)
    added = BK.add_outlines(objs, 0.0034)
    BK.material_mode('render')
    paths = []
    shots = [('front', (0, -10, 1.0), (90, 0, 0), 2.1, (-0.45, -0.6, 0.66)),
             ('back', (0, 10, 1.0), (90, 0, 180), 2.1, (0.45, 0.6, 0.66)),
             ('q34', (-6.0, -8.0, 1.0), (90, 0, -36.87), 2.1, (-0.6, -0.4, 0.66))]
    try:
        for pose in ('tpose', 'down'):
            if pose == 'down':
                pose_down(arm)
            for name, loc, rot, scale, light in shots:
                w = 1100 if pose == 'tpose' else 700
                BK.ortho_camera('cam', loc, rot, scale)
                BK.set_light_dir(light)
                BK.setup_render(w, 1100, 8)
                path = os.path.join(out, f'rex_{tag}_{pose}_{name}.png')
                BK.render_to(path)
                paths.append(path)
        # face close-up, arms down
        BK.ortho_camera('cam', (-0.25, -3.0, 1.7), (90, 0, -5), 0.42)
        BK.set_light_dir((-0.45, -0.6, 0.66))
        BK.setup_render(800, 800, 8)
        path = os.path.join(out, f'rex_{tag}_face.png')
        BK.render_to(path)
        paths.append(path)
    finally:
        BK.pose_reset(arm)
        BK.remove_outlines(added)
        BK.material_mode('export')
    return paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--stage', default='parts', choices=['parts', 'sculpt', 'export', 'grid'])
    ap.add_argument('--part', default='hoodie', help='grid stage: the part to draw strokes on')
    ap.add_argument('--gviews', default='torso', help='grid stage: comma list of views()')
    ap.add_argument('--rebuild', default=None, help="comma list of parts to re-mesh ('all' for every part)")
    ap.add_argument('--tag', default='v1')
    ap.add_argument('--clay', action='store_true')
    ap.add_argument('--samples', type=int, default=24)
    ap.add_argument('--views', default='front,three_quarter,side,back')
    ap.add_argument('--face', action='store_true', help='close-up of the head')
    ap.add_argument('--focus', default='', choices=['', 'torso', 'legs', 'hand', 'feet'], help='close-up box')
    ap.add_argument('--glb', default=os.path.join(ROOT, 'public', 'models', 'rex.glb'))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rebuild = None if a.rebuild is None else [s for s in a.rebuild.split(',') if s]
    if a.stage == 'export':
        export(a.out, a.glb)
        return
    if a.stage == 'grid':
        from charkit import sculpt as K
        meshes = load_meshes(a.out)
        v, f, _ = meshes[a.part]
        extra = [(mv, mf, '#3c4252') for n, (mv, mf, _) in meshes.items() if n != a.part]
        vw = views()
        K.review(np.asarray(v, np.float64), np.asarray(f, np.int64), [vw[k] for k in a.gviews.split(',')], a.out,
                 f'grid_{a.tag}_{a.part}', size=1000, samples=a.samples, grid_mm=10 if vw[a.gviews.split(',')[0]].half > 0.2 else 5,
                 extra=extra)
        return
    if a.stage == 'sculpt':
        only = rebuild if rebuild and rebuild != ['all'] else None
        sculpt_parts(a.out, only)
    if a.stage in ('parts', 'sculpt'):
        meshes = build_parts(a.out, rebuild) if a.stage == 'parts' else load_meshes(a.out)
        vlist = [v for v in a.views.split(',') if v]
        FOCUS = {'torso': ((-0.3, -0.25, 0.9), (0.3, 0.25, 1.62)), 'legs': ((-0.25, -0.25, 0.0), (0.25, 0.25, 1.05)),
                 'hand': ((0.38, -0.12, 1.33), (0.98, 0.12, 1.53)), 'feet': ((-0.2, -0.25, 0.0), (0.2, 0.15, 0.25))}
        if a.face:
            box = (np.array([-0.11, -0.13, 1.54]), np.array([0.11, 0.08, 1.86]))
            paths = render(meshes, a.out, a.tag + '_face', a.clay, vlist, a.samples, 760, 760, box, 85)
        elif a.focus:
            lo, hi = FOCUS[a.focus]
            paths = render(meshes, a.out, f'{a.tag}_{a.focus}', a.clay, vlist, a.samples, 760, 900, (np.array(lo), np.array(hi)), 70)
        else:
            paths = render(meshes, a.out, a.tag, a.clay, vlist, a.samples)
        from charkit import studio as ST
        sub = '_face' if a.face else (f'_{a.focus}' if a.focus else '')
        ST.sheet(paths, os.path.join(a.out, f'rex_{a.tag}{sub}{"_clay" if a.clay else ""}_sheet.png'),
                 labels=vlist, title=f'Rex {a.tag}{sub}', cell_h=640, silhouettes=not sub)


if __name__ == '__main__':
    main()
