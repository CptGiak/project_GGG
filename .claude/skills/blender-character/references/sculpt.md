# The hand pass: brush sculpting on the mesh (`charkit/sculpt.py`)

The SDF stage builds primary and secondary forms. A sculptor then finishes them by hand: cut
planes, crease the lines of age and cloth, lay clay along a muscle, relax and polish. Blender's
own sculpt operators need a viewport (`sculpt.brush_stroke` fails headless with "context is
incorrect"), so `sculpt.py` reimplements the brushes in numpy on the marching-cubes mesh.

## The brushes (formulas from Blender 5.0's `sculpt_paint/brushes/*.cc`)

Every brush shares one dab loop. For the vertices within radius r of the dab centre, the weight
is `(1 - mask) * front-face term * falloff(1 - d/r)`. The dab strength is multiplied by the
**overlap factor**, so one full stroke reaches the nominal strength once, whatever the spacing.
Only the displacement differs:

| brush | displacement | use it for |
|---|---|---|
| `draw` | area normal × r × s | swelling, a quick raise or dent |
| `inflate` | the vertex's own normal × r × s × 0.25 | lobes, fleshy volumes |
| `pinch` | toward the stroke line (side and normal axes) | sharpening an edge |
| `crease` | draw inward + pinch in the tangent plane (pinch²) | wrinkles, folds, seams |
| `blob` | crease with the pinch reversed | rounded beads, rims |
| `clay_strips` | toward a plane 0.15 r above the area, square tip, only from below | building muscle and fat masses, skin rolls |
| `clay` | the same with a round tip and a lower plane | soft build-up |
| `flatten` / `fill` / `scrape` | toward the area plane (both sides / below / above) | planes |
| `trim` | toward one plane averaged over the whole stroke (cuts what sticks out) | chiselled facets (Trim / Plateau) |
| `smooth` | toward the neighbour average | polishing transitions |
| `relax` | the same, tangential only | evening out triangles crushed by a crease, without filling it |
| `grab` / `snake_hook` | move a region with the stroke | proportions, pulled shapes |
| `mask` | paints `Sculpt.mask` (1 = frozen) | protecting an area |

`K.preset(brush, **kw)` gives Blender 5.2's Essentials preset values (Clay Strips: smoother
falloff, tip roundness 0.15, spacing 0.1 r; Crease Sharp: pow4 falloff, pinch 0.8, spacing
0.06 r; Trim: hardness 0.6), overridden by your arguments.

## Drawing strokes like a hand

1. Render orthographic **grid views** with `K.review(v, f, views, ...)`: a raking key light
   and a millimetre grid. The labels are **absolute** (u, w) coordinates, the same numbers in
   every view that shares axes (front: u = x, w = z; side from +X: u = y, w = z). Landmarks
   are drawn as labelled dots.
2. Read the coordinates of the feature off the grid and write the stroke as a polyline on
   that view: `on('eye', 'crease', [(7, -2.5), (16, 3.0), ...], radius=..., strength=-0.6)`.
   At run time each point is ray-cast onto the *current* surface, like a pen on clay.
3. Replay the whole stroke list from the base mesh on every run (`--stage sculpt`). The list
   is the sculpt: any stroke can be moved, weakened or removed later, which no human sculptor
   gets for free.
4. Look at the new renders, then change one group of strokes at a time.

Context first: render once with the hair, beard and cap in flat colours (`--stage base`
writes `base_ctx_*`), so you only sculpt skin that stays visible.

## Recipes

- **Wrinkle** (`wrinkle()` in `examples/chess_master_sculpt.py`): crease along the line,
  then relax along it, a clay-strips roll on the overhanging side at about 1.6 crease radii,
  smooth on the lower side, a light polish. Lines run perpendicular to the muscle under them:
  horizontal on the forehead, vertical in the glabella, fanning out of the eye corner.
- **Nasolabial fold**: a deeper crease plus a cheek-side volume (malar fat) laid first with
  clay strips. It is not a symmetric groove.
- **Hooded lid**: fold line about 3 mm above the lid margin, drooping past the outer corner.
  Add a shallow lower-lid line and a tear-trough crease that runs into the bag.
- **Planes of the head**: `trim` along the nose bridge and the temple, clay strips along the
  cheekbone, a soft crease under it for the plane change.
- **Cloth** (`examples/chess_master_folds.py`): pipe folds on a hanging skirt come out better
  procedurally (`skirt_pipes`: rounded ridges, narrow valleys, irregular spacing, deeper toward
  the hem). Specific folds are strokes: drag folds from the armpit, compression folds across
  the inner elbow (perpendicular to the arm, curving toward the shoulder), gathers at a belt.

## Pitfalls

- **Radius against mesh resolution.** A crease narrower than about 3 edges pinches triangles
  into a jagged, torn line. Keep crease radii at 2.5 edges or more, pinch at about 0.5 or
  less, and follow every crease with `relax`.
- **Thin plates** (ears, lids, cloth hems): pushing more than the plate's thickness goes
  through to the other side and opens a slit. Keep moves there shallow (draw strength 0.2
  over a wide radius) and check the ear from behind.
- **Review lighting.** A single raking key shows relief best. Fill or second keys that are
  too strong flatten everything, and the creases vanish from the review.
- **Painting sculpted geometry.** `paint.paint` needs an SDF: pass `K.mesh_sdf(v, f, n)`. The
  SDF curvature in `paint()` is too coarse for millimetre creases, so add `K.cavity()` (the
  distance to a smoothed copy along the normal) for the fine darkening.
- **Speed.** Each dab costs a few milliseconds on 600k vertices. A 60-stroke face replays in
  about 4 minutes; renders of 1.2 M triangles take about 35 s per 900 px view.
