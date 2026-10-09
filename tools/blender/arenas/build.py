"""Arena art builder (headless Blender through the bpy module).

    PY=/root/blender-venv/bin/python
    $PY -I tools/blender/arenas/build.py city --textures      # facade / floor tiles -> public/models/arenas/
    $PY -I tools/blender/arenas/build.py city --kit           # kit pieces -> public/models/arenas/city.glb
    $PY -I tools/blender/arenas/build.py all --textures --kit --preview
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import kit  # noqa: E402

THEMES = ['city', 'stage', 'tartarus']


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('theme', choices=THEMES + ['all'])
    ap.add_argument('--textures', action='store_true', help='render the texture tiles')
    ap.add_argument('--kit', action='store_true', help='model and export the kit GLB')
    ap.add_argument('--preview', action='store_true', help='render a contact sheet of the kit')
    ap.add_argument('--only', default='', help='comma separated tile / piece names')
    args = ap.parse_args()
    themes = THEMES if args.theme == 'all' else [args.theme]
    for t in themes:
        mod = __import__(t)
        t0 = time.time()
        only = [s for s in args.only.split(',') if s]
        if args.textures:
            mod.build_textures(kit.OUT_DIR, only) if only else mod.build_textures(kit.OUT_DIR)
        if args.kit or args.preview:
            mod.build_kit(kit.OUT_DIR, export=args.kit, preview=args.preview)
        print(f'[{t}] done in {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
