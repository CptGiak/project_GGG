"""
SDF sculpting: organic forms from signed distance primitives blended like clay, meshed with
marching cubes. The same field answers AO, curvature and skin-weight queries later on, which
is why characters are modelled here instead of as lofted tubes.

Units are metres, axes are Blender's: X = character's left, -Y = character's front, Z = up.
Distances are negative inside. Everything is vectorised: p is an (N, 3) float32 array.

    from charkit import sdf as S
    head = S.ellipsoid((0, 0, 1.6), (0.075, 0.09, 0.11))
    nose = S.round_cone((0, -0.09, 1.6), (0, -0.115, 1.56), 0.012, 0.016)
    face = S.blend(head, nose, k=0.015)
    verts, faces = S.mesh(face, voxel=0.0015)
"""
from __future__ import annotations

import math
from typing import Callable, Sequence

import numpy as np

F = np.float32
BIG = F(1e3)  # "far away" value; never use inf (smin of inf produces NaN)

# Pruning contract: node._eval(p, m) must return exact distances for points within m metres of
# the node's bounds. Further away a child may return its box distance, an underestimate that is
# still >= m, which no blend (k <= m / 2) or displacement band (<= m) can be fooled by.
# Every operator passes the margin down, enlarged by what it needs itself.
PRUNE = 0.006


def _v(x) -> np.ndarray:
    return np.asarray(x, dtype=F).reshape(3)


def rot(x: float = 0.0, y: float = 0.0, z: float = 0.0) -> np.ndarray:
    """Rotation matrix from XYZ Euler angles in degrees (applied X, then Y, then Z)."""
    rx, ry, rz = (math.radians(a) for a in (x, y, z))
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return (Rz @ Ry @ Rx).astype(F)


def look_rot(fwd, up=(0, 0, 1)) -> np.ndarray:
    """Rotation whose local +Z points along `fwd` (local +Y as close to `up` as possible)."""
    z = _v(fwd) / max(np.linalg.norm(fwd), 1e-9)
    u = _v(up)
    x = np.cross(u, z)
    if np.linalg.norm(x) < 1e-6:
        x = np.cross(_v((0, 1, 0)), z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], axis=1).astype(F)


# =============================================================================================
# Node base
# =============================================================================================

class SDF:
    """Base node. Subclasses implement `_eval` and set `lo` / `hi` (axis-aligned bounds)."""
    lo: np.ndarray
    hi: np.ndarray
    tag: str | None = None

    def __call__(self, p: np.ndarray, margin: float | None = None) -> np.ndarray:
        return self._eval(np.asarray(p, dtype=F), PRUNE if margin is None else margin)

    def _eval(self, p: np.ndarray, m: float) -> np.ndarray:  # pragma: no cover - abstract
        raise NotImplementedError

    # --- pruned evaluation: exact within `margin` of the bounds, box distance outside --------
    def eval_pruned(self, p: np.ndarray, margin: float) -> np.ndarray:
        lo, hi = self.lo - margin, self.hi + margin
        inside = np.all((p >= lo) & (p <= hi), axis=1)
        out = box_distance(p, self.lo, self.hi)
        if inside.any():
            out[inside] = self._eval(p[inside], margin)
        return out

    # --- sugar -----------------------------------------------------------------------------
    def __or__(self, o: 'SDF') -> 'SDF':
        return Union([self, o])

    def __sub__(self, o: 'SDF') -> 'SDF':
        return Subtract(self, o)

    def __and__(self, o: 'SDF') -> 'SDF':
        return Intersect(self, o)

    def shell(self, t: float) -> 'SDF':
        return Shell(self, t)

    def grow(self, r: float) -> 'SDF':
        return Offset(self, -r)

    def displace(self, fn: Callable[[np.ndarray], np.ndarray], amp: float) -> 'SDF':
        return Displace(self, fn, amp)

    def mirror_x(self) -> 'SDF':
        return MirrorX(self)

    def named(self, tag: str) -> 'SDF':
        self.tag = tag
        return self


def box_distance(p: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> np.ndarray:
    c = (lo + hi) * 0.5
    h = (hi - lo) * 0.5
    q = np.abs(p - c) - h
    return (np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(q.max(axis=1), 0)).astype(F)


# =============================================================================================
# Primitives (after Inigo Quilez, iquilezles.org/articles/distfunctions)
# =============================================================================================

class Sphere(SDF):
    def __init__(self, c, r):
        self.c, self.r = _v(c), F(r)
        self.lo, self.hi = self.c - r, self.c + r

    def _eval(self, p, m=0.0):
        return np.linalg.norm(p - self.c, axis=1) - self.r


class Ellipsoid(SDF):
    """Approximate ellipsoid distance (good near the surface, which is all meshing needs)."""
    def __init__(self, c, radii, R=None):
        self.c, self.r = _v(c), _v(radii)
        self.R = np.eye(3, dtype=F) if R is None else np.asarray(R, F)
        ext = np.abs(self.R) @ self.r
        self.lo, self.hi = self.c - ext, self.c + ext

    def _eval(self, p, m=0.0):
        q = (p - self.c) @ self.R  # world -> local
        k0 = np.linalg.norm(q / self.r, axis=1)
        k1 = np.linalg.norm(q / (self.r * self.r), axis=1)
        return (k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)).astype(F)


class RoundCone(SDF):
    """Capsule with different radii at the two ends (exact). r1 == r2 gives a capsule."""
    def __init__(self, a, b, r1, r2=None):
        self.a, self.b = _v(a), _v(b)
        self.r1 = F(r1)
        self.r2 = F(r1 if r2 is None else r2)
        rm = max(self.r1, self.r2)
        self.lo = np.minimum(self.a, self.b) - rm
        self.hi = np.maximum(self.a, self.b) + rm
        ba = self.b - self.a
        self.l2 = F(ba @ ba)
        self.rr = self.r1 - self.r2
        self.a2 = self.l2 - self.rr * self.rr
        self.il2 = F(1.0 / max(self.l2, 1e-12))

    def _eval(self, p, m=0.0):
        ba = self.b - self.a
        pa = p - self.a
        y = pa @ ba
        z = y - self.l2
        xv = pa * self.l2 - np.outer(y, ba)
        x2 = np.einsum('ij,ij->i', xv, xv)
        y2 = y * y * self.l2
        z2 = z * z * self.l2
        k = np.sign(self.rr) * self.rr * self.rr * x2
        d = np.empty(len(p), F)
        c1 = np.sign(z) * self.a2 * z2 > k
        c2 = (~c1) & (np.sign(y) * self.a2 * y2 < k)
        c3 = ~(c1 | c2)
        d[c1] = np.sqrt(x2[c1] + z2[c1]) * self.il2 - self.r2
        d[c2] = np.sqrt(x2[c2] + y2[c2]) * self.il2 - self.r1
        d[c3] = (np.sqrt(x2[c3] * self.a2 * self.il2) + y[c3] * self.rr) * self.il2 - self.r1
        return d


def capsule(a, b, r) -> RoundCone:
    return RoundCone(a, b, r, r)


class RoundBox(SDF):
    """Box with half-extents `half`, rounded by `r` (r is inside the half-extents)."""
    def __init__(self, c, half, r=0.0, R=None):
        self.c, self.h, self.r = _v(c), _v(half), F(r)
        self.R = np.eye(3, dtype=F) if R is None else np.asarray(R, F)
        ext = np.abs(self.R) @ self.h
        self.lo, self.hi = self.c - ext, self.c + ext

    def _eval(self, p, m=0.0):
        q = np.abs((p - self.c) @ self.R) - (self.h - self.r)
        return (np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(q.max(axis=1), 0) - self.r).astype(F)


class Torus(SDF):
    """Ring in the local XY plane (axis = local Z)."""
    def __init__(self, c, R_major, r_minor, R=None, sx: float = 1.0, sy: float = 1.0):
        self.c, self.Rm, self.rm = _v(c), F(R_major), F(r_minor)
        self.sx, self.sy = F(sx), F(sy)
        self.R = np.eye(3, dtype=F) if R is None else np.asarray(R, F)
        e = self.Rm * max(sx, sy) + self.rm
        self.lo, self.hi = self.c - e, self.c + e

    def _eval(self, p, m=0.0):
        q = (p - self.c) @ self.R
        xy = np.sqrt((q[:, 0] / self.sx) ** 2 + (q[:, 1] / self.sy) ** 2) - self.Rm
        return (np.sqrt(xy * xy + q[:, 2] ** 2) - self.rm).astype(F)


class Cylinder(SDF):
    """Capped cylinder along local Z, centred on c, half-height h, edge rounding r."""
    def __init__(self, c, radius, h, r=0.0, R=None):
        self.c, self.rad, self.h, self.r = _v(c), F(radius), F(h), F(r)
        self.R = np.eye(3, dtype=F) if R is None else np.asarray(R, F)
        e = math.hypot(radius, h)
        self.lo, self.hi = self.c - e, self.c + e

    def _eval(self, p, m=0.0):
        q = (p - self.c) @ self.R
        dx = np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2) - self.rad + self.r
        dz = np.abs(q[:, 2]) - self.h + self.r
        return (np.minimum(np.maximum(dx, dz), 0) + np.sqrt(np.maximum(dx, 0) ** 2 + np.maximum(dz, 0) ** 2) - self.r).astype(F)


class Plane(SDF):
    """Half-space: negative on the side opposite to the normal n (through point o)."""
    def __init__(self, o, n, extent: float = 5.0):
        self.o = _v(o)
        self.n = _v(n) / np.linalg.norm(n)
        self.lo, self.hi = self.o - extent, self.o + extent

    def _eval(self, p, m=0.0):
        return ((p - self.o) @ self.n).astype(F)


def tube(points: Sequence, radii: Sequence[float] | float, k: float = 0.0) -> SDF:
    """Chain of round cones through `points` (limbs, fingers, hair clumps, straps, folds)."""
    pts = [_v(p) for p in points]
    rs = [float(radii)] * len(pts) if np.isscalar(radii) else [float(r) for r in radii]
    segs = [RoundCone(pts[i], pts[i + 1], rs[i], rs[i + 1]) for i in range(len(pts) - 1)]
    return Union(segs, k=k) if len(segs) > 1 else segs[0]


def catmull(points: Sequence, samples: int = 6) -> list:
    """Catmull-Rom resampling (smooth curve through the control points)."""
    P = [_v(p) for p in points]
    out = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, len(P) - 1)]
        for s in range(samples):
            t = s / samples
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    out.append(P[-1])
    return out


def smooth_tube(points: Sequence, radii: Sequence[float] | float, samples: int = 4, k: float = 0.0) -> SDF:
    """Tube along a Catmull-Rom curve; radii are interpolated along the control points."""
    pts = catmull(points, samples)
    if np.isscalar(radii):
        radii = [float(radii)] * len(points)
    t_ctrl = np.linspace(0, 1, len(radii))
    t = np.linspace(0, 1, len(pts))
    rs = np.interp(t, t_ctrl, radii)
    return tube(pts, rs, k=k)


# Convenience constructors with the names used in the references
sphere = Sphere
ellipsoid = Ellipsoid
round_cone = RoundCone
round_box = RoundBox
torus = Torus
cylinder = Cylinder
plane = Plane


# =============================================================================================
# Operators
# =============================================================================================

def smin(a: np.ndarray, b: np.ndarray, k: float) -> np.ndarray:
    """Polynomial smooth minimum: blends within distance k (the clay 'fillet')."""
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return (b * (1 - h) + a * h - k * h * (1 - h)).astype(F)


def smax(a: np.ndarray, b: np.ndarray, k: float) -> np.ndarray:
    return -smin(-a, -b, k)


class Union(SDF):
    """Union of children; k > 0 blends them smoothly. Children are evaluated only near their
    own bounds (exact distances are only needed close to the surface)."""
    def __init__(self, children: Sequence[SDF], k: float = 0.0):
        self.ch = [c for c in children if c is not None]
        self.k = float(k)
        self.lo = np.min([c.lo for c in self.ch], axis=0) - self.k
        self.hi = np.max([c.hi for c in self.ch], axis=0) + self.k

    def _eval(self, p, m=0.0):
        m2 = max(m, 2.0 * self.k + 0.001)
        d = self.ch[0].eval_pruned(p, m2)
        for c in self.ch[1:]:
            d = smin(d, c.eval_pruned(p, m2), self.k)
        return d


def blend(*shapes: SDF, k: float) -> SDF:
    """Smooth union of all shapes with blend radius k."""
    return Union(list(shapes), k=k)


def union(*shapes: SDF) -> SDF:
    return Union(list(shapes))


class Subtract(SDF):
    """a minus b (k > 0 rounds the cut)."""
    def __init__(self, a: SDF, b: SDF, k: float = 0.0):
        self.a, self.b, self.k = a, b, float(k)
        self.lo, self.hi = a.lo, a.hi

    def _eval(self, p, m=0.0):
        m2 = max(m, 2.0 * self.k + 0.001)
        return smax(self.a.eval_pruned(p, m2), -self.b.eval_pruned(p, m2), self.k)


def carve(a: SDF, *cutters: SDF, k: float = 0.0) -> SDF:
    out = a
    for c in cutters:
        out = Subtract(out, c, k)
    return out


class Intersect(SDF):
    def __init__(self, a: SDF, b: SDF, k: float = 0.0):
        self.a, self.b, self.k = a, b, float(k)
        self.lo = np.maximum(a.lo, b.lo)
        self.hi = np.minimum(a.hi, b.hi)
        # an intersection with a plane (huge bounds) keeps the other's bounds
        self.lo = np.where(self.lo > self.hi, a.lo, self.lo)
        self.hi = np.where(self.lo > self.hi, a.hi, self.hi)

    def _eval(self, p, m=0.0):
        m2 = max(m, 2.0 * self.k + 0.001)
        return smax(self.a.eval_pruned(p, m2), self.b.eval_pruned(p, m2), self.k)


def intersect(a: SDF, b: SDF, k: float = 0.0) -> SDF:
    return Intersect(a, b, k)


class Shell(SDF):
    """Hollow layer of thickness 2t centred on the surface (cloth over a body offset)."""
    def __init__(self, a: SDF, t: float):
        self.a, self.t = a, F(t)
        self.lo, self.hi = a.lo - t, a.hi + t

    def _eval(self, p, m=0.0):
        return np.abs(self.a.eval_pruned(p, m + float(self.t))) - self.t


class Offset(SDF):
    """Moves the surface outwards by -d (grow(r) == Offset(-r))."""
    def __init__(self, a: SDF, d: float):
        self.a, self.d = a, F(d)
        g = max(-float(d), 0.0)
        self.lo, self.hi = a.lo - g, a.hi + g

    def _eval(self, p, m=0.0):
        return self.a.eval_pruned(p, m + abs(float(self.d))) + self.d


class Displace(SDF):
    """Surface detail: d - amp * fn(p). fn returns roughly [-1, 1] (or [0, 1] for grooves).
    Only evaluated in a thin band around the surface, so detail is cheap."""
    def __init__(self, a: SDF, fn: Callable[[np.ndarray], np.ndarray], amp: float):
        self.a, self.fn, self.amp = a, fn, F(amp)
        self.lo, self.hi = a.lo - abs(amp), a.hi + abs(amp)
        self.band = 2.0 * abs(float(amp)) + 0.002

    def _eval(self, p, m=0.0):
        d = self.a.eval_pruned(p, max(m, self.band) + abs(float(self.amp)))
        band = np.abs(d) < self.band
        if band.any():
            d[band] = d[band] - self.amp * self.fn(p[band]).astype(F)
        return d


class MirrorX(SDF):
    """Symmetry across the X = 0 plane: model the character's left side (+X) once."""
    def __init__(self, a: SDF):
        self.a = a
        m = max(abs(a.lo[0]), abs(a.hi[0]))
        self.lo = np.array([-m, a.lo[1], a.lo[2]], F)
        self.hi = np.array([m, a.hi[1], a.hi[2]], F)

    def _eval(self, p, m=0.0):
        q = p.copy()
        q[:, 0] = np.abs(q[:, 0])
        return self.a.eval_pruned(q, m)


class Warp(SDF):
    """Domain deformation: evaluates `a` at fn(p). Keep the warp gentle (it is not distance-
    preserving); `grow` enlarges the bounds by the maximum displacement of the warp."""
    def __init__(self, a: SDF, fn: Callable[[np.ndarray], np.ndarray], grow: float = 0.05):
        self.a, self.fn = a, fn
        self.lo, self.hi = a.lo - grow, a.hi + grow

    def _eval(self, p, m=0.0):
        return self.a.eval_pruned(self.fn(p).astype(F), m)


class Fn(SDF):
    """Wrap any vectorised function p -> distance with explicit bounds."""
    def __init__(self, fn: Callable[[np.ndarray], np.ndarray], lo, hi):
        self.fn = fn
        self.lo, self.hi = _v(lo), _v(hi)

    def _eval(self, p, m=0.0):
        return self.fn(p).astype(F)


# =============================================================================================
# Noise and surface patterns (inputs to Displace)
# =============================================================================================

_PERM = np.random.RandomState(1337).permutation(256)
_PERM = np.concatenate([_PERM, _PERM]).astype(np.int32)
_GRAD = np.array([[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
                  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1]], F)


def perlin(p: np.ndarray, freq: float = 1.0, seed: int = 0) -> np.ndarray:
    """Gradient noise in about [-1, 1]. freq is in cycles per metre."""
    q = p * F(freq) + F(seed * 17.31)
    i0 = np.floor(q).astype(np.int64)
    f = (q - i0).astype(F)
    i0 &= 255
    u = f * f * f * (f * (f * 6 - 15) + 10)

    def g(ix, iy, iz, fx, fy, fz):
        h = _PERM[_PERM[_PERM[ix] + iy] + iz] & 15
        gv = _GRAD[h]
        return gv[:, 0] * fx + gv[:, 1] * fy + gv[:, 2] * fz

    x0, y0, z0 = i0[:, 0], i0[:, 1], i0[:, 2]
    x1, y1, z1 = (x0 + 1) & 255, (y0 + 1) & 255, (z0 + 1) & 255
    fx, fy, fz = f[:, 0], f[:, 1], f[:, 2]
    n000 = g(x0, y0, z0, fx, fy, fz)
    n100 = g(x1, y0, z0, fx - 1, fy, fz)
    n010 = g(x0, y1, z0, fx, fy - 1, fz)
    n110 = g(x1, y1, z0, fx - 1, fy - 1, fz)
    n001 = g(x0, y0, z1, fx, fy, fz - 1)
    n101 = g(x1, y0, z1, fx - 1, fy, fz - 1)
    n011 = g(x0, y1, z1, fx, fy - 1, fz - 1)
    n111 = g(x1, y1, z1, fx - 1, fy - 1, fz - 1)
    ux, uy, uz = u[:, 0], u[:, 1], u[:, 2]
    nx00 = n000 + ux * (n100 - n000)
    nx10 = n010 + ux * (n110 - n010)
    nx01 = n001 + ux * (n101 - n001)
    nx11 = n011 + ux * (n111 - n011)
    nxy0 = nx00 + uy * (nx10 - nx00)
    nxy1 = nx01 + uy * (nx11 - nx01)
    return (nxy0 + uz * (nxy1 - nxy0)).astype(F)


def fbm(p: np.ndarray, freq: float = 1.0, octaves: int = 4, gain: float = 0.5, seed: int = 0) -> np.ndarray:
    out = np.zeros(len(p), F)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += F(amp) * perlin(p, freq * (2 ** o), seed + o)
        tot += amp
        amp *= gain
    return out / F(tot)


def stretched(fn: Callable[[np.ndarray], np.ndarray], axis, squash: float) -> Callable[[np.ndarray], np.ndarray]:
    """Anisotropic pattern: features elongated along `axis` by `squash` (hair strands, fibres,
    brush strokes). squash = 0.1 makes features 10x longer along the axis."""
    a = _v(axis) / np.linalg.norm(axis)

    def f(p):
        along = p @ a
        q = p + np.outer(along * (F(squash) - 1), a)
        return fn(q)
    return f


def grooves(axis, spacing: float, width: float = 0.35, wobble: float = 0.0, wobble_freq: float = 30.0,
            seed: int = 0) -> Callable[[np.ndarray], np.ndarray]:
    """Parallel grooves (wrinkles, fabric ribs, carved lines) across `axis`, returning 0..1
    (1 = bottom of the groove). Use as Displace(..., amp=-depth) to cut them."""
    a = _v(axis) / np.linalg.norm(axis)

    def f(p):
        t = p @ a / F(spacing)
        if wobble:
            t = t + F(wobble) * perlin(p, wobble_freq, seed)
        s = np.abs(t - np.round(t)) * 2  # 0 at line centre, 1 between lines
        return np.clip(1 - s / F(width), 0, 1) ** 2
    return f


def masked(fn: Callable[[np.ndarray], np.ndarray], mask: SDF, falloff: float) -> Callable[[np.ndarray], np.ndarray]:
    """Restricts a pattern to the inside of `mask` with a soft edge of width `falloff`."""
    def f(p):
        w = np.clip(-mask(p) / F(falloff), 0, 1)
        w = w * w * (3 - 2 * w)
        return fn(p) * w
    return f


# =============================================================================================
# Meshing
# =============================================================================================

def sample(sdf: SDF, lo, hi, voxel: float, coarse: int = 4, band: float = 2.0) -> tuple:
    """Dense distance grid over [lo, hi]. A coarse pass (aligned with the fine grid) finds the
    cells near the surface; exact values are computed only there. Every other fine voxel only
    needs the right sign, which a far cell shares at all its corners."""
    from scipy import ndimage

    lo = _v(lo)
    hi = _v(hi)
    c = int(coarse)
    cv = voxel * c
    nc = np.maximum(np.ceil((hi - lo) / cv).astype(int) + 1, 2)
    n = (nc - 1) * c + 1
    axes_c = [lo[i] + np.arange(nc[i], dtype=F) * F(cv) for i in range(3)]
    G = np.stack(np.meshgrid(*axes_c, indexing='ij'), axis=-1).reshape(-1, 3)
    dc = np.empty(len(G), F)
    step = 2_000_000
    for s in range(0, len(G), step):
        dc[s:s + step] = sdf(G[s:s + step])
    dc = dc.reshape(nc)
    near = ndimage.binary_dilation(np.abs(dc) < F(cv * band), iterations=1)
    # per-cell flags: a cell is refined when any of its 8 corners is near the surface
    cell = np.zeros(nc - 1, bool)
    sign = np.zeros(nc - 1, F)
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                sl = (slice(dx, dx + nc[0] - 1), slice(dy, dy + nc[1] - 1), slice(dz, dz + nc[2] - 1))
                cell |= near[sl]
    sign = np.where(dc[:-1, :-1, :-1] < 0, F(-1), F(1))

    def up(a):
        a = np.repeat(np.repeat(np.repeat(a, c, 0), c, 1), c, 2)
        return np.pad(a, [(0, 1), (0, 1), (0, 1)], mode='edge')

    d = up(sign * F(cv * band * 2))
    mask = up(cell)
    fi = np.argwhere(mask)
    if len(fi):
        P = (lo + fi.astype(F) * F(voxel)).astype(F)
        out = np.empty(len(P), F)
        for s in range(0, len(P), step):
            out[s:s + step] = sdf(P[s:s + step])
        d[fi[:, 0], fi[:, 1], fi[:, 2]] = out
    return d, lo


def mesh(sdf: SDF, voxel: float = 0.003, lo=None, hi=None, pad: float = 0.01, coarse: int = 4) -> tuple:
    """Marching-cubes mesh of the zero level set. Returns (verts (V,3), faces (F,3)) with
    outward-facing triangles."""
    from skimage import measure

    lo = (sdf.lo - pad) if lo is None else _v(lo)
    hi = (sdf.hi + pad) if hi is None else _v(hi)
    d, origin = sample(sdf, lo, hi, voxel, coarse=coarse)
    verts, faces, _, _ = measure.marching_cubes(d, level=0.0, spacing=(voxel, voxel, voxel), allow_degenerate=False)
    verts = (verts + origin).astype(F)
    faces = faces.astype(np.int64)
    # orient: triangle normals should follow the field gradient (outwards)
    tri = verts[faces]
    nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    cen = tri.mean(axis=1)
    sub = np.linspace(0, len(faces) - 1, min(len(faces), 2000)).astype(int)
    g = gradient(sdf, cen[sub])
    if np.einsum('ij,ij->i', nrm[sub], g).mean() < 0:
        faces = faces[:, ::-1].copy()
    return verts, faces


def gradient(sdf: SDF, p: np.ndarray, h: float = 5e-4) -> np.ndarray:
    """Central-difference gradient (unnormalised)."""
    p = np.asarray(p, F)
    e = np.eye(3, dtype=F) * F(h)
    g = np.stack([sdf(p + e[i]) - sdf(p - e[i]) for i in range(3)], axis=1)
    return g


def normals(sdf: SDF, p: np.ndarray, h: float = 5e-4) -> np.ndarray:
    g = gradient(sdf, p, h)
    return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)


def ambient_occlusion(sdf: SDF, p: np.ndarray, n: np.ndarray, step: float = 0.012, count: int = 5,
                      strength: float = 1.0) -> np.ndarray:
    """Cheap SDF ambient occlusion (march along the normal, compare distance to step length).
    1 = open, 0 = fully occluded. step ~ size of the creases you want to darken."""
    occ = np.zeros(len(p), F)
    w = 1.0
    for i in range(1, count + 1):
        h = F(step * i)
        d = sdf(p + n * h)
        occ += F(w) * np.maximum(h - d, 0) / h
        w *= 0.6
    return np.clip(1 - strength * occ / 2.2, 0, 1).astype(F)


def curvature(sdf: SDF, p: np.ndarray, h: float = 0.004) -> np.ndarray:
    """Mean-curvature proxy from the Laplacian of the field at scale h: > 0 convex (edges,
    knuckles, nose tip), < 0 concave (creases, wrinkles, folds)."""
    p = np.asarray(p, F)
    e = np.eye(3, dtype=F) * F(h)
    d0 = sdf(p)
    lap = sum(sdf(p + e[i]) + sdf(p - e[i]) - 2 * d0 for i in range(3)) / F(h * h)
    return (lap * F(h)).astype(F)


def nearest_tag(parts: Sequence[SDF], p: np.ndarray) -> np.ndarray:
    """Index of the part closest to each point (material / bone assignment)."""
    D = np.stack([pt.eval_pruned(p, 0.02) for pt in parts], axis=1)
    return np.argmin(D, axis=1)


class Transform(SDF):
    """Places a shape modelled in its own local frame: p_local = R^T (p - t) / s.
    R = rot(...) or look_rot(...), s = uniform scale. Build ears, hands, props once, place many."""
    def __init__(self, a: SDF, t=(0, 0, 0), R=None, s: float = 1.0):
        self.a, self.t, self.s = a, _v(t), F(s)
        self.R = np.eye(3, dtype=F) if R is None else np.asarray(R, F)
        corners = np.array([[x, y, z] for x in (a.lo[0], a.hi[0]) for y in (a.lo[1], a.hi[1]) for z in (a.lo[2], a.hi[2])], F)
        w = (corners * self.s) @ self.R.T + self.t
        self.lo, self.hi = w.min(axis=0), w.max(axis=0)

    def _eval(self, p, m=0.0):
        q = ((p - self.t) @ self.R) / self.s
        return self.a.eval_pruned(q, m / float(self.s)) * self.s


def place(a: SDF, t=(0, 0, 0), R=None, s: float = 1.0) -> SDF:
    return Transform(a, t, R, s)


def ridged(fn: Callable[[np.ndarray], np.ndarray]) -> Callable[[np.ndarray], np.ndarray]:
    """1 - |noise|: sharp ridges/creases (hair clumps, cloth crumples, bark, wrinkles)."""
    def f(p):
        return 1.0 - 2.0 * np.abs(fn(p))
    return f


def shell(a: SDF, t: float) -> SDF:
    return Shell(a, t)


def grow(a: SDF, r: float) -> SDF:
    return Offset(a, -r)


# =============================================================================================
# Hair as locks (stylised hair reads as a few big clumps, not as noise)
# =============================================================================================

def lock(points: Sequence, r_root: float, r_mid: float, r_tip: float = 0.0015, samples: int = 4,
         strands: float = 0.0, strand_scale: float = 0.004, seed: int = 0) -> SDF:
    """One tapered clump of hair along a Catmull-Rom curve (thick in the first third, pointed
    tip). strands > 0 cuts a few grooves along the lock (amplitude in metres)."""
    n = len(points)
    radii = np.interp(np.linspace(0, 1, n), [0.0, 0.35, 1.0], [r_root, r_mid, r_tip])
    t = smooth_tube(points, list(radii), samples=samples, k=min(r_mid * 0.5, 0.004))
    if strands > 0:
        a = _v(points[-1]) - _v(points[0])
        pat = stretched(ridged(lambda p, s=seed: perlin(p, 1.0 / strand_scale, s)), a, 0.12)
        t = Displace(t, pat, strands)
    return t


def lock_field(roots: Sequence, flow: Callable[[np.ndarray, int], list], radius: Callable[[int], tuple],
               k: float = 0.003, strands: float = 0.0, strand_scale: float = 0.004) -> SDF:
    """Many locks: flow(root, i) returns the control points of lock i (starting at its root),
    radius(i) returns (r_root, r_mid, r_tip). Locks are blended with k (small k = separated
    clumps, large k = a single mass)."""
    locks = []
    for i, r in enumerate(roots):
        pts = flow(_v(r), i)
        rr = radius(i)
        locks.append(lock(pts, *rr, strands=strands, strand_scale=strand_scale, seed=i))
    return Union(locks, k=k)


def jitter(seed: int, scale: float = 1.0) -> Callable[[int], np.ndarray]:
    """Deterministic per-index random vector in [-scale, scale]^3 (lock variation)."""
    rs = np.random.RandomState(seed)
    table = rs.uniform(-1, 1, size=(4096, 3)).astype(F)
    return lambda i: table[i % 4096] * F(scale)


def snap(shape: SDF, points, offset: float = 0.0, iters: int = 4) -> np.ndarray:
    """Moves points onto the surface of `shape` (then `offset` metres outwards along the normal).
    Use it to plant hair roots, buttons, straps and props on a body instead of guessing
    coordinates: roots guessed by hand end up buried or floating."""
    p = np.asarray(points, F).reshape(-1, 3).copy()
    for _ in range(iters):
        d = shape(p)
        n = normals(shape, p)
        p = p - n * d[:, None]
    if offset:
        p = p + normals(shape, p) * F(offset)
    return p


def raycast(shape: SDF, origins, direction, max_dist: float = 1.0, steps: int = 256, eps: float = 1e-4) -> np.ndarray:
    """Sphere tracing: distance along `direction` to the first hit (inf where nothing is hit).
    Handy to check what the camera will see (e.g. is the eyeball visible through the lids?)."""
    O = np.asarray(origins, F).reshape(-1, 3)
    D = np.asarray(direction, F).reshape(-1, 3)
    D = D / np.linalg.norm(D, axis=1, keepdims=True)
    if len(D) == 1:
        D = np.repeat(D, len(O), axis=0)
    t = np.zeros(len(O), F)
    done = np.zeros(len(O), bool)
    for _ in range(steps):
        act = ~done
        if not act.any():
            break
        d = shape(O[act] + D[act] * t[act, None])
        hit = d < eps
        idx = np.where(act)[0]
        done[idx[hit]] = True
        t[idx[~hit]] += np.maximum(d[~hit], eps)
        done[t > max_dist] = True
    return np.where(t > max_dist, np.inf, t)


class Lathe(SDF):
    """Solid of revolution around the local Z axis from a closed 2D profile [(r, z), ...]
    (r >= 0, listed from the bottom of the axis round to the top of the axis). Chess pieces,
    buttons, bottles, columns, knobs, gas canisters."""
    def __init__(self, profile: Sequence, c=(0, 0, 0), R=None):
        P = np.asarray(profile, np.float64)
        if P[0, 0] > 1e-9:
            P = np.vstack([[0.0, P[0, 1]], P])
        if P[-1, 0] > 1e-9:
            P = np.vstack([P, [0.0, P[-1, 1]]])
        self.P = P.astype(F)
        self.c = _v(c)
        self.R = np.eye(3, dtype=F) if R is None else np.asarray(R, F)
        rmax = float(P[:, 0].max())
        zmin, zmax = float(P[:, 1].min()), float(P[:, 1].max())
        corners = np.array([[x, y, z] for x in (-rmax, rmax) for y in (-rmax, rmax) for z in (zmin, zmax)], F)
        w = corners @ self.R.T + self.c
        self.lo, self.hi = w.min(axis=0), w.max(axis=0)

    def _eval(self, p, m=0.0):
        q = (p - self.c) @ self.R
        r = np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2)
        z = q[:, 2]
        # 2D polygon distance (profile mirrored to -r so the axis is inside) with winding sign
        P = np.vstack([self.P, self.P[::-1] * np.array([-1, 1], F)])
        d2 = np.full(len(q), np.inf, F)
        inside = np.zeros(len(q), bool)
        for i in range(len(P)):
            a, b = P[i], P[(i + 1) % len(P)]
            e = b - a
            w0 = r - a[0]
            w1 = z - a[1]
            t = np.clip((w0 * e[0] + w1 * e[1]) / max(float(e @ e), 1e-12), 0, 1)
            dx, dy = w0 - e[0] * t, w1 - e[1] * t
            d2 = np.minimum(d2, dx * dx + dy * dy)
            c1 = z >= a[1]
            c2 = z < b[1]
            c3 = e[0] * w1 > e[1] * w0
            flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
            inside ^= flip
        d = np.sqrt(d2)
        return np.where(inside, -d, d).astype(F)


def lathe(profile, c=(0, 0, 0), R=None) -> Lathe:
    return Lathe(profile, c, R)


class Chain(SDF):
    """Flattened ribbon along a curve (scarves, belts, straps, cloth tails): a smooth union of
    oriented ellipsoids. width/thick may be callables of t in [0, 1]."""
    def __init__(self, points: Sequence, width, thick, up=(0, 0, 1), samples: int = 6, k: float = 0.004):
        pts = catmull(points, samples)
        n = len(pts)
        parts = []
        for i in range(n - 1):
            a, b = pts[i], pts[i + 1]
            t = i / max(n - 2, 1)
            w = width(t) if callable(width) else width
            th = thick(t) if callable(thick) else thick
            mid = (a + b) / 2
            ln = float(np.linalg.norm(b - a))
            z = (b - a) / max(ln, 1e-9)
            u = _v(up(t)) if callable(up) else _v(up)
            x = np.cross(u, z)
            if np.linalg.norm(x) < 1e-6:
                x = np.cross(_v((1, 0, 0)), z)
            x /= np.linalg.norm(x)
            y = np.cross(z, x)
            R = np.stack([x, y, z], axis=1).astype(F)
            parts.append(Ellipsoid(mid, (w / 2, th / 2, ln * 0.75 + th), R))
        self.u = Union(parts, k=k)
        self.lo, self.hi = self.u.lo, self.u.hi

    def _eval(self, p, m=0.0):
        return self.u._eval(p, m)


def ribbon(points, width, thick, up=(0, 0, 1), samples: int = 6, k: float = 0.004) -> Chain:
    return Chain(points, width, thick, up, samples, k)


class Scale(SDF):
    """Non-uniform scale about `center` (approximate: the distance is corrected by the smallest
    factor, so it stays a safe bound). Turns round lathe/tube shapes into elliptic ones."""
    def __init__(self, a: SDF, factors, center=(0, 0, 0)):
        self.a, self.s, self.c = a, _v(factors), _v(center)
        self.lo = (a.lo - self.c) * self.s + self.c
        self.hi = (a.hi - self.c) * self.s + self.c
        self.k = F(self.s.min())

    def _eval(self, p, m=0.0):
        q = (p - self.c) / self.s + self.c
        return self.a.eval_pruned(q, m / float(self.k)) * self.k


def scale(a: SDF, factors, center=(0, 0, 0)) -> SDF:
    return Scale(a, factors, center)
