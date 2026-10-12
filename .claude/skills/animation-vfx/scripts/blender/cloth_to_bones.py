"""
Cloth cape -> bone chain keys (game-ready: a skinned cape driven by 4 bones, no sim at runtime).
  blender -b --factory-startup -P cloth_to_bones.py -- OUT_DIR
Steps: animated 'chest' + pinned cloth cape -> bake point cache -> Damped Track each cape bone
to a vertex group at its tail -> visual-key bake to FK -> drop constraints & cloth -> skin cape
to the bones -> measure bone-tip vs. cloth error -> export GLB.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Quaternion, Vector  # noqa: E402

import ggg_anim as G  # noqa: E402

USAGE = __doc__
_cli = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
if not _cli or _cli[0] in ('-h', '--help'):
    print(USAGE)
    sys.exit(0)
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = os.path.abspath(args[0])
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = 30
F0, F1 = 1, 60
sc.frame_start, sc.frame_end = F0, F1

# --- rig: chest + 4-bone cape chain hanging behind the back (+Y = back) -----------------------
NB, TOP, LEN = 4, 1.40, 0.80
bones = [{'name': 'chest', 'head': (0, 0, 1.0), 'tail': (0, 0, 1.45)}]
for i in range(NB):
    z0, z1 = TOP - LEN * i / NB, TOP - LEN * (i + 1) / NB
    bones.append({'name': f'cape{i}', 'head': (0, 0.12, z0), 'tail': (0, 0.12, z1),
                  'parent': 'chest' if i == 0 else f'cape{i - 1}', 'roll_ref': (0, 1, 0)})
arm = G.build_armature('CapeRig', bones)

# --- cape mesh (grid 9 x 17), pinned top row, skinned top row to chest for the sim ------------
W, NX, NZ = 0.45, 8, 16
verts = [(-W / 2 + W * x / NX, 0.12, TOP - LEN * z / NZ) for z in range(NZ + 1) for x in range(NX + 1)]
faces = [(z * (NX + 1) + x, z * (NX + 1) + x + 1, (z + 1) * (NX + 1) + x + 1, (z + 1) * (NX + 1) + x)
         for z in range(NZ) for x in range(NX)]
me = bpy.data.meshes.new('Cape')
me.from_pydata(verts, [], faces)
cape = bpy.data.objects.new('Cape', me)
sc.collection.objects.link(cape)
row = lambda z: [z * (NX + 1) + x for x in range(NX + 1)]           # noqa: E731
cape.vertex_groups.new(name='pin').add(row(0), 1.0, 'REPLACE')
cape.vertex_groups.new(name='chest').add(row(0), 1.0, 'REPLACE')
for i in range(NB):                       # target groups: the row at each bone's tail
    cape.vertex_groups.new(name=f'tip{i}').add(row(NZ * (i + 1) // NB), 1.0, 'REPLACE')
cape.parent = arm
am = cape.modifiers.new('Armature', 'ARMATURE')       # order matters: armature BEFORE cloth
am.object = arm
cl = cape.modifiers.new('Cloth', 'CLOTH')
cs = cl.settings
cs.vertex_group_mass = 'pin'
cs.quality, cs.mass, cs.air_damping = 8, 0.25, 2.0
cs.tension_stiffness = cs.compression_stiffness = 20.0
cs.bending_stiffness = 0.5
cl.point_cache.frame_start, cl.point_cache.frame_end = F0, F1

# --- animate the chest: lunge forward (-Y) then spin 90 degrees -----------------------------
G.assign_action(arm, bpy.data.actions.new('ChestMove'))
pb = arm.pose.bones['chest']
for f, y, yaw in ((F0, 0.0, 0), (20, -0.8, 0), (40, -0.9, 90), (F1, -0.9, 90)):
    pb.location = (0, 0, -y)          # chest local Z = -Y (front) for this roll
    pb.rotation_quaternion = Quaternion((0, 1, 0), math.radians(yaw))   # local Y = up
    pb.keyframe_insert('location', frame=f, group='chest')
    pb.keyframe_insert('rotation_quaternion', frame=f, group='chest')

# --- simulate: bake the point cache (needs sequential evaluation from frame_start) -----------
sc.frame_set(F0)
with bpy.context.temp_override(scene=sc, active_object=cape, point_cache=cl.point_cache):
    bpy.ops.ptcache.bake(bake=True)
print('cloth baked:', cl.point_cache.is_baked)

# --- cape bones aim at the simulated rows ------------------------------------------------------
for i in range(NB):
    c = arm.pose.bones[f'cape{i}'].constraints.new('DAMPED_TRACK')
    c.target, c.subtarget, c.track_axis = cape, f'tip{i}', 'TRACK_Y'


def tip_error():
    """max distance (m) between each cape bone tail and its target row centre (evaluated mesh)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = cape.evaluated_get(dg)
    worst = 0.0
    for i in range(NB):
        idx = row(NZ * (i + 1) // NB)
        ctr = sum((ev.matrix_world @ ev.data.vertices[k].co for k in idx), Vector()) / len(idx)
        tail = arm.matrix_world @ arm.pose.bones[f'cape{i}'].tail
        worst = max(worst, (tail - ctr).length)
    return worst


errs = []
for f in range(F0, F1 + 1, 10):
    sc.frame_set(f)
    errs.append(round(tip_error(), 4))
print('constraint-driven tip error per 10 frames (m):', errs)

# --- visual bake -> FK keys, then remove constraints ------------------------------------------
cape_act = G.bake_to_fk(arm, F0, F1, 'CapeSwing', clear_constraints=True)
sc.frame_set(30)
print('after bake, tip error @30 (cloth still on):', round(tip_error(), 4))

# --- runtime asset: drop cloth, skin cape rows to bones (linear blend between bone rows) ------
cape.modifiers.remove(cl)
for vg in list(cape.vertex_groups):
    if vg.name.startswith('tip') or vg.name == 'pin':
        cape.vertex_groups.remove(vg)
groups = {f'cape{i}': cape.vertex_groups.new(name=f'cape{i}') for i in range(NB)}
cape.vertex_groups['chest'].remove(row(0))
for z in range(NZ + 1):
    s = z / NZ * NB                                  # 0..NB along the chain
    i = min(int(s), NB - 1)
    w = s - i
    groups[f'cape{i}'].add(row(z), 1.0 - w if i < NB - 1 else 1.0, 'REPLACE')
    if i + 1 < NB and w > 0:
        groups[f'cape{i + 1}'].add(row(z), w, 'REPLACE')
G.push_to_nla(arm, cape_act)
bpy.data.actions.remove(bpy.data.actions['ChestMove'])
dropped = G.export_glb(os.path.join(OUT, 'cape.glb'), [arm, cape])
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'cape.blend'))
print('DONE', bpy.app.version_string)
