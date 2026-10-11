# Critique rubric

Use it at every gate. Read the sheet image, then answer in order and stop at the first "no":
that is the one thing to fix next. The order is the order in which problems hide each other.

## 1. Silhouette (black row of the sheet)
- Can you tell who it is from the black shape alone, front and side?
- Is there one dominant shape (round / square / triangle) and a clear top-heavy or
  bottom-heavy mass distribution?
- Is there negative space (arms not glued to the body, legs apart, a prop sticking out)?
- Are profiles smooth where they should be (no tyres, no lumps from stacked primitives)?

## 2. Proportions
- Height in heads as in the brief? Head big enough for the style (caricature heroes often
  6 to 6.5 heads)?
- Hands and feet sized for the style (heroic and caricature: bigger)?
- Shoulder line and posture tell the age and personality (old: sloped, rounded forward,
  forward head; heroic: wide, high chest)?

## 3. Big forms (clay)
- Big / medium / small: one or two big masses, a few medium, small details clustered with rest
  areas between them?
- Forms turn (you can see planes: front, side, top) instead of looking like inflated tubes?
- Every piece is attached: nothing floats (gaps under hats, collars, buttons) and nothing is
  buried (hair roots, eyes)?

## 4. Face (close-up)
- Eyes visible and converging on a target, lids sitting on the eyeball, no dark cavity?
- Brows, lids and mouth (or what covers it) say the intended emotion?
- Nose built from planes, ears tilted back, features in thirds?
- At thumbnail size, does it read as a face with an expression?

## 5. Colour and value
- In greyscale, do the head, body masses and prop separate?
- One saturated accent, everything else quieter? Skin has warm and cool zones?
- Exposure: darkest cloth still dark, whites not clipped (no blown-out beard or highlights)?
- Painterly cues visible (AO tint, edge light, top-light warmth, strokes) without noise?

## 6. Rig and deformation
- Extreme poses: no tearing, no collapsing joints, cloth follows and does not intersect?
- Props stay in the hand? Secondary chains hang naturally at rest?

## 7. Animation
- Key poses alone tell the story? Line of action in each?
- Timing: anticipation, action, recovery in the ratios of the table? Holds alive?
- Arcs in the trails, spacing matching the easing? Feet planted? Follow-through visible?

## Symptom → cause → fix

| Symptom | Likely cause | Fix |
|---|---|---|
| straight seams or boxes on a smooth surface | pruning margin broken by a custom node, displacement on box distances | honour `_eval(p, m)`; check `max\|d\|` at vertices |
| "tyres" on a coat or skirt | stacked ellipsoids with small k | `lathe` profile + `scale` (elliptic), or bigger k |
| "Michelin" sleeves | fold rings everywhere, too deep | mask folds to the elbow, 4 to 5 mm deep, 3 cm apart |
| face looks like a plush toy | no planes, features too round, flat colour | nose lobes/wings, cheek hollows, brow ridge; paint zones + AO tint |
| eyes are dark holes | cutter removed volume around the eyeball | subtract the inner sphere from the cutter; broad socket depression |
| eyes invisible | socket did not reach the face surface | raycast; move the socket depression forwards |
| hair looks like fur or a sponge | noise displacement on a volume | `lock`s with roots snapped, 2 to 4 mm blend, core underneath |
| brows or hair stick out like horns | lock flow points away from the surface | flow along the surface (follow the ridge), lift only the tips |
| accessory floating or buried | guessed coordinates | `snap()` + `look_rot(normal)` |
| colours washed out | exposure too high, additive edge light | `exposure=-0.6`, multiplicative edges, check the value sheet |
| colours muddy | too much AO tint and low-frequency variation | lower `ao_strength`, `var_amount`; raise base saturation slightly |
| plastic skin | no colour zones, no SSS | skin zones (nose, cheeks, ears red; forehead yellow; jaw cool), SSS 0.1 to 0.15 |
| floaty animation | linear or evenly spaced keys, no anticipation | windup/snap/settle eases, anticipation 1/3 of the action |
| robotic animation | everything moves together | overlap offsets 2 to 4 frames, spring chains, asymmetric keys |
| sliding feet | legs not re-solved per key | `two_bone_ik` thigh/shin to the ankle landmarks in every key |
