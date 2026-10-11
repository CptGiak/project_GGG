# Limits of code-only modelling and the hybrid route

## What this skill reaches (measured on the worked example)
- A full, original, characterful stylised hero (head with lids, nose planes, brows, lock
  beard; coat with folds; big hands; hard-surface prop with pieces). The rig has chains and
  a prop bone. The animated idle uses anticipation, arcs, easing, overlap and spring
  follow-through.
- Took about 30 render iterations and several hours of compute and critique.

## What it does not reach, and why
AAA hero characters (Valve's Deadlock roster, Riot, Blizzard) come from concept artists,
a ZBrush sculptor (millions of polygons shaped by thousands of brush strokes judged in real
time), retopology, hand-painted textures, a facial rig and dozens of hand-keyed animations,
iterated for months by specialists. From code:
- **Organic micro-form** (lips, eyelids that fold, fabric tension, muscle under skin) needs
  continuous visual judgement that a render-every-few-minutes loop cannot match.
- **Painted textures** with intentional brushwork are approximated by procedural strokes.
- **Animation nuance** (timing judged in motion, subtle overlap and acting) is approximated
  with rules, springs and IK.
Say this plainly when asked "can it be AAA?". The user deserves the real answer before
investing time.

## The hybrid route (higher ceiling)
Use the best tool for each step and keep Claude on what code does best.

1. **Concept / turnaround sheet** (image model, e.g. Gemini Nano Banana Pro). The repository
   already has prompts and conventions in `docs/art/character-prompts.md`: T-pose, front and
   back, flat light, plain background.
2. **High-detail mesh from the image** (image-to-3D: Tripo, Meshy, Rodin / Hyper3D,
   Hunyuan3D, TRELLIS). The user runs these (accounts, API keys, credits) and commits the GLB
   or OBJ, for example under `tools/blender/_incoming/` or a path they choose. Some offer
   auto-rigging and stock animations too.
3. **Claude: cleanup and integration in Blender**:
   - scale, orientation, origin at the feet, facing -Y; split parts by material or
     connectivity;
   - remesh: `voxel_remesh` + `quadriflow_remesh` or decimate to the game budget, then bake
     normal and colour maps from the original (Cycles, selected to active);
   - fix symmetry, close holes, and re-sculpt problem areas with `charkit.sdf` (e.g. replace
     a mushy hand with an SDF hand and blend it in);
   - restyle the colour (painterly `Look` from an SDF approximation, or bake + grade the
     generated texture).
4. **Claude: rig, weights, animation** with this skill (`rig.py`). For weights on a
   generated mesh, bone-heat (`ARMATURE_AUTO`) works on manifold low-poly meshes. Otherwise
   use `segment_weights` with part masks. For a rigged mesh from another source, infer the
   skeleton like `tools/blender/lol/rig_infer.py` does.
5. **Claude: game integration**: GLB with the game skeleton, toon materials, retarget in
   `src/champions/glbModels.ts`.

Expected result: AA-looking forms from the generator, with Claude's consistent topology,
style, rig and animation. Still not Valve's hand-crafted level, but the gap narrows to the
art direction and animation polish, which a human artist can then push.

## When to recommend which
- Prototype, gameplay test, a large cast → code-only (fast, free, consistent, fully editable).
- Marketing renders, hero characters seen up close → hybrid, or a human artist.
- Faces that must talk or emote in close-up → hybrid plus a face rig, or a human artist.
