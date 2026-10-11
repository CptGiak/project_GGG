# VFX design: abilities, projectiles, impacts, ultimates

**Use this file for** deciding what an effect looks like and when each part happens: which layer
carries the gameplay truth, shape language, phases and frame timings, value and colour bands, PvP
readability, and the anatomy of each archetype (projectile, beam and charge-up, explosion and AoE,
homing swarm, melee slash). It ends with the full REX spec, slash notes for the melee champions and
the QA checklist. How to build it in three.js r186 (shaders, pools, `bloomColor()`, budgets) is in
`vfx-tech.md`; hitstop, shake and impact frames in depth are in `game-feel.md`.

**Contents:** §0 Ten laws · §1 Principles (1.1 purpose, 1.2 gameplay vs flavour, 1.3 shape,
1.4 phases & timing, 1.5 value & colour, 1.6 competitive readability, 1.7 layering) · §2 Projectile
anatomy · §3 Beams & charge-ups · §4 Explosions & AoE · §5 Homing swarms · §6 Melee slashes · §7 →
vfx-tech.md · §8 Anime / cel specifics · §9 Beat-synced VFX · §10 REX worked spec · §11 Melee slash
notes · §12 QA checklist · Sources

**Conventions**
- **f** = one frame at 60 fps = 16.7 ms (ms × 0.06 = f).
- **L×** = HDR luminance as a multiple of the bloom threshold 1.45 (`Engine.ts:49`); L×1 is where
  bloom starts. Build colours with `bloomColor(hex, L)` (vfx-tech.md §8).
- **Colours** are authored as sRGB hex; `new THREE.Color('#hex')` is linear.
- **Sizes:** sprites, heads, flashes, stars and notes are full extents (m); rings, shockwaves,
  telegraphs and blasts are radii *r* (m), as in `Effects.ring(pos, n, c, r0, r1, life)`.
- **(GGG)** = house value: tune in-engine, verify with captures. **[S#]** = source for the number
  (list at the end; numbering shared with vfx-tech.md).
- **Baseline** = the engine's VFX before the current VFX pass (`Effects`, `Particles`, `Trails`,
  `WeaponGhosts`, `Projectiles`, `rexKit`); that code is changing: re-read it first.

---

## 0. Ten laws

1. **Gameplay space first.** Hit area, border and timing are primary; decoration sits below them in
   value, saturation, opacity, size and motion [S1][S5][S14].
2. **Visual weight follows gameplay weight** [S1][S5][S11].
3. **Anticipation → climax → dissipation**, outro always secondary [S3][S24][S56]. Rise in 1–3 f,
   decay over 5–15× the rise.
4. **Value before hue.** Near-white core on 5–15 % of the area, saturated mid on 50–70 %, dark or
   complementary edge on 20–30 %. 100 % white only for ultimates and climaxes [S71].
5. **Identity:** which ability it is reads at a glance, under any skin [S13][S15].
6. **Direction** reads on a paused frame: bright sharp head, soft dim tail [S11][S23].
7. **Friend vs foe** has its own rim/border and shape channel, never hue alone, with colourblind
   remaps [S35][S36].
8. **Stylized** = hard edges, few tones, texture and flicker stepped at 20–30 fps; transforms stay at
   60 fps [S9][S37][S57].
9. **Bloom is luminance-based.** Violet `#9b5cff` needs ×6.6 to reach L×1, gold `#ffc94a` ×2.3:
   about 3×. Saturation lives in the halo, not in clipped cores.
10. **Budget (GGG):** ≤40 VFX draw calls · ≤3 screens of transparent coverage (≤6 for peaks under
    300 ms) · ≤3,000 live particles · zero per-frame allocations · shaders precompiled · no light
    added or removed mid-match.

---

## 1. Principles

### 1.1 Purpose
Riot's goals, in order: clarity, minimal clutter, the champion's theme, surprise [S1][S2]. Every
artistic principle serves a gameplay job [S10]: shape → area of effect, contrast → focal point,
colour → identity, timing → threat level. Each effect is feedback with one
intent (threat, positive or negative signal, level hint, ambience) [S57]; a flashy layer that blurs
the intent is a bug.

### 1.2 Gameplay space vs flavour

| | Primary (gameplay space) | Secondary (flavour) |
|---|---|---|
| Value | high range, strong value/saturation contrast | lower range |
| Silhouette | clear, strong | small, soft |
| Opacity / motion | high / intense | low / subtle |

From [S1][S5]. Leona's Eclipse makes the *border* primary because players must read the radius to
escape [S5]; Morgana Q's particle was widened to the missile's real width [S13]; projectiles show
direction without motion by softening the tail [S11]; skins keep the base spell's identity [S15].

**GGG rule.** Every spec lists its *gameplay layer* (exact shape, radius or width, real timing)
apart from the flavour layers; QA reviews the gameplay layer alone first (§12 item 1).

**Where the truth lives.** Projectiles are swept spheres of `radius` against the fighter capsule
(`CAPSULE_R` 0.45 m in `Projectiles.ts`); beams use the kit's beam radius; blasts hit when the
victim's chest is within `r + 0.45` m (`Projectiles.detonate`). A body touching a ring drawn at *r* is
inside, so draw blast borders at exactly *r*.

### 1.3 Shape language
Circles read friendly or safe, squares stable or defensive, triangles dangerous [S55]; soft orbs read
helpful [S6]; motion is carried by a strong silhouette [S1]. **GGG mapping:** damage = stars, shards,
chevrons · knockback/CC = rings, square "speaker" pulses · heals/shields = circles, hexes (Hades' hex
halos read as protection [S26]) · marks = glyphs (notes, bat sigil).

### 1.4 Phases and timing
Anticipation, main action, dissipation [S56][S24]; outros fade through value, hue, opacity or size
below the climax [S3]; end in overshoot and settle [S8]; smear frames plus anticipation make quick
effects pop [S7].

**Hard numbers:** anticipation ≥ 15 f to draw attention, ≥ 39 f when the player must react [S57].
Small hits last 12–24 f with the flash peaking at 3–6 f [S45]. First hit frame ≤ 6 f [S23].

| Class (GGG) | Anticipation | Climax | Dissipation | Notes |
|---|---|---|---|---|
| Light hit | 0 | 1–2 f flash | 9–15 f | 6–10 sparks |
| Heavy hit | 0–3 f | 2–3 f + pose-hold | 18–30 f | hold frames: game-feel.md §1.3 |
| Skill-shot cast | 3–7 f | 2 f | 7–12 f | shows direction |
| Dodgeable AoE | ≥ 15 f (≥ 39 f if lethal) | 2–3 f | 24–54 f | edge = exact radius |
| Ultimate | 18–48 f | 6–18 f | 36–90 f | 100 % white allowed |

**Envelopes:** rise : hold : decay ≈ 1 : 1 : 6 (light), 1 : 2 : 10 (heavy).

**Curves (GGG)** (TS versions: `Ease.*` in `src/fighter/Animator.ts`)
- Scale: easeOutExpo `1 − 2^(−10t)`, 80 % of size at 23 % of life. Pops: easeOutBack, c₁ = 1.70158.
- Erosion threshold: `smoothstep(0.3, 1.0, t)` (holds, then falls).
- Colour cools slightly faster than the shape: the white core dies before the silhouette.
- Exaggeration: 120–140 % on climax frames, back to 100 % within 6–9 f [S8]. Harder hits and harder
  CC get bigger, brighter visuals [S5].

### 1.5 Value and colour hierarchy
Value range steers the eye more than anything else [S6]. Build palettes from mid values and keep the
extremes for the moments that matter [S1][S5]; "100 % white things are saved for ultimates" [S71];
the most intense colour goes on the moment of most energy [S6].

**Three-band recipe (GGG)**

| Band | Area | Colour | Brightness |
|---|---|---|---|
| Core | 5–15 % | near-white tinted to the hue (`#fff4dc` gold, `#f2e8ff` violet) | L×2–4 |
| Mid | 50–70 % | saturated champion hue, ≤ 1.0 per channel (never clips) | L×0.3–0.9, no bloom |
| Edge | 20–30 % | darker saturated or complementary (REX ink `#1a0838`), premultiplied so it darkens the background | — |

**Multiplier to reach L×1** (× tier for L×2, L×4…): REX violet `#9b5cff` 6.6 · REX gold `#ffc94a` 2.3 ·
`#fff4dc` 1.6 · `#f2e8ff` 1.7 · white 1.45 · Kaiser `#ffc24a` / `#ff2e88` 2.4 / 5.8 · Nova
`#2ef2ff` / `#ff3fd0` 2.0 / 4.9 · Elisabbat `#a24cff` / `#ff2e6a` 7.2 / 6.0 · threat rim `#ff4a3d` 5.5 ·
ally rim `#2ef2ff` 2.0. So `neon(color, 2.8)` is L×0.49 on REX's model violet and L×1.14 on gold:
only the gold blooms.

**Trail contrast trick** [S16]: two trails on the same UV tile, one additive and one darkening, the
darkening one shorter-lived "to keep the contrast at the head"; colour drifts over life (Senna's E,
blue → pink).

**Flash sequence** [S17]: white flash → black (ink) flash → ramp-down; lower the outer ring's detail and
contrast so primary and secondary stay separate.

### 1.6 Readability in competitive play

**Friend vs foe.** Players read red as enemy-owned and object when white-heavy ults hide ownership
[S36]; Valorant offers purple and yellow enemy highlights for colourblind players [S35]. GGG palettes
are magenta/red-heavy (Kaiser `#ff2e88`, Elisabbat `#ff2e6a`), so relation gets its own rim/border
channel: **enemy `#ff4a3d`, spiky or dashed; self/ally `#2ef2ff`, solid**. Champion colours stay in
the flavour layers (True Damage Senna team-colours her ult's trail centres [S41]).

**Own-effects dimming (GGG):** your own flavour layers at 60–80 % opacity; enemy projectiles at 100 %
with the threat rim. Through a third-person camera a shot runs *away* from you along the line of
sight, so everything it draws piles up on the crosshair: a 0.7 m beam or a 0.5 m slug ribbon
collapses into a white ball over the target, and impact sparks spraying back at the shooter bloom
into another (REX's first pass hid the target for ~200 ms). Fade wide pieces seen end-on (the
engine's `Segments` does it: 20 % from behind, 50 % for an incoming shot), dim the cast glow, face-on
rings and the glow on the target by 60-85 % for that viewer (`alongView`), fan the sparks across the
view (`sprayDir`), keep the 2-3 f impact frame crisp: the target is readable again ≤ 3 f after it.
The same shot seen from the side keeps everything (Unreal's "owner no see" variants, Overwatch's
first-person effect versions).

**Honest gameplay layer:** visual width = hitbox width [S13]; ground rings at the exact radius;
telegraphs show the real time. Valorant anchors hit effects to the struck body part, and its spark
marks where a shot landed, not a confirmed hit [S33]. Trade fidelity for readability and keep
characters standing out from the environment [S32][S34].

**Clarity budget per screen (GGG):** ≤ 1 element at L×4+ at a time; ≤ 2 full-screen post effects at
once; high-frequency detail on ≤ 20 % of an effect's area; no late sparks (they "drain momentum"):
lengthen the first burst instead [S17].

### 1.7 Layering
"Most great VFX are 3–5 simple layers" [S45]. Battlefront II stacks two flipbooks of one blast
(smoke, then emissive fire in the second flipbook's alpha) and uses many single particles [S27];
Fallout 4 scrolls loopable textures and dissolves fire into smoke [S28].

| Order | Layer | `renderOrder` slot (GGG) |
|---|---|---|
| 0 | ground decal / telegraph | 1–3 |
| 1 | dark or alpha body (smoke, ink) | 13–15 (`Effects.alpha` pool = 15) |
| 2 | additive body | 16–19 |
| 3 | core / flare | 16–19 |
| 4 | sparks | 20 (`Effects.add` pool) |
| — | post | `PersonaFX` pass |

Taken: `WeaponGhosts` 4, REX muzzle glow 6, `SlashTrail` 10, `Effects` beams 11, rings 12. Additive
layers commute; only darkening layers must draw before the glow on them.

**Secondary motion:** sparks drag at 6–10 /s, smoke rises and erodes slower, layers start 1–2 f apart.

---

## 2. Anatomy of a projectile

Three parts [S23]: a **cast** that announces it and shows where it goes, the **projectile** (readable
and identifiable, because players dodge it) and the **hit**.

### 2.1 Muzzle flash
Layers: directional, side (3–6-point stars), core circle, sparks, emissive [S19]. Rings along the
shot plus perpendicular sparks show direction cheaply [S23].

**Spec (GGG)**
- 2–3 f in total: f0 at 100 % and L×2.5–4; f1 at 50 % and 115 % scale, **stepped, not lerped**; f2 for
  heavies only.
- Four quantized roll variants (0°, 22.5°, 45°, 67.5° for a 4-point star).
- Forward cone 2–3× longer than the side flares. Energy weapons: a small toon puff, not smoke.

**Baseline:** `Effects.muzzle()` (white star, hue glow, forward ring r 0.08→0.6 m over 11 f, 4
streaks) has the right layers but shows ≈3 frames at 0.6–0.9 m and is LDR: particle colours ≤ 1, so
nothing blooms alone.

### 2.2 Head
White core L×2–3, hue glow L×0.8–1.2, ±10 % size flicker at 30–60 Hz.

**Anti-strobing:** stretch the head over 1–1.5 frames of travel, or it reads as dotted. Beat Shot
(150 m/s) and Lead Single (135 m/s) travel 2.5 / 2.25 m per frame: heads 3–4 m long. Clip the tail
at the muzzle on f0. **Baseline:** the `bolt` head is a 0.9 m white capsule in a
1.1 m glow (`Projectiles.make('bolt')`), under half the per-frame travel, so Beat Shot reads dotted.

**Accept:** core ≥ 4 px wide at 1080p at 20–40 m; consecutive head frames touch; a paused frame
shows direction.

### 2.3 Trail
- **Ribbon:** billboarded strip with a width taper (`1 − p`) and optional dashes [S65]; clean joins
  from averaging neighbouring segment directions in screen space [S64].
- **Sparkle trail:** one particle per 40–60 ms, emitted by distance travelled. Today's per-frame coin
  flip (`Math.random() < 0.8` in `Projectiles.update`) is frame-rate dependent and dotted at speed.
- **Distortion trail:** hero effects only.

Fade the tail in value *and* opacity: that is the direction cue [S11]. Use the two-layer contrast
trick [S16]. Shots at 100+ m/s: trail life 7–18 f.

### 2.4 Impact timeline (GGG, light → heavy)

| Frames | Layer |
|---|---|
| f0–1 / f0–3 | flash, L×3 → L×5, 0.3 → 1.0 m |
| f0–8 | 6–10 / 14–20 sparks at 6–14 m/s, drag 6–8 /s, life 7–18 f, velocity-stretched [S45] |
| f1–15 | ring r 0.1→0.6 / 0.3→2.2 m, easeOutExpo |
| f2 | ink "black flash" (occlusion 0.4), then ramp-down [S17] |
| f0–30 | surface ring; embers or notes for 24–54 f |
| f0–6 | pose-hold (heavy only; frames per game-feel.md §1.3) |

### 2.5 Hitscan vs physical
A hitscan tracer is a mesh stretched over the trace, with scrolling UVs, a maximum length, a constant
world-space UV scale and optionally a tail that retracts after the head arrives; a fast "fake
hitscan" projectile delays damage to match its visual [S18]. Beat Shot is physical but fast: render
it as a tracer (stretched head, no ribbon). Never draw a full-length line before a physical
projectile can have arrived.

### 2.6 Light vs heavy (GGG)

| | Beat Shot | Lead Single |
|---|---|---|
| Muzzle | 2 f, 0.45 m | 3 f, 0.9 m + 3 cone rings |
| Head | 0.12 m core | 0.48 m (= 2 × hit radius) |
| Trail | stretched head | 8 m two-layer ribbon, 15 f |
| Impact | 2 f flash, 8 sparks | 3 f flash, 18 sparks + 3 shards |
| Camera, hitstop | none on the shooter | game-feel.md §11 (ranged hits freeze the victim only) |

---

## 3. Beams and charge-ups

**Charge (GGG)**
- Inward streaks spawn on a 1.2–1.6 m sphere and accelerate to arrive exactly at end of life
  (15–24 f) [S72]. Spawn rate ramps 10 → 60 /s.
- Converging rings shrink r 1.0 → 0.1 m. The core grows 0.1 → 0.35 m while its flicker rises 0 → 15 %.
- Hue walks from base to accent; SFX pitch reads the *same* `charge` value as the visuals.
- An osu!-style **approach ring** closes exactly when the charge is full. For the shooter it sits on
  the crosshair: the HUD already draws a screen-space charge ring with `perfect` / `over` states
  (`HUD.ts`, `chargeRing`). Everyone else reads the world-space orb.

**Beam body:** noisy twisted cylinders, ribbons with panning noise, UV distortion, filaments and
gradients [S73], or unlit meshes with dissolve and noise vertex displacement [S31].

**GGG beam recipe**
- Width = 2 × the kit's beam radius (the beam's hit width, not the target capsule).
- White core at 25 % of the width, L×3–4; hue body with a ±22 % noisy edge.
- Noise scrolling *forward* (muzzle → target) at 30–40 m/s; width ±12 % on the beat.
- Origin flare, impact flare plus wall ring, sub-bass rings along the length.

**Release:** f0–1 at 1.4× hit width → hit width by f6 → erase muzzle→target while thinning to 0.2×
by ≈ f13 (220 ms).

**Overcharge** reads as instability: positional jitter, flicker stepped on threes (20 fps), sparks
shed outward, desaturation.

**Accept:** the body equals the hit width from f6 on; the approach ring meets the orb on the frame
the perfect window opens; the beam never blooms wider than 1.5× its hit width.

---

## 4. Explosions and AoE

**Explosion stack (GGG)**

| Frames | Layer |
|---|---|
| f0–2 | flash sphere, L×4, diameter ≈ 30 % of the blast radius |
| f0–15 | ground shockwave to the **exact** radius, easeOutExpo |
| f2–20 | energy body: dark smoke under an emissive core [S27], coloured by a gradient ramp over greyscale noise [S27][S28] |
| f3–12 | 25–40 sparks |
| f6–60 | 12–16 dust puffs hugging the ground, 4–6 m/s outward, drag 3 /s |
| f30–90 | embers |
| f120–240 | crack decal |

**Shockwave ring:** thin front, thicker trailing band that erodes; radius on easeOutExpo, thickness
∝ (1 − t)²; break-up noise sampled on the unit circle, not the angle, so there is no seam
(vfx-tech.md §7.5). Hero rings may also write distortion (vfx-tech.md §7.10). Lift ground rings 2 cm.

**Telegraphs.** Keep warning times consistent; identical red circles confuse when attacks differ,
so show the attack's shape and effect, and escalate scale, opacity and emission toward impact [S54].

**Telegraph spec (GGG)**
- Border at L×0.8 (never blooms); fill alpha 0.10–0.18, growing outward with `age / fuse`.
- Last 9 f: the border blinks to L×1.5, 2 f on / 2 f off.
- Enemy: threat rim, spiky or dashed border. Self/ally: solid, 40–60 % opacity.

**Area ultimates** spend the budget in time, not area: one readable shape, ≥ 39 f of anticipation if
escapable, a climax of ≤ 18 f, a long low-value tail, never high-value noise across the whole radius.

**Baseline:** `explode` projectiles call the generic `Effects.explosion()` unless the spec sets
`blast: false` (then draw your stack in `onBurst`, which runs on local and remote copies). Its ring
reaches 1.2 × r at the blast point, not on the ground, and there is no telegraph.

---

## 5. Homing missiles and swarms

The Itano Circus fills the screen with guided missiles on erratic, spiralling paths, *each with a
distinct smoke tail* [S51].

**Keeping many readable (GGG):** stagger launches by 4–6 f and fan their directions; thin trails
(≤ ¼ of the head width, 12–18 f); two alternating colours; ink-outlined heads; the threat rim for the
targeted player.

**Paths**
- Gameplay steering is in `Projectiles.update`: after `homing.delay`,
  `vel ← lerp(vel, dir·speed, 1 − e^(−k·dt))` at constant speed, k = strength (7 for REX), ×1.8
  inside 10 m.
- Add a **visual-only** spiral `A·sin(ωt + φᵢ)`, A ≤ 0.25 m, fading to 0 within 3 m of the target so
  the hit point stays honest. Spin 1–3 rev/s. One sparkle per 60 ms per missile, capped.

**Bats and bees (GGG):** instanced billboards or 4-triangle meshes; vertex-shader flap `sin(t·ω + φ)`
at ω = 18–25 rad/s for bats (the current bat projectile uses 34) and 60–90 for
bees, look stepped at 30 fps; steering from attraction, curl-noise wander and cheap separation,
±20 % per-instance phase and scale. The swarm's damage volume gets a faint ground ring; single bats
are flavour.

---

## 6. Melee slashes

**Technique**
- Pan textures across a premade ring or arc mesh: a triangular mask plus scrolling noise, unlit,
  hidden when idle [S21]. Or keep the mesh static and let scrolled noise carry the motion [S20].
- Fluid motion comes from animating UV-distortion intensity and scale, not just scrolling [S22].
- Erosion must **subtract, not multiply** [S16][S57].
- 3D smears stretch geometry along the trajectory, or add in-betweens and motion lines [S52].

**Timing (GGG):** wind-up glow 5–12 f; arc fully drawn in **2–3 f** (it appears, it doesn't grow);
hold 2–4 f; erode tail → tip over 7–15 f.

**Extras (GGG):** tip ribbon of 6–10 samples; sparks perpendicular to the blade; heavy hits get an
impact frame (§8) and a pose-hold (game-feel.md §1.3).

**Baseline:** `SlashTrail` (`Trails.ts`, two-rail base→tip swoosh, 0.16 s, additive) and
`WeaponGhosts` (holo afterimages every 34 ms, 0.2 s life). The ring-sector slash mesh (§11) is missing.

**Accept:** arc outer radius = hit reach ±10 %; arc complete by f3 of the active window; erosion
starts at the tail.

---

## 7. Technical toolbox
Moved to `vfx-tech.md`: shader library (§7 there: noise, erosion, fresnel, ramps, rings, SDF
flares and notes, beams, EQ ring, soft particles, distortion, dithering), HDR and bloom with
`bloomColor()` (§8), pools and budgets (§9), testing (§12).

---

## 8. Anime and cel-shaded specifics

- **Genshin** [S9]: hard vector-like masks, high-contrast element colours, snappy timing (slow hits
  "feel mushy"), radial action lines; impact frame = **1–2 f white or desaturated overlay, then a
  colour-inverted frame**.
- **Arc System Works:** GGXrd cut frames to evoke 2D [S37]; Strive explains counter-hits with slowdown
  and zoom [S38]. **Arcane:** 2D smears over 3D, neon vector magic [S43]. **Hades:** acidic rims, hex
  halos [S26].
- **Persona 5 (house reading):** red/black/white, halftone, jagged starbursts and text slams for
  6–12 f; `PersonaFX` (`PostFX.ts`) already has halftone, speed lines, chroma, vignette and flash.

**Stepped timing:** texture, noise and flicker at 30 fps (twos) or 20 fps (threes), never below
~12 fps for moving parts (under 8 fps the eye loses the motion [S57]). Transforms stay at 60 fps.

**Hitstop** [S44]: 2–4 f light, 6–10 f heavy, 12–18 f supers, capped near 120 ms; freeze only the
attacker and the victim (ranged: the victim); online, freeze poses and impact sprites, never the
simulation. Today `Match.hitStop` slows the whole local simulation, VFX included, to 6 %
(`Match.update`, which also feeds `vfx.update` the scaled dt). These are fighting-game references;
GGG's tiers (30–40 % shorter) are game-feel.md §1.3. **Shake:** `trauma²` on gradient noise [S46];
values and shooter rules in game-feel.md §2.

**Toon details:** 2–3 hard ramp bands, posterized with `floor` / decimate [S67][S69]. Ink = a
premultiplied dark band on sprites, inverted hulls (`addOutline`) on meshes; keep VFX out of
depth-based outline passes [S69]. Speed lines: polar coordinates around a focus, a hash on the angle,
radial falloff [S53] (`PersonaFX` draws them from `uSpeed`).

---

## 9. Music- and beat-synced VFX

**Reference points:** Hi-Fi Rush keys poses on the beat (120 BPM = 30 f per beat), pulses the world
and locks support attacks to the rhythm [S39]. On True Damage Senna, pop colours and sharp shapes
made the key ability (W root) harder to prioritise: palette fights hierarchy [S40][S41]. K/DA uses
holographic, prism and kaleidoscope motifs [S42]. A mobile equalizer keeps the level in R and scrolls
G and B opposite ways into columns; bar gaps come from UV distortion, not transparency [S25].

**GGG clock (`src/core/Beat.ts`, 104 BPM):** beat 577 ms (34.6 f), eighth 288 ms (17.3 f), sixteenth
144 ms (8.7 f). Beat Shot's 7 /s is almost one per sixteenth but free-running. `Beat.kick` = 1 on a
kick, decaying e^(−7.5t); `Beat.snare` e^(−9t); `Beat.pulse = max(kick, 0.85·snare)`; `Beat.beats`
counts continuously; a free-running groove keeps pulsing without audible music.

**Rules**
- `kick`, `snare` and `pulse` drive **flavour only**: glow ±15–25 %, EQ bars, ring spawns, beam width
  ±12 %, idle emissive. Never telegraph timing, hitbox visuals or speeds.
- Quantize optional accents to the grid (next eighth: `Math.ceil(Beat.beats * 2) / 2`).
- Clips authored with `beats: true` (REX's taunt) fire their VFX from clip keys, so accents stay on
  the beat at any tempo.

Existing beat visuals: `equalizerMaterial` (`toon.ts`) on REX's rifle, the `WeaponGhosts` ult
shells, REX's muzzle ready pulse (`rex.ts` `tick`). EQ-ring shader: vfx-tech.md §7.8.

---

## 10. REX worked spec

**Tokens** (every L× value goes through `bloomColor()`; × = multiplier for L×1): **V** violet
`#9b5cff` ×6.6 (`champions.ts` colour 0; the model's neon uses `#a46bff`) · **G** gold `#ffc94a` ×2.3 ·
**Wg** `#fff4dc` ×1.6 · **Wv** `#f2e8ff` ×1.7 · **Ink** `#1a0838` (occlusion only) · **Over**
`#ff3b6b` ×5.7 (as in `rex.ts`) · threat rim `#ff4a3d` ×5.5 · ally rim `#2ef2ff` ×2.0.

**Gameplay numbers** (`rexKit.ts`, `shared/champions.ts`)

| Ability | Numbers |
|---|---|
| Beat Shot | 7 /s, 150 m/s, r 0.12, life 1.4 s; damage 100 % to 28 m, 62 % at 60 m; spread 0.5° + bloom·2.6° |
| Lead Single | fires on the clip's `fire` event (f6); 135 m/s, r 0.24, kb 7; a hit refunds 1.5 s on the other cooldowns |
| Bass Charge | full at 0.95 s; perfect window 0.18 s; overcharge from +0.6 s, decaying over 1 s to 75 % power; beam r 0.2 (perfect 0.35), 180 m; < 15 % charge fizzles; moves at 0.5 speed |
| Sub Bomb | thrown on `release` at 26 m/s (+4 up, + ½ REX's velocity); gravity 22; 2 bounces (speed × 0.6); fuse 1.3 s; radius 4.6; kb 14 |
| Drop The Beat | 1.5 s action at 0.3 speed; 12 notes, first at 0.15 s, then every 90 ms; 34 m/s upward fan; homing k 7 after 0.22 s; r 0.3; life 3 s |

**Baseline vs spec** (before the REX pass; what was built is in `src/combat/kits/rexFx.ts` and
case-study-rex.md)

| Ability | Baseline (`rexKit.ts`) | Main gaps |
|---|---|---|
| Beat Shot | `bolt` + `muzzle(V)`; two `hitSpark`s per hit (`Projectiles.update` + `Match.hitFeedback`) | dotted head; ≈1 m LDR flash vs 0.35 m; ~32 particles per hit vs ≤14 per shot |
| Lead Single | `muzzle(G)`, 2 forward rings, instant 2-beam tracer, shake 0.2; `bolt` × 2.1; refund ring on target | no ready cue; line before the slug; no ribbon |
| Bass Charge | charging: HUD ring only; release: V beam r 0.18 + 0.25k + white core, ring every 4 m (≤15), big `hitSpark` | 0.86 m wide vs 0.4 m hit width; 18 rings overflow the 16-ring pool; no charge reads |
| Sub Bomb | `grenade`, generic `explosion(4.6)`, shake 0.25 | no bounce FX, no telegraph; ring at 1.2 r, off the ground |
| Drop The Beat | 12 `note` meshes, `muzzle(G)` per launch, two `hitSpark`s per hit | no announce, threat rim or escalation |

**Tuned in captures** (the built values in `rexFx.ts` / `rex.ts` win where they differ from the
tables below): approach ring from r 0.9 m (not 1.6); converging rings r 0.5 → 0.08 m; beam caps
0.6 m; beam body tier 0.36-0.42 (under the threshold) with a 3 m throat from 0.3× width; cast,
face-on rings and target glows dimmed in the shooter's own view (`alongView`).

The taunt has no VFX. `rex.ts` animates the weapon detail (ring pumps, drum indexing, barrel heat
V → G → white, EQ kick, ready pulse, charge orb) behind `cue('shot'|'slug'|'note'|'beam'|'charge'|
'chargeState'|'ready')`; the baseline kit never called it (the REX pass wires it on the local and
remote paths: check both whenever a cue is added).

### 10.1 Beat Shot (burst fire + muzzle)

| Layer | Spec |
|---|---|
| Muzzle | 4-point star (k 0.3), 0.45 m, 4 quantized rolls; core Wg L×3; f0 100 %, f1 50 % at 1.15×; two 0.25 m side streaks |
| Accent (`Beat.kick` > 0.6, ≈ every 4th shot) | flash 1.3×; gold ring r 0.08→0.6 m over 11 f; +2 sparks |
| Tracer | stretched billboard 0.10 m wide, length clamp(150 × 1.5/60 = 3.75, 0.6, 4) m, clipped at the muzzle on f0; core Wv L×2, edge V L×0.7, tail occlusion 0.2; one frame of 35 % afterimage |
| Hit (fighter) | 4-point flash 0.35 m L×3, 2 f; 6–8 sparks at 6–12 m/s (drag 7, 7–12 f); ring r 0.1→0.45 m, 9 f; ink flash on f2 (occlusion 0.4) |
| Hit (world) | r 0.4 m "sound dent" ring, 15 f, + 3 sparks |
| Headshot | gold 6-point star 0.6 m, L×4, 3 f |
| Falloff > 28 m | impact size × damage scale, floored at 70 % |
| Spread | side flares +30 % at full spread ("hot barrel") |

**Budget:** ≤ 14 particles per shot, ≤ 7 live tracers, one `hitSpark` per hit.

### 10.2 Lead Single (heavy slug, no charge-up)

**Ready cue:** muzzle at V L×0.8, pulsing with `Beat.pulse` while aiming with the slug ready
(`cue('ready')`).

**Cast (on `fire`):** f0 / f1 / f2 three gold cone rings (r 0.15 / 0.30 / 0.45 m), each pushing 0.3 m
forward and scaling ×1.6 over 7 f at L×1.2; 6-point flare 0.9 m with core Wg L×4 (f0), L×2 (f1),
L×1 (f2); 4 side sparks. Camera, FOV and trauma: game-feel.md §11.

**Projectile**
- Head: 0.5 m disc (G core 40 % at Wg L×2.5, V ring L×0.9, ink rim 0.5), stretched to 4.5 m.
- Bass ripples: a ring every 3 m facing the travel direction, r 0.3→0.9 m over 12 f, L×0.6.
- Two-layer 8 m ribbon: additive gold (15 f) + premultiplied dark violet (9 f) [S16]; two staff
  lines at ±0.15 m, 0.02 m wide, 12 f.
- Today's tracer flashes the whole line before the slug arrives: draw it from the muzzle to the
  slug's current head only (≤ 6 f, L×0.6).

**Hit (fighter):** f0 Wg star 1.0 m L×5; normal-aligned shockwave r 0.3→2.2 m over 15 f; 16–18
sparks (8–16 m/s), 3 shards (gravity 12), 4 violet dust puffs (L×0.4, 30 f); 3 knockback streaks
(0.6 m, 9 f). Victim hold and impact-frame rules: game-feel.md §1.3, §5.3.

**Refund:** a gold ring contracts around the rifle (r 1.2→0.4 m, 12 f) with the HUD flash (today an
expanding ring on the target, in `fireSlug`). **Miss:** r 1.2 m ring, 6 sparks, an ink-violet
scorch ring fading over 90 f.

### 10.3 Bass Charge (charge-up → perfect → overcharge → beam)

| Phase | Layers |
|---|---|
| **Charge** f0–57 | Orb 0.08→0.30 m (easeInQuad), colour V→G, core L×1→2.5. Inward streaks from 1.4 m, 18 f life, 12→60 /s. Converging rings at f0 / f19 / f38 (r 1.0→0.15 m). **Approach ring** from r 1.6 m reaching the orb at exactly f57, on the crosshair in screen space while zoomed. Violet "planted" ground ring r 0.8 m. Enemies see the orb with the threat rim |
| **Perfect** f57–68 | f0–1: Wg flash L×5 + ring snap r 1.4→1.0 m (6 f, easeOutBack). The orb *locks*: no growth, steady G, rotating 4-point glint, 30 Hz shimmer. Crosshair pulse |
| **Full** f68–93 | steady G, glint off |
| **Overcharge** > f93 | toward desaturated `#ff3b6b`; flicker stepped at 20 fps ±25 %; jitter 0.02→0.08 m; 4–6 /s glitch slices (±0.05 m, 1 f); outward sparks 20 /s |
| **Beam** f0–1 | 1.4× hit width (0.56 m; perfect 0.98 m); core L×4 (perfect: Wg L×6); body G/V; muzzle cap 6-point 1.2 m; impact cap 1.0 m + wall ring |
| f2–6 | ease to hit width (0.4 m; perfect 0.7 m); edge noise ±22 % scrolling at 40 m/s |
| f6–13 | erase muzzle→target while thinning to 0.2× |
| f0–27 | a ring every 6 m (cap 12), delayed by distance / 400 m/s, r 0.3→1.2 m over 18 f, L×0.6; one spark per 1.5 m (cap 40) |
| Pierced fighters | 0.8 m flash, 10 sparks (holds: game-feel.md §11) |

**Variants:** *perfect* = gold-dominant, 2 extra white rings (impact frame per game-feel.md §5.3).
*Overcharged* = width × 0.75, 30 % frayed, desaturated, no impact frame. *Fizzle* (< 15 %) = the orb
collapses inward over 6 f with 4 sparks, no beam.

### 10.4 Sub Bomb (flight, bounce, detonation)

**Flight:** hand flash 0.3 m, 2 f, on the `release` event; puck emissive V L×0.8, jumping to L×2 on
`Beat.kick`; spin 3 rev/s with a 1.5 m / 12 f ribbon; a sub ring (r 0.2→0.8 m, 15 f, L×0.5) on every
eighth-note tick.

**Bounce:** ground ring r 0.3→1.2 m, 12 f; 6 dust puffs (24 f); 4-point flare 0.4 m, 2 f; squash to
y 0.7 for 2 f.

**Fuse telegraph** (from the first bounce, or at 0.5 s): ground decal at the **exact 4.6 m** radius,
following the puck; border 0.08 m at L×0.8; fill 0.08→0.18 with age / 1.3 s; last 9 f blinking 2 f
on / 2 f off at L×1.5. Enemies: threat rim, spiky border. REX and allies: solid violet.

**Detonation** (`blast: false` + `onBurst`, so the generic explosion does not double it)

| Frames | Layers |
|---|---|
| f0–1 | Wg flash sphere 1.4 m L×5; PersonaFX flash 0.15 within 8 m |
| f0–15 | toon ground shockwave r 0.5→4.6 m, easeOutExpo, dark trailing band |
| f0 / f4 / f8 | three air cone rings r 1→3.5 m, 15 f, V L×0.9 |
| f2–26 | 24 EQ bars at r 1.2 m, 0.4–1.2 m tall, stepped at 20 fps, eroded by f26 |
| f1–20 | 30 sparks (8–16 m/s, drag 5); 8 SDF notes 0.3 m thrown up at 4–7 m/s (gravity 6, 54–72 f) |
| f4–50 | 14 dust puffs outward at 4–6 m/s, drag 3, occlusion 0.25, 36–54 f |
| f0–12 | distortion ring (High preset only) |
| f0–150 | cracked "subwoofer" decal r 2.5 m, fading from f90 |

Knocked fighters get 3 push streaks (trauma: game-feel.md §11). **Budget:** ≈ 80 particles + 6 meshes.

### 10.5 Drop The Beat (12 homing notes)

**Announce (f0–15):** a gold light column on REX (0.6 × 6 m, L×1.5), visible arena-wide as
everyone's warning (`SpotMode.ts` has a column shader to start from); a 32-bar EQ ring at his feet
bouncing through the 1.5 s action; optionally, caster only, a Persona cut-in banner (diagonal, 30 f,
35 % opacity, clear of the crosshair) plus 18 f of speed lines.

**Each launch** (every 5.4 f): muzzle pop; the note scales 0→1 over 3 f (easeOutBack); 2 f white core flash.

**Head:** SDF eighth note 0.55 m tall (its width matches the 0.6 m hit diameter); fill V or G,
alternating as in the kit; notehead core L×1.4; ink outline 0.045 at occlusion 0.9; roll wobble ±15°
at 3 Hz; sparkles every 80 ms (18 f life, cap 150).

**Path:** fountain for 0–0.22 s, then homing with a visual spiral (A 0.25 m, ω 12 rad/s, φᵢ = i·30°),
A → 0 within 3 m of the target. **Trails:** 0.08 m ribbon, (1 − p)² taper, 15 f, L×0.7; staff-line
pairs on every third note only. **Readability:** notes homing on *you* swap the ink outline for the
threat rim.

**Hit:** 4-point star 0.5 m L×3, 2 f; 5 sparks; ring r 0.2→0.8 m over 11 f. Hits on the same target
within 24 f escalate (+10 % size, +1 semitone each); the 12th note gets a 1.2 m star.
**Expire:** splits into 3 tiny notes fading over 18 f.

**Budget:** ≤ 12 heads + 12 trails, ≤ 200 particles, ≤ 0.6 screens of coverage.

### 10.6 Impact tiers on REX's targets

| Tier | Flash | Sparks | Ring (r) | Extra |
|---|---|---|---|---|
| Light (shot, note) | 0.35–0.5 m, 2 f, L×3 | 5–8 | 0.45–0.8 m | 3 EQ spikes on the normal (0.2–0.5 m, 7 f) |
| Heavy (slug, bomb, beam) | 0.8–1.4 m, 3 f, L×5 | 14–30 | 2.2–4.6 m | push streaks, dust |
| Critical (headshot, perfect) | gold 6-point 1.0–1.4 m, L×6 | +50 % | +1 white ring | shooter-only impact frame |

Hold and trauma per tier: game-feel.md §1.3; shooter-only impact frames: game-feel.md §5.3.
Sparks spray back along the hit normal, which for the shooter is straight at the camera: in the own
view (`alongView`) fan them across the view instead (drop 85 % of the along-view component), or 17
sparks seen head-on bloom into a ball over the target for their whole life.

### 10.7 Taunt (`taunt` clip, authored in beats)
The clip (`rexAnims()` in `rex.ts`) lasts 6.6 beats (3.8 s at 104 BPM): "raise the roof" up on beats 1–4
(0.58 / 1.15 / 1.73 / 2.31 s), point on beat 5 (2.88 s). Fire the VFX from those keys.

- **Spotlight** (from beat 0.5): cone from 4 m above, fresnel edge, L×0.6 (never blooms), 12 f fades,
  off with the clip.
- **Roof pumps** (beats 1–4): a 16-bar EQ ring (r 0.9 m) pops its bars to 0.6 m and drops them over
  15 f; two notes float off the hand (1 m/s, 48 f).
- **Point** (beat 5): gold 4-point glint 0.5 m, 3 f; a chevron "shout" ring toward the target
  (r 0.4→1.5 m, 18 f); "HEADLINER" holo text from a runtime CanvasTexture, glitching in over 24 f
  with scanlines and chroma stepped at 20 fps.

**Budget:** ≤ 40 particles, ≤ 0.2 screens, nothing above L×1.2 (cosmetic).

---

## 11. Melee slash notes (Kaiser · Nova · Elisabbat)

**Shared rig (built in code):** ring-sector mesh (r_inner, r_outer, θ, 24–48 segments; uv.x tail→tip,
uv.y inner→outer); triangular mask `smoothstep(0, .15, v) * (1 − smoothstep(.85, 1, v))` weighted toward
the tip; a draw-on threshold sweeping uv.x 0→1 in 2–3 f, then noise erosion from the tail [S21][S22].
Holo variant: scanlines (40 per m, scrolling 2 m/s) and a 0.02 m chroma split at the edge.

**KAISER** (holo greatsword; `#ffc24a` / `#ff2e88`; heavy, square-ish shapes)

| Move | Spec |
|---|---|
| Wind-up 9–12 f | blade L×0.8→1.6, 6 inward sparks at the tip |
| Swing | 200° arc, r 0.6–2.4 m: draw 3 f, hold 3 f, erode 12 f; thick band |
| Shockwave slash | 2.4 × 1.6 m vertical crescent travelling along the ground; front L×2, body L×0.8; crack decal every 0.5 m; 2 dust puffs per m |
| Hit | 1.2 m star 3 f, local impact frame, 14 sparks + 4 square holo shards |

**NOVA** (twin holo katanas; `#2ef2ff` / `#ff3fd0`; thin, spiky, fast). Her cyan is the ally-rim
colour: relation must come from rim *and* shape.

| Move | Spec |
|---|---|
| Swings | 140° arcs, r 0.4–1.6 m, colours alternating per blade: draw 2 f, hold 1–2 f, erode 7 f |
| X-slash | two crescents at ±45°, 1.6 m, white-hot crossing at L×3; 6 afterimages stepped every 2 f, fading over 9 f |
| Teleport out | 3 f glitch silhouette (horizontal slice offsets) + 12 pixel squares |
| Teleport in | 1 f vertical light line (2 m, L×3) + ground ring r 0.2→1.2 m over 12 f; the arrival flash lands **on or before** her first visible frame |

**ELISABBAT** (`#a24cff` / `#ff2e6a`; gothic triangles, ink)

| Move | Spec |
|---|---|
| Claws | 3 parallel 0.03 m arcs, 0.12 m apart: draw 2 f, crimson core with ink edge (occlusion 0.7), erode 9 f, 2–3 drips (gravity 9) |
| Bat form | 16–24 bats + ink smoke (occlusion 0.6) within 15 f; a ground shadow ring keeps her hurtbox readable |
| Swarms | §5 bats, faint ground ring, small red tick sparks on victims |
| Blood marks | bat-wing sigil with 1–3 stack segments, pulsing on `Beat.kick` (flavour); unmistakable on the marked player's screen |
| Bite | fang chevrons close in 3 f; 6–10 blood orbs along Béziers to her chest (18–27 f, 2 f stagger); on arrival a rising crimson ring (r 0.4→1.2 m) and upward sparks (heals move *up*); never green |

---

## 12. VFX QA checklist

**Readability**
1. **Flavour-off pass:** radius, timing and direction read from the gameplay layer alone.
2. Visuals match hitboxes within ±10 % (debug collider overlay).
3. Warnings ≥ 15 f (≥ 39 f for escapable lethal attacks), identical on every cast.
4. Projectile cores ≥ 4 px wide at 1080p at 20–40 m.
5. **10 % size test:** a thumbnail still identifies the ability by silhouette and value.
6. **Greyscale test:** core > mid > edge holds.
7. **Squint test:** one focal point per effect.
8. **Crowded fight** (4 champions, 2 ults): enemy projectiles found in under 0.5 s.
9. Friend vs foe reads from rim and shape, never hue alone.
10. **Colourblind:** Chrome DevTools → Rendering → *Emulate vision deficiencies* (protan, deutan,
    tritan, achromatopsia) on ults and telegraphs.
11. Projectile direction reads on a paused frame.
12. Your own effects never cover the crosshair, including the zoomed charge.
13. No two abilities share a silhouette.
14. Contrast holds in neon city, stage and tartarus, on bright and dark patches.

**Timing and feel**

15. The climax lands within ±1 f of hit registration, and `visualOnly` remote copies match.
16. Outros sit below the climax in value, saturation and opacity; no accidental hard cuts.
17. Layers start 1–2 f apart; nothing pops by accident.
18. Hitstop never stalls the simulation; shake never rotates the shooter's aim.
19. Beat sync touches flavour only.

**Colour and HDR**

20. No large area above L×1 for more than 3 f, except ults; 100 % white only on climaxes and ults.
21. **Halo pop test:** fades at 0.25× speed show no bloom switching on and off.
22. The Low preset (no bloom) still reads, with fallback halos.
23. Violet and gold cores don't drift into pink or yellow mush.

**Performance**

24. VFX ≤ 40 draw calls (`renderer.info`); a 4-ult stress scene holds ≤ 16.7 ms on an integrated GPU.
25. **Overdraw view** (VFX swapped for constant additive 0.1): ≤ 3 screens sustained, ≤ 6 at peak.
26. No GC spikes in fights (flat memory track).
27. No first-cast frame over 25 ms (precompiled shaders, fixed light count).
28. Caps drop secondary layers first, never the gameplay layer.
29. Effects scale with `pixelRatio`; nothing depends on 1-px lines.

**Process**

30. Packet loss never orphans looping effects.
31. Review at 1×, 0.25× and frame by frame, replaying constantly [S57].
32. Paintover and side-by-side reference reviews [S34][S74].

---

## Sources

- S1 Riot, LoL VFX Style Guide: https://nexus.leagueoflegends.com/wp-content/uploads/2017/10/VFX_Styleguide_final_public_hidpjqwx7lqyx0pjj3ss.pdf
- S2 Riot, VFX Style Guide dev blog: https://nexus.leagueoflegends.com/en-us/2017/10/dev-leagues-vfx-style-guide/
- S3 Riot, Timing in VFX (slide): https://www.deck.gallery/league-of-legends-2017/slide/32-importance-timing-vfx-the/
- S5 VFX Apprentice, LoL design tips: https://www.vfxapprentice.com/blog/10-league-of-legends-vfx-design-tips
- S6 VFX Apprentice, artistic principles: https://www.vfxapprentice.com/blog/five-artistic-principles-gaming-vfx
- S7 VFX Apprentice, timing: https://www.vfxapprentice.com/blog/the-soul-of-effects-what-is-timing-in-vfx
- S8 VFX Apprentice, Riot creative head: https://www.vfxapprentice.com/blog/riot-games-head-creative-vfx-artist-needs
- S9 VFX Apprentice, Genshin breakdown: https://www.vfxapprentice.com/blog/genshin-impact-stylized-vfx-breakdown
- S10 Keyser & Chamberlin, GDC 2017: https://media.gdcvault.com/gdc2017/Presentations/Chamberlin_Keyser_ArtisticPrinciplesVFX.pdf
- S11 Riot, Dev: Clarity in League: https://www.riotgames.com/en/news/dev-clarity-in-league
- S13 Riot, VFX updates: https://www.leagueoflegends.com/en-au/news/dev/dev-behind-the-scenes-of-vfx-updates/
- S14 McDonald, LoL missile 1: https://realtimevfx.com/t/anatomy-of-a-league-of-legends-missile-part-1-creating-areas-of-focus/11614
- S15 McDonald, LoL missile 2: https://realtimevfx.com/t/anatomy-of-a-league-of-legends-missile-part-2-what-are-we-communicating-with-our-vfx/13062
- S16 McSheehan, knowledge share: https://realtimevfx.com/t/shannon-mcsheehan-lol-fx-knowledge-share/1133
- S17 Hit-spark critique: https://realtimevfx.com/t/stylised-explosive-and-fiery-hit-spark-looking-for-feedback/11286
- S18 Hitscan tracers: https://realtimevfx.com/t/need-advice-on-how-to-create-a-hit-scan-tracer-bullet-effect-using-beams-in-ue4/3876
- S19 Stylized muzzle flashes pack: https://realtimevfx.com/t/stylized-muzzle-flashes-vfx-pack/14791
- S20 Venom Slash breakdown: https://realtimevfx.com/t/venom-slash-breakdown-of-the-effect-included/18903
- S21 Cyanilux, Sword slash shader: https://www.cyanilux.com/tutorials/sword-slash-shader-breakdown/
- S22 heyyocg, Fire Slash design process: https://heyyocg.link/en/design-process-of-flame-slash/
- S23 Leroy, LoL-grade VFX: https://80.lv/articles/constructing-vfx-worthy-of-league-of-legends/
- S24 Jevremović, VFX Staples: https://80.lv/articles/vfx-staples-shape-color-and-motion
- S25 Villalva, equalizer effect: https://80.lv/articles/making-a-stylized-equalizer-effect
- S26 Hades effects (80.lv): https://80.lv/articles/a-behind-the-scenes-look-at-the-effects-in-hades
- S27 Trümpler, Battlefront II: https://simonschreibt.de/gat/battlefront-ii-layered-explosion/
- S28 Trümpler, Fallout 4: https://simonschreibt.de/gat/fallout-4-the-mushroom-case/
- S31 H. Alisavakis, Tornado & explosion: https://halisavakis.com/write-up-tornado-explosion/
- S32 Riot, VALORANT clarity: https://technology.riotgames.com/node/110
- S33 Valorant hit effects: https://www.pcgamer.com/au/heres-how-to-read-valorants-hit-effects-following-the-latest-patch/
- S34 Valorant art director: https://www.inverse.com/gaming/valorant-art-style-interview-moby-francke
- S35 Valorant enemy highlight colours: https://dotesports.com/valorant/news/how-to-change-enemy-highlight-color-in-valorant
- S36 Overwatch forums: https://us.forums.blizzard.com/en/overwatch/t/in-overwatch-red-enemy-effects-with-one-exception/313227
- S37 ASW, GGXrd (GDC 2015): https://www.gdcvault.com/play/1022031/GuiltyGearXrd-s-Art-Style-The
- S38 Guilty Gear Strive: https://gamesoftrobo.substack.com/p/what-does-guilty-gear-strive-do-right
- S39 Hi-Fi Rush: https://hitmarker.net/news/syncing-music-with-gameplay-a-closer-look-at-this-rhythm-based-action-game-519880
- S40 Paulsen, True Damage: https://www.artstation.com/artwork/Ya1zvq
- S41 McSheehan, TD Senna: https://shannonmcsheehan.artstation.com/projects/Dxq6NO
- S42 K/DA art blast: https://magazine.artstation.com/2020/11/riot-games-league-of-legends-k-da-artblast/
- S43 Arcane pipeline: https://www.redsharknews.com/why-netflixs-arcane-looks-so-good-how-fortiche-ramped-up-the-animation-pipeline
- S44 Hitstop: https://critpoints.net/2017/05/17/hitstophitfreezehitlaghitpausehitshit/
- S45 GamineAI, game VFX: https://www.gamineai.com/blog/how-to-create-game-vfx-particle-systems-visual-effects
- S46 Trauma² shake: https://godotengine.org/asset-library/asset/735
- S51 Itano Circus: https://en.wikipedia.org/wiki/Ichir%C5%8D_Itano
- S52 Smear frames (thesis): https://theses.fh-hagenberg.at/system/files/pdf/Lendenfeld18.pdf
- S53 Radial speed lines: https://godotshaders.com/shader/radial-speedlines/
- S54 Attack telegraphs: https://bugnet.io/blog/how-to-design-enemy-attack-telegraphs
- S55 Pixune, Shape language: https://pixune.com/blog/shape-language-technique/
- S56 Mattila, thesis: https://www.theseus.fi/bitstream/handle/10024/151308/Mattila_Meri.pdf
- S57 T. Iché, VFXDoc: https://github.com/peeweek/VFXDoc
- S64 three.quarks: https://github.com/Alchemist0823/three.quarks
- S65 MeshLine: https://github.com/pmndrs/meshline
- S67 LYGIA: https://github.com/patriciogonzalezvivo/lygia
- S69 Lettier, game shaders: https://github.com/lettier/3d-game-shaders-for-beginners
- S71 Darkness Lightning critique: https://realtimevfx.com/t/art-test-darkness-lightning/4507
- S72 Charge-up emitters: http://www.mirzabeig.com/tutorials/stylized-particle-galaxy/
- S73 Niagara laser beam: https://cghow.com/niagara-laser-beam/
- S74 Riot, VALORANT VFX job: https://www.themuse.com/jobs/riotgames/senior-vfx-artist-valorant
