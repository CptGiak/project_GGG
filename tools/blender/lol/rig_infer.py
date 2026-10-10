"""Ricostruzione dello scheletro di un modello di LoL dai soli pesi della mesh (numpy).

Il mirror dei file di gioco non pubblica gli scheletri .skl, ma ogni vertice della .skn porta
fino a 4 indici di influenza con i pesi. Due ossa che condividono vertici sono collegate e
l'articolazione sta dove i loro pesi si mescolano. Da qui:

1. grafo delle influenze (peso condiviso) e albero di copertura massimo;
2. gambe: dal punto più basso di ogni lato si risale fino al bacino;
3. colonna: dal bacino alla testa (l'influenza più grande in alto);
4. braccia: dalla colonna verso l'esterno fino alla mano (dove partono le dita);
5. ossa del gioco (Rig.ts) assegnate per altezza e posizione delle articolazioni;
6. tutto il resto (capelli, viso, vestiti, accessori) va all'osso del gioco più vicino nell'albero.
   Le catene lunghe che pendono dal bacino (falde) e le dita restano ossa a parte.

Coordinate del gioco: X = sinistra del personaggio, Y su, +Z avanti, metri.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class RigGuess:
    owner: dict                      # influenza -> nome osso (gioco, dita o catena)
    joints: dict                     # osso -> posizione dell'articolazione (bind)
    chains: list = field(default_factory=list)    # [{'name', 'bones': [...], 'joints': [...] , 'parent'}]
    fingers: dict = field(default_factory=dict)   # 'L'/'R' -> {'fingers': [...], 'fingertips': [...], 'thumb': [...]}
    notes: list = field(default_factory=list)


def _cow(W):
    """peso condiviso tra coppie di influenze e centro della zona di mescolanza"""
    A = W.T @ W
    np.fill_diagonal(A, 0)
    return A


class Graph:
    def __init__(self, P, W, min_tot=0.5):
        self.P, self.W = P, W
        self.tot = W.sum(0)
        self.alive = np.where(self.tot > min_tot)[0]
        self.c = (W.T @ P) / np.maximum(self.tot[:, None], 1e-9)
        self.A = _cow(W)
        self.H = P[:, 1].max() - P[:, 1].min()
        self.floor = P[:, 1].min()

    def joint(self, a, b):
        """centro dell'anello di mescolanza: vertici pesati quasi solo su a e b (gli accessori
        con 3-4 influenze spostano la stima)"""
        wa, wb = self.W[:, a], self.W[:, b]
        w = wa * wb
        ring = (wa + wb > 0.85) & (np.minimum(wa, wb) > 0.1)
        if w[ring].sum() > 0.5:
            w = np.where(ring, w, 0.0)
        s = w.sum()
        if s < 1e-9:
            return (self.c[a] + self.c[b]) / 2
        return (self.P * w[:, None]).sum(0) / s

    def nbrs(self, k, thr=0.05):
        a = self.A[k]
        idx = np.where(a > thr)[0]
        return idx[np.argsort(-a[idx])]

    def spanning_tree(self, root):
        """albero di copertura massimo (Prim) sul peso condiviso, radicato in root"""
        parent = {root: None}
        best = {}
        import heapq
        heap = []
        for n in self.nbrs(root):
            heapq.heappush(heap, (-self.A[root, n], int(n), root))
        while heap:
            w, n, p = heapq.heappop(heap)
            if n in parent:
                continue
            parent[n] = p
            for m in self.nbrs(n):
                if m not in parent:
                    heapq.heappush(heap, (-self.A[n, m], int(m), n))
        return parent


def _walk(g: Graph, start, step_ok, stop, max_len=30):
    path = [start]
    while len(path) < max_len:
        cur = path[-1]
        if stop(cur):
            break
        nxt = [n for n in g.nbrs(cur, 0.02) if n not in path and step_ok(cur, n)]
        if not nxt:
            break
        path.append(int(nxt[0]))
    return path


def infer(P, W, side_x=1.0, overrides=None) -> RigGuess:
    ov = overrides or {}
    g = Graph(P, W)
    H, floor = g.H, g.floor
    c, tot = g.c, g.tot
    alive = set(int(k) for k in g.alive)
    notes = []

    # ---- testa: l'influenza più pesante nella parte alta ----------------------------------------------
    top = [k for k in alive if c[k, 1] > floor + 0.82 * H]
    head = int(ov.get('head', max(top, key=lambda k: tot[k])))

    # ---- gambe: dal più basso di ogni lato si risale ------------------------------------------------
    legs = {}
    for s, sgn in (('L', 1), ('R', -1)):
        low = [k for k in alive if c[k, 0] * sgn > 0.02 and c[k, 1] < floor + 0.06 * H and tot[k] > 2]
        start = int(ov.get(f'toe{s}', min(low, key=lambda k: c[k, 1] - 0.002 * tot[k])))
        legs[s] = _walk(g, start,
                        step_ok=lambda a, b: c[b, 1] > c[a, 1] + 0.004 * H,
                        stop=lambda k: abs(c[k, 0]) < 0.035 * H and c[k, 1] > floor + 0.4 * H)
    pelvis = int(ov.get('pelvis', legs['L'][-1]))
    if legs['R'][-1] != pelvis:
        notes.append(f'gambe con bacini diversi: {legs["L"][-1]} / {legs["R"][-1]}')
    tree = g.spanning_tree(pelvis)

    def path_to(k):
        out = []
        while k is not None:
            out.append(k)
            k = tree.get(k)
        return out[::-1]

    spine_path = path_to(head)                         # bacino ... testa
    owner = {}
    joints = {}

    # ---- colonna --------------------------------------------------------------------------------------
    hip_j = {s: None for s in 'LR'}
    for s in 'LR':
        lp = path_to(legs[s][0])                       # bacino ... dita del piede
        hip_j[s] = g.joint(lp[0], lp[1])
    hips_y = (hip_j['L'][1] + hip_j['R'][1]) / 2
    # braccia: figli della colonna verso l'esterno
    kids = {}
    for k, p in tree.items():
        if p is not None:
            kids.setdefault(p, []).append(k)

    def subtree(k):
        out, st = [], [k]
        while st:
            x = st.pop()
            out.append(x)
            st.extend(kids.get(x, []))
        return out

    arms = {}
    for s, sgn in (('L', 1), ('R', -1)):
        best = None
        for sp in spine_path[1:-1]:
            for ch in kids.get(sp, []):
                if ch in spine_path:
                    continue
                sub = subtree(ch)
                reach = max(c[x, 0] * sgn for x in sub)
                score = reach * 1.0
                if reach > 0.12 * H and (best is None or score > best[0]):
                    best = (score, sp, ch)
        if best is None:
            raise RuntimeError(f'braccio {s} non trovato')
        _, attach, clav = best
        if f'clavicle{s}' in ov:
            clav = ov[f'clavicle{s}']
        # catena principale: verso l'esterno seguendo il figlio con il sotto-albero più lontano
        chain = [clav]
        while True:
            ch = [x for x in kids.get(chain[-1], [])]
            if not ch:
                break
            far = max(ch, key=lambda x: max(c[y, 0] * sgn for y in subtree(x)) + 0.001 * tot[x])
            if max(c[y, 0] * sgn for y in subtree(far)) <= c[chain[-1], 0] * sgn + 0.005:
                break
            chain.append(far)
        arms[s] = (attach, chain)

    # mano: l'influenza della catena con più figli (dita); in alternativa la penultima grossa
    hands = {}
    for s, (attach, chain) in arms.items():
        deg = [(len(kids.get(k, [])), i) for i, k in enumerate(chain)]
        cand = [i for d, i in deg if d >= 3]
        hi = int(ov.get(f'hand{s}_i', cand[0] if cand else len(chain) - 2))
        hands[s] = hi

    # ---- assegnazione delle ossa del gioco ----------------------------------------------------------
    neck_y = g.joint(spine_path[-2], spine_path[-1])[1]
    attach_ids = [arms[s][0] for s in 'LR']
    chest_from = min(spine_path.index(a) for a in attach_ids)
    sp_inner = spine_path[1:-1]
    owner[pelvis] = 'hips'
    owner[head] = 'head'
    for k in sp_inner:
        i = spine_path.index(k)
        frac = (c[k, 1] - hips_y) / max(neck_y - hips_y, 1e-6)
        if i > chest_from and c[k, 1] > neck_y - 0.02 * H and k == spine_path[-2]:
            owner[k] = 'neck'
        elif k == spine_path[-2] and i > chest_from:
            owner[k] = 'neck'
        elif frac > 0.5 or i >= chest_from:
            owner[k] = 'chest'
        else:
            owner[k] = 'spine'
    if 'spine' not in owner.values():
        # colonna corta: il primo segmento sopra il bacino fa da spine
        owner[sp_inner[0]] = 'spine'
    if 'neck' not in owner.values():
        owner[spine_path[-2]] = 'neck'

    def first_joint(bone, path):
        """articolazione tra l'osso e il suo genitore nel percorso"""
        for i, k in enumerate(path):
            if owner.get(k) == bone:
                return g.joint(path[i - 1], k) if i > 0 else c[k]
        return None

    joints['hips'] = np.array([0.0, hips_y, (hip_j['L'][2] + hip_j['R'][2]) / 2])
    for b in ('spine', 'chest', 'neck', 'head'):
        joints[b] = first_joint(b, spine_path)

    # gambe: anca, ginocchio, caviglia
    for s in 'LR':
        lp = path_to(legs[s][0])[1:]          # senza bacino: coscia ... punta
        js = [g.joint(a, b) for a, b in zip(lp[:-1], lp[1:])]
        hip = hip_j[s]
        # caviglia: l'articolazione più alta sotto il 9% dell'altezza
        low = [i for i, j in enumerate(js) if j[1] < floor + 0.09 * H]
        ai = low[0] if low else len(js) - 1
        ankle = js[ai]
        mid = (hip[1] + ankle[1]) / 2
        ki = min(range(ai), key=lambda i: abs(js[i][1] - mid)) if ai > 0 else 0
        knee = js[ki]
        for i, k in enumerate(lp):
            if i <= ki:
                owner[k] = f'thigh{s}'
            elif i <= ai:
                owner[k] = f'shin{s}'
            else:
                owner[k] = f'foot{s}'
        joints[f'thigh{s}'] = hip
        joints[f'shin{s}'] = knee
        joints[f'foot{s}'] = ankle

    # braccia: spalla, gomito, polso
    fingers = {}
    for s, (attach, chain) in arms.items():
        hi = hands[s]
        js = [g.joint(a, b) for a, b in zip([attach] + chain[:-1], chain)]   # js[i] = testa di chain[i]
        wrist = js[hi]
        # spalla: il primo giunto della catena oltre la clavicola
        si = int(ov.get(f'shoulder{s}_i', 1))
        shoulder = js[si]
        length = np.linalg.norm(wrist - shoulder)
        # gomito: giunto più vicino al 52% della distanza spalla-polso
        cand = list(range(si + 1, hi))
        if cand:
            ei = min(cand, key=lambda i: abs(np.linalg.norm(js[i] - shoulder) - 0.52 * length))
        else:
            ei = si
        elbow = js[ei]
        # maniche gonfie o imbottite spostano la zona di mescolanza: se il rapporto braccio /
        # avambraccio non è credibile, gomito sulla retta spalla-polso al 52%
        ratio = np.linalg.norm(elbow - shoulder) / max(np.linalg.norm(wrist - elbow), 1e-6)
        if not 0.8 < ratio < 1.4:
            notes.append(f'gomito {s}: rapporto {ratio:.2f}, uso il 52% spalla-polso')
            elbow = shoulder + (wrist - shoulder) * 0.52
        for i, k in enumerate(chain[:hi + 1]):
            owner[k] = (f'shoulder{s}' if i < si else f'upperArm{s}' if i < ei else f'foreArm{s}' if i < hi else f'hand{s}')
        joints[f'shoulder{s}'] = js[0]
        joints[f'upperArm{s}'] = shoulder
        joints[f'foreArm{s}'] = elbow
        joints[f'hand{s}'] = wrist
        # dita: figli della mano
        hand_k = chain[hi]
        fd = {'fingers': [], 'fingertips': [], 'thumb': [], 'joints': {}}
        roots = [x for x in kids.get(hand_k, [])]
        if roots:
            # pollice: la radice più avanti (+Z) e più vicina al polso
            thumb = max(roots, key=lambda x: c[x, 2] - 0.5 * np.linalg.norm(c[x] - wrist))
            knuckles = []
            for r in roots:
                sub = subtree(r)
                depth = {r: 0}
                for x in sub:
                    if x != r:
                        d, p = 0, x
                        while p != r:
                            p = tree[p]
                            d += 1
                        depth[x] = d
                for x in sub:
                    if r == thumb:
                        owner[x] = f'thumb{s}'
                        fd['thumb'].append(x)
                    elif depth[x] == 0:
                        owner[x] = f'fingers{s}'
                        fd['fingers'].append(x)
                        knuckles.append(g.joint(hand_k, x))
                    else:
                        owner[x] = f'fingertips{s}'
                        fd['fingertips'].append(x)
            fd['joints']['thumb'] = g.joint(hand_k, thumb)
            if knuckles:
                fd['joints']['fingers'] = np.mean(knuckles, 0)
                mids = [g.joint(tree[x], x) for x in fd['fingertips'] if owner.get(tree[x]) == f'fingers{s}']
                if mids:
                    fd['joints']['fingertips'] = np.mean(mids, 0)
        fingers[s] = fd

    # ---- catene che pendono dal tronco (falde, code) ------------------------------------------------
    chains = []
    torso_owned = ('hips', 'spine', 'chest')

    def free_kids(x):
        return [y for y in kids.get(x, []) if y not in owner]

    def depth(x):
        ch = free_kids(x)
        return 1 + (max(depth(z) for z in ch) if ch else 0)

    def is_long(x):
        sub = [y for y in subtree(x) if y not in owner]
        drop = c[x, 1] - min(c[y, 1] for y in sub)
        return depth(x) >= 3 and drop > 0.12 * H

    def grow(r):
        """scende dal primo osso finché c'è un solo ramo lungo; ritorna la catena e i rami lunghi
        di un'eventuale biforcazione in fondo"""
        seq = [r]
        while True:
            fk = [y for y in free_kids(seq[-1]) if y not in seq]
            longs = [y for y in fk if is_long(y)]
            if len(longs) == 1:
                seq.append(longs[0])
                continue
            if not longs:
                down = [y for y in fk if c[y, 1] < c[seq[-1], 1] - 0.01 * H]
                if down:
                    seq.append(min(down, key=lambda y: c[y, 1]))
                    continue
            return seq, (longs if len(longs) >= 2 else [])

    pending = [(k, p) for k, p in tree.items()
               if p is not None and k not in owner and owner.get(p) in torso_owned and is_long(k)]
    found = []
    while pending:
        r, pk = pending.pop()
        if r in owner:
            continue
        hub = [y for y in free_kids(r) if is_long(y)]
        if len(hub) >= 2:
            # nodo da cui partono più falde: resta rigido col tronco, ogni ramo è una catena
            owner[r] = owner[pk] if owner.get(pk) in torso_owned else 'hips'
            pending.extend((y, r) for y in hub)
            continue
        seq, split = grow(r)
        if len(seq) >= 3 and c[seq[0], 1] - c[seq[-1], 1] > 0.12 * H:
            for x in seq:
                owner[x] = '__chain__'
            found.append((seq, pk))
            pending.extend((y, seq[-1]) for y in split)
    for seq, pk in found:
        js = [g.joint(pk, seq[0])] + [g.joint(a, b) for a, b in zip(seq[:-1], seq[1:])]
        last = c[seq[-1]]
        js.append(last + (last - js[-1]))
        name = f'chain{len(chains)}'
        for i, x in enumerate(seq):
            owner[x] = f'{name}_{i}'
        for i in range(len(seq) - 1, -1, -1):       # rami laterali all'osso della catena più vicino
            for y in subtree(seq[i]):
                if y not in owner:
                    owner[y] = f'{name}_{i}'
        anchor = owner.get(pk, 'hips')
        chains.append({'name': name, 'bones': [f'{name}_{i}' for i in range(len(seq))], 'joints': js,
                       'parent': anchor if anchor in torso_owned else 'hips', 'infl': seq})

    # ---- il resto: osso del gioco più vicino risalendo l'albero ------------------------------------
    for k in alive:
        if k in owner:
            continue
        p = tree.get(k)
        while p is not None and p not in owner:
            p = tree.get(p)
        if p is not None:
            owner[k] = owner[p]
    # influenze non collegate al corpo: osso del tronco (o del braccio) più vicino
    torso = ['hips', 'spine', 'chest', 'neck', 'head']
    for k in alive:
        if k in owner:
            continue
        cand = torso + [f'{a}{s}' for a in ('foreArm', 'hand') for s in 'LR']
        best = min(cand, key=lambda b: np.linalg.norm(c[k] - joints[b]) + (0.0 if b in torso else 0.05 * H))
        owner[k] = best

    # ---- correzioni ----------------------------------------------------------------------------------
    arm_ids = {k for s in 'LR' for k in arms[s][1]}
    ny, hy = joints['neck'][1], joints['head'][1]
    for k, b in list(owner.items()):
        # mascella e bocca appese al collo: seguono la testa
        if b == 'neck' and k not in spine_path and c[k, 1] > ny + 0.3 * (hy - ny):
            owner[k] = 'head'
        # colletti alti sopra la clavicola: col petto, non con la spalla
        if b in ('shoulderL', 'shoulderR') and k not in arm_ids:
            ua = joints['upperArm' + b[-1]]
            if c[k, 1] > ua[1] + 0.05 * H and abs(c[k, 0]) < abs(ua[0]):
                owner[k] = 'chest'
    for k, b in ov.get('assign', {}).items():
        owner[int(k)] = b
    # articolazioni simmetriche (le proporzioni del gioco lo sono)
    for b in ('shoulder', 'upperArm', 'foreArm', 'hand', 'thigh', 'shin', 'foot'):
        l, r = joints[b + 'L'], joints[b + 'R']
        m = np.array([(l[0] - r[0]) / 2, (l[1] + r[1]) / 2, (l[2] + r[2]) / 2])
        joints[b + 'L'], joints[b + 'R'] = m, m * np.array([-1.0, 1.0, 1.0])
    for b in ('hips', 'spine', 'chest', 'neck', 'head'):
        joints[b] = np.array([0.0, joints[b][1], joints[b][2]])
    fl, fr = fingers.get('L', {}).get('joints', {}), fingers.get('R', {}).get('joints', {})
    for key in set(fl) & set(fr):
        m = np.array([(fl[key][0] - fr[key][0]) / 2, (fl[key][1] + fr[key][1]) / 2, (fl[key][2] + fr[key][2]) / 2])
        fl[key], fr[key] = m, m * np.array([-1.0, 1.0, 1.0])
    return RigGuess(owner=owner, joints=joints, chains=chains, fingers=fingers, notes=notes)
