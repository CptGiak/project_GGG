"""Print animations / samplers / extras / joint rest rotations of a .glb (plain Python 3)."""
import json
import math
import struct
import sys


def read_glb(path):
    b = open(path, 'rb').read()
    magic, ver, length = struct.unpack_from('<4sII', b, 0)
    assert magic == b'glTF', magic
    off, js, binc = 12, None, None
    while off < length:
        clen, ctype = struct.unpack_from('<I4s', b, off)
        chunk = b[off + 8: off + 8 + clen]
        if ctype == b'JSON':
            js = json.loads(chunk)
        elif ctype == b'BIN\x00':
            binc = chunk
        off += 8 + clen
    return js, binc


def accessor(js, binc, i):
    a = js['accessors'][i]
    bv = js['bufferViews'][a['bufferView']]
    comp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    fmt = {5126: 'f', 5123: 'H', 5121: 'B', 5122: 'h', 5120: 'b'}[a['componentType']]
    size = struct.calcsize(fmt)
    stride = bv.get('byteStride', size * comp)
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    return [struct.unpack_from('<' + fmt * comp, binc, base + k * stride) for k in range(a['count'])]


def main(path):
    js, binc = read_glb(path)
    nodes = js['nodes']
    print(f'== {path}')
    print('extensionsUsed:', js.get('extensionsUsed'))
    for an in js.get('animations', []):
        interps = {}
        tmax = 0
        for s in an['samplers']:
            ip = s.get('interpolation', 'LINEAR'); interps[ip] = interps.get(ip, 0) + 1
            inp = js['accessors'][s['input']]
            tmax = max(tmax, inp['max'][0])
        n_in = sorted({js['accessors'][s['input']]['count'] for s in an['samplers']})
        print(f"anim {an['name']!r}: channels={len(an['channels'])} interp={interps} "
              f"keycounts={n_in[:4]}{'...' if len(n_in) > 4 else ''} duration={tmax:.4f}s extras={an.get('extras')}")
    skin = js['skins'][0] if js.get('skins') else None
    if skin:
        names = [nodes[j]['name'] for j in skin['joints']]
        print('joints', len(names), names)
        for j in skin['joints']:
            n = nodes[j]
            if n['name'] in ('hips', 'spine', 'thighL', 'shinL', 'footL', 'upperArmL', 'upperArmR'):
                q = n.get('rotation', [0, 0, 0, 1])
                ang = 2 * math.degrees(math.acos(max(-1, min(1, abs(q[3])))))
                print(f"  rest {n['name']:10s} t={[round(x, 3) for x in n.get('translation', [0, 0, 0])]} "
                      f"q(xyzw)={[round(x, 3) for x in q]} angle={ang:.1f}")
    if '--quat-flips' in sys.argv:
        for an in js.get('animations', []):
            for ch, s in zip(an['channels'], an['samplers']):
                if ch['target']['path'] != 'rotation':
                    continue
                vals = accessor(js, binc, an['samplers'][ch['sampler']]['output'])
                flips = sum(1 for a, b in zip(vals, vals[1:]) if sum(x * y for x, y in zip(a, b)) < 0)
                if flips:
                    print(f"  sign flips {an['name']}/{nodes[ch['target']['node']]['name']}: {flips}")


if __name__ == '__main__':
    for p in sys.argv[1:]:
        if not p.startswith('--'):
            main(p)
