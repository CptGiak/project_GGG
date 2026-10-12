"""
Fits the game skeleton (src/fighter/Rig.ts) to a character mesh that has none, such as the
output of an image-to-3D generator: one closed surface, standing, arms out (T-pose or a lowered
"relaxed" T-pose / A-pose), legs apart, facing -Y. numpy + scipy only.

Coordinates: Blender, metres, X = the character's left, -Y = front, Z = up, feet on z = 0,
body centred on x = 0.

How the joints are found (all from a dense sampling of the surface):
- frontal silhouette (x, z) with the depth range (min / max y) of every pixel;
- crotch: lowest row where the centre column is filled; ankles: where the front-back extent
  of each leg shrinks from the shoe to the shin; knees halfway up the leg;
- armpits: coming in from the fingertips, the column where the topmost run of pixels (the
  arm's section) suddenly reaches far down (the torso); the arm's medial line is the middle of
  that run, column by column; a hanging arm is measured again turned horizontal about the
  shoulder; wrist where the round forearm section flattens into the hand, elbow at 52% of
  shoulder-wrist (bodySpec); the palm's direction from the thumb's side;
- spine, chest and neck by the proportions of bodySpec('heavy'), head joint from the shoulders;
- depth (y) of every joint: middle of the body's front-back range at that place.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

# bodySpec('heavy') between the hips bone and the upper-arm joints: spine at 0.11, chest at
# 0.29 of 0.43 m (src/fighter/Rig.ts)
SPINE_AT, CHEST_AT = 0.11 / 0.43, 0.29 / 0.43


def sample_surface(V: np.ndarray, F: np.ndarray, n: int = 1_200_000, seed: int = 0) -> np.ndarray:
    """area-weighted random points on the triangles, plus the vertices"""
    tri = V[F]
    area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    rng = np.random.default_rng(seed)
    idx = rng.choice(len(F), n, p=area / area.sum())
    r1 = np.sqrt(rng.random(n))
    r2 = rng.random(n)
    w = np.stack([1 - r1, r1 * (1 - r2), r1 * r2], 1)
    P = np.einsum('ni,nij->nj', w, tri[idx])
    return np.concatenate([P, V])


@dataclass
class Fit:
    joints: dict                     # bone -> head position (Blender coords)
    tails: dict                      # bone -> tail position (for bone heat and display)
    extra: list                      # finger bones: dicts name/head/tail/parent
    measures: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)


class Silhouette:
    """frontal occupancy (x, z) with the y range of each pixel"""

    def __init__(self, P: np.ndarray, cell: float):
        self.c = cell
        self.x0 = float(P[:, 0].min()) - 3 * cell
        self.z0 = float(P[:, 2].min()) - 3 * cell
        ix = ((P[:, 0] - self.x0) / cell).astype(np.int64)
        iz = ((P[:, 2] - self.z0) / cell).astype(np.int64)
        nx, nz = int(ix.max()) + 4, int(iz.max()) + 4
        occ = np.zeros((nx, nz), bool)
        occ[ix, iz] = True
        ymin = np.full((nx, nz), np.inf)
        ymax = np.full((nx, nz), -np.inf)
        np.minimum.at(ymin, (ix, iz), P[:, 1])
        np.maximum.at(ymax, (ix, iz), P[:, 1])
        self.occ = ndimage.binary_closing(occ, iterations=1) | occ
        self.ymin, self.ymax = ymin, ymax

    def i(self, x: float) -> int:
        return int((x - self.x0) / self.c)

    def k(self, z: float) -> int:
        return int((z - self.z0) / self.c)

    def x(self, i) -> float:
        return self.x0 + (np.asarray(i) + 0.5) * self.c

    def z(self, k) -> float:
        return self.z0 + (np.asarray(k) + 0.5) * self.c

    def top_run(self, i: int, gap: int = 2):
        """(top, bottom) rows of the highest run of filled pixels in column i (gaps <= gap bridged)"""
        col = self.occ[i]
        rows = np.nonzero(col)[0]
        if len(rows) == 0:
            return None
        top = int(rows[-1])
        k = top
        while k > 0:
            if col[k - 1]:
                k -= 1
                continue
            lo = max(0, k - 1 - gap)
            if col[lo:k - 1].any():
                k = lo + int(np.nonzero(col[lo:k - 1])[0][-1])
                continue
            break
        return top, k

    def runs(self, i: int, gap: int = 2) -> list:
        """(top, bottom) rows of every run of filled pixels in column i, top first (gaps <= gap
        bridged)"""
        rows = np.nonzero(self.occ[i])[0]
        if len(rows) == 0:
            return []
        out = []
        start = prev = int(rows[0])
        for r in rows[1:]:
            r = int(r)
            if r - prev > gap + 1:
                out.append((prev, start))
                start = r
            prev = r
        out.append((prev, start))
        return out[::-1]

    def track(self, i: int, prev: tuple | None):
        """the run of column i that continues `prev` (largest overlap, else the nearest); the
        topmost run when there is no previous one"""
        rs = self.runs(i)
        if not rs:
            return None
        if prev is None:
            return rs[0]
        pt, pb = prev
        best = max(rs, key=lambda r: (min(r[0], pt) - max(r[1], pb), -abs((r[0] + r[1]) - (pt + pb))))
        if min(best[0], pt) - max(best[1], pb) < -3:
            best = min(rs, key=lambda r: abs((r[0] + r[1]) - (pt + pb)))
        return best

    def depth_mid(self, i: int, k0: int, k1: int) -> tuple:
        lo = self.ymin[i, k0:k1 + 1]
        hi = self.ymax[i, k0:k1 + 1]
        ok = np.isfinite(lo)
        if not ok.any():
            return float('nan'), 0.0
        a, b = float(lo[ok].min()), float(hi[ok].max())
        return (a + b) / 2, b - a


def band(P: np.ndarray, z0: float, z1: float, xmin: float = -np.inf, xmax: float = np.inf) -> np.ndarray:
    m = (P[:, 2] >= z0) & (P[:, 2] < z1) & (P[:, 0] >= xmin) & (P[:, 0] < xmax)
    return P[m]


def mid(a: np.ndarray, lo: float = 2, hi: float = 98) -> float:
    return float((np.percentile(a, lo) + np.percentile(a, hi)) / 2) if len(a) else 0.0


def fit(V: np.ndarray, F: np.ndarray, hand_frac: float = 0.09) -> Fit:
    P = sample_surface(V, F)
    H = float(P[:, 2].max())
    S = Silhouette(P, H / 420)
    notes, meas = [], {'height': H}
    J, T = {}, {}
    i0 = S.i(0.0)

    # ---- crotch: lowest row (above the shins) where the centre column is filled -------------
    center = S.occ[i0 - 1:i0 + 2].any(axis=0)
    k_lo = S.k(0.2 * H)
    crotch = None
    for k in range(k_lo, S.k(0.7 * H)):
        if center[k:k + max(3, int(0.02 * H / S.c))].all():
            crotch = float(S.z(k))
            break
    if crotch is None or crotch < 0.3 * H:
        notes.append(f'crotch not found ({crotch}), using 0.47 H')
        crotch = 0.47 * H
    meas['crotch'] = crotch

    # ---- legs -----------------------------------------------------------------------------------
    # hip joints above the crotch (baggy trousers hang lower: 7% of the height fits both)
    hip_j = crotch + 0.07 * H
    for s, sx in (('L', 1.0), ('R', -1.0)):
        leg = P[(P[:, 0] * sx > 0.01) & (P[:, 2] < crotch - 0.01 * H)]
        thigh_band = band(leg, crotch - 0.07 * H, crotch - 0.025 * H)
        tx = mid(thigh_band[:, 0]) if len(thigh_band) else sx * 0.055 * H
        # ankle: the front-back extent drops from the shoe's to the shin's
        zs = np.arange(0.005 * H, 0.2 * H, 0.004 * H)
        ext = np.array([np.ptp(b[:, 1]) if len(b := band(leg, z, z + 0.004 * H)) > 8 else np.nan for z in zs])
        foot_ext = np.nanmax(ext[zs < 0.05 * H])
        shin_ext = np.nanmedian(ext[(zs > 0.12 * H) & (zs < 0.19 * H)])
        thr = shin_ext + 0.3 * (foot_ext - shin_ext)
        above = np.nonzero((ext <= thr) & (zs > 0.02 * H))[0]
        # the extent reaches the shin's at the collar of the shoe, a little above the ankle bone
        ankle_z = float(zs[above[0]]) * 0.82 if len(above) else 0.045 * H
        meas[f'ankle_profile{s}'] = (round(float(foot_ext), 3), round(float(shin_ext), 3))
        a_band = band(leg, ankle_z + 0.02 * H, ankle_z + 0.04 * H)
        ax, ay = mid(a_band[:, 0]), mid(a_band[:, 1])
        knee_z = ankle_z + 0.5 * (hip_j - ankle_z)
        k_band = band(leg, knee_z - 0.01 * H, knee_z + 0.01 * H)
        kx, ky = mid(k_band[:, 0]), mid(k_band[:, 1])
        h_band = band(P, hip_j - 0.01 * H, hip_j + 0.01 * H, -0.12 * H, 0.12 * H)
        J['thigh' + s] = np.array([0.92 * tx, mid(h_band[:, 1]), hip_j])
        J['shin' + s] = np.array([kx, ky, knee_z])
        J['foot' + s] = np.array([ax, ay, ankle_z])
        toe = band(leg, 0.0, 0.04 * H)
        toe = toe[np.abs(toe[:, 0] - ax) < 0.05 * H]
        ty = float(np.percentile(toe[:, 1], 2)) if len(toe) else ay - 0.1 * H
        T['foot' + s] = np.array([ax, ty + 0.02 * H, 0.015 * H])
        T['thigh' + s] = J['shin' + s]
        T['shin' + s] = J['foot' + s]

    # ---- arms -----------------------------------------------------------------------------------
    # the arms are read in a slab of depth around the hands: hair or a scarf hanging behind or in
    # front of an arm would otherwise merge with it in the frontal silhouette
    reach = np.abs(P[:, 0]) > 0.85 * np.abs(P[:, 0]).max()
    y_arm = float(np.median(P[reach, 1])) if reach.any() else 0.0
    SA = Silhouette(P[np.abs(P[:, 1] - y_arm) < 0.065 * H], S.c)
    arm_info = {}
    for s, sx in (('L', 1.0), ('R', -1.0)):
        side, tip_i, arm_runs = arm_side(SA, P, sx, H)
        if abs(SA.x(tip_i) - SA.x(side)) < 0.2 * H:
            notes.append(f'arm {s}: short ({abs(SA.x(tip_i) - SA.x(side)):.2f} m from the torso side): arms close to the body?')
        x_side = float(SA.x(side))
        step = 1 if sx > 0 else -1
        L, th, dp = medial_line(SA, range(side + step, tip_i + step, step), arm_runs)
        a = arm_joints(L, th, dp, x_side, sx, H, hand_frac, float(SA.x(tip_i)), SA.c)
        drop = math.degrees(math.atan2(a['sh'][2] - a['tip'][2], abs(a['tip'][0] - a['sh'][0])))
        if abs(drop) > 12:
            # hanging arm: measure it again turned horizontal about the shoulder (the columns then
            # cut it square), then turn the joints back
            sh = a['sh']
            d = a['tip'] - sh
            seg_t = np.clip((P - sh) @ d / (d @ d), 0, 1)
            near = np.linalg.norm(P - (sh + seg_t[:, None] * d), axis=1) < 0.1 * H
            Q = P[near & ((P - sh) @ d > -0.01 * H) & (np.abs(P[:, 1] - y_arm) < 0.065 * H)] - sh
            phi = -sx * math.radians(drop)
            R = np.array([[math.cos(phi), 0, math.sin(phi)], [0, 1, 0], [-math.sin(phi), 0, math.cos(phi)]])
            Qr = Q @ R.T + sh
            S2 = Silhouette(Qr, S.c)
            i_sh = S2.i(sh[0] + sx * 0.004 * H)
            i_tip = S2.i(float(Qr[:, 0].max()) if sx > 0 else float(Qr[:, 0].min()))
            L2, th2, dp2 = medial_line(S2, range(i_sh, i_tip + step, step))
            a2 = arm_joints(L2, th2, dp2, float(sh[0]), sx, H, hand_frac, float(S2.x(i_tip)), S.c)
            back = lambda q: (np.asarray(q) - sh) @ R + sh  # noqa: E731
            for k in ('elbow', 'wrist', 'tip', 'knuckle', 'ftip'):
                a[k] = back(a2[k])
            a['hand_len'], a['bent'], a['wrist_found'], a['palm'] = a2['hand_len'], a2['bent'], a2['wrist_found'], a2['palm']
            notes.append(f'arm {s}: hanging {drop:.0f} deg, measured again turned horizontal')
        meas[f'arm_bend{s}'] = round(a['bent'] / H * 100, 1)
        meas[f'wrist_by{s}'] = a['wrist_found'] or 'narrowest'
        if not a['wrist_found']:
            notes.append(f'arm {s}: wrist from the narrowest section (no knuckles or flat hand found)')
        J['upperArm' + s] = a['sh']
        J['foreArm' + s] = a['elbow']
        J['hand' + s] = a['wrist']
        T['hand' + s] = a['knuckle']
        arm_info[s] = {'side_x': x_side, 'armpit_z': a['armpit_z'], 'thickness': a['th0'], 'tip': a['tip'],
                       'knuckle': a['knuckle'], 'ftip': a['ftip']}
        meas[f'palm{s}'] = a['palm']
        if a['palm'] != 'down':
            notes.append(f'arm {s}: palm facing {a["palm"]}, the hand will be turned palm down')
        meas[f'arm_drop{s}'] = round(drop, 1)
        meas[f'armpit{s}'] = (round(x_side, 3), round(a['armpit_z'], 3))
        meas[f'hand_len{s}'] = round(a['hand_len'], 3)

    # ---- spine, neck, head ---------------------------------------------------------------------
    ua_z = (J['upperArmL'][2] + J['upperArmR'][2]) / 2
    hips_z = hip_j + 0.045
    D = ua_z - hips_z
    if D < 0.1 * H:
        notes.append(f'shoulders too close to the hips ({D:.3f} m): check the fit')

    def torso_y(z):
        b = band(P, z - 0.008 * H, z + 0.008 * H, -0.05 * H, 0.05 * H)
        return mid(b[:, 1]) if len(b) else 0.0

    J['hips'] = np.array([0.0, torso_y(hips_z), hips_z])
    J['spine'] = np.array([0.0, torso_y(hips_z + SPINE_AT * D), hips_z + SPINE_AT * D])
    J['chest'] = np.array([0.0, torso_y(hips_z + CHEST_AT * D), hips_z + CHEST_AT * D])
    neck_z = ua_z + 0.055
    J['neck'] = np.array([0.0, torso_y(neck_z), neck_z])
    head_z = ua_z + 0.072 * H
    hb = band(P, head_z + 0.02 * H, head_z + 0.05 * H, -0.03 * H, 0.03 * H)
    J['head'] = np.array([0.0, mid(hb[:, 1]) if len(hb) else torso_y(head_z), head_z])
    T['head'] = np.array([0.0, J['head'][1], H - 0.03 * H])
    for s, sx in (('L', 1.0), ('R', -1.0)):
        # clavicle as in Rig.ts: 3.5 cm off the centre, 1 cm above the upper-arm joint
        J['shoulder' + s] = np.array([sx * 0.035, J['chest'][1], ua_z + 0.01])
        T['shoulder' + s] = J['upperArm' + s]
    meas['shoulders_z'] = round(float(ua_z), 3)
    meas['hips_z'] = round(float(hips_z), 3)

    extra = []
    for s in 'LR':
        a = arm_info[s]
        extra.append({'name': 'fingers' + s, 'head': a['knuckle'], 'tail': a['ftip'], 'parent': 'hand' + s})
        extra.append({'name': 'fingertips' + s, 'head': a['ftip'], 'tail': a['tip'], 'parent': 'fingers' + s})
    meas['arms'] = {s: {k: (np.round(v, 3).tolist() if isinstance(v, np.ndarray) else round(v, 3)) for k, v in a.items()}
                    for s, a in arm_info.items()}
    return Fit({k: np.asarray(v, float) for k, v in J.items()}, {k: np.asarray(v, float) for k, v in T.items()},
               extra, meas, notes)


def arm_side(S: Silhouette, P: np.ndarray, sx: float, H: float):
    """(torso side column, fingertip column, the arm's run per column). From the fingertips
    inwards the arm's section is followed run to run (hair spikes above it or things hanging
    below are other runs). The torso starts where the underside of that run
    - drops far down (the body continues below the armpit), or
    - steps down by more than half the arm's thickness and stays down (a cropped jacket over a
      narrower waist)."""
    tip_i = S.i(float(P[:, 0].max())) if sx > 0 else S.i(float(P[:, 0].min()))
    step = 1 if sx > 0 else -1
    cols, prev, runs = [], None, {}
    for i in range(tip_i, S.i(0.0), -step):
        r = S.track(i, runs.get(prev))
        if not r:
            continue
        runs[i] = r
        cols.append(i)
        if prev is not None and S.z(r[1]) < S.z(runs[prev][1]) - 0.1 * H:
            break
        prev = i
    bot = np.array([float(S.z(runs[i][1])) for i in cols])
    thick = np.array([float((runs[i][0] - runs[i][1] + 1) * S.c) for i in cols])
    out = np.abs(np.array([float(S.x(i)) for i in cols]) - float(S.x(tip_i)))
    w = max(3, int(0.05 * H / S.c))
    hold = max(2, int(0.02 * H / S.c))
    side = None
    for k in range(w, len(cols)):
        if bot[k] < bot[k - 1] - 0.1 * H:
            side = cols[k - 1]
            break
        # the step-down test only past the hand and forearm (fingers to palm is a step too)
        if out[k] < 0.15 * H:
            continue
        ref = float(np.median(bot[k - w:k]))
        th = float(np.median(thick[(out > 0.1 * H) & (out <= out[k])]))
        drop = max(0.6 * th, 0.025 * H)
        if len(bot[k:k + hold]) == hold and (bot[k:k + hold] < ref - drop).all():
            side = cols[k - 1]
            break
    if side is None or abs(S.x(side)) < 0.04 * H:
        raise RuntimeError('an arm does not separate from the torso (arms down or touching the body?)')
    return side, tip_i, {i: runs[i] for i in cols if (i - side) * step > 0}


def medial_line(S: Silhouette, cols, runs: dict | None = None):
    """per column: middle of the arm's run (x, y, z), its height and its depth. `runs`: the run of
    each column found by arm_side; else the run is followed from the first column"""
    line = []
    prev = None
    for i in cols:
        r = runs.get(i) if runs else None
        r = r or S.track(i, prev)
        if not r:
            continue
        prev = r
        top, bot = r
        y, depth = S.depth_mid(i, bot, top)
        line.append((float(S.x(i)), y, float(S.z((top + bot) / 2)), float((top - bot + 1) * S.c), depth))
    line = np.array(line)
    L = line[:, :3].copy()
    for c in (1, 2):
        L[:, c] = ndimage.uniform_filter1d(L[:, c], 5, mode='nearest')
    return L, line[:, 3], line[:, 4]


def arm_joints(L, th, dp, x_side: float, sx: float, H: float, hand_frac: float, tip_x: float, cell: float) -> dict:
    """shoulder, elbow, wrist and finger joints on an arm's medial line (arm roughly along X)"""
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(L, axis=0), axis=1))])
    out = np.abs(L[:, 0] - x_side)
    bottom = L[:, 2] - th / 2
    near = out < 0.02 * H
    armpit_z = float(np.median(bottom[near])) if near.any() else float(bottom[0])
    # shoulder joint: on the medial line just outside the torso side (in a T-pose the shoulder
    # ball sits above the armpit, halfway up the arm's section)
    j0 = int(np.argmin(np.abs(out - 0.006 * H)))
    sh = L[j0].copy()
    d_tip = arc[-1] - arc
    want = hand_frac * H
    ratio = np.log(np.maximum(dp, 1e-6) / np.maximum(th, 1e-6))
    area = th * np.where(dp > 0, dp, th)
    thick = np.minimum(th, np.where(dp > 0, dp, th))       # the hand's thickness, palm down or forward
    k = max(2, int(0.01 * H / cell))
    wi, found, knuckle_i = None, 'knuckles', None
    # 1. knuckles: the thickness drops sharply from the palm to the fingers held together; the
    #    wrist is about one finger length further in (palm ~ 1.1 x fingers), at the narrowest
    #    section there
    cand = [i for i in range(k, len(L) - k) if 0.03 * H < d_tip[i] < 0.085 * H]
    if cand:
        drop = np.array([np.median(thick[i - k:i]) / max(np.median(thick[i + 1:i + 1 + k]), 1e-6) for i in cand])
        j = int(np.argmax(drop))
        if drop[j] > 1.5:
            knuckle_i = cand[j]
            target = d_tip[knuckle_i] * 2.1
            near = np.nonzero(np.abs(d_tip - target) < 0.012 * H)[0]
            if len(near):
                wi = int(near[np.argmin(area[near])])
    # 2. where the round forearm section flattens into the hand (palm down: thin in z and wide in y;
    #    palm forward: the other way round), around the expected hand length
    if wi is None:
        found = 'flattening'
        fore = (d_tip > 1.6 * want) & (d_tip < 2.6 * want)
        base = float(np.median(ratio[fore])) if fore.sum() > 3 else float(np.median(ratio))
        flat = np.abs(ratio - base) > math.log(1.2)
        run = max(2, int(0.012 * H / cell))
        for i in np.nonzero((d_tip < 1.6 * want) & (d_tip > 0.5 * want))[0]:
            if flat[i:i + run].all():
                wi = max(int(i) - 1, 0)
                break
    # 3. the narrowest section around the expected hand length
    if wi is None:
        found = ''
        win = (d_tip > 0.6 * want) & (d_tip < 1.45 * want)
        score = area * (1 + 1.5 * ((d_tip - want) / want) ** 2)
        wi = int(np.nonzero(win)[0][np.argmin(score[win])]) if win.any() else int(np.argmin(np.abs(d_tip - want)))
    wrist = L[wi].copy()
    tip = L[-1].copy()
    tip[0] = tip_x
    # palm: down when the hand is wider in depth than tall; else the thumb (the bump near the
    # wrist) says which way it faces: up = palm to the front, down = palm to the back
    hand = slice(wi + 1, max(wi + 2, len(L) - max(2, (len(L) - wi) // 5)))
    aspect = float(np.median(ratio[hand])) if len(ratio[hand]) else 0.0
    palm = 'down'
    if aspect < -0.15:
        near_w = slice(wi + 1, wi + 1 + max(2, (len(L) - wi) // 2))
        top, bot = L[near_w, 2] + th[near_w] / 2, L[near_w, 2] - th[near_w] / 2
        up, down = float(np.median(top)) - wrist[2], wrist[2] - float(np.median(bot))
        palm = 'forward' if up >= down else 'back'
    # elbow: 52% of the way (bodySpec: 0.29 / 0.56), on the medial line. The bend of the
    # medial line is not used: sleeves (rolls, cuffs) move it more than a slightly bent elbow
    chord = wrist - sh
    p = sh + 0.52 * chord
    ei = int(np.argmin(np.abs(L[:, 0] - p[0])))
    elbow = np.array([p[0], L[ei, 1], L[ei, 2]])
    rel = L[:wi + 1] - sh
    t = np.clip(rel @ chord / max(chord @ chord, 1e-9), 0, 1)
    bent = float(np.linalg.norm(rel - t[:, None] * chord[None], axis=1).max())
    knuckle = L[knuckle_i].copy() if knuckle_i is not None else wrist + 0.6 * (tip - wrist)
    return {'sh': sh, 'elbow': elbow, 'wrist': wrist, 'tip': tip, 'knuckle': knuckle,
            'ftip': knuckle + 0.5 * (tip - knuckle), 'armpit_z': armpit_z, 'th0': float(th[j0]),
            'hand_len': float(d_tip[wi]), 'bent': bent, 'wrist_found': found, 'palm': palm}


def fit_spec(J: dict, female: bool = False, bulk: float = 1.0) -> dict:
    """Rig.ts body proportions from the T-pose joints (Blender coords): the inversion of the
    Rig formula, as build_lol.fit_spec does in game coordinates."""
    z = lambda b: float((J[b + 'L'][2] + J[b + 'R'][2]) / 2)  # noqa: E731
    ankle, knee, hip = z('foot'), z('shin'), z('thigh')
    hips = hip + 0.045
    ua = z('upperArm')
    s = {
        'hipHeight': hips,
        'spineLen': max(0.05, float(J['spine'][2]) - hips),
        'chestLen': 0.0,
        'neckLen': 0.0,
        'clavicle': float(J['upperArmL'][0] - J['upperArmR'][0]) / 2,
        'shoulderDrop': 0.0,
        'upperArm': float(np.linalg.norm(J['foreArmL'] - J['upperArmL']) + np.linalg.norm(J['foreArmR'] - J['upperArmR'])) / 2,
        'foreArm': float(np.linalg.norm(J['handL'] - J['foreArmL']) + np.linalg.norm(J['handR'] - J['foreArmR'])) / 2,
        'hipWidth': float(J['thighL'][0] - J['thighR'][0]) / 2,
        'thigh': hip - knee,
        'shin': knee - ankle,
        'footHeight': ankle,
        'bulk': bulk,
        'female': female,
    }
    spine_z = hips + s['spineLen']
    s['chestLen'] = max(0.08, float(J['chest'][2]) - spine_z)
    chest = spine_z + s['chestLen']
    s['shoulderDrop'] = ua + 0.01 - chest
    neck = chest + s['shoulderDrop'] + 0.045
    s['neckLen'] = max(0.12, float(J['head'][2]) - neck + 0.11)
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in s.items()}
