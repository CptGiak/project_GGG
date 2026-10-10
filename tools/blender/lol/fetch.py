"""Scarica una skin di League of Legends da raw.communitydragon.org (mirror dei file di gioco).

    python3 -I tools/blender/lol/fetch.py akali qiyana locke

Per ogni campione salva in tools/blender/lol/_cache/<id>/ (ignorata da git):
- skin.bin.json: i dati della skin (mesh, texture e materiali per pezzo, pezzi nascosti);
- la mesh .skn;
- le texture diffuse dei pezzi in PNG (il mirror converte .tex e .dds);
- skin_info.json: il riassunto che usa build_lol.py.

Il mirror non pubblica gli scheletri .skl: build_lol.py li ricostruisce dai pesi della mesh.
"""
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from skins import SKINS  # noqa: E402

BASE = 'https://raw.communitydragon.org/latest/'
UA = {'User-Agent': 'project-ggg-tools/1.0'}
CACHE = os.path.join(HERE, '_cache')


def get(path, out):
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return out
    req = urllib.request.Request(BASE + path, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out + '.part', 'wb') as f:
        f.write(data)
    os.replace(out + '.part', out)
    print(f'  {path}  {len(data) / 1024:.0f} KiB')
    return out


def game_path(asset):
    """Percorso di un asset nel mirror: minuscolo, sotto game/, texture convertite in PNG."""
    p = 'game/' + asset.lower()
    for ext in ('.tex', '.dds'):
        if p.endswith(ext):
            p = p[: -len(ext)] + '.png'
    return p


def diffuse_of(bin_data, material):
    mat = bin_data.get(material) or {}
    for sv in mat.get('samplerValues', []):
        if (sv.get('samplerName') or sv.get('TextureName')) in ('Diffuse_Texture', 'DiffuseTexture'):
            return sv.get('texturePath') or sv.get('textureName')
    return None


def fetch(cid):
    cfg = SKINS[cid]
    champ, skin = cfg['champ'], cfg['skin']
    out_dir = os.path.join(CACHE, cid)
    print(f'{cid}: {cfg["name"]}')
    bin_path = get(f'game/data/characters/{champ}/skins/skin{skin}.bin.json', os.path.join(out_dir, 'skin.bin.json'))
    data = json.load(open(bin_path))
    props = next(v for v in data.values() if isinstance(v, dict) and v.get('__type') == 'SkinCharacterDataProperties')
    mesh = props['skinMeshProperties']

    default_tex = mesh.get('texture') or (diffuse_of(data, mesh['Material']) if mesh.get('Material') else None)
    overrides = {}
    for o in mesh.get('materialOverride', []):
        tex = o.get('texture') or (diffuse_of(data, o['Material']) if o.get('Material') else None)
        if tex:
            overrides[o['submesh']] = tex
    hidden = mesh.get('initialSubmeshToHide', '').replace(',', ' ').split()

    skn = get(game_path(mesh['simpleSkin']), os.path.join(out_dir, os.path.basename(mesh['simpleSkin']).lower()))
    textures = {}
    for tex in sorted({t for t in [default_tex, *overrides.values()] if t}):
        png = os.path.join(out_dir, os.path.basename(game_path(tex)))
        textures[tex] = os.path.basename(get(game_path(tex), png))

    chains = []
    for m in mesh.get('rigPoseModifierData', []) or []:
        if m.get('mStartingJointName') and m.get('mEndingJointName'):
            chains.append([m['mStartingJointName'], m['mEndingJointName']])

    info = {
        'id': cid,
        'name': cfg['name'],
        'skn': os.path.basename(skn),
        'skin_scale': mesh.get('skinScale', 1.0),
        'default_texture': textures.get(default_tex),
        'textures': {sub: textures[t] for sub, t in overrides.items()},
        'hidden': hidden,
        'cloth_chains': chains,
    }
    with open(os.path.join(out_dir, 'skin_info.json'), 'w') as f:
        json.dump(info, f, indent=2)
    return info


if __name__ == '__main__':
    for cid in sys.argv[1:] or list(SKINS):
        fetch(cid)
