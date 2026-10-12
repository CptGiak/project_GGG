# <CHAMPION> · <ACTION> — animation / VFX / feel spec

Fill one per action before authoring. Numbers first; cite the reference section a default came
from. Gameplay facts are copied from the kit, never invented.

## 0. Gameplay facts (from `src/combat/kits/<id>Kit.ts`, `shared/champions.ts`)

| Fact | Value | Source |
|---|---|---|
| input → action | (press / hold / release) | |
| action lock (`startAction` duration) | s | |
| event times (spawn, hit, release) | s / frames @60 | |
| projectile speed, radius, life, gravity, bounces | | |
| hit radius / blast radius (VFX must match exactly) | m | |
| cooldown, charge times, windows | | |
| remote path (`playRemote` case, event fields a/p/d/t/n) | | |

## 1. Read (one line each)

- Silhouette at gameplay distance:
- Fantasy / personality (what this action says about the champion):
- Weight class (body-animation.md §4.3):

## 2. Phases @60 fps (body-animation.md §2.7)

| Phase | Frames | Key pose(s) | Ease into it | Notes (lag, holds, smears) |
|---|---|---|---|---|
| anticipation | | | | |
| action / release | | | | |
| impact / climax | | | | 1-3 f |
| follow-through (moving hold) | | | | 4-10 f |
| recovery | | | | 1.5-3× startup, cancelable from f… |

## 3. Contacts and IK

| Contact | Channel | Check (anim_report) |
|---|---|---|
| weapon in the right hand | `wR` (shouldered?) | weapon miss 0, stock gap < 0.02 |
| support hand | `off` / `wL` + elbow hint `e` | off-hand slip 0, bend plane ≤ 45°/f, wrist-shoulder ≥ 0.35 |
| planted feet | `fL` / `fR` (shared `feet`) | ankle y = footHeight, slide < 0.01 |

## 4. Procedural layers

| Layer | Spec |
|---|---|
| recoil `kick` | `{ pitch, back, roll, yaw, body, freq, zeta, rise, hang }` (engine-ggg.md §7) |
| tremble | deg / Hz over the hold |
| groove / beats | |
| inertialization | default / clip `inertia` |
| camera kick (local) | pitch / roll / FOV punch |

## 5. Secondary motion (secondary-motion.md §9)

| Part | Type (SpringBone / ClothChain / ClothSheet) | f (Hz) | ζ | other |
|---|---|---|---|---|

## 6. Weapon / prop detail (model `tick` + `cue`)

| Cue id | When (local + remote) | What moves / glows |
|---|---|---|

## 7. VFX layers (vfx-design.md: gameplay layer first)

| Layer | Primitive (`seg` / `decals` / particles / ring / model billboard) | Size (m) | Colour + tier (`bloomColor`) | Timing (frames) | Budget |
|---|---|---|---|---|---|
| gameplay (exact width / radius / timing) | | | | | |
| anticipation | | | | | |
| climax | | | | 1-3 f | |
| trail / body | | | | | |
| impact (tier light / heavy / crit) | | | | | |
| dissipation | | | | 5-15× rise | |

Enemy-view variant (threat colour) and ally/self variant:

## 8. Feel (game-feel.md)

| Event | Strength scalar | Shake (trauma) | Camera kick | FOV punch | Hitstop | Flash / impact frame | Sound |
|---|---|---|---|---|---|---|---|

## 9. Acceptance

- anim_report: (paste the clean numbers)
- Filmstrips / GIFs: (paths)
- Checklist (checklists.md): body / secondary / VFX / feel / performance all ticked
