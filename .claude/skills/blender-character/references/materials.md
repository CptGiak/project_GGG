# Painterly colour and materials

## Why vertex colour from the SDF
Hand-painted game art (Deadlock, Arcane, Blizzard, Riot) paints light and form *into* the
albedo: darker, warmer crevices, lighter edges, a warm top and a cool underside, colour
temperature zones and brush strokes. `charkit.paint` computes all of it from the same SDF
the shape came from: fast, no UVs, and it follows every carve and lock.

## `Look` parameters (start here, then tune per part)

| Param | Meaning | Skin | Cloth | Hair (white) | Leather | Wood | Metal (brass) |
|---|---|---|---|---|---|---|---|
| `base` | sRGB mid-tone | `#d7a184` | per palette | `#dcd6cc` | `#4b2f22` | `#5a3220` | `#b08a3e` |
| `ao_step` | crease size (m) | .007 | .015 to .02 | .005 | .01 | .006 | .004 |
| `ao_strength` | AO amount | 1.15 | 1.0 | 1.1 | 1.0 | 1.0 | 1.0 |
| `ao_tint` | colour of occlusion | `#6e231f` (blood red) | darker hue of the cloth | `#4f4a52` (cool grey) | `#1a0c08` | `#1f0d06` | `#3a2a10` |
| `cavity` / `edge` | crease dark / edge light | .6 / .35 | .5 / .45 | .6 / .45 | .4 / .7 | .4 / .7 | .5 / .8 |
| `curv_scale` | curvature scale (m) | .007 | .012 | .007 | .008 | .004 | .003 |
| `top_light` | warm top, cool bottom | .3 | .3 | .25 | .35 | .3 | .3 |
| `stroke_*` | brush direction / length | along the form | along the fall of the cloth | along the hair flow | – | along the grain (squash .08) | – |
Material on top: Principled BSDF reading the `Col` attribute. Roughness: skin .55 + SSS
.1 to .15 (radius scale 1 cm), cloth .85 to .9 (sheen optional), leather .35 to .45, wood .45,
brass metallic 1 / roughness .3, eyes .12, glass transmission 1 / roughness .05.

## Colour zones (Zone(shape, colour, strength, falloff))
- **Skin (Loomis colour zones)**: forehead yellowish (`#e3bb8e`, .35), middle third red
  (nose `#bd5547` .65, cheeks `#cc7262` .4, ears `#c56656` .45), lower third cooler or
  blue-grey on men (`#a08f8c` .35), purple-brown under the eyes on tired or old faces.
- **Hair**: darker roots, lighter tips. Old beards yellow near the mouth (`#c4ad82`).
- **Cloth**: worn lighter at elbows, knees and edges, darker at the hem and inner folds.
- **Props**: brass brighter on edges and darker in carvings. Wood darker in grooves.

## Palette and value
- Decide values before hues: the head (focal point) gets the highest contrast. Big masses
  sit in 2 or 3 close values (rest), and the accent is the most saturated element (a red
  scarf on a muted coat).
- Check `studio.sheet(..., values=True)` (greyscale row): head, body and prop must separate.
- AgX view transform, `exposure = -0.6` with `studio.light_rig`. If dark cloth looks grey,
  the problem is exposure or additive edges, not the base colour.

## Eyes
`paint.eye_colors(verts, centres, gaze_vectors, r_eye, iris, iris_dark, sclera)`. Aim both
gazes at the same target (the prop, the camera, the enemy). Iris ≈ 52% of the eyeball radius,
pupil ≈ 42% of the iris, darker limbal ring, slightly darker sclera corners.

## For the engine
- Vertex colours export to glTF (`COLOR_0`) and three.js reads them with
  `vertexColors: true`. On decimated meshes they are interpolated (fine at game distance).
- For textures: Smart UV Project on the low-poly mesh, then bake the high-poly colour
  attribute with Cycles bake (type `EMIT` with the attribute plugged into emission, *selected
  to active*, cage extrusion 1 to 2 cm). Normal maps bake the same way (type `NORMAL`).
- In this game the toon shader (`src/render/toon.ts`) does two-tone lighting: keep painted
  AO subtle (it doubles with the toon shadow) and keep the accent saturated.
