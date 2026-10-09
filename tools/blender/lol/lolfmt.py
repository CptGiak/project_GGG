"""Lettura dei formati di League of Legends usati dall'import (solo numpy).

SKN (SimpleSkin): mesh skinnata nella posa di bind, divisa in sotto-mesh (un materiale ciascuna).
Ogni vertice ha posizione, 4 indici di influenza (u8, nella tabella influenze dello scheletro),
4 pesi, normale, UV e opzionalmente colore e tangente.
"""
import struct
from dataclasses import dataclass

import numpy as np

SKN_MAGIC = 0x00112233


@dataclass
class Submesh:
    name: str
    v0: int
    nv: int
    i0: int
    ni: int


@dataclass
class Skn:
    submeshes: list
    indices: np.ndarray   # (nt, 3) uint32, indici globali dei vertici
    pos: np.ndarray       # (nv, 3) float32, coordinate di LoL
    bones: np.ndarray     # (nv, 4) uint8, indici nella tabella delle influenze
    weights: np.ndarray   # (nv, 4) float32
    normal: np.ndarray    # (nv, 3) float32
    uv: np.ndarray        # (nv, 2) float32

    def triangles(self, sub):
        return self.indices[sub.i0 // 3:(sub.i0 + sub.ni) // 3]


def read_skn(path):
    b = open(path, 'rb').read()
    magic, major, minor = struct.unpack_from('<IHH', b, 0)
    if magic != SKN_MAGIC:
        raise ValueError(f'{path}: non è un file .skn')
    o = 8
    subs = []
    vtype = 0
    if major == 0:
        ni, nv = struct.unpack_from('<II', b, o)
        o += 8
        subs.append(Submesh('Base', 0, nv, 0, ni))
    else:
        (ns,) = struct.unpack_from('<I', b, o)
        o += 4
        for _ in range(ns):
            name = b[o:o + 64].split(b'\0', 1)[0].decode('ascii', 'replace')
            v0, snv, i0, sni = struct.unpack_from('<IIII', b, o + 64)
            subs.append(Submesh(name, v0, snv, i0, sni))
            o += 80
        if major == 4:
            o += 4  # flags
        ni, nv = struct.unpack_from('<II', b, o)
        o += 8
        if major == 4:
            _vsize, vtype = struct.unpack_from('<II', b, o)
            o += 8 + 24 + 16  # bounding box e sfera
    idx = np.frombuffer(b, '<u2', ni, o).astype(np.uint32)
    o += ni * 2
    fields = [('pos', '<f4', 3), ('bones', 'u1', 4), ('weights', '<f4', 4), ('normal', '<f4', 3), ('uv', '<f4', 2)]
    if vtype >= 1:
        fields.append(('color', 'u1', 4))
    if vtype == 2:
        fields.append(('tangent', '<f4', 4))
    dt = np.dtype([(n, t, (c,)) for n, t, c in fields])
    v = np.frombuffer(b, dt, nv, o)
    # in alcuni file gli indici sono locali alla sotto-mesh: li rendo globali
    tris = idx.reshape(-1, 3).copy()
    for s in subs:
        t = tris[s.i0 // 3:(s.i0 + s.ni) // 3]
        if t.size and t.max() < s.nv and s.v0 > 0 and t.min() < s.v0:
            t += s.v0
    return Skn(subs, tris, v['pos'].astype(np.float32), v['bones'].copy(), v['weights'].astype(np.float32),
               v['normal'].astype(np.float32), v['uv'].astype(np.float32))
