"""
Painterly vertex colour: the hand-painted look (Deadlock, Arcane, Blizzard) comes from light
and form information painted into the albedo, not from flat fills. For every vertex:

  base colour (palette) -> colour zones (warm nose/cheeks/ears, cool jaw...) -> ambient occlusion
  (darker AND warmer/more saturated in crevices) -> cavity/edge (crease darkening, rim wear
  highlights) -> top-down light (warm above, cool below) -> low-frequency hue/value variation and
  stretched "brush strokes".

All of it is computed from the same SDF the shape came from, so it is fast and needs no UVs.
Colours are given in sRGB hex and written as linear floats to a POINT colour attribute.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Sequence

import numpy as np

from . import sdf as S

F = np.float32


def hex_rgb(h: str) -> np.ndarray:
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], F)


def to_lin(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(F)


def to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055).astype(F)


def _smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


@dataclass
class Zone:
    """A soft region (inside `shape`, fading over `falloff` metres) tinted towards `color`."""
    shape: S.SDF
    color: str
    strength: float = 0.5
    falloff: float = 0.02
    mode: str = 'mix'  # 'mix' | 'multiply' | 'screen'


@dataclass
class Look:
    base: str
    zones: Sequence[Zone] = field(default_factory=list)
    ao_step: float = 0.008           # size of the creases to darken (metres)
    ao_strength: float = 0.9
    ao_tint: str = '#5a2a2a'         # occluded areas shift towards this (warm, saturated)
    cavity: float = 0.35             # crease darkening from curvature
    edge: float = 0.25               # convex edge lightening (worn edges, light catching forms)
    curv_scale: float = 0.007
    top_light: float = 0.18          # warm above / cool below
    warm: str = '#fff1d6'
    cool: str = '#6f86a8'
    var_freq: float = 18.0           # low-frequency colour variation (cycles per metre)
    var_amount: float = 0.06
    stroke_axis: tuple = (0.0, 0.0, 1.0)
    stroke_squash: float = 0.25
    stroke_freq: float = 140.0
    stroke_amount: float = 0.05
    pattern: Callable[[np.ndarray], np.ndarray] | None = None   # optional 0..1 mask -> pattern_color
    pattern_color: str = '#000000'
    pattern_strength: float = 0.0


def _subsampled(fn, v: np.ndarray, n: np.ndarray, limit: int = 120_000) -> np.ndarray:
    """Evaluates a smooth per-vertex quantity on at most `limit` vertices and interpolates the
    rest (inverse-distance, 4 neighbours). AO and curvature vary over millimetres, so dense
    marching-cubes meshes do not need them at every vertex."""
    if len(v) <= limit:
        return fn(v, n)
    from scipy.spatial import cKDTree
    idx = np.random.RandomState(0).choice(len(v), limit, replace=False)
    vals = fn(v[idx], n[idx])
    d, nb = cKDTree(v[idx]).query(v, k=4)
    w = 1.0 / np.maximum(d, 1e-6)
    w /= w.sum(axis=1, keepdims=True)
    return (vals[nb] * w).sum(axis=1).astype(F)


def mesh_normals(verts: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Area-weighted vertex normals (cheap; no SDF evaluations)."""
    v = np.asarray(verts, F)
    tri = v[faces]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    vn = np.zeros_like(v)
    for k in range(3):
        np.add.at(vn, faces[:, k], fn)
    return (vn / np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)).astype(F)


def paint(verts: np.ndarray, normals: np.ndarray, shape: S.SDF, look: Look, occluder: S.SDF | None = None) -> np.ndarray:
    """Returns linear RGB per vertex. `occluder` = union of every part that can cast AO on this
    one (defaults to the part itself)."""
    v = np.asarray(verts, F)
    n = np.asarray(normals, F)
    col = np.tile(to_lin(hex_rgb(look.base)), (len(v), 1))

    # colour zones
    for z in look.zones:
        w = _smooth(-z.shape(v) / F(z.falloff)) * F(z.strength)
        zc = to_lin(hex_rgb(z.color))
        if z.mode == 'multiply':
            target = col * zc
        elif z.mode == 'screen':
            target = 1 - (1 - col) * (1 - zc)
        else:
            target = np.broadcast_to(zc, col.shape)
        col = col + (target - col) * w[:, None]

    # optional pattern (tweed, stripes, checker...)
    if look.pattern is not None and look.pattern_strength > 0:
        w = np.clip(look.pattern(v), 0, 1) * F(look.pattern_strength)
        col = col + (to_lin(hex_rgb(look.pattern_color)) - col) * w[:, None]

    # ambient occlusion: darker and shifted towards a warm saturated tint (painterly shadows)
    occ_src = occluder if occluder is not None else shape
    ao = _subsampled(lambda vv, nn: S.ambient_occlusion(occ_src, vv + nn * F(0.0006), nn, step=look.ao_step, count=5,
                                                        strength=look.ao_strength), v, n)
    tint = to_lin(hex_rgb(look.ao_tint))
    shade = col * (0.35 + 0.65 * ao[:, None])
    shade = shade + (col * tint * 1.6 - shade) * ((1 - ao) * 0.35)[:, None]
    col = np.clip(shade, 0, None)

    # cavity / edges from curvature
    if look.cavity > 0 or look.edge > 0:
        k = _subsampled(lambda vv, nn: S.curvature(shape, vv, look.curv_scale), v, n)
        k = k / (np.percentile(np.abs(k), 95) + 1e-6)
        cav = np.clip(-k, 0, 1) * F(look.cavity)
        edg = np.clip(k, 0, 1) * F(look.edge)
        col = col * (1 - cav[:, None] * 0.6) * (1 + edg[:, None] * 0.6)

    # top-down light painted in: warm above, cool below (the "hand-painted" key light)
    if look.top_light > 0:
        up = n[:, 2]
        w_warm = np.clip(up, 0, 1) * F(look.top_light)
        w_cool = np.clip(-up, 0, 1) * F(look.top_light)
        col = col + (col * to_lin(hex_rgb(look.warm)) * 1.25 - col) * w_warm[:, None]
        col = col + (col * to_lin(hex_rgb(look.cool)) * 1.1 - col) * w_cool[:, None]

    # low-frequency hue/value variation + stretched brush strokes
    if look.var_amount > 0:
        nv = np.stack([S.fbm(v, look.var_freq, 3, seed=s) for s in (1, 2, 3)], axis=1)
        col = col * (1 + nv * F(look.var_amount * 2))
    if look.stroke_amount > 0:
        st = S.stretched(lambda p: S.fbm(p, look.stroke_freq, 2, seed=9), look.stroke_axis, look.stroke_squash)(v)
        col = col * (1 + st[:, None] * F(look.stroke_amount * 2))
    return np.clip(col, 0, 1).astype(F)


def eye_colors(verts: np.ndarray, centers: Sequence, gaze: Sequence, r_eye: float, iris: str = '#5b7a8c',
               iris_dark: str = '#22323d', sclera: str = '#e9e2d6', pupil_frac: float = 0.42,
               iris_frac: float = 0.52) -> np.ndarray:
    """Sclera / iris / pupil painted on eyeball spheres by the angle from the gaze direction,
    with a darker limbal ring and a soft shadow under the upper lid."""
    v = np.asarray(verts, F)
    out = np.tile(to_lin(hex_rgb(sclera)), (len(v), 1))
    owner = np.argmin(np.stack([np.linalg.norm(v - np.asarray(c, F), axis=1) for c in centers], axis=1), axis=1)
    for i, (c, g) in enumerate(zip(centers, gaze)):
        sel = owner == i
        d = (v[sel] - np.asarray(c, F)) / F(r_eye)
        gg = np.asarray(g, F) / np.linalg.norm(g)
        cosang = d @ gg
        ang = np.arccos(np.clip(cosang, -1, 1))
        a_iris = np.arcsin(iris_frac)
        a_pupil = np.arcsin(iris_frac * pupil_frac)
        t = np.clip(ang / a_iris, 0, 1)
        ic = to_lin(hex_rgb(iris)) * (1 - 0.5 * t[:, None] ** 3) + to_lin(hex_rgb(iris_dark)) * (0.5 * t[:, None] ** 3)
        c_out = out[sel]
        m_iris = _smooth((a_iris - ang) / 0.06)
        c_out = c_out * (1 - m_iris[:, None]) + ic * m_iris[:, None]
        m_pupil = _smooth((a_pupil - ang) / 0.04)
        c_out = c_out * (1 - m_pupil[:, None]) + to_lin(hex_rgb('#0b0b0d')) * m_pupil[:, None]
        # sclera: slightly darker/pinker towards the corners
        side = np.clip(np.abs(d[:, 0]) - 0.3, 0, 1)
        c_out = c_out * (1 - 0.25 * side[:, None] * (1 - m_iris[:, None]))
        out[sel] = c_out
    return out
