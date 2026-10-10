"""
Importa una skin di League of Legends (scaricata con lol/fetch.py) e la prepara per il gioco:
mesh e texture originali, scheletro del gioco ricostruito dai pesi, T-pose, armi nel perno della
mano, GLB in public/models/lol/<id>.glb.

    PY=/root/blender-venv/bin/python
    $PY -I tools/blender/lol/fetch.py akali              # una volta: scarica mesh e texture
    $PY -I tools/blender/build_lol.py akali --preview    # render della posa di bind originale
    $PY -I tools/blender/build_lol.py akali --export     # GLB per il gioco + render di controllo
    $PY -I tools/blender/build_lol.py akali --poses      # pose del gioco (dump_poses.ts)

I file di LoL e tutto ciò che ne deriva (cache, render, GLB) restano fuori da git.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'lol'))

import bpy  # noqa: E402,I001
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import bl_kit as K  # noqa: E402
from lolfmt import read_skn  # noqa: E402
from rig_infer import infer  # noqa: E402
from skins import SKINS  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
CACHE = os.path.join(HERE, 'lol', '_cache')
MODELS = os.path.join(ROOT, 'public', 'models', 'lol')
V = Vector


# =============================================================================================
# Lettura
# =============================================================================================

class Lol:
    """Mesh di LoL in coordinate del gioco (metri, X = sinistra del personaggio, Y su, +Z avanti)."""

    def __init__(self, cid: str, scale: float = 1.0):
        self.cid = cid
        self.cfg = SKINS[cid]
        self.dir = os.path.join(CACHE, cid)
        self.info = json.load(open(os.path.join(self.dir, 'skin_info.json')))
        m = read_skn(os.path.join(self.dir, self.info['skn']))
        self.skn = m
        # LoL è sinistrorso: specchio X (la sinistra del personaggio va a +X) e inverto l'avvolgimento
        self.scale = 0.01 * self.info.get('skin_scale', 1.0) * scale
        self.P = m.pos.astype(np.float64) * np.array([-1.0, 1.0, 1.0]) * self.scale
        self.N = m.normal.astype(np.float64) * np.array([-1.0, 1.0, 1.0])
        self.uv = np.stack([m.uv[:, 0], 1.0 - m.uv[:, 1]], 1)
        n_inf = int(m.bones.max()) + 1
        W = np.zeros((len(self.P), n_inf))
        for j in range(4):
            np.add.at(W, (np.arange(len(self.P)), m.bones[:, j]), m.weights[:, j])
        self.W = W
        self.subs = {s.name: s for s in m.submeshes}
        self.hidden = set(self.info['hidden']) | set(self.cfg.get('hide', ()))
        self.visible = [s.name for s in m.submeshes if s.name not in self.hidden]
        weapon_subs = {s for w in self.cfg.get('weapons', {}).values() for s in w['subs']}
        self.body = [s for s in self.visible if s not in weapon_subs]

    def faces(self, name):
        s = self.subs[name]
        t = self.skn.triangles(s).astype(np.int64)
        return t[:, [0, 2, 1]]  # avvolgimento invertito dallo specchio

    def texture(self, name):
        tex = self.info['textures'].get(name) or self.info['default_texture']
        return os.path.join(self.dir, tex) if tex else None

    def vidx(self, names):
        return np.concatenate([np.arange(self.subs[n].v0, self.subs[n].v0 + self.subs[n].nv) for n in names])


def to_blender(P):
    """game (x left, y up, z forward) -> Blender (x left, -y forward, z up)"""
    P = np.asarray(P, dtype=np.float64)
    return np.stack([P[..., 0], -P[..., 2], P[..., 1]], -1)


def to_game(P):
    P = np.asarray(P, dtype=np.float64)
    return np.stack([P[..., 0], P[..., 2], -P[..., 1]], -1)


# =============================================================================================
# Oggetti Blender
# =============================================================================================

def material_for(lol: Lol, sub: str, cache: dict):
    path = lol.texture(sub)
    key = path or sub
    if key in cache:
        return cache[key]
    name = os.path.splitext(os.path.basename(path))[0] if path else sub
    m = K.make_material(name, '#ffffff', shade_mul=(0.62, 0.58, 0.72), image=path, band=0.0)
    cache[key] = m
    return m


def submesh_object(lol: Lol, sub: str, mats: dict, P=None, name=None):
    s = lol.subs[sub]
    P = lol.P if P is None else P
    f = lol.faces(sub) - s.v0
    verts = to_blender(P[s.v0:s.v0 + s.nv])
    uvs = lol.uv[s.v0:s.v0 + s.nv]
    ob = K.mesh_object(name or f'{lol.cid}_{sub}', verts, f, mats=[material_for(lol, sub, mats)], uvs=[tuple(u) for u in uvs])
    n = to_blender(lol.N[s.v0:s.v0 + s.nv])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
    ob.data.normals_split_custom_set_from_vertices([tuple(v) for v in n])
    ob['lol_sub'] = sub
    return ob


# =============================================================================================
# Scheletro: ricostruzione, T-pose, proporzioni del gioco
# =============================================================================================

def bone_names(guess):
    names = list(K.GAME_BONES)
    for s in 'LR':
        for f in ('fingers', 'fingertips', 'thumb'):
            if any(b == f + s for b in guess.owner.values()) and f in guess.fingers[s]['joints']:
                names.append(f + s)
    for ch in guess.chains:
        names.extend(ch['bones'])
    return names


def target_weights(lol: Lol, guess, names):
    """pesi per osso di destinazione (somma delle influenze di LoL), 4 per vertice"""
    idx = {n: i for i, n in enumerate(names)}
    Wt = np.zeros((len(lol.P), len(names)))
    for k, b in guess.owner.items():
        if b not in idx:
            # dita senza osso proprio: alla mano
            b = 'hand' + b[-1] if b.startswith(('fingers', 'fingertips', 'thumb')) else 'hips'
        Wt[:, idx[b]] += lol.W[:, k]
    order = np.argsort(-Wt, axis=1)
    keep = np.zeros_like(Wt, dtype=bool)
    np.put_along_axis(keep, order[:, :4], True, axis=1)
    Wt = np.where(keep & (Wt > 0.01), Wt, 0.0)
    empty = Wt.sum(1) < 1e-6
    Wt[empty, idx['hips']] = 1.0
    return Wt / Wt.sum(1, keepdims=True)


def add_tail(lol: Lol, guess, names, Wt, t: dict):
    """catena per una coda di capelli: pesi per distanza lungo l'asse, sfumati con la testa"""
    k = lol.scale / 0.01
    root = np.asarray(t['root']) * k
    d = np.asarray(t['dir'], dtype=np.float64)
    d /= np.linalg.norm(d)
    L = t['length'] * k
    n = t.get('bones', 3)
    bones = [f'tail_{i}' for i in range(n)]
    joints = [root + d * (L * i / n) for i in range(n + 1)]
    guess.chains.append({'name': 'tail', 'bones': bones, 'joints': joints, 'parent': 'head', 'infl': []})
    names = names + bones
    Wt = np.concatenate([Wt, np.zeros((len(Wt), n))], 1)
    body = np.zeros(len(lol.P), dtype=bool)
    body[lol.vidx(lol.body)] = True
    rel = lol.P - root
    tt = rel @ d
    side = rel - tt[:, None] * d
    sel = body & (tt > 0) & (np.abs(rel[:, 1]) < 0.25 * k) & (np.linalg.norm(side, axis=1) < 0.3 * k)
    hi = names.index('head')
    blend = np.clip(tt / (0.07 * k), 0, 1)
    blend = blend * blend * (3 - 2 * blend)
    f = np.clip(tt / (L / n) - 0.5, 0, n - 1)
    i0 = np.floor(f).astype(int)
    fr = f - i0
    for v in np.nonzero(sel)[0]:
        w = Wt[v, hi] * blend[v]
        Wt[v, hi] -= w
        Wt[v, len(names) - n + i0[v]] += w * (1 - fr[v])
        if i0[v] + 1 < n:
            Wt[v, len(names) - n + i0[v] + 1] += w * fr[v]
    print(f'  coda: {int(sel.sum())} vertici, {n} ossa')
    return names, Wt


def add_groups(ob, W, names):
    for j, n in enumerate(names):
        nz = np.nonzero(W[:, j])[0]
        if len(nz) == 0:
            continue
        vg = ob.vertex_groups.get(n) or ob.vertex_groups.new(name=n)
        for i in nz:
            vg.add([int(i)], float(W[i, j]), 'REPLACE')


def extra_bones(guess, joints_g, names):
    """dita e catene: teste/code in coordinate Blender (joints_g: dict osso -> posizione gioco)"""
    out = []
    for s in 'LR':
        fj = {k: np.asarray(v) for k, v in guess.fingers[s]['joints'].items()}
        hand = np.asarray(joints_g['hand' + s])
        if 'fingers' + s in names:
            h = joints_g.get('fingers' + s, fj['fingers'])
            t = joints_g.get('fingertips' + s, fj.get('fingertips', h + (h - hand) * 0.5))
            out.append({'name': 'fingers' + s, 'head': K.g2b(h), 'tail': K.g2b(t), 'parent': 'hand' + s})
            if 'fingertips' + s in names:
                tt = np.asarray(t) + (np.asarray(t) - np.asarray(h)) * 0.8
                out.append({'name': 'fingertips' + s, 'head': K.g2b(t), 'tail': K.g2b(tt), 'parent': 'fingers' + s})
        if 'thumb' + s in names:
            h = np.asarray(joints_g.get('thumb' + s, fj['thumb']))
            tt = h + (h - hand) * 0.8
            out.append({'name': 'thumb' + s, 'head': K.g2b(h), 'tail': K.g2b(tt), 'parent': 'hand' + s})
    for ch in guess.chains:
        js = joints_g.get(ch['name'], ch['joints'])
        for i, b in enumerate(ch['bones']):
            out.append({'name': b, 'head': K.g2b(js[i]), 'tail': K.g2b(js[i + 1]),
                        'parent': ch['parent'] if i == 0 else ch['bones'][i - 1]})
    return out


def head_g(arm, bone):
    return np.array(K.b2g(arm.matrix_world @ arm.pose.bones[bone].head))


def align(arm, bone, a, b, target):
    """ruota l'osso (asse mondo per la sua testa) perché la direzione a->b vada su target"""
    bpy.context.view_layer.update()
    d = V(K.g2b(b(arm)) - K.g2b(a(arm))).normalized()
    t = V(K.g2b(target)).normalized()
    ang = d.angle(t)
    if ang < 1e-4:
        return
    ax = d.cross(t)
    if ax.length < 1e-8:
        return
    K.pose_rotate(arm, bone, ax.normalized(), math.degrees(ang))


def pose_tpose(arm, names):
    """braccia orizzontali (lungo ±X) e dritte, gambe verticali: la T-pose del Rig del gioco"""
    H = lambda b: (lambda a: head_g(a, b))  # noqa: E731
    for s, sx in (('L', 1.0), ('R', -1.0)):
        align(arm, 'upperArm' + s, H('upperArm' + s), H('foreArm' + s), (sx, 0, 0))
        align(arm, 'foreArm' + s, H('foreArm' + s), H('hand' + s), (sx, 0, 0))
        if 'fingers' + s in names:
            align(arm, 'hand' + s, H('hand' + s), H('fingers' + s), (sx, 0, 0))
        align(arm, 'thigh' + s, H('thigh' + s), H('shin' + s), (0, -1, 0))
        align(arm, 'shin' + s, H('shin' + s), H('foot' + s), (0, -1, 0))


def fit_spec(J, female: bool, bulk: float) -> dict:
    """proporzioni del Rig del gioco dalle articolazioni in T-pose (formula di Rig.ts invertita)"""
    y2 = lambda b: (J[b + 'L'][1] + J[b + 'R'][1]) / 2  # noqa: E731
    ankle, knee, hip = y2('foot'), y2('shin'), y2('thigh')
    hips = hip + 0.045
    ua = y2('upperArm')
    chest = J['chest'][1]
    s = {
        'hipHeight': round(hips, 4),
        'spineLen': round(max(0.05, J['spine'][1] - hips), 4),
        'chestLen': 0.0,
        'neckLen': 0.0,
        'clavicle': round((J['upperArmL'][0] - J['upperArmR'][0]) / 2, 4),
        'shoulderDrop': 0.0,
        'upperArm': round(float(np.linalg.norm(J['foreArmL'] - J['upperArmL'])), 4),
        'foreArm': round(float(np.linalg.norm(J['handL'] - J['foreArmL'])), 4),
        'hipWidth': round((J['thighL'][0] - J['thighR'][0]) / 2, 4),
        'thigh': round(hip - knee, 4),
        'shin': round(knee - ankle, 4),
        'footHeight': round(ankle, 4),
        'bulk': bulk,
        'female': female,
    }
    spine_y = hips + s['spineLen']
    s['chestLen'] = round(max(0.08, chest - spine_y), 4)
    chest = spine_y + s['chestLen']
    s['shoulderDrop'] = round(ua + 0.01 - chest, 4)
    neck = chest + s['shoulderDrop'] + 0.045
    s['neckLen'] = round(max(0.12, J['head'][1] - neck + 0.11), 4)
    return {k: (round(float(v), 4) if isinstance(v, (float, np.floating)) and not isinstance(v, bool) else v) for k, v in s.items()}


def shoulder_y(s: dict) -> float:
    """altezza delle spalle in T-pose di un corpo del Rig (come in Rig.ts)"""
    return 0.045 + s['thigh'] + s['shin'] + s['footHeight'] + s['spineLen'] + s['chestLen'] + s['shoulderDrop'] - 0.01


# le clip dei campioni importati (src/champions/lolAnims.ts) sono scritte per bodySpec('female')
FEMALE_BODY = {'thigh': 0.42, 'shin': 0.42, 'footHeight': 0.075, 'spineLen': 0.1, 'chestLen': 0.15, 'shoulderDrop': 0.13}


def anim_scale_of(spec: dict) -> float:
    """animScale di quelle clip sul corpo `spec` (lolAnimScale nel gioco)"""
    return shoulder_y(spec) / shoulder_y(FEMALE_BODY)


# =============================================================================================
# Armi: pezzi della mesh portati nel sistema del perno della mano
# =============================================================================================

def weapon_frame(lol: Lol, w: dict):
    """(origine, matrice 3x3 righe = assi X,Y,Z locali in coordinate del gioco, scala)"""
    P = lol.P[lol.vidx(w['subs'])]
    if 'ring' in w:
        lo, hi = P.min(0), P.max(0)
        c = (lo + hi) / 2
        R = (hi - lo)[:2].mean() / 2
        a = math.radians(w['ring']['grip_deg'])
        radial = np.array([math.sin(a), math.cos(a), 0.0])
        grip = c + radial * R * 0.93
        z = -radial                               # dall'impugnatura verso il centro
        y = np.array([math.cos(a), -math.sin(a), 0.0])   # nel piano dell'anello
        length = 2 * R
    else:
        grip = np.asarray(w['grip'], dtype=np.float64) * (lol.scale / 0.01)   # config: metri di LoL
        z = np.asarray(w['axis'], dtype=np.float64)
        y = np.asarray(w['up'], dtype=np.float64)
        length = float(np.ptp((P - grip) @ (z / np.linalg.norm(z))))
    z = z / np.linalg.norm(z)
    y = y - z * (y @ z)
    y /= np.linalg.norm(y)
    x = np.cross(y, z)
    k = (w['size'] / length) if w.get('size') else 1.0
    return grip, np.stack([x, y, z]), k


def build_weapon(lol: Lol, side: str, w: dict, mats: dict):
    grip, Rm, k = weapon_frame(lol, w)
    parts = []
    for sub in w['subs']:
        s = lol.subs[sub]
        P = lol.P.copy()
        loc = (P[s.v0:s.v0 + s.nv] - grip) @ Rm.T * k
        P[s.v0:s.v0 + s.nv] = loc
        ob = submesh_object(lol, sub, mats, P=P, name=f'w_{side}_{sub}')
        # normali nello stesso sistema
        n = lol.N[s.v0:s.v0 + s.nv] @ Rm.T
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        ob.data.normals_split_custom_set_from_vertices([tuple(v) for v in to_blender(n)])
        parts.append(ob)
    ob = K.join(parts, f'weapon_{side}') if len(parts) > 1 else parts[0]
    ob.name = f'weapon_{side}'
    loc = np.array([v.co[:] for v in ob.data.vertices])
    g = to_game(loc)
    ob['ggg_weapon'] = json.dumps({'side': side, 'tip': float(g[:, 2].max()), 'base': float(max(0.0, g[:, 2].min()))})
    return ob


# =============================================================================================
# Render di controllo
# =============================================================================================

def render_set(objs, out_png, views=('front', 'side', 'back'), height=None, px=900, samples=12, outline=True):
    """Render ortografici affiancati con contorno, come per Kaiser."""
    from PIL import Image
    pts = []
    for o in objs:
        if o.type != 'MESH':
            continue
        dg = bpy.context.evaluated_depsgraph_get()
        me = o.evaluated_get(dg).to_mesh()
        pts.append(np.array([o.matrix_world @ v.co for v in me.vertices]))
        o.evaluated_get(dg).to_mesh_clear()
    pts = np.concatenate(pts)
    lo, hi = pts.min(0), pts.max(0)
    h = (hi[2] - lo[2]) if height is None else height
    span = max(h, (hi[0] - lo[0]) / 0.62, (hi[1] - lo[1]) / 0.62) * 1.06
    zc = (lo[2] + hi[2]) / 2
    cams = {
        'front': ((0, -10, zc), (90, 0, 0), (-0.45, -0.6, 0.66)),
        'back': ((0, 10, zc), (90, 0, 180), (0.45, 0.6, 0.66)),
        'side': ((-10, 0, zc), (90, 0, -90), (-0.6, -0.45, 0.66)),   # dalla destra del personaggio
        'left': ((10, 0, zc), (90, 0, 90), (0.6, -0.45, 0.66)),
        '3/4': ((-6, -8, zc), (90, 0, -36.87), (-0.6, -0.55, 0.6)),
    }
    added = K.add_outlines(objs, 0.0026) if outline else []
    K.material_mode('render')
    tiles = []
    try:
        for v in views:
            loc, rot, light = cams[v]
            K.ortho_camera('cam_' + v, loc, rot, span)
            K.set_light_dir(light)
            K.setup_render(int(px * 0.62), px, samples)
            p = out_png.replace('.png', f'_{v.replace("/", "")}.png')
            K.render_to(p)
            tiles.append(Image.open(p).convert('RGBA'))
    finally:
        K.remove_outlines(added)
        K.material_mode('export')
    sheet = Image.new('RGBA', (sum(t.width for t in tiles), px), (58, 54, 66, 255))
    x = 0
    for t in tiles:
        sheet.alpha_composite(t, (x, 0))
        x += t.width
    sheet.save(out_png)
    return out_png


# =============================================================================================
# Build
# =============================================================================================

def build(cid: str, log=print):
    t0 = time.time()
    K.reset_scene()
    cfg = SKINS[cid]
    lol = Lol(cid, cfg.get('scale', 1.0))
    keep = lol.vidx(lol.body)
    guess = infer(lol.P[keep], lol.W[keep], overrides=cfg.get('rig'))
    for n in guess.notes:
        log('  nota:', n)
    names = bone_names(guess)
    Wt = target_weights(lol, guess, names)
    if cfg.get('tail'):
        names, Wt = add_tail(lol, guess, names, Wt, cfg['tail'])
    mats = {}

    # mesh del corpo con i pesi rimappati
    body = []
    for sub in lol.body:
        s = lol.subs[sub]
        ob = submesh_object(lol, sub, mats)
        add_groups(ob, Wt[s.v0:s.v0 + s.nv], names)
        body.append(ob)

    # armatura provvisoria nella posa di bind, poi T-pose
    joints_b = {b: K.g2b(guess.joints[b]) for b in K.GAME_BONES}
    tmp = K.build_armature('bind_rig', joints_b, extra=extra_bones(guess, {b: guess.joints[b] for b in K.GAME_BONES}, names))
    for ob in body:
        K.add_armature_modifier(ob, tmp)
    pose_tpose(tmp, names)
    if cfg.get('tail'):
        K.pose_rotate(tmp, 'tail_0', (1, 0, 0), -cfg['tail']['down'])
    bpy.context.view_layer.update()
    J = {b: head_g(tmp, b) for b in names}
    chain_js = {}
    for ch in guess.chains:
        last = ch['bones'][-1]
        tail = np.array(K.b2g(tmp.matrix_world @ tmp.pose.bones[last].tail))
        chain_js[ch['name']] = [J[b] for b in ch['bones']] + [tail]
    for ob in body:
        K.set_active(ob)
        md = next(m for m in ob.modifiers if m.type == 'ARMATURE')
        bpy.ops.object.modifier_apply(modifier=md.name)
        ob.parent = None
    bpy.data.objects.remove(tmp, do_unlink=True)

    spec = fit_spec(J, cfg.get('female', False), cfg.get('bulk', 1.0))
    log('  spec', spec)
    # ossa del GLB sulle articolazioni vere del modello in T-pose (il gioco copia solo le rotazioni);
    # il bacino 4,5 cm sopra le anche come nel Rig, così i piedi del GLB poggiano dove quelli del Rig
    J['hips'] = np.array([0.0, (J['thighL'][1] + J['thighR'][1]) / 2 + 0.045, J['hips'][2]])
    jg = {**{b: J[b] for b in names}, **chain_js}
    arm = K.build_armature('lol_rig', {b: K.g2b(J[b]) for b in K.GAME_BONES}, extra=extra_bones(guess, jg, names))
    arm.name = f'{cid}_rig'
    mesh = K.join(body, cid) if len(body) > 1 else body[0]
    mesh.name = cid
    K.add_armature_modifier(mesh, arm)

    weapons = {side: build_weapon(lol, side, w, mats) for side, w in cfg.get('weapons', {}).items()}

    hips_b = K.g2b(J['hips'])
    anim_scale = round(anim_scale_of(spec), 4)
    arm['ggg_spec'] = json.dumps(spec)
    arm['ggg_chains'] = json.dumps([
        {'bones': ch['bones'], 'parent': ch['parent'],
         'joints': [[round(float(c), 5) for c in j] for j in chain_js[ch['name']]]}
        for ch in guess.chains])
    g = lambda p: [round(float(c), 4) for c in K.b2g(p)]  # noqa: E731
    arm['ggg_sockets'] = json.dumps({
        'gearL': g(hips_b + V((spec['hipWidth'] + 0.12, -0.05, -0.02))),
        'gearR': g(hips_b + V((-spec['hipWidth'] - 0.12, -0.05, -0.02))),
        'nozzle': g(hips_b + V((0, 0.16, 0.08))),
    })
    arm['ggg_source'] = json.dumps({'champion': cfg['champ'], 'skin': cfg['skin'], 'name': cfg['name'],
                                    'animScale': anim_scale, 'scale': cfg.get('scale', 1.0)})
    tris = sum(len(o.data.polygons) for o in [mesh, *weapons.values()])
    log(f'  {cid}: {len(names)} ossa, {len(guess.chains)} catene, {tris} triangoli, {time.time() - t0:.1f}s')
    log(f'  animScale {anim_scale}')
    return {'lol': lol, 'guess': guess, 'spec': spec, 'arm': arm, 'mesh': mesh, 'weapons': weapons, 'names': names,
            'anim_scale': anim_scale, 'grip_hands': cfg['grip'], 'J': J}


def export(cid: str, B: dict):
    path = os.path.join(MODELS, f'{cid}.glb')
    K.material_mode('export')
    K.export_glb(path, [B['arm'], B['mesh'], *B['weapons'].values()])
    print('  export', path, f'{os.path.getsize(path) / 1e6:.2f} MB')
    return path


def preview(cid):
    K.reset_scene()
    lol = Lol(cid)
    mats = {}
    objs = [submesh_object(lol, s, mats) for s in lol.visible]
    out = os.path.join(lol.dir, 'renders', 'bind.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    render_set(objs, out, views=('front', 'side', 'back'))
    print('preview', out)


def check_render(cid, B):
    """T-pose fronte/lato/retro con le armi accanto alle mani"""
    out = os.path.join(CACHE, cid, 'renders', 'tpose.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    arm = B['arm']
    shown = []
    for side, w in B['weapons'].items():
        # arma nel perno della mano (come weaponPivot del gioco), solo per il render
        bone = arm.data.bones['hand' + side]
        sign = 1.0 if side == 'L' else -1.0
        hb = arm.matrix_world @ bone.head_local
        # T-pose: la mano punta lungo ±X, il perno sta 5 cm più in là; la lama in avanti
        piv = hb + V((sign * 0.05 * (0.88 if B['spec']['female'] else 1.0), -0.006, 0.0))
        # rotazione della mano in T-pose: ±90° attorno a +Z del gioco = ∓90° attorno a +Y di Blender
        w.matrix_world = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(-90 * sign), 4, 'Y')
        shown.append(w)
    render_set([B['mesh'], *shown], out, views=('front', 'side', 'back'))
    for w in shown:
        w.matrix_world = Matrix.Identity(4)
    print('  render', out)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cid', nargs='+', choices=sorted(SKINS))
    ap.add_argument('--preview', action='store_true')
    ap.add_argument('--export', action='store_true')
    ap.add_argument('--render', action='store_true')
    ap.add_argument('--poses', action='store_true')
    a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:])
    for cid in a.cid:
        if a.preview:
            preview(cid)
        if a.export or a.render or a.poses:
            B = build(cid)
            if a.render:
                check_render(cid, B)
            if a.export:
                export(cid, B)
            if a.poses:
                from lol_poses import render_poses
                render_poses(cid, B)


if __name__ == '__main__':
    main()
