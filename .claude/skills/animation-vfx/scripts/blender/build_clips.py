"""
Test driver: 19-bone GGG skeleton -> 3 clips (FK loop, FK attack w/ BACK easing + events,
IK walk baked to FK) -> NLA -> GLB. Usage:
  blender -b --factory-startup -P build_clips.py -- OUT_DIR
  python -I build_clips.py OUT_DIR            (PyPI bpy wheel)
"""
import json
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
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
OUT = os.path.abspath(argv[0] if argv else 'out')
os.makedirs(OUT, exist_ok=True)
FPS = 30

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps, sc.render.fps_base = FPS, 1.0

# --- skeleton: Blender coords, X = character's left, -Y = front, Z = up (T-pose) ------------
J = {'hips': (0, 0, .95), 'spine': (0, 0, 1.05), 'chest': (0, 0, 1.25), 'neck': (0, 0, 1.45),
     'head': (0, 0, 1.55), 'headTop': (0, 0, 1.75)}
for s, x in (('L', 1), ('R', -1)):
    J |= {f'shoulder{s}': (.03 * x, 0, 1.42), f'upperArm{s}': (.17 * x, 0, 1.42),
          f'foreArm{s}': (.45 * x, 0, 1.42), f'hand{s}': (.70 * x, 0, 1.42),
          f'handEnd{s}': (.80 * x, 0, 1.42), f'thigh{s}': (.10 * x, 0, .92),
          f'shin{s}': (.10 * x, -.01, .50), f'foot{s}': (.10 * x, 0, .08),
          f'toe{s}': (.10 * x, -.14, .02)}
CHAIN = [('hips', 'spine', None), ('spine', 'chest', 'hips'), ('chest', 'neck', 'spine'),
         ('neck', 'head', 'chest'), ('head', 'headTop', 'neck')]
for s in 'LR':
    CHAIN += [(f'shoulder{s}', f'upperArm{s}', 'chest'), (f'upperArm{s}', f'foreArm{s}', f'shoulder{s}'),
              (f'foreArm{s}', f'hand{s}', f'upperArm{s}'), (f'hand{s}', f'handEnd{s}', f'foreArm{s}'),
              (f'thigh{s}', f'shin{s}', 'hips'), (f'shin{s}', f'foot{s}', f'thigh{s}'),
              (f'foot{s}', f'toe{s}', f'shin{s}')]
bones = [{'name': h, 'head': J[h], 'tail': J[t], 'parent': p} for h, t, p in CHAIN]
arm = G.build_armature('Rig', bones)
body = G.rigid_box_mesh(arm)
assert len(arm.data.bones) == 19, len(arm.data.bones)


def rot(bone, axis, deg):
    """Bone-local quaternion for 'rotate `deg` about ARMATURE axis `axis`' (at rest)."""
    R = arm.data.bones[bone].matrix_local.to_quaternion()
    return tuple(R.inverted() @ Quaternion(Vector(axis), math.radians(deg)) @ R)


ID = (1, 0, 0, 0)

# --- clip 1: Idle loop (BEZIER, last key == first key) --------------------------------------
idle = G.key_clip(arm, 'Idle', fps=FPS, loop=True, keys=[
    {'t': 0.0, 'rot': {'chest': ID, 'upperArmL': rot('upperArmL', (0, 1, 0), 70), 'upperArmR': rot('upperArmR', (0, 1, 0), -70)}},
    {'t': 1.0, 'rot': {'chest': rot('chest', (1, 0, 0), 4), 'upperArmL': rot('upperArmL', (0, 1, 0), 66), 'upperArmR': rot('upperArmR', (0, 1, 0), -66)}},
    {'t': 2.0, 'rot': {'chest': ID, 'upperArmL': rot('upperArmL', (0, 1, 0), 70), 'upperArmR': rot('upperArmR', (0, 1, 0), -70)}},
])

# --- clip 2: Attack (anticipation EASE_IN, strike BACK/EASE_OUT overshoot, hold, recover) -----
attack = G.key_clip(arm, 'Attack', fps=FPS, keys=[
    {'t': 0.00, 'interp': 'SINE', 'easing': 'EASE_IN',
     'rot': {'chest': ID, 'upperArmR': rot('upperArmR', (0, 1, 0), -70), 'foreArmR': ID}},
    {'t': 0.18, 'interp': 'BACK', 'easing': 'EASE_OUT', 'back': 2.2,
     'rot': {'chest': rot('chest', (0, 0, 1), -35), 'upperArmR': rot('upperArmR', (1, 0, 0), -80), 'foreArmR': rot('foreArmR', (1, 0, 0), -60)}},
    {'t': 0.30, 'interp': 'CONSTANT',
     'rot': {'chest': rot('chest', (0, 0, 1), 30), 'upperArmR': rot('upperArmR', (1, 0, 0), 85), 'foreArmR': ID}},
    {'t': 0.40, 'interp': 'BEZIER',
     'rot': {'chest': rot('chest', (0, 0, 1), 30), 'upperArmR': rot('upperArmR', (1, 0, 0), 85), 'foreArmR': ID}},
    {'t': 0.80,
     'rot': {'chest': ID, 'upperArmR': rot('upperArmR', (0, 1, 0), -70), 'foreArmR': ID}},
])
G.set_events(attack, [('windup', 0.0), ('hit', 0.30), ('recover', 0.40)], FPS)

# --- clip 3: Walk = IK legs (world-space empties) + hips root motion, baked to FK ------------
T = 30                                            # frames per cycle
targets = {}
for s, x in (('L', 1), ('R', -1)):
    foot = bpy.data.objects.new(f'ikFoot{s}', None)
    pole = bpy.data.objects.new(f'ikKnee{s}', None)
    for o in (foot, pole):
        sc.collection.objects.link(o)
    foot.rotation_mode = 'QUATERNION'             # foot keeps its rest world orientation
    foot.rotation_quaternion = arm.data.bones[f'foot{s}'].matrix_local.to_quaternion()
    targets[s] = (foot, pole)
    shin = arm.pose.bones[f'shin{s}']
    ik = shin.constraints.new('IK')
    ik.target, ik.pole_target, ik.chain_count = foot, pole, 2
    cr = arm.pose.bones[f'foot{s}'].constraints.new('COPY_ROTATION')
    cr.target = foot

# rest calibration: targets at rest joints, pick the pole angle that reproduces the rest pose
for s, x in (('L', 1), ('R', -1)):
    foot, pole = targets[s]
    foot.location = J[f'foot{s}']
    pole.location = (J[f'shin{s}'][0], -0.6, J[f'shin{s}'][2])
    ik = arm.pose.bones[f'shin{s}'].constraints['IK']
    best = None
    for a in (0, 90, -90, 180):
        ik.pole_angle = math.radians(a)
        bpy.context.view_layer.update()
        err = 0.0
        for b in (f'thigh{s}', f'shin{s}'):
            d = arm.pose.bones[b].matrix.to_quaternion().rotation_difference(
                arm.data.bones[b].matrix_local.to_quaternion()).angle
            err += min(d, 2 * math.pi - d)            # q and -q are the same rotation
        best = min(best or (err, a), (err, a))
    ik.pole_angle = math.radians(best[1])
    print(f'pole_angle {s}: {best[1]} deg (rest error {best[0]:.5f} rad)')


def key_obj(o, f, loc):
    o.location = loc
    o.keyframe_insert('location', frame=f)        # keyframe_insert works on every version


hip = arm.pose.bones['hips']
arm.animation_data.action = None                   # keyframe_insert keys INTO the assigned action!
for f in range(0, T + 1):
    t = f / T
    y = -0.6 * t                                  # root motion: 0.6 m per cycle toward -Y
    for s, phase in (('L', 0.0), ('R', 0.5)):
        foot, pole = targets[s]
        x = J[f'foot{s}'][0]
        u = (t - phase) % 1.0                      # 0..0.5 stance, 0.5..1 swing
        if s == 'L':
            plant_now = -0.15 - 0.6 * math.floor(t)          # stance [0,.5) at -0.15, next at -0.75
            if u < 0.5:
                fy, fz = plant_now, J['footL'][2]
            else:
                w = (u - 0.5) / 0.5
                fy, fz = plant_now + (-0.6) * (0.5 - 0.5 * math.cos(math.pi * w)), J['footL'][2] + 0.10 * math.sin(math.pi * w)
        else:
            if t < 0.5:                                       # swing from +0.15 to -0.45
                w = t / 0.5
                fy, fz = 0.15 - 0.6 * (0.5 - 0.5 * math.cos(math.pi * w)), J['footR'][2] + 0.10 * math.sin(math.pi * w)
            else:
                fy, fz = -0.45, J['footR'][2]
        key_obj(foot, f, (x, fy, fz))
        key_obj(pole, f, (J[f'shin{s}'][0], y - 0.6, J[f'shin{s}'][2]))
    # hips: bone-local axes are (X, Y=up, Z=front) for this roll -> armature (-Y) == local +Z
    hip.location = (0, -0.02 + 0.02 * math.cos(4 * math.pi * t), -y)
    hip.keyframe_insert('location', frame=f, group='hips')

walk_src = arm.animation_data.action               # hips-only action used while baking
sc.frame_start, sc.frame_end = 0, T
walk = G.bake_to_fk(arm, 0, T, 'Walk')             # IK + COPY_ROTATION solved -> FK keys
bpy.data.actions.remove(walk_src)
for s in 'LR':
    for o in targets[s]:
        bpy.data.objects.remove(o)

# --- a stray, never-published action (demonstrates export_anim_single_armature) ---------------
stray = G.key_clip(arm, 'WIP_unused', fps=FPS, keys=[{'t': 0, 'rot': {'head': ID}}, {'t': 1, 'rot': {'head': rot('head', (0, 0, 1), 40)}}])
arm.animation_data.action = None

# --- NLA: one track per published clip ----------------------------------------------------------
for act in (idle, attack, walk):
    G.push_to_nla(arm, act)
arm.animation_data.action = None

# --- checks -------------------------------------------------------------------------------------
report = [G.check_clip(arm, a, FPS) for a in (idle, attack, walk)]
for r in report:
    print('CHECK', json.dumps(r))

# --- exports ------------------------------------------------------------------------------------
v = '%d%d' % bpy.app.version[:2]
dropped = G.export_glb(os.path.join(OUT, f'char_{v}.glb'), [arm, body])
print('dropped (unknown in this version):', dropped)
G.export_glb(os.path.join(OUT, f'char_{v}_default_single_armature.glb'), [arm, body],
             export_anim_single_armature=True)
G.export_glb(os.path.join(OUT, f'char_{v}_nosample.glb'), [arm, body], export_force_sampling=False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f'char_{v}.blend'))
print('DONE', bpy.app.version_string)
