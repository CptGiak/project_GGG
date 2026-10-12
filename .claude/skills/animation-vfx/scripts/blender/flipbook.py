"""
VFX flipbook: animated emissive ring burst -> N transparent frames -> COLSxROWS atlas + JSON.
Also exports the slash/arc mesh (UV u = along arc, v = across) as a GLB for UV-scroll shaders.
  blender -b --factory-startup -P flipbook.py -- OUT_DIR [--frames 16] [--cell 128]
"""
import ctypes
import json
import math
import os
import sys

import bpy
import numpy as np

USAGE = __doc__
_cli = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
if not _cli or _cli[0] in ('-h', '--help'):
    print(USAGE)
    sys.exit(0)
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = os.path.abspath(args[0])
NF = int(args[args.index('--frames') + 1]) if '--frames' in args else 16
CELL = int(args[args.index('--cell') + 1]) if '--cell' in args else 128
os.makedirs(OUT, exist_ok=True)
BL = bpy.app.version

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def arc_mesh(name, r0, r1, a0, a1, seg=48):
    """Annulus sector; UV u: 0->1 along the arc (scroll direction), v: 0 inner -> 1 outer."""
    verts, faces, uvs = [], [], []
    for i in range(seg + 1):
        a = a0 + (a1 - a0) * i / seg
        verts += [(r0 * math.cos(a), r0 * math.sin(a), 0), (r1 * math.cos(a), r1 * math.sin(a), 0)]
    for i in range(seg):
        faces.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uv.data[li].uv = ((vi // 2) / seg, vi % 2)
    me.update()
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    return ob


# --- emissive material: colour ramp across the band (v), alpha fades with an animated value ---
mat = bpy.data.materials.new('Burst')
if bpy.app.version < (5, 0, 0):                    # node trees are always on in 5.x
    mat.use_nodes = True
if hasattr(mat, 'surface_render_method'):          # EEVEE Next (4.2+)
    mat.surface_render_method = 'BLENDED'
nt = mat.node_tree
nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputMaterial')
mix = nt.nodes.new('ShaderNodeMixShader')
tr = nt.nodes.new('ShaderNodeBsdfTransparent')
em = nt.nodes.new('ShaderNodeEmission')
uvn = nt.nodes.new('ShaderNodeUVMap')
sep = nt.nodes.new('ShaderNodeSeparateXYZ')
ramp = nt.nodes.new('ShaderNodeValToRGB')
fade = nt.nodes.new('ShaderNodeValue')
mul = nt.nodes.new('ShaderNodeMath')
mul.operation = 'MULTIPLY'
ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = 0.0, (1.0, 0.25, 0.02, 0.0)
ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = 0.55, (1.0, 0.9, 0.6, 1.0)
e2 = ramp.color_ramp.elements.new(1.0)
e2.color = (1.0, 0.4, 0.05, 0.0)
nt.links.new(uvn.outputs['UV'], sep.inputs[0])
nt.links.new(sep.outputs['Y'], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], em.inputs['Color'])
nt.links.new(ramp.outputs['Alpha'], mul.inputs[0])
nt.links.new(fade.outputs[0], mul.inputs[1])
nt.links.new(mul.outputs[0], mix.inputs['Fac'])
nt.links.new(tr.outputs[0], mix.inputs[1])
nt.links.new(em.outputs[0], mix.inputs[2])
nt.links.new(mix.outputs[0], out.inputs['Surface'])
em.inputs['Strength'].default_value = 1.2          # >1 clips to white under 'Standard'

ring = arc_mesh('Ring', 0.55, 1.0, 0.0, 2 * math.pi)
ring.data.materials.append(mat)

# --- animation: scale 0.2 -> 1.0 (EASE_OUT expo), alpha 1 -> 0 (EASE_IN) over NF frames -------
sc.frame_start, sc.frame_end = 0, NF - 1
for f, s, a in ((0, 0.2, 1.0), (NF - 1, 1.0, 0.0)):
    ring.scale = (s, s, s)
    ring.keyframe_insert('scale', frame=f)
    fade.outputs[0].default_value = a
    fade.outputs[0].keyframe_insert('default_value', frame=f)   # node-tree action (own slot on 4.4+)


def ease(id_data, interp, easing):
    ad = id_data.animation_data
    act = ad.action
    if BL >= (4, 4, 0):
        fcs = [fc for l in act.layers for st in l.strips for cb in st.channelbags for fc in cb.fcurves]
    else:
        fcs = list(act.fcurves)
    for fc in fcs:
        for kp in fc.keyframe_points:
            kp.interpolation, kp.easing = interp, easing


ease(ring, 'EXPO', 'EASE_OUT')
ease(mat.node_tree, 'QUAD', 'EASE_IN')

# --- camera: orthographic, top-down, effect fills the cell ------------------------------------
cd = bpy.data.cameras.new('Cam')
cd.type, cd.ortho_scale = 'ORTHO', 2.1
cam = bpy.data.objects.new('Cam', cd)
sc.collection.objects.link(cam)
cam.location = (0, 0, 5)
sc.camera = cam

# --- render settings ---------------------------------------------------------------------------
r = sc.render
r.resolution_x = r.resolution_y = CELL
r.resolution_percentage = 100
r.film_transparent = True                       # alpha = coverage; PNG stores STRAIGHT alpha
r.image_settings.file_format, r.image_settings.color_mode = 'PNG', 'RGBA'
r.use_compositing = False                       # no glare/bloom (EEVEE Next has no built-in bloom)
sc.view_settings.view_transform = 'Standard'    # AgX (default) desaturates emissive colours
try:
    ctypes.CDLL('libEGL.so.1') if sys.platform == 'linux' else None
    r.engine = 'BLENDER_EEVEE' if BL >= (5, 0, 0) else 'BLENDER_EEVEE_NEXT'
    sc.eevee.taa_render_samples = 16
except OSError:
    r.engine = 'CYCLES'
    sc.cycles.device, sc.cycles.samples, sc.cycles.use_denoising = 'CPU', 16, False
print('engine', r.engine)

frames_dir = os.path.join(OUT, 'frames')
os.makedirs(frames_dir, exist_ok=True)
tiles = []
for f in range(NF):
    sc.frame_set(f)
    r.filepath = os.path.join(frames_dir, f'burst_{f:03d}.png')
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(r.filepath)
    px = np.empty(CELL * CELL * 4, np.float32)
    img.pixels.foreach_get(px)
    tiles.append(px.reshape(CELL, CELL, 4))
    bpy.data.images.remove(img)

# --- pack: frame 0 top-left, row-major (Blender image rows are bottom-up) ----------------------
cols = math.ceil(math.sqrt(NF))
rows = math.ceil(NF / cols)
atlas = np.zeros((rows * CELL, cols * CELL, 4), np.float32)
for i, t in enumerate(tiles):
    rr, cc = divmod(i, cols)
    y0 = (rows - 1 - rr) * CELL
    atlas[y0:y0 + CELL, cc * CELL:(cc + 1) * CELL] = t
im = bpy.data.images.new('atlas', cols * CELL, rows * CELL, alpha=True)
im.pixels.foreach_set(atlas.ravel())
im.filepath_raw, im.file_format = os.path.join(OUT, 'burst_atlas.png'), 'PNG'
im.save()
meta = {'image': 'burst_atlas.png', 'frames': NF, 'cols': cols, 'rows': rows, 'cell': CELL,
        'fps': 30, 'order': 'row-major, frame 0 top-left', 'alpha': 'straight'}
json.dump(meta, open(os.path.join(OUT, 'burst_atlas.json'), 'w'), indent=1)

# --- the slash mesh as its own GLB (u along the arc for UV scrolling) ---------------------------
slash = arc_mesh('Slash', 0.8, 1.0, math.radians(-60), math.radians(110), seg=32)
for o in sc.objects:
    o.select_set(o == slash)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'slash.glb'), export_format='GLB',
                          use_selection=True, export_animations=False, export_materials='NONE')
print('atlas', cols, 'x', rows, 'cells of', CELL, '->', os.path.join(OUT, 'burst_atlas.png'))
