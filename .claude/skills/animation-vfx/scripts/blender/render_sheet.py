"""
Contact sheet (+ onion skin) of an action, fully headless.
  blender -b char.blend --factory-startup -P render_sheet.py -- CLIP N OUT.png [--onion]
  python -I render_sheet.py char.blend CLIP N OUT.png [--onion]          (bpy wheel)
"""
import ctypes
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402  (bundled with Blender)
from mathutils import Vector  # noqa: E402

import ggg_anim as G  # noqa: E402

USAGE = __doc__
_cli = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
if not _cli or _cli[0] in ('-h', '--help'):
    print(USAGE)
    sys.exit(0)
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
if args[0].endswith('.blend'):
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(args.pop(0)))
CLIP, N, OUT = args[0], int(args[1]), os.path.abspath(args[2])
ONION = '--onion' in args
CELL = 256

sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == 'ARMATURE')
act = bpy.data.actions[CLIP]


def gpu_ok() -> bool:
    """Workbench/EEVEE need an EGL (or GLX) context; without it Blender ABORTS (exit 134)."""
    if sys.platform != 'linux':
        return True
    try:
        ctypes.CDLL('libEGL.so.1')
        return True
    except OSError:
        return False


r = sc.render
r.resolution_x = r.resolution_y = CELL
r.resolution_percentage = 100
r.film_transparent = True
r.image_settings.file_format = 'PNG'
r.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'       # AgX/Filmic would shift flat colours
if gpu_ok():
    r.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light, sh.color_type = 'STUDIO', 'OBJECT'
    sh.show_object_outline = True
    sc.display.render_aa = '8'
else:
    r.engine = 'CYCLES'
    sc.cycles.device, sc.cycles.samples, sc.cycles.use_denoising = 'CPU', 8, False
    if sc.world is None:
        sc.world = bpy.data.worlds.new('W')
    sc.world.color = (0.8, 0.8, 0.8)
print('engine:', r.engine)

# orthographic camera framing the clip's full motion (sampled bounds of the pose)
G.preview_clip(arm, act)
f0, f1 = (int(round(x)) for x in act.frame_range)
frames = [round(f0 + (f1 - f0) * i / max(1, N - 1)) for i in range(N)]
pts = []
for f in frames:
    sc.frame_set(f)
    pts += [arm.matrix_world @ pb.head for pb in arm.pose.bones] + [arm.matrix_world @ pb.tail for pb in arm.pose.bones]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
mid = (lo + hi) / 2
cam_data = bpy.data.cameras.new('SheetCam')
cam_data.type, cam_data.ortho_scale = 'ORTHO', max(hi.x - lo.x, hi.z - lo.z) * 1.25 + 0.1
cam = bpy.data.objects.new('SheetCam', cam_data)
sc.collection.objects.link(cam)
cam.location = (mid.x - 3.0, mid.y - 4.0, mid.z + 0.6)      # 3/4 front view (front = -Y)
cam.rotation_euler = (Vector(mid) - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.camera = cam
if not any(o.type == 'LIGHT' for o in sc.objects):
    ld = bpy.data.lights.new('Key', 'SUN')
    ld.energy = 3.0
    lo_ = bpy.data.objects.new('Key', ld)
    lo_.rotation_euler = (math.radians(50), 0, math.radians(-30))
    sc.collection.objects.link(lo_)

# frame label: a text object parented to the camera, rewritten per frame
td = bpy.data.curves.new('Label', 'FONT')
td.size = cam_data.ortho_scale * 0.07
lab = bpy.data.objects.new('Label', td)
sc.collection.objects.link(lab)
lab.parent = cam
lab.location = (-cam_data.ortho_scale * 0.47, cam_data.ortho_scale * 0.40, -1.0)
lab.color = (1.0, 0.2, 0.1, 1.0)
lab.hide_render = ONION
fps = sc.render.fps / sc.render.fps_base

tmp = os.path.join(os.path.dirname(OUT), '_frames')
os.makedirs(tmp, exist_ok=True)
tiles = []
for i, f in enumerate(frames):
    sc.frame_set(f)
    td.body = f'{CLIP} f{f} {(f - f0) / fps:.2f}s'
    r.filepath = os.path.join(tmp, f'f{f:04d}.png')
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(r.filepath)
    px = np.empty(CELL * CELL * 4, dtype=np.float32)
    img.pixels.foreach_get(px)                        # bottom-up rows, RGBA float
    tiles.append(px.reshape(CELL, CELL, 4))
    bpy.data.images.remove(img)
G.end_preview(arm)

if ONION:      # oldest = cyan, newest = magenta, later frames on top
    canvas = np.zeros((CELL, CELL, 4), np.float32)
    canvas[..., :3] = 0.08
    canvas[..., 3] = 1.0
    for i, t in enumerate(tiles):
        k = i / max(1, len(tiles) - 1)
        tint = np.array([k, 1.0 - k, 1.0], np.float32)
        a = t[..., 3:4] * (0.25 + 0.75 * k)
        canvas[..., :3] = canvas[..., :3] * (1 - a) + (t[..., :3] * 0.5 + tint * 0.5) * a
    out = canvas
else:          # grid, row-major from the top-left
    cols = math.ceil(math.sqrt(len(tiles)))
    rows = math.ceil(len(tiles) / cols)
    out = np.zeros((rows * CELL, cols * CELL, 4), np.float32)
    out[..., :3], out[..., 3] = 0.12, 1.0
    for i, t in enumerate(tiles):
        rr, cc = divmod(i, cols)
        y0 = (rows - 1 - rr) * CELL                    # numpy row 0 = image bottom
        a = t[..., 3:4]
        cell = out[y0:y0 + CELL, cc * CELL:(cc + 1) * CELL]
        cell[..., :3] = cell[..., :3] * (1 - a) + t[..., :3] * a
h, w = out.shape[:2]
im = bpy.data.images.new('sheet', w, h, alpha=True)
im.pixels.foreach_set(out.ravel())
im.filepath_raw, im.file_format = OUT, 'PNG'
im.save()
print('wrote', OUT, w, 'x', h)
