# Sculpting with `charkit.sdf`: recipes

Contents: API cheat sheet · resolution · head · eyes · nose · ears · mouth · wrinkles ·
hair (locks) · hands · torso and clothes · folds · accessories · hard-surface props ·
debugging.

All coordinates are metres, Blender axes (X = character's left, -Y = front, Z = up).
`S` = `charkit.sdf`. Every shape is an `SDF` node; nothing is meshed until `S.mesh(shape, voxel)`.

## API cheat sheet

| Need | Call |
|---|---|
| ball, egg, pill, tapered limb | `S.sphere(c, r)`, `S.ellipsoid(c, radii, R)`, `S.capsule(a, b, r)`, `S.round_cone(a, b, r1, r2)` |
| box with rounded edges | `S.round_box(c, half, r, R)` |
| ring, disc, cylinder | `S.torus(c, R, r, R=rot, sx, sy)`, `S.cylinder(c, radius, half_h, r, R)` |
| solid of revolution | `S.lathe([(r, z), ...], c, R)` (chess pieces, canisters, coats via `S.scale`) |
| curve with radius | `S.tube(points, radii)`, `S.smooth_tube(points, radii)` (Catmull-Rom) |
| flat strip along a curve | `S.ribbon(points, width, thick, up=normal)` (scarves, straps, belts, cloth tails) |
| hair clump | `S.lock(points, r_root, r_mid, r_tip, strands=amp)` |
| clay blend | `S.blend(a, b, ..., k=0.01)` (k = fillet radius) |
| hard union / cut / intersect | `S.union(...)`, `S.carve(a, cutter, k)`, `S.intersect(a, b, k)` |
| clothing layer | `S.shell(S.grow(body, gap), half_thickness)` |
| symmetric part | `shape.mirror_x()` (model the +X side once) |
| place a sub-model | `S.place(shape, t, R, s)` (uniform scale), `S.scale(shape, (sx, sy, sz))` |
| surface detail | `shape.displace(fn, amp)` with `S.grooves`, `S.masked`, `S.stretched`, `S.ridged`, `S.fbm`, `S.perlin` |
| put things on a surface | `S.snap(shape, points, offset)` + `S.normals(shape, p)` |
| check visibility | `S.raycast(shape, origins, direction)` |
| rotation helpers | `S.rot(x_deg, y_deg, z_deg)`, `S.look_rot(forward, up)` |

Smooth-blend radii that work: features of the face 3 to 8 mm, face masses 1.5 to 2 cm,
torso masses 4 to 6 cm, clothes into clothes 2 to 4 cm, accessories onto clothes 2 to 4 mm.

## Resolution and speed

- Voxel: face 0.8 to 1 mm, hair locks 0.6 to 1 mm, hands 1 to 1.2 mm, body and clothes
  2.5 to 3 mm, props 0.5 to 1.2 mm. A feature needs about 3 voxels across to survive.
- Iterate at `voxel × 2` with clay (8× fewer samples). Full resolution only for colour and
  final renders.
- Cost grows with the number of primitives *near each point*. Many locks (beards) are the
  slowest part (~2 to 3 min). Keep `samples` of `smooth_tube` low (3 to 5).
- Build expensive shapes once and cache them (`_cached()` pattern in the examples) when other
  parts snap to them.

## Head (stylised realism)

Masses, then carve, then add, then detail. Eye line at z = 0, face thirds:
hairline +0.085, brow +0.02, nose base -0.045, chin -0.11 (scale everything for caricature).

```python
cranium  = S.ellipsoid((0, .012, .03), (.074, .097, .087))
forehead = S.ellipsoid((0, -.045, .045), (.06, .045, .05))
face     = S.ellipsoid((0, -.033, -.032), (.058, .06, .062))
cheek    = S.ellipsoid((.051, -.048, -.016), (.02, .022, .015)).mirror_x()
brow     = S.ellipsoid((.03, -.074, .017), (.03, .016, .013), R=S.rot(0, -14, 0)).mirror_x()
muzzle   = S.ellipsoid((0, -.07, -.064), (.032, .026, .024))
chin     = S.ellipsoid((0, -.066, -.102), (.024, .02, .019))
jaw      = S.tube([(.057, .006, -.058), (.04, -.035, -.09), (.017, -.063, -.104)], .013).mirror_x()
head = S.blend(cranium, forehead, face, cheek, brow, muzzle, chin, jaw, neck, k=0.018)
```
Old age: hollow temples and cheeks (`carve` with k = 1.2 to 1.4 cm), bags under the eyes,
hooded upper lids, bigger nose and ears, wrinkles (see below).

## Eyes (the part most likely to go wrong)

Sculptor's construction: lid ball over the eyeball, then an almond cut.

```python
socket = S.ellipsoid((x, y - .032, z), (.019, .0175, .0135))   # broad depression IN FRONT of the eye
head = S.carve(head, socket, k=.008)
head = S.blend(head, S.sphere(c, r_eye + .0026), k=.0055)     # lid ball
head = S.blend(head, upper_fold_ellipsoid, k=.004)            # hooded lid / crease
opening = almond(c, gaze_y=-.03, half_up=.0058, half_dn=.0043, width=.0275, tilt=-7 * side)
opening = S.intersect(opening, S.sphere(c, r_eye + .0095), k=.001)
opening = S.carve(opening, S.sphere(c, r_eye - .0015))         # cut only in front of the eyeball
head = S.carve(head, opening, k=.0009)
```
The eyeballs are a separate object (`eye_colors` paints sclera, iris and pupil by the angle
from the gaze; aim the gaze at a point of interest: both eyes must converge).
Check before rendering: `S.raycast` a grid of rays from the camera side over the eye. The
eyeball must be hit first inside an almond (≈ 27 × 10 mm adult). Failure modes seen in practice:
- eyeball buried: the socket did not reach the real face surface (smooth blends add mm);
- dark ring or dark pit: the cutter removed a volume around the eyeball (missing the inner
  sphere subtraction) or the socket is a deep sphere instead of a broad depression;
- surprised or bulging look: the opening is too tall, or the eyeball sits too far forward.

## Nose

Bridge as a `smooth_tube` with a slight hump, tip as an ellipsoid plus two small lobes, wings
(alae) as ellipsoids rotated outwards, the columella as a round cone, nostrils carved from
below, and a thin capsule carved along the alar groove. Old or caricature: longer, drooping
tip, bigger wings. A single sphere tip reads as a clown nose. Keep projection ≤ 3.5 to 4 cm
from the cheek plane (a horizontal tube in profile means it is too long).

## Ears

Model one ear in its own frame (X out, -Y towards the face, Z up): flattened ellipsoid base +
helix (`torus` cut by a plane so it opens to the front) + lobe + tragus, carve the concha and
fossa. Place with `S.place(ear(), t, R=S.rot(-14, 0, 0)).mirror_x()`. Ears tilt back about 15°
and span brow to nose base. Use `mirror_x` for the pair, not a reflected matrix.

## Mouth

Either design it (upper lip as a flattened tube along a "bow" curve, lower lip fuller,
philtrum carve, corners carved with small spheres, nasolabial folds as long capsule carves
with a blend bulge beside them) or cover it (moustache, mask, scarf, collar). A badly built
mouth ruins a face; covering it is a legitimate design choice.

## Wrinkles and skin

```python
zone  = S.ellipsoid((0, -.07, .055), (.05, .04, .026))                      # forehead
lines = S.masked(S.grooves((0, 0, 1), .0105, width=.26, wobble=.22, wobble_freq=24), zone, .012)
head  = head.displace(lines, -0.0009)                                        # negative = cut in
```
Use frown lines (vertical, between the brows), crow's feet (radial, outer eye corners) and
forehead lines (horizontal). Keep depths at 0.5 to 1 mm. Strong wrinkles look like cuts. Add
pores and unevenness with `fbm` at ~180 cycles/m and amplitude ~0.2 mm.

## Hair, beards, brows: locks

Stylised hair is a few big readable clumps. Recipe:
1. Pick root curves on the scalp, jaw or brow and `S.snap` them onto the skin
   (offset 1 to 2 mm).
2. For each root, write 3 or 4 control points of the lock's flow (gravity, combing direction,
   convergence towards a tip area) with a little `S.jitter` per lock.
3. `S.lock(points, r_root, r_mid, r_tip, strands=0.4–1.1 mm)`, then union the locks with
   k = 2.5 to 4 mm.
4. Add a shrunk core volume under the locks (`S.grow(core, -4 mm)`) so gaps never show skin.
5. Build the two sides from different seeds (`_sides()` in the example). Exact mirror copies
   look artificial.
Brows lie along the brow ridge and only the outer tips lift. Locks that stick out sideways
read as horns.

## Hands

Palm as a round box plus a heel ellipsoid. Each finger is a 3-segment tube whose segment
lengths shrink (0.42/0.33/0.25 of its length), with a curl angle that grows per joint. Add
knuckle spheres at the joints (bigger for old hands), a thumb from the heel of the palm,
tendons and veins as thin capsules on the back, and a wrist round cone. Model one hand in hand
space (wrist at origin, fingers along -Z) and place it with the forearm frame (see
`chess_master_body.hands()`). Caricature heroes often have hands 1.2 to 1.4× realistic.

## Torso and clothes

- Body volumes first (chest, belly, pelvis, upper-back hump, shoulder balls, trapezius cones).
  Clothes are built from them, so the body itself only needs to exist where it shows.
- Jacket or coat top: `S.grow(torso, 0.02)` cut with a plane at the waist.
- Coat skirt or long coat: a `lathe` profile (r over z) made elliptic with
  `S.scale(..., (1, 0.8, 1))`, then `shell` (7 to 8 mm), hem cut by a slightly tilted plane, and
  a front slit and back vent carved. Stacked ellipsoids give tyres.
- Sleeves: `smooth_tube` shoulder → elbow → wrist (baggy radii), a cuff round cone, and a
  hollow carved in the cuff so the wrist goes in.
- Collars: a torus around the neck base (rotated forwards) blended with k ≈ 2 cm.
- Closures and seams: thin round boxes carved (step of the overlapping panel).
- Patches, flaps, pockets: `snap` the centre and orient with `look_rot(normal)`.
  Half-thickness 2 to 3 mm. Thick blocks read as handles.
- Hollow cloth (`shell`) where you can see inside (skirts, hoods, open collars). Solid elsewhere.

## Folds (where and how)

| Fold | Where | Recipe |
|---|---|---|
| compression rings | inside elbow, back of knee, ankle "break" | `grooves(limb_axis, 2.5–3 cm, wobble .6)` masked by a sphere at the joint, depth 4 to 6 mm |
| pipe folds | hanging skirts, coats below the waist, curtains | `0.5+0.5*sin(atan2(x, y)*n + noise)` masked to the lower skirt, amp 3 to 4 mm, n = 6 to 8 |
| drag / diagonal | armpits to chest, crotch to knee | grooves along the pull direction, masked |
| drape | upper back of loose coats | sparse horizontal-ish grooves (5 cm), depth 3 to 4 mm |
| knit / tweed | scarves, caps, coats | fine grooves at 4 to 8 mm, depth ≤ 1 mm (often better as paint only) |
Fewer, bigger folds read better than many small ones (the rest-area rule).
Mirror symmetric fold patterns through `abs(x)` (see `sym()` in the example).

## Hard-surface props

- Round boxes with r = 2 to 6 mm (sharp CG edges look fake; small bevels catch light).
- Carve seams, grooves and panel lines (0.5 to 1.5 mm), and add brass corners, latches and
  handles as separate parts with their own material.
- Chess pieces: `PIECES` lathe profiles in `chess_master_body.py` (pawn, rook, bishop,
  queen, king), plus detail by carving (rook crenels, bishop mitre cut, queen crown) and a
  knight from blended round cones.
- Glasses, wires and rings: `torus` + `capsule` at 0.4 to 0.5 mm voxels.

## Debugging

- Seams or boxes on a surface → a node broke the pruning contract, or a displacement acts
  on box distances. Check `max |d|` at the mesh vertices (`shape(v)` should be ≈ 0) and the
  agreement between mesh normals and `S.normals` (1st percentile ≥ 0.95 on smooth parts).
- Part missing → its bounds are wrong or it is entirely inside another part (raycast it).
- Speed → too many primitives overlapping, voxel too small, or `sample(band=...)` too high.
