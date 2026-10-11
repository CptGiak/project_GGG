# Character design for games

## The brief (fill it before modelling)

```
Name / role:            Zugzwang, area-control strategist
Fantasy (one line):     the old park chess hustler who has already seen your next 5 moves
Personality → body:     patient, smug, focused → hunched, hands busy, eyes over the glasses
Silhouette:             question mark: rounded back + forward head + flat cap, A-line coat, tome-like case
Proportions:            6.5 heads; head ×1.3, hands ×1.28, skinny legs, big shoes
Shape language:         round (old, harmless-looking) with square accents (the case) = deceptive
Palette (value first):  dark mid coat, light beard/face (focal), dark case; hue 60 olive-brown /
                        30 charcoal + ivory / 10 red scarf (accent)
Signature details:      half-moon glasses, walrus moustache over the mouth, chess case with brass corners
Rest areas:             coat front, trousers, cap top
```

## Silhouette and readability
- Hero games are read at 20 to 40 m: silhouette, colour blocks, then details. Design the
  black shape first (`studio.sheet(..., silhouettes=True)`).
- Each character owns one shape idea: a giant weapon, a hunched back, a cape, a hat, a tail.
- Negative space: gaps between arms and body, between the legs, around props.
- Top-heavy reads strong or brutish, bottom-heavy reads stable, old or grounded, and tall and
  thin reads agile or sinister.

## Shape language
| Shape | Reads as | Use for |
|---|---|---|
| circle | friendly, soft, old, harmless | supports, mentors, comic relief |
| square | solid, stubborn, reliable | tanks, bruisers, craftsmen |
| triangle | danger, speed, cunning | assassins, villains, glass cannons |
Mix one dominant shape with a contrasting secondary one for interest (round old man with
square case = harmless look, sharp mind).

## Proportions and exaggeration
- Realistic adult 7.5 heads, heroic 8, stylised hero 6 to 6.5, cute 4 to 5, chibi 2.5 to 3.5.
- Push what tells the story: strong → shoulders and hands, old → nose, ears, hunch, belly,
  agile → legs and neck, smart → head and hands.
- Push one thing a lot rather than everything a little: caricature is selective.
- Detail density: big / medium / small in about 60 / 30 / 10 of the surface, clustered near
  the focal point (face, hands, weapon), with rest areas elsewhere.

## Colour
- Value structure first: 3 values for the big masses. The face or focal point gets the
  highest contrast.
- Hue split 60/30/10 plus one saturated accent that leads to the focal point or the gameplay
  read (a weapon glow, a scarf, a team colour).
- Saturation budget: if everything is saturated, nothing is.
- Warm light and cool shadow (or the reverse at night) unify the painted look.

## Style notes

**Deadlock (Valve, 2024 to now)**: occult urban fantasy mixing early-20th-century New York
and New Orleans. Caricatural but grounded proportions, with heroes often built on a city
archetype twisted by the occult (the park chess player becomes a chess-wielding wizard, the
pigeon grandma becomes a folklore witch). Chunky readable silhouettes and period costume
(coats, hats, suspenders, gloves). The look is hand-painted: visible brush strokes, painted
light and AO, a muted earthy palette with one strong accent per hero, and warm/cool shifts.
Animations carry personality, down to reload details: Solomon's board pieces rearrange into
positions from real historical games. To approach it here, use period costume, the
caricature push, the painterly `Look`s with stronger strokes, a muted palette with one
accent, and an idle that shows the character's habit.

**Arcane (Fortiche)**: painted textures over 3D, sharp angular faces, big hands, strong
rim light, saturated accents (pink, teal, gold) on desaturated bases, visible brush strokes.

**Persona / anime cel (this repository's current game look)**: flat 2-tone colours, crisp
outlines (inverted hull), big expressive eyes, hair as sharp clumps with highlight rings,
saturated palettes on black. Use flat `Look`s (small `var_amount` and `stroke_amount`, AO
tint near-black) and let the game's toon shader do the lighting.

**Overwatch / Blizzard**: chunky, appealing, clean shapes, hand-painted gradients, big hands
and feet, very readable team silhouettes.

## Show the fantasy, not just the archetype
An old man with a chess case is a bystander. An old man juggling glowing chess pieces in orbit
is a hero. Put the power in the silhouette and the hero shot: the signature prop *in use*,
emissive accents, VFX shapes (rings, trails, floating pieces) built as simple emissive
meshes. Grounded realism is a valid choice, but make it on purpose.

## Designing for the medium (code)
- Hide what code models poorly: mouths behind beards, masks or scarves; hands in gloves;
  hair as a few big locks or under hats.
- Show what code models well: props, armour, accessories, rigid forms, symmetry with
  controlled variation, clean silhouettes.
- If the brief needs a hero face that acts (talking, emotes in close-up), plan the hybrid
  route ([hybrid.md](hybrid.md)) or a face rig budget from the start.
