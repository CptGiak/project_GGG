---
name: game-sfx
description: Design, synthesize, mix and verify video-game sound effects and adaptive game music written in code (Web Audio API, no sample files), at the level of a professional game audio team and never as generic "AI slop". Covers layered SFX (transient/body/tail/sub), variation and combo escalation, readability (hit confirms, threat cues, ducking, voice limits), spatial audio and per-arena reverb, champion sonic identities, anime/fighting-game hype (hitstop, sub drops, reverse swells), procedural instruments (Karplus-Strong guitars, brass, strings, choir, drums), composing catchy Dragon Ball / anisong-style battle themes in the project's score notation, and an offline render-and-measure loop so you can "hear" what you made. Use it whenever the task touches sound in any way: SFX, "suono", "effetti sonori", "audio", "rumori", "colpi", "esplosioni", "rampino", "musica", "colonna sonora", "OST", "tema di battaglia", "jingle", mixing, volumes, a sound that feels weak/cheap/repetitive, a new champion or ability that needs sounds, or src/core/Audio.ts and src/core/audio/ in this repo, even if the user does not say "sound design".
---

# Game SFX and score, synthesized in code

You are the whole audio team: sound designer, composer, mixer and QA. Everything is generated
by code at runtime (Web Audio nodes plus JS-rendered buffers), so two facts drive the method:

1. **You cannot hear.** You only know what you render and measure. Render offline, read the
   numbers and the spectrogram, fix, render again. Never stack changes blind, and give the
   user MP3s to listen to: their ears are the final judge.
2. **Cheap sounds come from shortcuts, not from synthesis.** One oscillator plus one noise burst,
   identical on every play, full-band, too loud or too quiet, out of key with the music: that is
   what reads as "AI slop". Every rule below exists to avoid one of those tells.

## Project map (read before touching audio)

```
src/core/Audio.ts            AudioEngine: category buses, safety limiter, play(name, pos?, vol?,
                             src?, arg?), impact(...) (one world hit per damage event),
                             confirm(...) (the local attacker's 2D feedback), distance curves,
                             air absorption, arena room, voice budgets, rate limits, ducking,
                             combo tracking, movement loops, music control
src/core/audio/mix.ts        THE MIX: categories (level, range, voices, bus EQ), REF_LUFS, the
                             dB slider curve and the default volumes
src/core/audio/trims.ts      GENERATED per-sound loudness trims (tools/audio/mix_trims.mjs)
src/core/audio/layers.ts     SfxDef/SfxCtx types and the layer vocabulary (thump, smack, click,
                             crunch, hiss, blip, whoosh, ring, bell, mallet, sub, swell, sparkle,
                             vox, zap, stab, boom, clack, flutter, blop) + champion signatures
src/core/audio/sfx.ts        shared catalogue (movement, generic combat, confirms, UI) merged
                             with the impacts and every kit
src/core/audio/impacts.ts    hit impacts per material and IMPACTS[champion]["slot.part"], the
                             confirms (hit, crit, counter, block, momentum, kill) and hurt
src/core/audio/kits/*.ts     each champion's ability sounds, named "<champion>.<sound>"
src/core/audio/graph.ts      live node helpers (tone, noiseBurst, fm, modal, drive, crush, echo);
                             `softAttack` (on for SFX): attacks up to 8 ms rise linearly
src/core/audio/dsp.ts        offline JS DSP (biquad, noise colours, Karplus-Strong, drive, decay)
src/core/audio/samples.ts    JS-rendered bank: drum kit with round-robin takes, double-tracked
                             guitars, bass
src/core/audio/reverb.ts     procedural impulse responses per arena (+ the score's hall)
src/core/audio/instruments.ts brass/strings/choir/timpani voices, the NoteCache that renders each
                             note once in a background OfflineAudioContext, the Band (mix strips)
src/core/audio/score.ts      score notation parser + validator, voice leading
src/core/audio/music.ts      adaptive sequencer: intensity gates, fills, climax, stingers, harmony
src/core/audio/songs/*.ts    the composed cues (menu, city, stage, tartarus, jingles)
src/core/audio/preview.ts    dev-only offline renders driven by scripts/render.mjs
tools/audio/mix_trims.mjs    loudness-normalises the catalogue (writes trims.ts, ~1 min for all)
tools/audio/check_sfx.ts     every played name exists, every damage part has an impact, no dead
                             or untrimmed sounds
tools/audio/check_songs.ts   score validator (bar lengths, ranges, clashes)
```

Game code calls `audio.play('<champion>.<sound>', pos)`. At the fighter's own `f.pos` the engine
knows who made the sound (`registerFighter`); anywhere else (a target point, a projectile, a
blink's arrival) pass the fighter too, `audio.play(name, at, 1, f)`, or the sound is credited to
whoever stands there. Damage never plays a sound from a kit: `Match` calls `audio.impact(...)`
(material from `IMPACTS`) and `audio.confirm(...)`. Unknown names are silent (the dev build warns
once in the console), so a new ability can call a new name first and you add the recipe after;
`npx tsx tools/audio/check_sfx.ts` lists them. Mixing (levels, defaults, fatigue, the measured history): [references/mixing.md](references/mixing.md).

## Workflow

1. **Intent first.** Write one line per sound: what gameplay fact it communicates, how often it
   plays, who must hear it (only you / everyone / enemies as a warning), and its rank in the mix
   (see the hierarchy below). A swing heard 3 times a second needs a different design than an
   ultimate heard once a minute.
2. **Design in layers** (one job and one frequency band per layer, each from a different
   generator). Pick from the layer helpers in `layers.ts`; read
   [references/synthesis.md](references/synthesis.md) for parameters when building new ones.
3. **Give it identity.** Tie pitched layers to the score (`chordHz(c.h, i, oct)` /
   `degHz`), add the champion's signature when it is their action, match the arena surface.
4. **Wire the metadata**: `cat` (mix category, see mix.ts), `lvl` (rank inside it, dB), `dur`
   (voice accounting), `max` (steal oldest beyond it), `gap` (rate limit per source), `vary`,
   `combo` window for escalation, `rev`, `duck` for big moments. Never set a level by ear in a
   recipe: run `node tools/audio/mix_trims.mjs <prefix>` to normalise its loudness.
5. **Render and measure** (below). Compare against neighbours, not in isolation, then check the
   whole mix in a recorded match (`scripts/capture.mjs` + `scripts/mixstats.py`).
6. **Check in the real game**: `npm run dev`, `?play&champ=X&arena=Y&bots=3`, and listen to the
   MP3s yourself via the user. Typecheck (`npx tsc --noEmit`) before committing.

## The listening loop

```bash
npx vite --port 5199 &   # the scripts reuse a dev server on 5199 (render.mjs starts one if none)
# per-sound loudness and timbre, dry (no trim, no bus)
node .claude/skills/game-sfx/scripts/render.mjs sfxDry '{"names":["rex.shot","hit.bullet"],"repeat":3}' /tmp/out/dry
python3 .claude/skills/game-sfx/scripts/sfxstats.py /tmp/out/dry
# normalise after editing recipes (all, or by name prefix)
node tools/audio/mix_trims.mjs rex. hit.
# as heard in the game: trims, category levels and EQ, the arena room ("name@champ#{json arg}")
node .claude/skills/game-sfx/scripts/render.mjs sfxSheet '{"names":["hit.blade#{\"w\":0.8}","confirm.hit"],"repeat":3,"arena":"stage"}' /tmp/out/hits
# the whole mix in a real bot match (60 s), then its loudness, balance and trigger rates
node .claude/skills/game-sfx/scripts/capture.mjs 'http://localhost:5199/?play&champ=rex&bots=5&diff=0.8' 60 /tmp/out/match
python3 .claude/skills/game-sfx/scripts/mixstats.py /tmp/out/match
# a stretch of a song (warm = orchestra notes pre-rendered like in the game; at = arrangement index)
node .claude/skills/game-sfx/scripts/render.mjs song '{"id":"city","seconds":30,"intensity":0.7,"warm":true,"at":3}' /tmp/out/city
npx tsx tools/audio/check_songs.ts
```

`render.mjs` runs `src/core/audio/preview.ts` in headless Chromium and writes `.wav`, `.png` (log
spectrogram: look at it with Read), `.mp3` (send it to the user) and `.json`. Read the numbers
like this:

| Measure | Healthy | Smell |
|---|---|---|
| Whole mix in combat (`mixstats.py`, default settings) | master about -18 LUFS integrated, limiter active < 10 % | louder: squashed and tiring; limiter always on: pumping |
| Music vs SFX in combat | SFX events 6-10 dB above the score (momentary) | music on top of the action, or SFX shouting over a buried score |
| Per sound (`sfxstats.py`) | `harsh` (2-5 kHz share) under about -10 dB on frequent sounds, `flat` < 0.15, `sub` < -10 dB except ult/big, `punch - lufsM` < ~9 dB | hiss (`air` > -8 dB), noise bodies (`flat` > 0.3), boom on small sounds |
| Variation between plays (`var`) | 0.3-1.5 dB, a few % pitch | 0: machine-gun repetition |
| Trigger density (`mixstats.py`) | under ~8 sounds/s within 25 m in a 6-player fight | everything audible from everywhere |
| Song band balance | most energy 60-250 Hz, below 60 Hz under about -8 dB | boom that laptop speakers cannot play |
| Render cost (`renderMs`/seconds) | under ~0.4x real time for 10-20 s windows here | live voices where the NoteCache should serve buffers (`misses`) |

## Principles that matter most (full version: [references/principles.md](references/principles.md))

- **Anatomy.** Transient (2-10 ms broadband click) + body (pitched or modal, 30-400 ms) + tail
  (room, debris, decay) + sub only on heavy events, with a saturated copy of the sub so small
  speakers still imply it. Line transients up for punch, stagger a few ms for a flam.
- **Scale with the gameplay.** Size the body and tail to the hitstop and damage: a jab must not
  sound like an uppercut. Heavier = lower punch pitch, longer tail, more sub, a short music duck.
- **Variation, never repeats.** Random pitch ±3-5 % (never beyond ±2 semitones), level
  ±1.5 dB, fresh noise grain, filter centre ±10 %. Round-robin takes for sampled drums.
- **Escalate combos.** Step only the tonal layer up a semitone per consecutive hit (`combo`
  window); keep transient and body stable; resolve the finisher bigger.
- **Readability over realism.** Own-player confirms are 2D and dry; the world is spatial.
  Enemies' ultimates get an extra threat cue. Cap voices per sound. Duck the music, and the busy
  categories a little, under the biggest moment; never let tails move the "loudness window".
- **One hit, one impact, one confirm.** Never stack sounds on a hit; crits, counters and momentum
  change the impact and the confirm. Rapid fire and ticks are rate-limited textures.
- **Frequent = gentle.** The more often a sound plays, the shorter, mid-focused (120 Hz-2 kHz) and
  quieter it must be; pink/brown band-limited noise only, sub only on ultimates and explosions.
- **Space sells it.** Distance = quieter + darker (air absorption) + wetter; behind the head =
  duller. One convolution room per arena that matches what you see (street slap-back, stadium,
  void).
- **Hype is contrast.** A breath in (reverse swell) or a beat of near silence before the big hit,
  a sub drop tuned to the key, the score answering with a stinger.
- **Tonal SFX live in the score's key.** Kill confirms, medals, UI, crits read the current chord.

## Anti-slop checklist (run it before you call a sound done)

- [ ] At least three layers from different generators; no layer is full-band.
- [ ] Every play is different (pitch, grain, filter), and repeats escalate where it means
      something.
- [ ] It has a mix category, was normalised (`mix_trims.mjs`), and its brightness and length fit
      how often it plays (frequent = short, mid-focused, no sub, no hiss).
- [ ] Pitched content follows the score's harmony (or is deliberately atonal).
- [ ] It has space: room send and distance cues for world sounds, dry for confirms.
- [ ] It says who did it (champion signature, weapon material) and what happened (hit vs block
      vs crit vs counter are instantly different).
- [ ] Timing matches the animation frame and the hitstop; no 2-frame lag.
- [ ] Voice cap, `dur` and (for rapid fire / ticks) `gap` set; no unbounded loops or node leaks
      (every source stops).
- [ ] A hit does not play from the kit: the damage part has an `IMPACTS` entry instead.

## Music in one paragraph (full version: [references/music.md](references/music.md))

Compose, don't loop. Write cues in the score notation (bars validated to 16 sixteenths), develop
one motif across every cue (here the "Ki motif" 1-5-b7-6-5), use real form (intro, A-melo,
B-melo, chorus/sabi, kime break, breakdown, riser, last chorus lifted a step), cadences that
power up (bVI-bVII-I), pedal points and Phrygian-dominant breakdowns for villain colour,
counter-melodies separated by rhythm and register, and a climax arrangement for the final
minute. Validate with `check_songs.ts`, render, and give the user MP3s.

## Performance rules

- Pre-render anything that does not need per-play parameters: drums, guitars, orchestra notes
  (NoteCache). Live graphs only for SFX and continuous loops. ConvolverNodes: one per bus.
- Every node you start must stop; feedback loops must be broken (`echo(..., until)`).
- Merge identical triggers within 25 ms; cap instances per sound; keep SFX under ~20 nodes.
- Build WaveShaper curves and periodic waves once (cached in `graph.ts`).

## Adding things

- **A new SFX**: add an entry (with its `cat`) to the shared catalogue in `sfx.ts` or to a kit,
  build it from `layers.ts`, run `node tools/audio/mix_trims.mjs <name>` to normalise it, render a
  sheet with neighbours of the same category.
- **A new ability**: name its moments `<champion>.<sound>` in `src/core/audio/kits/<champion>.ts`
  (cast/anticipation, travel or loop, payoff; the hit itself comes from `IMPACTS`), add its damage
  parts to `IMPACTS` in `impacts.ts` with a material and a weight (and a `gap` if it ticks), wire
  `audio.play` in the kit (local and `playRemote` paths), normalise, capture a match.
- **A new champion**: a new kit file registered in `kits/index.ts`, a `case` in `signature()`
  (one short, characterful layer for generic dashes), and a timbre family nobody else uses
  (Kaiser = bass guitar and wobble, Nova = synth arps and 4-bit stutter, Akali = vinyl scratch and
  808, Qiyana = golden ring and three elements, Locke = chains, bells and soul fire, Sera = sung
  vowels and chimes, Rex = drum-machine gun and bass, Pooh = woodblock, marimba and honey,
  Elisabbat = wing flutter, velvet and fangs).
- **A new arena**: add a `RoomSpec` in `reverb.ts`, a surface in `surface()`, and a battle theme
  in `ARENA_SONG`.
- **A new cue**: new file in `songs/`, register it in `songs/index.ts`, run the validator.
- **Changing the balance**: edit `CATS` in `mix.ts` (moves a whole category), never per-sound
  gains; re-capture a match and compare with the numbers in references/mixing.md.
