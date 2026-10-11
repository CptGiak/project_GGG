"""
Stroke-based sculpting on dense triangle meshes: the "hand".

The SDF toolkit builds primary forms well (blobs, blends, shells). What it cannot do is what a
sculptor's hand does on top: cut planes, pinch a crease, lay clay strips along a muscle, smooth a
transition. This module brings those brushes to a numpy mesh, with the formulas of Blender's
sculpt brushes (source/blender/editors/sculpt_paint/brushes/*.cc, Blender 5.0):

    draw         offset = area_normal * radius * strength, times the falloff
    inflate      each vertex along its own normal (x 0.25, as Blender)
    pinch        towards the stroke line (projected on the stroke's side and normal axes)
    crease       draw + pinch towards the line in the tangent plane (pinch factor squared)
    blob         crease with the pinch inverted (a rounded bead)
    clay_strips  towards a plane 0.18 r above the area centre; only vertices below it; square tip
    clay         the same with a round tip and a lower plane
    flatten      towards the area plane (both sides); fill = only below, scrape = only above
    smooth       Laplacian towards the neighbour average
    grab / snake_hook   move a region with the stroke (from the stroke's start positions)

A stroke is a polyline. Dabs are laid every `spacing` x radius along it (Blender's default 10 %
of the diameter = 0.2 r); each dab is scaled by the overlap factor so the whole stroke reaches
the nominal strength once, whatever the spacing (BRUSH_SPACE_ATTEN). Pressure tapers in and out.
X symmetry mirrors every dab.

Where the points come from is up to the caller:
  * 3D points (snapped onto the surface along the view or to the nearest point),
  * points read off an orthographic review render: `View` turns (u, w) on the view plane into
    surface hits, and `review()` renders those views with a millimetre grid to read them from,
  * anatomical landmarks + offsets (see examples/chess_master_sculpt.py).

The stroke list is the sculpt: replaying it on the base mesh rebuilds the result, so a stroke
can be edited or removed later (a "sculpt history" no human sculptor gets for free).
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from typing import Iterable, Sequence

import numpy as np
from scipy.spatial import cKDTree

F = np.float64

# =============================================================================================
# Falloff curves (BKE_brush_curve_strength, p = 1 - d / r)
# =============================================================================================


def curve(p: np.ndarray, kind: str = 'smooth') -> np.ndarray:
    p = np.clip(p, 0.0, 1.0)
    if kind == 'smooth':
        return 3 * p * p - 2 * p * p * p
    if kind == 'smoother':
        return p ** 3 * (p * (p * 6 - 15) + 10)
    if kind == 'sphere':
        return np.sqrt(np.clip(2 * p - p * p, 0, None))
    if kind == 'root':
        return np.sqrt(p)
    if kind == 'sharp':
        return p * p
    if kind == 'lin':
        return p
    if kind == 'pow4':
        return p ** 4
    if kind == 'invsquare':
        return p * (2 - p)
    if kind == 'constant':
        return np.ones_like(p)
    raise ValueError(kind)


def overlap_factor(spacing: float, kind: str = 'smooth') -> float:
    """1 / (largest sum of overlapping dab falloffs) for dabs every `spacing` radii
    (paint_stroke_integrate_overlap). Keeps a stroke's total effect independent of spacing."""
    if spacing >= 2.0:
        return 1.0
    best = 0.0
    for phase in np.linspace(0, spacing, 10, endpoint=False):
        xs = np.arange(-1 + phase, 1, spacing)
        best = max(best, float(curve(1 - np.abs(xs), kind).sum()))
    return 1.0 / best if best > 0 else 1.0


def cube_distance(lx: np.ndarray, ly: np.ndarray, roundness: float) -> np.ndarray:
    """calc_brush_cube_distances: normalised distance inside a square tip with rounded corners."""
    ax, ay = np.abs(lx), np.abs(ly)
    hard = 1.0 - roundness
    rr = 1.0 / max(roundness, 1e-6)
    d = np.zeros_like(ax)
    corner = np.minimum(ax, ay) > hard
    side = (~corner) & (np.maximum(ax, ay) > hard)
    d[corner] = np.hypot(ax[corner] - hard, ay[corner] - hard) * rr
    d[side] = (np.maximum(ax[side], ay[side]) - hard) * rr
    d[np.maximum(ax, ay) > 1.0] = 1.0
    return np.clip(d, 0, 1)


def _unit(a: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(a, axis=-1, keepdims=True)
    return a / np.maximum(n, 1e-12)


# =============================================================================================
# Mesh topology helpers
# =============================================================================================

def vertex_normals(v: np.ndarray, f: np.ndarray) -> np.ndarray:
    tri = v[f]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n = np.zeros_like(v)
    for k in range(3):
        n[:, 0] += np.bincount(f[:, k], fn[:, 0], len(v))
        n[:, 1] += np.bincount(f[:, k], fn[:, 1], len(v))
        n[:, 2] += np.bincount(f[:, k], fn[:, 2], len(v))
    return _unit(n)


def neighbours(f: np.ndarray, n_verts: int) -> tuple:
    """CSR adjacency (indptr, indices) of the unique edges."""
    e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    e = np.concatenate([e, e[:, ::-1]])
    key = e[:, 0].astype(np.int64) * n_verts + e[:, 1]
    key = np.unique(key)
    a, b = key // n_verts, key % n_verts
    indptr = np.zeros(n_verts + 1, np.int64)
    np.add.at(indptr, a + 1, 1)
    indptr = np.cumsum(indptr)
    return indptr, b.astype(np.int64)


def csr_gather(indptr: np.ndarray, indices: np.ndarray, idx: np.ndarray) -> tuple:
    """Entries of rows `idx` of a CSR structure: (flat entries, owning row position, counts)."""
    starts = indptr[idx]
    cnt = indptr[idx + 1] - starts
    total = int(cnt.sum())
    owner = np.repeat(np.arange(len(idx)), cnt)
    offs = np.arange(total) - np.repeat(np.cumsum(cnt) - cnt, cnt)
    return indices[np.repeat(starts, cnt) + offs], owner, cnt


def vertex_faces(f: np.ndarray, n_verts: int) -> tuple:
    """CSR vertex -> incident faces."""
    owner = f.reshape(-1)
    face = np.repeat(np.arange(len(f)), 3)
    order = np.argsort(owner, kind='stable')
    indptr = np.zeros(n_verts + 1, np.int64)
    np.add.at(indptr, owner + 1, 1)
    return np.cumsum(indptr), face[order].astype(np.int64)


def laplacian_delta(v: np.ndarray, indptr: np.ndarray, indices: np.ndarray, idx: np.ndarray | None = None) -> np.ndarray:
    """(neighbour average - v) for `idx` (all vertices if None)."""
    if idx is None:
        sums = np.add.reduceat(v[indices], indptr[:-1], axis=0)
        cnt = np.diff(indptr)[:, None]
        sums[cnt[:, 0] == 0] = 0
        return sums / np.maximum(cnt, 1) - v
    flat, owner, cnt = csr_gather(indptr, indices, idx)
    sums = np.zeros((len(idx), 3))
    for c in range(3):
        sums[:, c] = np.bincount(owner, v[flat, c], len(idx))
    return sums / np.maximum(cnt, 1)[:, None] - v[idx]


def cavity(v: np.ndarray, f: np.ndarray, normals: np.ndarray | None = None, iters: int = 6,
           indptr=None, indices=None) -> np.ndarray:
    """Signed concavity at the scale of `iters` smoothing steps: > 0 in creases and folds, < 0
    on ridges. (Distance from the surface to its smoothed copy, along the normal.)"""
    n = vertex_normals(v, f) if normals is None else normals
    if indptr is None:
        indptr, indices = neighbours(f, len(v))
    s = v.copy()
    for _ in range(iters):
        s = s + 0.5 * laplacian_delta(s, indptr, indices)
    return np.einsum('ij,ij->i', s - v, n)


# =============================================================================================
# Orthographic views: (u, w) on the view plane <-> surface points
# =============================================================================================

@dataclass
class View:
    """Orthographic view. az = 0 looks at the front (-Y side), az = 90 at the +X side; el tilts
    the camera up. (u, w) are metres along the image's right and up axes, measured from `center`.
    `half` is half the width of the visible square."""
    name: str
    az: float = 0.0
    el: float = 0.0
    center: tuple = (0.0, 0.0, 0.0)
    half: float = 0.13

    def basis(self) -> tuple:
        a, e = math.radians(self.az), math.radians(self.el)
        to_cam = np.array([math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)])
        fwd = -to_cam
        right = _unit(np.cross(fwd, [0.0, 0.0, 1.0]))
        up = np.cross(right, fwd)
        return right, up, fwd

    def offset(self) -> np.ndarray:
        """(u, w) of the view centre in absolute terms: grid labels and stroke points are
        absolute (u, w) = (p . right, p . up), the same numbers in every view that shares axes."""
        r, u, _ = self.basis()
        c = np.asarray(self.center, F)
        return np.array([c @ r, c @ u])

    def absolute(self, uw_abs: np.ndarray) -> np.ndarray:
        """Absolute (u, w) metres -> centre-relative (u, w)."""
        return np.asarray(uw_abs, F) - self.offset()

    def to_uw(self, p: np.ndarray) -> np.ndarray:
        r, u, _ = self.basis()
        q = np.asarray(p, F) - np.asarray(self.center, F)
        return np.stack([q @ r, q @ u], axis=-1)

    def depth(self, p: np.ndarray) -> np.ndarray:
        return (np.asarray(p, F) - np.asarray(self.center, F)) @ self.basis()[2]

    def to_pixel(self, p: np.ndarray, size: int) -> np.ndarray:
        uw = self.to_uw(p)
        s = size / (2 * self.half)
        return np.stack([size / 2 + uw[..., 0] * s, size / 2 - uw[..., 1] * s], axis=-1)

    def from_pixel(self, px: np.ndarray, size: int) -> np.ndarray:
        px = np.asarray(px, F)
        s = (2 * self.half) / size
        return np.stack([(px[..., 0] - size / 2) * s, (size / 2 - px[..., 1]) * s], axis=-1)


class RayCaster:
    """Hits of orthographic rays on a triangle mesh (nearest to the camera)."""

    def __init__(self, v: np.ndarray, f: np.ndarray, view: View):
        self.view = view
        self.v, self.f = v, f
        uw = view.to_uw(v)
        self.tri_uw = uw[f]                                   # (m, 3, 2)
        self.tri_d = view.depth(v)[f]                         # (m, 3)
        cen = self.tri_uw.mean(axis=1)
        self.ext = float(np.max(np.linalg.norm(self.tri_uw - cen[:, None], axis=2)))
        self.tree = cKDTree(cen)

    def hit(self, uw: np.ndarray) -> tuple:
        """uw (k, 2) -> points (k, 3) (nan where missed) and triangle ids (-1)."""
        uw = np.atleast_2d(np.asarray(uw, F))
        out = np.full((len(uw), 3), np.nan)
        tid = np.full(len(uw), -1)
        for i, q in enumerate(uw):
            cand = np.asarray(self.tree.query_ball_point(q, self.ext * 1.01), np.int64)
            if not len(cand):
                continue
            a, b, c = self.tri_uw[cand, 0], self.tri_uw[cand, 1], self.tri_uw[cand, 2]
            v0, v1, v2 = b - a, c - a, q - a
            den = v0[:, 0] * v1[:, 1] - v1[:, 0] * v0[:, 1]
            ok = np.abs(den) > 1e-18
            den = np.where(ok, den, 1.0)
            l1 = (v2[:, 0] * v1[:, 1] - v1[:, 0] * v2[:, 1]) / den
            l2 = (v0[:, 0] * v2[:, 1] - v2[:, 0] * v0[:, 1]) / den
            l0 = 1 - l1 - l2
            inside = ok & (l0 >= -1e-9) & (l1 >= -1e-9) & (l2 >= -1e-9)
            if not inside.any():
                continue
            d = (l0 * self.tri_d[cand, 0] + l1 * self.tri_d[cand, 1] + l2 * self.tri_d[cand, 2])
            d = np.where(inside, d, np.inf)
            k = int(np.argmin(d))
            t = cand[k]
            out[i] = l0[k] * self.v[self.f[t, 0]] + l1[k] * self.v[self.f[t, 1]] + l2[k] * self.v[self.f[t, 2]]
            tid[i] = t
        return out, tid


# =============================================================================================
# The sculpt
# =============================================================================================

BRUSHES = ('draw', 'inflate', 'pinch', 'crease', 'blob', 'clay', 'clay_strips', 'flatten', 'fill',
           'scrape', 'trim', 'smooth', 'relax', 'grab', 'snake_hook', 'mask')

# Defaults of Blender 5.2's Essentials presets (falloff, pinch, tip, spacing in radii).
PRESETS = {
    'clay_strips': dict(falloff='smoother', roundness=0.15, spacing=0.1),
    'crease': dict(falloff='pow4', pinch=0.8, spacing=0.06),
    'blob': dict(falloff='smooth', pinch=0.5, spacing=0.2),
    'clay': dict(falloff='smooth', hardness=0.65, spacing=0.06),
    'trim': dict(falloff='smooth', hardness=0.6, spacing=0.14),
    'draw': dict(falloff='smooth', spacing=0.2),
}


def preset(brush: str, **kw) -> dict:
    """Stroke keyword arguments: the Blender preset for `brush`, overridden by `kw`."""
    return {**PRESETS.get(brush, {}), **kw}


@dataclass
class Stroke:
    brush: str
    points: list                         # 3D points (already on or near the surface)
    radius: float = 0.004                # metres (or a list, one per point)
    strength: float = 0.5
    spacing: float = 0.2                 # in radii
    falloff: str = 'smooth'
    taper: tuple = (0.2, 0.2)            # pressure ramp in / out (fraction of the length)
    radius_taper: float = 0.0            # radius also shrinks with pressure (0 = constant)
    mirror: bool = True                  # X symmetry
    view: tuple | None = None            # direction towards the viewer: front-faces-only weighting
    pinch: float = 0.5                   # crease / blob pinch factor
    roundness: float = 0.18              # clay strips tip
    plane_offset: float = 0.0            # extra plane offset (radii) for plane brushes
    hardness: float = 0.0
    smooth_points: bool = True           # Catmull-Rom the polyline
    name: str = ''

    def to_json(self) -> dict:
        d = dict(self.__dict__)
        d['points'] = [list(map(float, p)) for p in self.points]
        return d


class Sculpt:
    def __init__(self, v: np.ndarray, f: np.ndarray, mask: np.ndarray | None = None):
        self.v = np.asarray(v, F).copy()
        self.f = np.asarray(f, np.int64)
        self.mask = np.zeros(len(self.v)) if mask is None else np.asarray(mask, F).copy()
        self.indptr, self.indices = neighbours(self.f, len(self.v))
        self.vf_ptr, self.vf_idx = vertex_faces(self.f, len(self.v))
        self.n = vertex_normals(self.v, self.f)
        self._dirty: list = []
        self._tree = None
        self._tree_v = None
        self._drift = 0.0
        self.log: list = []

    # ---- spatial queries ------------------------------------------------------------------
    def _rebuild(self):
        self._tree = cKDTree(self.v)
        self._drift = 0.0

    def tree(self) -> cKDTree:
        if self._tree is None or self._drift > 0.0015:
            self._rebuild()
        return self._tree

    def gather(self, c: np.ndarray, r: float) -> tuple:
        idx = self.tree().query_ball_point(c, r + self._drift)
        idx = np.fromiter(idx, np.int64, len(idx))
        if not len(idx):
            return idx, np.zeros(0)
        d = np.linalg.norm(self.v[idx] - c, axis=1)
        keep = d < r
        return idx[keep], d[keep]

    def nearest(self, p: np.ndarray, k: int = 8) -> tuple:
        """Closest vertex to p (exact on current positions among k candidates)."""
        _, cand = self.tree().query(p, k=k)
        cand = np.atleast_1d(cand)
        d = np.linalg.norm(self.v[cand] - p, axis=1)
        j = int(np.argmin(d))
        return int(cand[j]), float(d[j])

    def snap(self, p: np.ndarray) -> np.ndarray:
        """Project p onto the surface (tangent plane of the nearest vertex)."""
        i, _ = self.nearest(np.asarray(p, F))
        n = self.n[i]
        return p - np.dot(p - self.v[i], n) * n

    def refresh(self):
        """Recompute the normals of the vertices moved since the last refresh (exact: every face
        around them is recomputed)."""
        if not self._dirty:
            return
        idx = np.unique(np.concatenate(self._dirty))
        self._dirty = []
        if len(idx) > len(self.v) // 3:
            self.n = vertex_normals(self.v, self.f)
            return
        # normals of every vertex touching a moved face change; recompute those vertices fully
        faces = np.unique(csr_gather(self.vf_ptr, self.vf_idx, idx)[0])
        ring = np.unique(self.f[faces].reshape(-1))
        allf, owner, _ = csr_gather(self.vf_ptr, self.vf_idx, ring)
        tri = self.v[self.f[allf]]
        fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        acc = np.zeros((len(ring), 3))
        for c in range(3):
            acc[:, c] = np.bincount(owner, fn[:, c], len(ring))
        self.n[ring] = _unit(acc)

    def _move(self, idx: np.ndarray, t: np.ndarray):
        if not len(idx):
            return
        self.v[idx] += t
        self._dirty.append(idx)
        self._drift += float(np.sqrt((t * t).sum(axis=1).max()))

    # ---- area plane / normal ----------------------------------------------------------------
    def area(self, idx, d, r, falloff='smooth') -> tuple:
        sel = d < r * 0.5
        if sel.sum() < 3:
            sel = np.ones_like(d, bool)
        w = curve(1 - d[sel] / r, falloff) + 1e-6
        nrm = _unit((self.n[idx[sel]] * w[:, None]).sum(axis=0))
        cen = (self.v[idx[sel]] * w[:, None]).sum(axis=0) / w.sum()
        return cen, nrm

    # ---- one dab ----------------------------------------------------------------------------
    def dab(self, brush: str, c: np.ndarray, r: float, s: float, direction: np.ndarray | None = None,
            view: np.ndarray | None = None, falloff: str = 'smooth', pinch: float = 0.5,
            roundness: float = 0.18, plane_offset: float = 0.0, hardness: float = 0.0,
            pinch_amount: float | None = None):
        """One brush dab at surface point c. `s` already includes pressure and the overlap factor.
        `pinch_amount` (crease/blob) = pinch^2 x pressure x overlap; as in Blender it does not scale
        with the strength, so a weak crease is relatively sharper."""
        reach = r * (1.5 if brush == 'clay_strips' else 1.0)
        idx, d = self.gather(c, reach)
        if not len(idx):
            return
        if brush in ('smooth', 'relax'):
            fac = curve(1 - d / reach, falloff) * (1 - self.mask[idx])
            if view is not None:
                fac *= np.clip((self.n[idx] @ view + 0.1) / 0.4, 0, 1)
            delta = laplacian_delta(self.v, self.indptr, self.indices, idx)
            if brush == 'relax':
                # slide along the surface only (Blender's Relax / topology slide): even spacing,
                # same shape
                nn = self.n[idx]
                delta = delta - nn * np.einsum('ij,ij->i', delta, nn)[:, None]
            self._move(idx, delta * np.clip(fac * s, 0, 1)[:, None])
            return
        if brush == 'mask':
            fac = curve(1 - d / reach, falloff)
            self.mask[idx] = np.clip(self.mask[idx] + fac * s, 0, 1)
            return

        dd = d / reach
        if hardness > 0:
            dd = np.where(dd < hardness, 0.0, (dd - hardness) / (1 - hardness))
        fac = (1 - self.mask[idx])
        if view is not None:
            fac = fac * np.clip((self.n[idx] @ view + 0.1) / 0.4, 0, 1)
        cen, nrm = self.area(idx, d, reach)
        if direction is None or np.linalg.norm(direction) < 1e-12:
            direction = np.cross(nrm, [0.0, 0.0, 1.0]) if abs(nrm[2]) < 0.9 else np.cross(nrm, [1.0, 0, 0])
        direction = _unit(direction - np.dot(direction, nrm) * nrm)
        side = _unit(np.cross(nrm, direction))

        if brush in ('draw', 'crease', 'blob', 'pinch', 'inflate', 'grab', 'snake_hook'):
            fac = fac * curve(1 - dd, falloff)

        if brush == 'draw':
            t = nrm * (r * s) * fac[:, None]
        elif brush == 'inflate':
            t = self.n[idx] * (r * s * 0.25) * fac[:, None]
        elif brush == 'pinch':
            disp = c - self.v[idx]
            t = (np.outer(disp @ side, side) + np.outer(disp @ nrm, nrm)) * (fac * s)[:, None]
        elif brush in ('crease', 'blob'):
            disp = c - self.v[idx]
            disp = disp - np.outer(disp @ nrm, nrm)
            k = (pinch * pinch if pinch_amount is None else pinch_amount) * (-1.0 if brush == 'blob' else 1.0)
            t = disp * (fac * k)[:, None] + nrm * (r * s) * fac[:, None]
        elif brush == 'trim':
            # plane fixed for the whole stroke (set by stroke()): cut everything above it
            pp, pn = self._trim_plane
            h = (self.v[idx] - pp) @ pn
            fac = fac * curve(1 - dd, falloff) * (h > 0)
            t = -np.outer(h, pn) * (fac * abs(s))[:, None]
        elif brush in ('clay_strips', 'clay', 'flatten', 'fill', 'scrape'):
            sign = 1.0 if s >= 0 else -1.0
            if brush == 'clay_strips':
                off = 0.15 + plane_offset
            elif brush == 'clay':
                off = 0.1 + plane_offset
            else:
                off = plane_offset
            plane_pt = cen + nrm * (r * off * sign)
            rel = self.v[idx] - plane_pt
            h = rel @ nrm                                  # > 0 above the plane
            if brush == 'clay_strips':
                q = self.v[idx] - c
                lx, ly = (q @ side) / r, (q @ direction) / r
                dist = cube_distance(lx, ly, roundness)
                fac = fac * curve(1 - dist, falloff)
                # parabolic depth falloff (clay_strips.cc): strongest half a radius below the plane
                z = -h * sign / r
                fac = fac * np.clip(z * (1 - z), 0, None) * 4.0
            else:
                fac = fac * curve(1 - dd, falloff)
            if brush in ('clay_strips', 'clay', 'fill'):
                fac = np.where(h * sign < 0, fac, 0.0)
            elif brush == 'scrape':
                fac = np.where(h * sign > 0, fac, 0.0)
            t = -np.outer(h, nrm) * (fac * abs(s))[:, None]
        else:
            raise ValueError(brush)
        self._move(idx, t)

    # ---- strokes ----------------------------------------------------------------------------
    @staticmethod
    def resample(points: np.ndarray, step: float, smooth: bool = True) -> tuple:
        """Points every `step` metres along the polyline (Catmull-Rom through the points) and
        their tangents."""
        P = np.asarray(points, F)
        if len(P) == 1:
            return P, np.zeros_like(P)
        if smooth and len(P) > 2:
            ext = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
            dense = []
            for i in range(1, len(ext) - 2):
                p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
                for t in np.linspace(0, 1, 16, endpoint=False):
                    t2, t3 = t * t, t * t * t
                    dense.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                                        + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
            dense.append(P[-1])
            P = np.array(dense)
        seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
        L = np.concatenate([[0], np.cumsum(seg)])
        if L[-1] < 1e-9:
            return P[:1], np.zeros((1, 3))
        n = max(2, int(math.ceil(L[-1] / step)) + 1)
        s = np.linspace(0, L[-1], n)
        out = np.stack([np.interp(s, L, P[:, k]) for k in range(3)], axis=1)
        tan = np.gradient(out, axis=0)
        return out, _unit(tan)

    def stroke(self, st: Stroke):
        pts = np.asarray(st.points, F)
        rad = np.atleast_1d(np.asarray(st.radius, F))
        r_ref = float(rad.max())
        dabs, tans = self.resample(pts, st.spacing * float(rad.min()), st.smooth_points)
        # per-dab radius (interpolated along the point list) and pressure
        u = np.linspace(0, 1, len(dabs))
        r_d = np.interp(u, np.linspace(0, 1, len(rad)), rad) if len(rad) > 1 else np.full(len(dabs), r_ref)
        a_in, a_out = st.taper
        pr = np.ones(len(dabs))
        if a_in > 0:
            pr *= curve(np.clip(u / a_in, 0, 1), 'smooth')
        if a_out > 0:
            pr *= curve(np.clip((1 - u) / a_out, 0, 1), 'smooth')
        if len(dabs) == 1:
            pr[:] = 1.0
        if st.radius_taper > 0:
            r_d = r_d * (1 - st.radius_taper + st.radius_taper * pr)
        ov = overlap_factor(st.spacing, st.falloff) if len(dabs) > 1 else 1.0
        if st.brush == 'trim':
            self._trim_plane = self._stroke_plane(dabs, r_d, st.plane_offset)
        view = None if st.view is None else _unit(np.asarray(st.view, F))
        if st.brush in ('grab', 'snake_hook'):
            self._grab(st, dabs, r_d, pr)
            self.refresh()
            return
        for i in range(len(dabs)):
            c = self.snap(dabs[i])
            s = st.strength * pr[i] * ov
            if st.brush in ('smooth', 'relax'):
                s = st.strength * pr[i]
            pa = st.pinch ** 2 * pr[i] * ov
            self.dab(st.brush, c, r_d[i], s, tans[i], view, st.falloff, st.pinch, st.roundness,
                     st.plane_offset, st.hardness, pa)
            if st.mirror and abs(c[0]) > 1e-4:
                cm = c * np.array([-1.0, 1, 1])
                tm = tans[i] * np.array([-1.0, 1, 1])
                vm = None if view is None else view * np.array([-1.0, 1, 1])
                self.dab(st.brush, self.snap(cm), r_d[i], s, tm, vm, st.falloff, st.pinch, st.roundness,
                         st.plane_offset, st.hardness, pa)
            if i % 4 == 3:
                self.refresh()
        self.refresh()
        self.log.append(st)

    def _stroke_plane(self, dabs: np.ndarray, r_d: np.ndarray, depth: float) -> tuple:
        """Trim plane: area normal and centre averaged along the whole stroke, lowered by
        `depth` radii (a flat cut through the bumps the stroke crosses)."""
        ns, cs = [], []
        for c, r in zip(dabs, r_d):
            idx, d = self.gather(self.snap(c), r)
            if len(idx):
                cen, nrm = self.area(idx, d, r)
                ns.append(nrm)
                cs.append(cen)
        n = _unit(np.mean(ns, axis=0))
        return np.mean(cs, axis=0) - n * float(np.mean(r_d)) * depth, n

    _trim_plane = (np.zeros(3), np.array([0.0, 0.0, 1.0]))

    def _grab(self, st: Stroke, path: np.ndarray, r_d: np.ndarray, pr: np.ndarray):
        """grab: the region around the first point follows the whole path (falloff frozen at the
        start). snake_hook: the region is re-picked at every step, so it can pull long shapes."""
        mirror_pass = [False, True] if st.mirror else [False]
        for mir in mirror_pass:
            sgn = np.array([-1.0, 1, 1]) if mir else np.ones(3)
            P = path * sgn
            if st.brush == 'grab':
                c0 = self.snap(P[0])
                idx, d = self.gather(c0, r_d[0])
                fac = curve(1 - d / r_d[0], st.falloff) * (1 - self.mask[idx]) * st.strength
                self._move(idx, np.outer(fac, P[-1] - P[0]))
            else:
                cur = self.snap(P[0])
                for i in range(1, len(P)):
                    delta = P[i] - P[i - 1]
                    idx, d = self.gather(cur, r_d[i])
                    fac = curve(1 - d / r_d[i], st.falloff) * (1 - self.mask[idx]) * st.strength * pr[i]
                    self._move(idx, np.outer(fac, delta))
                    cur = cur + delta
        self.log.append(st)

    def smooth_region(self, center, radius: float, iters: int = 3, strength: float = 0.5, falloff='smooth'):
        for _ in range(iters):
            idx, d = self.gather(np.asarray(center, F), radius)
            fac = curve(1 - d / radius, falloff) * (1 - self.mask[idx]) * strength
            self._move(idx, laplacian_delta(self.v, self.indptr, self.indices, idx) * fac[:, None])
        self.refresh()

    def relax_all(self, iters: int = 1, strength: float = 0.3):
        """Light global smoothing (removes faceting after many strokes)."""
        for _ in range(iters):
            self.v += laplacian_delta(self.v, self.indptr, self.indices) * (strength * (1 - self.mask))[:, None]
        self._rebuild()
        self._dirty = []
        self.n = vertex_normals(self.v, self.f)

    # ---- strokes from views -----------------------------------------------------------------
    def on_view(self, view: View, uw: Sequence) -> np.ndarray:
        """Surface points under (u, w) view coordinates (metres), nearest to the camera."""
        rc = RayCaster(self.v, self.f, view)
        pts, tid = rc.hit(np.asarray(uw, F))
        if (tid < 0).any():
            bad = np.asarray(uw)[tid < 0]
            raise ValueError(f'{view.name}: points miss the mesh: {bad.tolist()}')
        return pts

    def save(self, path: str, **extra):
        np.savez(path, v=self.v.astype(np.float32), f=self.f.astype(np.int32), mask=self.mask.astype(np.float32), **extra)


# =============================================================================================
# Stroke files
# =============================================================================================

def strokes_from_json(path: str) -> list:
    with open(path) as fh:
        data = json.load(fh)
    return [Stroke(**d) for d in data]


def strokes_to_json(strokes: Iterable[Stroke], path: str):
    with open(path, 'w') as fh:
        json.dump([s.to_json() for s in strokes], fh, indent=1)


# =============================================================================================
# Painting a sculpted mesh: a mesh distance field for paint.paint, plus fine cavity
# =============================================================================================

def mesh_sdf(v: np.ndarray, f: np.ndarray, normals: np.ndarray | None = None):
    """An charkit.sdf.SDF over a closed mesh (nearest-vertex distance, signed by its normal), so
    paint.paint can compute AO and colour zones on sculpted geometry."""
    from charkit import sdf as S

    n = vertex_normals(v, f) if normals is None else normals
    tree = cKDTree(v)
    edge = float(np.median(np.linalg.norm(v[f[:, 0]] - v[f[:, 1]], axis=1)))

    class MeshSDF(S.SDF):
        def __init__(self):
            self.lo = v.min(axis=0).astype(np.float32)
            self.hi = v.max(axis=0).astype(np.float32)

        def _eval(self, p, m):
            p = np.asarray(p, F)
            d, i = tree.query(p, k=1)
            q = p - v[i]
            plane = np.einsum('ij,ij->i', q, n[i])
            sign = np.where(plane >= 0, 1.0, -1.0)
            out = np.where(d < 2 * edge, plane, sign * d)
            return out.astype(np.float32)

    return MeshSDF()


# =============================================================================================
# Review renders with a millimetre grid (to read stroke coordinates off)
# =============================================================================================

def review(v: np.ndarray, f: np.ndarray, views: Sequence[View], out_dir: str, prefix: str, size: int = 900,
           samples: int = 24, grid_mm: float = 5.0, landmarks: dict | None = None, extra: Sequence = (),
           color='#a0968c', colors: np.ndarray | None = None) -> list:
    """Clay renders of the mesh from orthographic views, with a grid every `grid_mm` and labels
    every 2 grid steps in millimetres of (u, w). `extra` = [(v, f, hex)] context meshes (eyes,
    hair) rendered in a flat colour. Returns the image paths."""
    import bpy

    from charkit import studio as ST

    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    ST.reset()
    objs = []
    ob = ST.mesh_from_arrays('sculpt', v.astype(np.float32), f.astype(np.int32))
    if colors is not None:
        ST.set_vertex_colors(ob, colors)
        ST.assign(ob, ST.principled('skin', '#ffffff', rough=0.55, sss=0.1, attr='Col', sss_radius=(1.0, 0.4, 0.25)))
    else:
        ST.assign(ob, ST.principled('clay', color, rough=0.5))
    objs.append(ob)
    for k, (ev, ef, hexc) in enumerate(extra):
        eo = ST.mesh_from_arrays(f'ctx{k}', np.asarray(ev, np.float32), np.asarray(ef, np.int32))
        ST.assign(eo, ST.principled(f'ctx{k}', hexc, rough=0.6))
        objs.append(eo)
    ST.world((0.13, 0.135, 0.15), 0.25)
    ST.render_settings(size, size, samples=samples, transparent=False)
    scn = bpy.context.scene
    cam = ST.camera('CAM')
    cam.data.type = 'ORTHO'
    paths = []
    for vw in views:
        right, up, fwd = vw.basis()
        cen = np.asarray(vw.center, F)
        loc = cen - fwd * 1.0
        cam.location = loc.tolist()
        import mathutils
        R = mathutils.Matrix((right.tolist(), up.tolist(), (-fwd).tolist())).transposed()
        cam.rotation_euler = R.to_euler()
        cam.data.ortho_scale = 2 * vw.half
        cam.data.clip_start, cam.data.clip_end = 0.01, 3.0
        scn.camera = cam
        _key_lights(cen, right, up, fwd, vw.half)
        path = os.path.join(out_dir, f'{prefix}_{vw.name}.png')
        scn.render.filepath = path
        bpy.ops.render.render(write_still=True)
        _grid_overlay(path, vw, size, grid_mm, landmarks)
        paths.append(path)
    return paths


def _key_lights(cen, right, up, fwd, half):
    import bpy
    for o in [o for o in bpy.data.objects if o.name.startswith('SL_')]:
        bpy.data.objects.remove(o, do_unlink=True)
    import mathutils
    dist = half * 8

    def area(name, direction, power, size, color=(1, 1, 1)):
        d = _unit(np.asarray(direction, F))
        lt = bpy.data.lights.new(name, 'AREA')
        lt.energy = power
        lt.size = size
        lt.color = color
        o = bpy.data.objects.new(name, lt)
        bpy.context.scene.collection.objects.link(o)
        o.location = (cen + d * dist).tolist()
        o.rotation_euler = mathutils.Vector((-d).tolist()).to_track_quat('-Z', 'Y').to_euler()

    # raking key from upper left (reveals relief), a softer second key from the right so the far
    # side of a 3/4 view still reads, weak fill, cool rim
    k = (half / 0.13) ** 2
    area('SL_key', -fwd * 0.45 - right * 0.8 + up * 0.75, 70 * k, half * 1.2, (1.0, 0.95, 0.88))
    area('SL_key2', -fwd * 0.6 + right * 0.75 + up * 0.55, 14 * k, half * 1.2, (1.0, 0.97, 0.92))
    area('SL_fill', -fwd * 0.9 + right * 0.2 - up * 0.3, 10 * k, half * 4, (0.8, 0.88, 1.0))
    area('SL_rim', fwd * 0.8 + right * 0.5 + up * 0.4, 45 * k, half * 2, (0.8, 0.88, 1.0))


def _grid_overlay(path: str, vw: View, size: int, grid_mm: float, landmarks: dict | None):
    from PIL import Image, ImageDraw, ImageFont

    im = Image.open(path).convert('RGB')
    ov = Image.new('RGBA', im.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(ov)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 12)
    except OSError:
        font = ImageFont.load_default()
    s = size / (2 * vw.half)
    step = grid_mm / 1000.0
    ou, ow = vw.offset()
    k0, k1 = int(np.floor((ou - vw.half) / step)), int(np.ceil((ou + vw.half) / step))
    for k in range(k0, k1 + 1):
        major = k % 2 == 0
        x = size / 2 + (k * step - ou) * s
        dr.line([(x, 0), (x, size)], fill=(120, 220, 255, 70 if major else 30), width=1)
        if major:
            dr.text((x + 2, 2), f'{k * grid_mm:+.0f}', fill=(150, 230, 255, 230), font=font)
    k0, k1 = int(np.floor((ow - vw.half) / step)), int(np.ceil((ow + vw.half) / step))
    for k in range(k0, k1 + 1):
        major = k % 2 == 0
        y = size / 2 - (k * step - ow) * s
        dr.line([(0, y), (size, y)], fill=(120, 220, 255, 70 if major else 30), width=1)
        if major:
            dr.text((2, y + 1), f'{k * grid_mm:+.0f}', fill=(150, 230, 255, 230), font=font)
    if landmarks:
        for name, p in landmarks.items():
            px = vw.to_pixel(np.asarray(p, F)[None], size)[0]
            dr.ellipse([px[0] - 3, px[1] - 3, px[0] + 3, px[1] + 3], outline=(255, 210, 60, 255), width=2)
            dr.text((px[0] + 5, px[1] - 6), name, fill=(255, 220, 90, 255), font=font)
    dr.text((size - 200, size - 18), f'{vw.name}: u right, w up (mm)', fill=(150, 230, 255, 230), font=font)
    Image.alpha_composite(im.convert('RGBA'), ov).convert('RGB').save(path)


def compare(paths_before: Sequence[str], paths_after: Sequence[str], out: str, labels=('prima', 'dopo')):
    from PIL import Image
    ims = [Image.open(p) for p in list(paths_before) + list(paths_after)]
    w, h = ims[0].size
    cols = len(paths_before)
    sheet = Image.new('RGB', (w * cols, h * 2), (30, 31, 36))
    for i, im in enumerate(ims):
        sheet.paste(im.resize((w, h)), ((i % cols) * w, (i // cols) * h))
    sheet.save(out)
    return out
