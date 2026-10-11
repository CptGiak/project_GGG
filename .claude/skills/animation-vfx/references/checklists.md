# Final review checklists

Use this file at the end of a pass, before showing anything: tick every line or write down why it
does not apply. Each block lists the checks that catch most problems, with the tool that proves
them; the full lists live in the domain references (body-animation.md §12, secondary-motion.md
§11.3, vfx-design.md §12, game-feel.md §10). Review at 1×, 0.25× and frame by frame, through the
gameplay camera as well as the lab cameras.

## A. Body (anim_report + filmstrips)

- [ ] Every key pose reads as a silhouette over the shoulder at 10 / 25 / 40 m; weapon and arms
      outside the torso outline at the gameplay-critical keys.
- [ ] Input → first visible change ≤ 2 f; gameplay events fire on the authored frame; the limbs
      that carry an event are at the event pose on that frame (`lag` ≤ 1 f on them).
- [ ] Startup within the frame budget (body-animation.md §2.7); recovery 1.5-3× startup and
      cancelable late; every action ends in an overshoot-and-settle (3-8 %).
- [ ] Ease named on every key; nothing stops at a passing key; extremes held 4-10 f as moving holds.
- [ ] anim_report clean: weapon miss 0, off-hand slip 0, stock gap < 0.02 m (also through kicks),
      ankle y = footHeight ± 5 mm planted, foot slide < 0.01 m, no locked elbows/knees (except a
      throw's release), **elbow bend plane ≤ 45°/f**, **wrist-shoulder ≥ 0.35** of reach,
      head-gun > 0.14 m, no angular spike > 900 °/s outside impact frames and snaps.
- [ ] Recoil rises in 1-2 f, hangs (heavy) 2-6 f, returns ≥ 3× slower than it rose, reaches chest
      and head; the stock never leaves the shoulder.
- [ ] Charge-ups: compression accelerates (inQuad), tremble ramps, stillness at "perfect", the
      biggest kick on release (a release clip).
- [ ] No twinning (L/R differ ≥ 8°, 1-3 f); head, chest and off-hand lag the driver on big actions.
- [ ] Transitions: no pops at action start / stop / cancel (inertialization on); fast clips use a
      short `inertia`; no transition passes through the rest pose.
- [ ] Beat clips land on the beat (≤ 30 ms); taunt timers converted from beats.
- [ ] Remote copies: the clip starts 2 f before its first event and the event (and kick) still fires.
- [ ] Kit layers reset on release / cancel / stun / death (`tremble` 0, cues 0, decals killed).

## B. Secondary motion (`tools/sm_report.ts` + filmstrips)

- [ ] Idle: no jitter, rest deviation < 5° (unless sag is intended), no anchor inside its colliders.
- [ ] Run, stop, spin, 30 m/s, a fall at 26 m/s², a 5 m blink, a 50 m teleport: no streaming flat,
      no prop pinned on its cone, no flip-up in jumps, no explosion after blinks.
- [ ] Same result at 30, 60 and 144 fps (relative chains and springs use `SubstepClock`).
- [ ] Chain stretch < 3 % in normal motion (≤ 8 % on instant stops: the engine caps it); roots never
      detach; a blink or teleport leaves every item at its idle numbers.
- [ ] Props settle after the body (hair 0.5-1 s, pendants a little longer); recoil wobbles settle
      within 0.3 s.

## C. VFX (in-match scenario, every frame around the climax)

- [ ] Gameplay layer honest: beam width = hit width, telegraph at the exact radius, timing real.
- [ ] Flavour-off pass: radius, timing and direction still read.
- [ ] Climax 1-3 f, the brightest and biggest moment; outro dimmer and longer; nothing pops.
- [ ] Value hierarchy: thin hot core (tier ≥ 2), mid layers under the threshold (tier ≤ 0.9,
      channels ≤ ~1), dark edge / ink where it sits on bright backgrounds; no white mush (no large
      area above tier 1 for more than 3 f, except ults).
- [ ] Direction reads on a paused frame (bright sharp head, soft dim tail).
- [ ] One impact system per hit (the kit's `fx.hit` / `ownsHitFx`, not also the stock spark).
- [ ] Friend vs foe reads from rim and shape (threat colours for enemy telegraphs), not hue alone.
- [ ] Your own effects never cover the crosshair (film each ability with the `game` camera: the
      target readable again ≤ 3 f after the impact frame; wide segments fade end-on, cast / face-on
      rings / target glow dimmed by `alongView`); the `target` camera still shows the incoming
      effect at full strength; projectiles ≥ 4 px wide at 20-40 m.
- [ ] Every effect also runs on remote copies (start events re-create timers; state in `n`).
- [ ] Weapon-attached billboards are excluded from the ult weapon hologram (`userData.noGhost`).

## D. Feel (game camera)

- [ ] One strength scalar per event; tiers consistent (game-feel.md §1.3).
- [ ] Own light shots: no screen shake, a sub-degree view kick; heavy: view kick + FOV punch.
- [ ] Hitstops short, never chained; the victim shows an impact pose during the stop.
- [ ] Flashes: full model flash ≤ ~3/s; impact frames ≤ 1 per 600 ms (WCAG).
- [ ] Sounds land on the contact frame (never early, ≤ 2 f late); beat-synced visuals follow the
      heard beat.

## E. Performance

- [ ] VFX draw calls ≤ 40 (instanced pools: particles, `seg`, `decals`); ≤ 3000 particles.
- [ ] Zero per-frame allocations in update paths (module-level temps, reused spec objects; per-event
      closures are fine).
- [ ] Ring pool (24) not exhausted by a single ability (ripples every ≥ 4 m).
- [ ] No first-cast hitch (shaders created at load, no light count changes).

## F. Process

- [ ] Baseline captured before the change; before/after sheets compared side by side.
- [ ] Shared engine code touched → regression table over every champion, every delta explained.
- [ ] `npx tsc --noEmit` clean; probes (`tools/_probe_*.ts`) deleted.
- [ ] Deliverables: GIFs, sheets, the numbers table, the list of engine changes and why.
