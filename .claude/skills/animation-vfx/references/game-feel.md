# Game feel: hitstop, shake, kicks, FOV, impact frames, AV sync

**Use this file for** making a hit, shot or ultimate *feel* right in PROJECT GGG's online PvP: hitstop (§1), shake and camera kicks (§2), camera (§3), recoil (§4), contact-frame layering, impact frames and post effects (§5), PvP-safe time effects (§6), AV sync at 104 BPM (§7), latency (§8), pitfalls (§9), QA (§10), the REX spec (§11) and the engine as it is today, with file:line (§12). One strength scalar `s ∈ [0,1]` per event drives every number.

Conventions: 1 f = 16.7 ms at 60 fps. Springs are (Hz, ζ), the units of `Kick(freq, zeta)` in `src/fighter/Springs.ts` (ω = 2π·Hz). Angles in degrees. Trauma is the 0–1 budget of `CameraRig.addTrauma`. `[S#]` = source; **[rec]** = recommendation; **[calc]** = derived; **[bg]** = unverified background.

## Contents

0. Twelve rules
1. Hitstop: 1.1 Purpose · 1.2 Reference data · **1.3 GGG tiers** · 1.4 Sakurai's techniques · 1.5 Online, and freezing in GGG
2. **Screen shake**: 2.1 Trauma · 2.2 3D and aiming · **2.3 Directional kicks** · 2.4 FOV punch, when not to shake, accessibility
3. Camera · 4. Weapon feel
5. Impact layering: 5.1 Timeline · 5.2 Anticipation · **5.3 Impact frames and post effects** · 5.4 One scalar → every layer
6. Time manipulation · 7. AV sync · 8. Responsiveness · 9. Pitfalls · 10. QA · 11. REX · 12. Engine notes & gotchas · Sources

---

## 0. Twelve rules

1. **One strength scalar per hit.** Freeze, shake, kick, FOV, flash, sound gain, rumble and UI are curves of `s` (§5.4).
2. **Same frame.** SFX transient, victim flash, spark, freeze start and hit marker land on one rendered frame.
3. **Presentation only.** Hitstop holds the two fighters' *displayed* pose and contact VFX, never the simulation, inputs, projectiles, clip events or camera.
4. **Ranged hits freeze the victim only** [S1]. Automatic fire (`stream` parts) and beam ticks freeze nothing.
5. **Rotate, don't translate, in 3D**, with smooth noise [S8]; roll is aim-safe, damp yaw/pitch while aiming.
6. **Kicks and trauma are separate**: directional events are spring impulses, trauma is undirected noise.
7. **Own small shots never shake the screen.** They kick (weapon pose, camera spring) and sound punchy.
8. **Visual recoil is not aim recoil.** Aim stays deterministic; the rendered camera kicks and springs back in 150–300 ms.
9. **PvP slow-mo is per-entity and cosmetic** (the dying victim); global only at match end and in kill cams.
10. **Audio is never early**: at most 1 f late, measured against the audio *output* clock (§7).
11. **Rate-limit and cap**: per-target freeze cooldown 100–150 ms, 150 ms damage-kick gate [S12], trauma caps, ≤ 3 full-screen flashes/s [S15].
12. **Ship sliders**: 0–1 scales for shake, flash, FOV effects and kick, plus "reduce flashing"; test each layer on/off [S7].

---

## 1. Hitstop / hitlag

### 1.1 Purpose

- Smash: the attacker freezes on contact; the victim freezes on the **first frame of its flinch** and shakes. It confirms the hit and gives both players time to read it [S1].
- Sakurai: length is per move, not damage alone; for deaths, stop, shake and **slow the death animation** [S2].
- Juicy Breakout's `Freezer` is a curve on the wall clock: 0–320 ms, speed 0–1, fades 0–160 ms [S7].

### 1.2 Reference data

| Source | Light | Medium | Heavy | Super / cap |
|---|---|---|---|---|
| SF6 Ed [S4] | 5LP **9 f** | 5MP **11 f** | 5HP **13 f** | projectile clash 8 f |
| GG Strive [S3] | Lv0–1 **11–12 f** | Lv2 **13 f** | Lv3 **14 f** | Lv4 **15 f**; Gold Burst 16 |
| MUGEN KFM `pausetime=atk,vic` [S5] | 8,8 · 7,8 | 10,11 | 12,12 | super finisher **30,30**; early multi-hits **4,8** |
| Smash [S1] | Melee ⌊(d/3+3)·e⌋·c | 15% hit: 8–9 f | **15 f** (Ultimate) | cap **30 f** |
| Celeste [S6] | dash 3 f | explosion 6 f | — | skipped if `TimeRate ≤ 0.25` |
| GGG today (§12.1) | melee basic 45 ms | skill/crit 60 ms | counter 100 ms | ult 120, parry 150 ms; slows the **whole local sim** to 6% |

Projectile hits put only the target in hitlag [S1]; shooters use none on guns [bg].

### 1.3 GGG tiers [rec]

Fighting-game hitstop is a 1v1 confirm window under a fixed camera. GGG has a free camera, several threats and a local freeze, so values run 30–40% shorter.

`s = clamp(dmg/300 + 0.1·crit + 0.15·counter, 0, 1)`, with `dmg` the real damage (crits already ×1.5). A killing blow sets `s ≥ 0.95`.

| Tier | `s` | Examples (real GGG damage) | Attacker freeze | Victim freeze | Jitter |
|---|---|---|---|---|---|
| T0 Tick | < 0.2 | Beat Shot 46, ult note 52, beam ticks | 0 | 0–1 f | 1 cm |
| T1 Light | 0.2–0.35 | katana/claw light, Beat Shot headshot 69 | melee 2–3 f · ranged 0 | 3 f (50 ms) | 2 cm |
| T2 Medium | 0.35–0.6 | greatsword c1–c3, slug 125, Sub Bomb 140 | melee 4–5 f · ranged 0 | 5–6 f (83–100 ms) | 4 cm |
| T3 Heavy | 0.6–0.95 | slug headshot 188, Bass Charge 270 | melee 7–8 f · ranged 0 | 8–9 f (133–150 ms) | 6 cm |
| T4 Finisher | ≥ 0.95 / kill | perfect beam 300, ult slam 380 | melee 10–12 f · ranged 0 | 12 f (200 ms), then victim slow-mo (§6) | 8 cm |

- **Never add**: `max(remaining, new)`, one hold ≤ 220 ms (13 f). **Per-target cooldown** 100–150 ms, so a 12-missile ult never freezes continuously.
- **Multi-hit moves**: early hits freeze the attacker at 50%, the victim at 100% [S5]. **Streams** (`stream: [...]` in `shared/champions.ts`) freeze nothing.

### 1.4 Sakurai's eight techniques → GGG [S2]

1. Shake the victim, not the attacker (2–8 cm).
2. Never move the hitbox: add jitter to `visual.root.position` after Fighter.ts:971; the capsule comes from `f.pos`.
3. Ground hits jitter along the flattened blow direction; air hits vertically.
4. Decay linearly 1 → 0, flipping sign every frame.
5. Length per move: §5.4 curve plus per-ability overrides.
6. Snap to the flinch's first frame, then hold (`hitReact` snaps in 50 ms, FighterAnimator.ts:386–412).
7. Keep the attacker crawling at 5–10% instead of stopping dead.
8. Scale jitter by `clamp(camDist/6, 1, 3)`.

### 1.5 Online, and freezing in GGG

- **Attacker client** (predicted hit): hold its own model and the victim proxy; simulation, input and camera run on. The spark holds its first frame for the victim's freeze.
- **Victim client** (server `dmg`, OnlineSession.ts:296–313): hold and jitter its own model, apply the damage kick (§2.3). It owns its position, so it may delay its own knockback by ≤ 100 ms ("freeze, then launch"). Never pause the local sim.
- **Observers**: half duration or none. Precedent: NetherRealm and Marvel Rivals keep cosmetics out of the simulation [S28].

**Freeze the pose, not the clock.** `FighterAnimator.update` advances the clip clock that emits *gameplay* events (Fighter.ts:1075–1082 → `kit.onAnimEvent`: REX `fire`/`release`, Kaiser `hitOn`). Slowing it, as `Match` does today (§12.1), delays gameplay. Hold the displayed pose and let clock, events, kick springs and physics run on real time:

```ts
// src/fighter/FighterAnimator.ts (proposed): presentation-only hitstop; import blendPose from './Animator'
private holdLeft = 0; private relLeft = 0; private crawl = 0;
private readonly held = new Pose();
/** max() with a running hold, never added; ≤ 220 ms. crawl: victim 0, attacker 0.05–0.1 */
hold(sec: number, crawl = 0): void {
  if (this.holdLeft <= 0 && this.relLeft <= 0) this.held.copy(this.pose);   // pose on screen
  this.holdLeft = Math.max(this.holdLeft, Math.min(sec, 0.22));
  this.crawl = crawl;
}
// in update(), after every procedural layer, immediately before `applyPose(pose, this.v.rig)`:
if (this.holdLeft > 0 || this.relLeft > 0) {
  const holding = this.holdLeft > 0;
  if (holding) { this.holdLeft -= dt; if (this.holdLeft <= 0) this.relLeft = 0.05; }   // ~3 f release
  else this.relLeft -= dt;
  const rate = holding ? this.crawl : 0.6;                    // release closes 60% of the gap per frame
  blendPose(this.held, this.held, pose, 1 - Math.pow(1 - rate, dt * 60));   // out === a: alias-safe
  if (this.holdLeft > 0 || this.relLeft > 0) pose.copy(this.held);
}
```

- `blendPose` is alias-safe only with `out === a` (`slerpQuaternions` copies `a` into `out` first). The release blend is self-contained: the inertializer runs only with `anims.inertial` (REX only, rex.ts:553) and only on the clip layers (FighterAnimator.ts:213–216).
- Jitter: after Fighter.ts:971 add `axis · sign · amp · holdLeft/holdDur`, sign flipping every 16.7 ms. If cloth or `SpringBone`s jangle, jitter `v.rig.root` instead.

---

## 2. Screen shake

### 2.1 The trauma model

Eiserloh [S8]: `trauma ∈ [0,1]`, added on events, decayed linearly; shake = `trauma²` or `trauma³` (cube: 0.3/0.6/0.9 → 3%/22%/73%); `angle = max · shake · noise(seed, t)` on the **rendered** camera; **gradient noise, not random values** (continuous, frame-rate independent, smooth in slow-mo); don't tie shake linearly to damage.

| Implementation | Model | Constants |
|---|---|---|
| Bevy, rbfx [S9] | trauma², 1D Perlin | roll 10°, decay 0.5–1/s, noise rate 16–20 |
| Source `CalcShake` [S10] | random offset every `1/freq` s × sin | amp × remaining², roll ±amp/4, frequency rises as it fades |
| Doom 3 [S12] | random × amplitude of the shake *sounds* heard | AV-synced by construction |

GGG today: trauma², decay 1.6/s, 3 summed sines, ±3.4° yaw/pitch and ±4.6° roll at trauma 1 (§12.2).

### 2.2 3D and aiming

- Translation pushes a 3D camera into walls; rotation works [S8]. ≤ 3 cm of translation is nearly free.
- Yaw/pitch move the world under the crosshair: 1° at 30 m = 0.52 m **[calc]**, so GGG's ±3.4° misplaces the reticle by 1.8 m (shots still go true: aim comes from `cam.yaw/pitch`, LocalController.ts:20–25). **Roll is aim-safe.**
- Keep only low-frequency continuous shake (Uncharted 3); tie ambient shake to speed (Tomb Raider) [S21].

**[rec]** Max at shake 1: yaw 1.5°, pitch 1.2°, roll 2.5°, offset 3 cm · `aimScale` 0.35 on yaw/pitch while aiming or charging · noise 15–25 Hz impacts, 8–12 Hz explosions, 2–5 Hz ult rumble · decay 1.5–2.5/s impacts, ≈ 1/s explosions · exponent 2 · observer falloff `0.5·trauma·max(0, 1 − d/25)²`.

Drop-in for the shake terms of CameraRig.ts:115–128:

```ts
const P = new Uint8Array(512);
{ const p = [...Array(256).keys()]; let s = 0x2545f491;
  for (let i = 255; i > 0; i--) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const j = (s >>> 0) % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
/** 1D gradient noise ≈ [-1, 1]: smooth, deterministic, safe under slow-mo */
export function noise1(x: number): number {
  const i = Math.floor(x), f = x - i, g0 = P[i & 255] / 127.5 - 1, g1 = P[(i + 1) & 255] / 127.5 - 1;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return 2 * (g0 * f + (g1 * (f - 1) - g0 * f) * u);
}
export class TraumaShake {
  trauma = 0; userScale = 1; aimScale = 1;                   // settings slider · 0.35 while aiming
  readonly out = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };  // rad / m, added to the RENDERED camera
  private t = Math.random() * 1e3;
  constructor(public k = { yawDeg: 1.5, pitchDeg: 1.2, rollDeg: 2.5, offset: 0.03, hz: 18, decay: 1.8, power: 2 }) {}
  add(a: number, cap = 1): void { this.trauma = Math.max(this.trauma, Math.min(cap, this.trauma + a)); }
  update(realDt: number): void {
    this.t += realDt * this.k.hz;
    this.trauma = Math.max(0, this.trauma - this.k.decay * realDt);
    const s = this.trauma ** this.k.power * this.userScale, r = Math.PI / 180, t = this.t, o = this.out;
    o.yaw = this.k.yawDeg * r * s * this.aimScale * noise1(t);
    o.pitch = this.k.pitchDeg * r * s * this.aimScale * noise1(t + 31.7);
    o.roll = this.k.rollDeg * r * s * noise1(t + 63.1);      // pivots on the crosshair
    o.x = this.k.offset * s * noise1(t + 97.3); o.y = this.k.offset * s * noise1(t + 131.9);
  }
}
```

### 2.3 Directional kicks

- Camera kicks oppose the firing direction [S13]; Celeste shakes along `dashDir` per dash [S6].
- **Quake III damage kick** [S11]: `damage × 40/health` clamped to **5–10°**; pitch `−kick·front`, roll `kick·left`; deflect **100 ms**, return **400 ms**, linear.
- **Doom 3** [S12]: quadratic decay; a **150 ms `IMPULSE_DELAY`** so pellets don't "obliterate the view"; recoil never shortens a damage kick.

**[rec]** Directional events are impulses on `CameraRig.kick` springs; noise is for undirected trauma only. Victim damage kick:

```ts
// victim only; 150 ms gate; deg = FEEL.kick(s) (0.6–5°); ×0.5 zoomed, ×1.3 at low HP
const front = toAttacker.dot(camFwd), right = toAttacker.dot(camRight);   // toAttacker: unit, horizontal
if (now - lastDamageKick > 150) { lastDamageKick = now; cam.kick(deg * front, 0, deg * right); }
// CameraRig signs: +pitch = view up (head snaps back); +roll = head tilts left (away from a right-side hit)
```

| Spring (Hz, ζ) | Peak | Undershoot | 5% settle | Use |
|---|---|---|---|---|
| CameraRig pitch today (5, 0.55) | 38 ms | 13% | 170 ms | too bouncy for recoil |
| **[rec]** (4.1–4.8, 0.8) | 36–41 ms | 1.5% | 125–145 ms | light shots, damage kicks |
| **[rec]** (2.9, 0.65) + rise 30 ms | 30 ms | 7% | 255 ms | heavy single shots |
| **[rec]** (2.2, 0.6) + rise 35 ms | 35 ms | 9.5% | 360 ms | charged releases |
| HL2 `ViewPunch` (1.28, 0.56) [S10] | ≈ 150 ms | 12% | ≈ 0.9 s **[calc]** | floaty today |

Impulse peak = `arccos ζ / (ω√(1−ζ²))`. "+ rise" uses the `Kick.hit(peak, rise, hang)` envelope (Springs.ts:117–138: outExpo rise, spring return). `CameraRig.kick` only exposes the impulse today (§12.3).

### 2.4 FOV punch, when not to shake, accessibility

- **FOV punch [rec]**: blasts +3–8°, rising in 30–50 ms, returning with τ 120–200 ms (`punch.hit(deg, 0.04)` on the 3.5 Hz, ζ 0.6 spring removes most in ≈ 140 ms). Focus pulse on heavy confirms −1.5 to −3°. Add after FOV smoothing (CameraRig.ts:126 does). Quake III lerps zoom over 150 ms [S11]; compensate FOV when dollying back [S14].
- **Don't shake for** your own small or automatic shots, ally abilities, events beyond ≈ 2.5× their radius, or ranged hits you deal (confirm pulse instead). Shake and kicks run on real dt, through hitstop.
- **Accessibility**: sliders for shake, head bob and FOV, a haptics level [S19], shake off [S14], a stable centre [S20]. GGG has none yet (§12.10).

---

## 3. Camera

- **Charge zoom**: `CameraRig.zoom` = −34° FOV, −45% distance, −20% shoulder, ×(1 − 0.55·zoom) sensitivity (CameraRig.ts:67, 97–105), but **nothing sets it** (§12.9). Exact sensitivity factor `tan(fov/2)/tan(base/2)` = 0.48 for 74°→40° **[calc]**. **[rec]** `smoothstep(charge)` over REX's 0.95 s; release in ≈ 120 ms.
- **Follow**: asymptotic averaging `x += (target − x)(1 − e^{−k·dt})` [S8]; GGG uses k 30 grounded, 26→17 in flight (CameraRig.ts:91), and speed adds ≤ +12° FOV and +0.8 m between 8 and 53 m/s (CameraRig.ts:96–100). **[rec]** grapple look-ahead `vel × 0.1 s`, cap 1.2 m, smoothed k ≈ 8 [S13].
- **Ults in PvP**: never take the caster's camera > 300 ms; use cut-ins plus +6° FOV, 2° roll; enemies get an audio cue and an edge cut-in [S23, S22].
- **Nausea**: speed FOV optional, ambient roll 0; interpolate follow vs fixed horizon on moving platforms [S21].
- Input beats auto-avoidance; thin occluders cut through; orbit like a satellite [S14]. Strike assist pulls hit enemies toward centre; off-screen threat arrows [S22].

---

## 4. Weapon feel for shooters

- **HL2 [S10]**: the .357 adds a permanent ±1° aim snap plus a visual `ViewPunch(−8°, ±2°)` (k 65, c 9: peaks ≈ 10° at 150 ms, settles ≈ 0.9 s **[calc]**); shotgun −1° to −2° pitch, ±2° yaw; `DoMachineGunKick` 0.2° + up to 1° (SMG1) or 8° (AR2) of sustained fire, yaw = pitch/3, roll = pitch/8. Splinter Cell: learnable recoil patterns; a reticle smaller than the spread "lies" [S25].
- **[rec]** Deterministic aim, visual-only kick, recovery at 3.2–4.8 Hz with ζ 0.7–0.85 (150–250 ms). GGG's weapon pose kick already works this way (§12.4); the camera kick lacks only callers.
- **Rhythm**: Halo 3 went from 0.5 to 0.7 s between sniper shots without killing flow [S25]. Beat Shot fires every 143 ms (rexKit.ts:121) ≈ **16th notes at 104 BPM (144.2 ms) [calc]**. Never delay a shot onto the grid (up to 144 ms of lag); accent shots near the beat instead (§7).
- **Punch**: crack 0–15 ms + 40–150 Hz body + tail to 800 ms, "more bass", shells and smoke [S13]; the barrel stretches on the firing frame and snaps back [S23]. **[rec]** REX: 24 pooled neon "note" casings, 1.2 s, tick on landing.
- **Markers**: predict marker, sound and spark at once; gate **kill** feedback, medals and slow-mo on server confirmation [S35]. GGG markers: Match.ts:426–430.
- **Damage numbers [rec]**: pop 1.4→1.0× in 80 ms; rise 0.8 m over 600 ms; crits 1.5×, warm; merge stream damage within 300 ms.

---

## 5. Impact feedback layering

### 5.1 Timeline [rec]

| t (ms) | Attacker client | Victim client |
|---|---|---|
| −450 to −100 | Heavy wind-up + rising whoosh (PvP heavies 250–450 ms; PvE bosses 0.5–1.25 s [S31]) | reads the telegraph |
| **0** | SFX transient · flash (1 f white, 80–120 ms decay) · spark frame 0 · hold · marker · confirm pulse | (on arrival) flash, SFX, jitter, damage kick + trauma, rumble, direction vignette |
| 0 to N | pose held, 5–10% crawl · shake on real dt | jitter decays · chroma peaks at ≈ 30 ms |
| N | release blend · follow-through | flinch or launch (Doom 2016: twitch/stagger/stun tiers [S30]) |
| N to N+400 | trails, debris, SFX tail · springs settle | kick returns in 300–400 ms |
| +RTT | damage number settles · **kill confirm** | — |

### 5.2 Anticipation, impact, reaction

Skullgirls [S24]: frames go to key poses, smears and overshoot; cutting one frame made a light crisper, and a super went 45 → 29 f with no loss. **Timing** is the core of punch [S33]. Budgets: body-animation.md §2.7, vfx-design.md.

### 5.3 Impact frames and post effects [rec]

**Impact frames**: two rendered frames, (A) a two-tone silhouette and (B) its inverse, with radial lines from the contact. T4 only (kills, perfect beam, ult finisher), ≤ 1 per 600 ms, each phase ≥ 1/60 s so 144 Hz screens show both. It is the Persona 5 / True Damage look; Guilty Gear Xrd reads 2D through *limited animation* [S29]. Fold it into `PersonaFXShader` (PostFX.ts) instead of adding a pass (chain: Render → Bloom → PersonaFX → Output → FXAA, Engine.ts:46–55).

```glsl
// PostFX.ts fragment (proposed), after the grade, before the vignette.
// uniforms: float uImpact, uImpactMode; vec2 uImpactC (contact, UV); vec3 uInk, uPaper
if (uImpact > 0.0) {
  float li = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 a = mix(uInk, uPaper, step(0.42, li)), b = mix(uPaper, uInk, step(0.42, li));  // A two-tone, B inverted
  vec2 d = vUv - uImpactC;
  float ray = step(0.8, fract(sin(floor(atan(d.y, d.x) * 36.0) * 91.7) * 4375.5)) * smoothstep(0.12, 0.6, length(d));
  col = mix(col, mix(mix(a, b, uImpactMode), uInk, ray * 0.85), uImpact);
}
```

Trigger: refuse when disabled, when "reduce flashing" is on (pulse the vignette instead) or < 600 ms after the last one. Otherwise set `uImpactC` to the contact's `(ndc + 1)/2`, show `uImpact = 1, uImpactMode = 0` for ≥ 1/60 s of real time, then `uImpactMode = 1` for ≥ 1/60 s, then `uImpact = 0`. Tick with real dt before `engine.render()`.

**WCAG 2.3.1 [S15]**: ≤ **3 general flashes/s** unless the flashing area is ≤ 25% of any 10° visual field (≈ 341×256 px at 1024×768). A flash = a pair of opposing relative-luminance changes ≥ 10% with the darker state < 0.80. Saturated red has a stricter "red flash" rule (GGG's damage vignette is saturated red, PostFX.ts:107). Rule of thumb: *fast → dark, bright → slow* [S20].

| Effect | Settings | GGG hook |
|---|---|---|
| Chromatic aberration pulse | 0.3–1.2% of screen width, 30 ms attack, 150 ms decay (T3+) | impact term in `ca` (PostFX.ts:61) |
| Radial blur | 0.1–0.25 for 100 ms (beam release) | new PersonaFX term |
| Speed lines | grapple > 35 m/s, or 80 ms burst on T4 | `uSpeed` (Match.ts:751–752) |
| Damage vignette | toward the attacker, 400–600 ms | `uDamage`, radial today (PostFX.ts:107) |
| Screen flash | ≤ 0.15 white mix, ≤ 3/s | `uFlash` (§12.7) |

### 5.4 One strength scalar → every layer

One tuning table, per-move overrides allowed, evaluated on the contact frame:

```ts
const knots = (k: [number, number][]) => (s: number) => {
  for (let i = 1; i < k.length; i++) if (s <= k[i][0]) return THREE.MathUtils.mapLinear(s, k[i - 1][0], k[i][0], k[i - 1][1], k[i][1]);
  return k[k.length - 1][1];
};
export const FEEL = {
  atkMs:  knots([[0, 0], [0.2, 0], [0.35, 50], [0.6, 83], [0.95, 133], [1, 200]]),   // melee only
  vicMs:  knots([[0, 0], [0.2, 17], [0.35, 50], [0.6, 100], [0.95, 150], [1, 200]]),
  jitter: knots([[0, 0.01], [0.6, 0.04], [1, 0.08]]),           // m, × clamp(camDist/6, 1, 3)
  trauma: knots([[0, 0.03], [0.35, 0.12], [0.6, 0.22], [1, 0.5]]),
  kick:   knots([[0, 0.6], [0.6, 2.5], [1, 5]]),                // victim damage kick, deg
  fov:    knots([[0, 0], [0.55, 0], [0.6, 2.5], [1, 6]]),        // deg
  flash:  knots([[0, 0.5], [0.6, 0.8], [1, 1]]),                // victim model flash
  gainDb: knots([[0, -6], [0.6, -2], [1, 0]]),
  rumble: knots([[0, 0.1], [0.6, 0.45], [1, 0.9]]),
};
```

Routing (kill ⇒ `s = max(s, 0.95)`; `stream` ⇒ no freeze; `ranged` ⇒ attacker freeze 0; the spark holds frame 0 for `vicMs`):

| Layer | Attacker (local) | Victim (local) | Observer |
|---|---|---|---|
| Freeze | `atkMs`, crawl 0.08, 120 ms cooldown | `vicMs`, `jitter` on ground/air axis | ½ or none |
| SFX | 2D `tick`/`dink`, `gainDb`, ±50 cents | positional `hit`/`hitHeavy` (s ≥ 0.6) | positional |
| Model flash | victim, `flash`, 1 f | own model, not for streams (§12.6) | victim |
| Marker | `kill` only when confirmed · `crit` · `hit` | — | — |
| Camera | focus `−0.4·fov` if s ≥ 0.6; melee only: trauma `0.6·trauma`, cap 0.6 | kick `kick` (150 ms gate); trauma `trauma`, cap 0.7; FOV `+fov` if s ≥ 0.6 | trauma `0.5·trauma·max(0, 1 − d/25)²`, cap 0.4 |
| Rumble | — | `rumble`, weak motor 0.6×, 80 + 200·s ms | — |
| Impact frame | T4 kill, confirmed | T4 kill, confirmed | never |

---

## 6. Time manipulation

Global slow-mo is impossible with client-simulated characters: local slow-mo shows stale positions and delays your own control. Allowed **[rec]**:

| Effect | Applies to | Curve |
|---|---|---|
| Hitstop | the two fighters' displayed pose (§1.5) | §1.3 |
| Kill spotlight | **only the dying victim** (death pose, VFX) + kill sparks, on killer's and victim's screens | to 0.25× in 30 ms, hold 350 ms, out over 150 ms |
| Ult activation | overlay and caster VFX; world stays live | ≤ 300 ms |
| Match-end final kill | global (play is over) | 0.2× for 1–1.5 s + zoom |
| Kill cam | everything | free |

Sakurai slows the death animation [S2]; Celeste skips its freeze when already slowed, so effects never stack [S6]. In GGG scale only the dt fed to the victim's `anim.update` and VFX. **Fuori Tempo** (Match.ts:692–696, half-speed sim for an off-beat fighter) is a *gameplay* rule; leave it alone. three r186 deprecates `Clock` [S32]: use `THREE.Timer` for new timers.

---

## 7. Audio-visual sync

- **Thresholds** (ITU-R BT.1359 [S17]): leading audio is noticed beyond ≈ 45 ms, lagging beyond ≈ 125 ms; acceptable ≈ +90/−185 ms. Late is natural, early is not.
- **Web Audio** [S16]: `baseLatency` ≈ 5.8 ms (two 128-frame quanta at 44.1 kHz); `outputLatency` device-dependent, ≈ 10–40 ms desktop, ≥ 150 ms Bluetooth [bg]; `getOutputTimestamp()` maps the context clock to `performance.now()`.
- **104 BPM grid [calc]**: beat 577 ms (34.6 f) · 8th 288 ms · 16th 144 ms (8.7 f) · 16th triplet 96 ms (5.8 f) · bar 2.31 s. GGG swings 16ths 1.08/0.92 (Audio.ts:564): 156/133 ms.

**[rec]**
- Fire SFX in the same step as the visual contact; GGG schedules at `currentTime + 5 ms` (Audio.ts:101), fine.
- Schedule *predictable* events exactly on the audio clock (beat-quantised launches, timed releases).
- `Beat` fires visuals when `ctx.currentTime` reaches a kick (Audio.ts:38, Beat.ts:48–60), ≈ `outputLatency + baseLatency` **before** it is heard. Compare against `ctx.currentTime − ctx.outputLatency − ctx.baseLatency`, or project with `getOutputTimestamp()`.
- Layer transient (0–15 ms) + body (15–150 ms) + tail (150–800 ms); ±40–60 cents and ±1.5 dB per play; 3–5 round-robin variants; step combo pitch, reset after 60 f [S7]; mix the enemy damaging you loudest [S23]; derive shake from SFX envelopes [S12].

**Hi-Fi Rush [S18]**: authored at 120 BPM, 15 frames per beat (30 fps), keys and footfalls on beats; **impacts land on the beat whatever the input timing** (off-beat inputs change playback speed); on-beat adds damage/SFX/VFX/rumble, off-beat is never punished; latency calibration option.

**PvP adaptation [rec]**: never delay the *resolution* of an input (a beat is 577 ms); quantise only cosmetic layers and the *spacing* of non-aimed sequences (REX's ult missiles); inputs within ±60 ms of an 8th get accent layers; reactive music layers grow with combos [S34]. Beat-authored clips (`beats: true`) are phased so t = 1 lands on the next beat (FighterAnimator.ts:150–153) and inherit any error in `Beat.beats` (§12.11).

---

## 8. Responsiveness

- ≤ 100 ms input → response reads as immediate [bg]; reaction ≈ 300 ms [S30]. Frame-time variance is the top latency priority (Call of Duty); Valorant: 128-tick, ≈ 100 ms peeker's advantage at 60 Hz [S26].
- **[rec]** Act in the same rAF frame as the input; Pointer Lock with raw deltas; ≤ 2 f input-to-photon; never wait for the server to show your own action.
- **Forgiveness** [S27]: buffer early inputs 100–150 ms (6–9 f); 100 ms coyote time for jump and grapple (Celeste 0.1 s [S6]); *cable stretching* (grapple latches slightly beyond range); benefit of the doubt; sphere-cast thin projectiles.
- **Commitment [rec]**: commit heavy wind-ups so they read; dodge-cancel after active frames; skill-cancel on confirmed hits only; short return-to-idle.

---

## 9. Over-juicing pitfalls

- **Readability**: PvP explosions must not blind opponents, nor your muzzle flash you [S33]; silhouettes first, backgrounds darker than characters [S29].
- **Consistency and fairness**: same tier, same feedback; cap stacking; allies never shake you; shake never moves the true aim; hitstop never slows the sim; kills need server confirmation.
- **Flashing** ≤ 3/s; **performance**: frame drops kill feel, pool particles [S28]; **audio**: prioritise threats [S23], merge rapid ticks (Audio.ts:77–81, Match.ts:428).

---

## 10. QA

Method: `scripts/capture.mjs scenario` (virtual clock); `lab.eval(ctx => …)` reads `match`/`local`/`dummy` state; film the contact at `every: 1`. Add a `?feel` panel (layer toggles, time scale, frame step [S7]). Test at 120 ms RTT, ±30 ms jitter, 2% loss.

1. The contact frame shows flash, spark, marker and hold together; SFX never early, ≤ 2 f late (240 fps capture).
2. Positions, cooldowns, projectiles and clip events are identical with hitstop on/off over 10 s.
3. Attacker re-syncs ≤ 200 ms after a hold with no pop; the victim hitbox never moves during jitter.
4. Ranged hits hold the victim only; streams nothing; 12 back-to-back ult missiles never freeze continuously.
5. With roll + translation only, the reticle stays on a 30 m target at trauma 1.
6. Shake smooth at 0.1× and identical at 30/60/144 fps (`Kick` sub-steps at 240 Hz, Springs.ts:139–160).
7. FOV returns exactly to rest after 1,000 punches.
8. Beat Shot: no screen shake, kick settled ≤ 250 ms after a burst; ≤ 1 damage kick per 150 ms.
9. Impact frames ≤ 1 per 600 ms; a PEAT/WCAG scan of a 60 s brawl passes; every slider at 0 disables its layer.
10. Kill feedback only on server confirmation; knockback delay ≤ `vicMs`, clients agree after a launch.
11. Beat pulses match the *heard* kick; no two consecutive SFX are bit-identical.
12. Cut-ins never cover the crosshair; enemy ults are announced by sound within 100 ms; markers differ by shape under a colour-blind filter.
13. Ten minutes of max-speed grappling gives 3 sensitive testers no nausea; blind testers pick the heavier hit > 80%; no frame > 33 ms on a T3/T4 hit.

---

## 11. Applying this to REX [rec]

REX: 900 HP (shared/champions.ts:121); Lead Single = LMB (`sig`), Beat Shot = RMB (`atk`, a `stream`), Bass Charge = C, Sub Bomb = F, Drop The Beat = R. Springs in (Hz, ζ).

| Event | Attacker (local) | Victim |
|---|---|---|
| **Beat Shot** fire (46, head 69, 7/s) | weapon kick 3.2–4.4°, 3.5 cm, alternating roll, body 0.35 (today, rexKit.ts:157) · camera +0.4° pitch (+0.8° at full bloom), ±0.15° yaw, (4.8, 0.8) · **no shake** · muzzle 1 f full + 1 f 50% · barrel stretch/snap · casing · ±50 cents · ±60 ms of an 8th → accent | — |
| Beat Shot hit | `tick`, 1 f model flash; head: `dink` + crit marker; **no freeze** (stream) | kick 0.6–1° (gated) · trauma +0.03, cap 0.25 |
| **Lead Single** fire (`fire` at F(6), rex.ts:496) | weapon kick 16°, (3.6, 0.62), rise 30/hang 65 ms (today) · **camera pitch 4.5°**, yaw ±0.8°, (2.9, 0.65) + rise 30 ms · FOV +4° · own trauma 0.08 roll-only (today `m.shake(0.2)`, rexKit.ts:192) · 2 f flash, smoke, 100 ms tracer · casing "thunk" +400 ms | — |
| Lead Single hit (125, head 188) | refund chime + ring (rexKit.ts:171) · head: focus −2° | hold 83 ms, head 133 ms · kick 3–4° (100/350 ms) · trauma 0.3 · chroma 120 ms |
| **Bass Charge** hold (0.95 s, perfect 0.18 s) | `smoothstep` zoom to −34° (`cam.zoom`, unused) · rising tone · vignette 0→20% · closing reticle ring · perfect: flash + `perfectTick` (rexKit.ts:100) · overcharge wobble (rexKit.ts:222–229) + crackle | — |
| Bass Charge release (270 / 300) | FOV +8° (rise 50 ms) · camera pitch 6° (perfect 8°), (2.2, 0.6) + rise 35 ms · radial blur 100 ms · weapon kick 9 + 8k° ≤ 20°, (2.9, 0.62), rise 35/hang 85 ms (today, rexKit.ts:254) · zoom out ≈ 120 ms · `m.shake(0.35·fxK)` (rexKit.ts:256) → ≤ 0.1 roll-only | per victim hold 133 ms (perfect 200) · `chord` +1 semitone per extra victim · kick 5° · trauma 0.45 · chroma · 300 ms low-pass · perfect kill → impact frame |
| **Sub Bomb** (140, r 4.6 m) | whoosh · bounce squash 0.7/1.3 for 60 ms + elastic 600 ms + rising note · beat-pulsing 4.6 m ring, faster in the last 300 ms · 2+ hits: stinger | 1 f local flash · trauma `0.6·(1 − d/11.5)²` (today 0.25 linear to 40 m, Projectiles.ts:409) · 100 ms hold in radius · 6 s scorch |
| **Drop The Beat** (12 × 52) | cut-in (enemy: edge) · FOV +6°, roll 2°, 0.5 m pull-back over 300 ms · launches on **16th-note triplets (96 ms)** up the chord (today 90 ms, rexKit.ts:296) · music −6 dB · no attacker hold | per note 2 f hold (120 ms cooldown) · trauma +0.08, cap 0.5 · gated kick |
| **Getting hit** | — | directional kick 0.6–5° · edge vignette toward the attacker (`hud.damageFrom`, Match.ts:530) · low HP ×1.3 + heartbeat · zoomed ×0.5 |

**Melee kits**: greatsword lights 67–83 ms, heavy 117–133, finisher 167–200 · katanas 33–50 ms, string ender 100 · claws 33 ms per hit, finisher 117. Shared: attacker crawl 8%; shake 0 lights, 0.2–0.35 heavies, kills 0.5 + focus −3°; afterimages hold in the freeze; blocks freeze both 50 ms; 250–450 ms wind-ups with an audio pre-cue.

---

## 12. Engine notes & gotchas

State after the REX pass (the items marked FIXED changed in that pass; the rest is still open).

**12.1 Hitstop slows the whole local simulation.** `Match.hitStop(sec)` takes `max()` (Match.ts:412–414); `update` then runs `simDt = dt·0.06` (649–655) for match time, bots, every fighter's physics, animator and clip events (696), projectiles (722), VFX (741) and arena; only the camera (726), clock, post-FX and HUD use real dt. Triggers: `hitFeedback` for the **local attacker only** (Match.ts:433–440: ult 120 ms, momentum 60 + 70·mk, counter 100, non-`atk` or crit 60, melee basic 45, streams none); `applyParry` 150 ms (565); perfect dodge 120 ms, practice (355); Kaiser 50/100 ms (kaiserKit.ts:216, 382); Pooh 60 ms (poohKit.ts:488). Consequences:
- Online, the attacker slows its own simulated character vs the server (predicted hit, Match.ts:264), while **the victim's client never freezes** (server `dmg` → `applyDamage`, OnlineSession.ts:301, has no `hitStop`).
- **Parries are broadcast to all clients** (server/Room.ts:431 → OnlineSession.ts:320): any parry slows *every* player's world 150 ms.
- In practice, bot hits on you never freeze (Match.ts:521–522). Ranged skill hits freeze the attacker's world, the reverse of rule 4.
- The stop freezes **effects** too: everything emitted on the hit frame is held for it. REX's Lead
  Single held a tier-5 star and 17 sparks in one spot for 4 extra frames, a white ball over the
  target in the shooter's view. Design impact frames to read frozen: small and sharp on the line of
  fire (`lineView`: star ×0.5 at tier 4, glow −70 %), sparks spawned already spread (0.12 m out
  along their direction), no soft glow blobs at full strength.
- **FIXED (chaining)**: `hitStop` no longer chains: right after a stop only a stronger one may start (cool-down = stop + 0.2 s real time). REX's 12 ult notes no longer keep the world in slow motion (3-4 short stops per barrage).
- **Still open**: `simDt = dt`; per-fighter pose holds (§1.5) with cooldowns; parry holds only on the two fighters involved. Until then keep hitstops short. `hitReact` now shows 55 % of the flinch on its first frame, so the victim holds an impact pose through a stop.

**12.2 Shake.** `addTrauma` adds, cap 1 (CameraRig.ts:47–49); trauma², decay 1.6/s, 3-sine noise (115–121, 136–138); ±3.4° yaw/pitch, ±4.6° roll at 1 (128). `Match.shake(amount, at)` fades linearly to 0 at 40 m (Match.ts:406–410). Sources: local victim `min(0.6, 0.15 + dmg/300)` (Match.ts:529), momentum 0.15 + 0.3·mk (442), explosions 0.25 (Projectiles.ts:409), landings `min(0.5, impact/60)` (Fighter.ts:510), REX slug 0.2 and Bass Charge 0.35–0.49 (rexKit.ts:192, 256), kits up to 0.9 (kaiserKit.ts:381). Missing: aimScale, roll-dominant split, gradient noise, per-event rate, user scale.

**12.3 Camera kick and FOV punch.** `CameraRig.kick(pitch, yaw, roll)` → `Kick` pitch (5, 0.55), yaw (5, 0.5), roll (4, 0.45); `punchFov(deg)` → `Kick(3.5, 0.6)` after FOV smoothing. Kits call them through **`m.cameraKick(f, pitch, yaw, roll, fov)`** (MatchContext), applied only when `f` is the local fighter. REX uses it (Beat Shot 0.35°, Lead Single 1.6° + FOV −3, Bass Charge release 2.2–4.4° + FOV −4 / perfect −6, ult notes 0.3°). Still impulse-only on the camera side (the weapon `Kick` has `rise`/`hang`); retune toward ζ 0.75–0.8 if kicks ever stack.

**12.4 Weapon kick (working).** `FighterAnimator.kick(KickSpec)` (FighterAnimator.ts:267–282); defaults pitch (6.5, 0.55), back (8.5, 0.6), roll (5.5, 0.4), yaw (6, 0.5) (line 40); `freq` rescales all four; `rise`/`hang` = heavy envelope (Springs.ts:117–138); hinged at the weapon's `stock` marker or `stockZ` (141, 292–299); `body` sets torso/hip absorption (305–365). `ClipEvent.kick` (Animator.ts:352) fires on every copy of a clip (FighterAnimator.ts:196–198). REX values: §11.

**12.5 Flinch.** `hitReact(pushX, pushZ, strength)` (FighterAnimator.ts:175–183, 386–424): 50 ms snap, `e^{−7.5t}·cos 9t` return over 0.7 s, 50% carry within 150 ms, knees buckle above 0.7; strength `clamp(dmg/110, 0.35, 1.3)`, ×1.2 crit (Match.ts:506). `playFlinch(name)` plays authored clips (185–188).

**12.6 Model hit flash.** `hitFlash = 0.12` s → emissive 75% white, linear fade, decaying with sim dt, so it stretches in a hitstop. **FIXED (rate)**: a full flash at most every 0.33 s per fighter (`flashAt`); rapid hits in between flash at 35 % (`flashK`), so Beat Shot no longer strobes a model 7×/s.

**12.7 Screen flash and damage vignette.** `Match.flash` decays 3/s → `uFlash = flash·0.5`, full-screen white (Match.ts:756–757, PostFX.ts:109), from perfect dodge 0.3, momentum `0.25·mk`, ult cut-in 0.2, parry 0.2 (Match.ts:356, 443, 402, 568). **No rate limiter.** `damageFlash += 0.25 + dmg/600` (cap 0.6, decay 1.8/s) + a low-HP term → `uDamage ≤ 0.75` (Match.ts:528, 753–754), radial red, not directional (PostFX.ts:107).

**12.8 Post and bloom.** Chroma = `(0.0005 + 0.003·uSpeed + 0.005·uDamage)·r²·4` (PostFX.ts:61), no hit pulse; speed lines follow local speed only (Match.ts:751–752); no impact frame or radial blur. Bloom `UnrealBloomPass(512², 0.42, 0.32, 1.45)`, `NoToneMapping` (Engine.ts:42, 49), off on `low` (Engine.ts:20): contacts must read without bloom.

**12.9 Charge zoom.** `CameraRig.zoom` (CameraRig.ts:27, 67, 97–105) is never set: Bass Charge has no zoom.

**12.10 Settings.** Only sensitivity, invertY, quality, base `fov` 74, volumes, bindings (Settings.ts:5–23). No shake/flash/kick/FOV-effect scales, no reduce-flashing.

**12.11 Beat clock.** `kick` decays `e^{−7.5t}` (half-life 92 ms), `snare` `e^{−9t}` (77 ms), `pulse = max(kick, 0.85·snare)`. Events fire on `ctx.currentTime`, so visuals lead the heard audio by the output latency; without music for 1.2 s a free-running 104 BPM groove takes over. Each kick re-phases `beats` onto **its position in the bar** (`Beat.push(t, snare, s / 4)`; FIXED: the first version snapped off-beat kicks to the nearest whole beat, jumping 0.23 beat early once per bar).

**12.12 Audio.** SFX at `currentTime + 5 ms` (Audio.ts:101); same-name throttle 25 ms (77–81); gain `1/(1 + 0.045·d)`, pan ×0.7 (84–90); `hit` vs `hitHeavy` by `amount > 120` (Match.ts:515); no per-play variation or round-robin. Music 104 BPM (menu 92), 120 ms look-ahead, 25 ms timer (Audio.ts:548, 558–561).

**12.13 Clocks.** rAF timestamps, dt ≤ 0.1 s (App.ts:399–402); `Match` clamps to 50 ms (Match.ts:641). `capture.mjs` virtualises `performance.now`, rAF and `Math.random`: wall-clock timers reproduce in captures.

**12.14 Missing, by priority**: presentation-only holds (victim-only for ranged); the damage kick on the victim's camera; aim-safe shake; a screen-flash limiter and accessibility scales (shake / flash / FOV effects); impact frames, chroma pulse; victim slow-mo; SFX variation; output-latency compensation in `Beat`.

---

## Sources

Code and specs read in full on GitHub; GDC talks (gdcvault.com/play/<id>) via transcript summaries; the rest via search extracts.

- [S1] SmashWiki, *Hitlag*, *Projectile* (ssbwiki.com); Kurogane Hammer, Smash 4 formulas.
- [S2] Sakurai: Famitsu col. 490 (sourcegaming.info); hit-stop techniques (nintendowire.com); *Stop for Big Moments!*
- [S3] Dustloop, GGST Frame Data / Mechanics.
- [S4] SuperCombo, SF6 Ed frame data.
- [S5] MUGEN KFM `kfm.cns` (Ikemen GO screenpack).
- [S6] Celeste `Player.cs` (NoelFB/Celeste).
- [S7] Juicy Breakout `Freezer.as`, `Shaker.as`, `Settings.as`, `Block.as` (grapefrukt/juicy-breakout).
- [S8] Eiserloh, *Juicing Your Cameras With Math*, GDC 2016 (1023557).
- [S9] Bevy `2d_screen_shake.rs`; rbfx `ShakeComponent`.
- [S10] Source SDK 2013: `view_effects.cpp`, `baseplayer_shared.cpp`, `weapon_357/shotgun/smg1/ar2.cpp`.
- [S11] Quake III Arena `cg_view.c`, `cg_playerstate.c`.
- [S12] Doom 3 `PlayerView.cpp`.
- [S13] Vlambeer (J. W. Nijman), *The Art of Screenshake*, talk notes.
- [S14] Nesky, *50 Camera Mistakes*, GDC (1020460).
- [S15] W3C WCAG: flash thresholds; Understanding SC 2.3.1.
- [S16] W3C Web Audio API spec.
- [S17] ITU-R BT.1359 via a secondary note (45ck/content-machine RQ-32).
- [S18] Hi-Fi Rush: CEDEC 2023 reports (GameSpark, 4Gamer); *Developing Hi-Fi RUSH Backwards*, GDC (1034256).
- [S19] K. Stevens, *Sensory Overload*, GDC (1029306).
- [S20] S. Robinson, feedback and visual-literacy talks, GDC (1034978, 1035337).
- [S21] Uncharted 3 cameras; Tomb Raider camera, GDC (1015514, 1017725).
- [S22] God of War (2018) combat and cinematography talks, GDC (1026085, 1025986).
- [S23] Overwatch: *Play by Sound*, *First Person Animation*, GDC (1023317, 1024319).
- [S24] M. Cartwright (Skullgirls), frame-restriction talks, GDC (1020575, 1027466).
- [S25] Halo 3 sniper; Splinter Cell gunplay, GDC (1012211, 1020354).
- [S26] Call of Duty latency, GDC (1025968, 1026833); Riot, *Peeking into VALORANT's Netcode*.
- [S27] S. Coster, *Forgiveness Mechanics*; TLOU2 ranged combat, GDC (1026606, 1034215).
- [S28] Mortal Kombat rollback; Marvel Rivals destruction, GDC (1025021, 1035260).
- [S29] Guilty Gear Xrd art style; Street Fighter V art direction, GDC (1022031, 1024558).
- [S30] DOOM combat; Dreamscaper; Ghost of Tsushima melee, GDC (1024940, 1027785, 1027194).
- [S31] Insomniac Spider-Man animation; Spider-Man 2 bosses, GDC (1025971, 1034367).
- [S32] three.js `Timer.js`, `Clock.js` (r183+ deprecation).
- [S33] *VFX as a Game Design Language*; *Zip! Thwack! Ping!*, GDC (1027899, 1025301).
- [S34] *Harmony* tempo-slaying, GDC (1029170).
- [S35] Sea of Thieves forum, server-side hit detection thread.
- [bg] Unverified: Swink, *Game Feel* (2008); Apex recoil; Doom Eternal GDC; Bluetooth latency.
