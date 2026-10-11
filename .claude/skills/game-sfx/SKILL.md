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
src/core/Audio.ts            AudioEngine facade: buses, limiter, play(name, pos?, vol?, srcChamp?),
                             distance/pan/air absorption, arena room, voice stealing, ducking,
                             combo tracking, movement loops (wind, gas jet, cable, footsteps),
                             music control (startMusic, setClimax, setDanger, stinger, matchEnd)
src/core/audio/sfx.ts        the SFX catalogue: SfxDef {fn, dur, max, rev, ui, vary, combo, duck,
                             gain} + layer helpers (whoosh, impact, metal, zap, boom, swell,
                             shimmer, vox, bell, cable, sub) + champion signatures
src/core/audio/graph.ts      live node helpers (tone, noiseBurst, fm, modal, drive, crush, echo)
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
tools/audio/check_songs.ts   score validator (bar lengths, ranges, clashes)
```

Game code calls `audio.play('name', pos, volume)`; kits pass the fighter's own `f.pos`, so the
engine knows which champion made the sound (`registerFighter`). `Match` passes the attacker for
hits (`play('hit', at, 1, attacker.champId)`). Unknown names are silently ignored, so a new
ability can call a new name first and you add the recipe after.

## Workflow

1. **Intent first.** Write one line per sound: what gameplay fact it communicates, how often it
   plays, who must hear it (only you / everyone / enemies as a warning), and its rank in the mix
   (see the hierarchy below). A swing heard 3 times a second needs a different design than an
   ultimate heard once a minute.
2. **Design in layers** (one job and one frequency band per layer, each from a different
   generator). Pick from the layer helpers in `sfx.ts`; read
   [references/synthesis.md](references/synthesis.md) for parameters when building new ones.
3. **Give it identity.** Tie pitched layers to the score (`chordHz(c.h, i, oct)` /
   `degHz`), add the champion's signature when it is their action, match the arena surface.
4. **Wire the metadata**: `dur` (voice accounting), `max` (steal oldest beyond it), `vary`,
   `combo` window for escalation, `ui` for 2D confirms, `rev`, `duck` for big moments, `gain`.
5. **Render and measure** (below). Compare against neighbours, not in isolation.
6. **Check in the real game**: `npm run dev`, `?play&champ=X&arena=Y&bots=3`, and listen to the
   MP3s yourself via the user. Typecheck (`npx tsc --noEmit`) before committing.

## The listening loop

```bash
# one or more sounds, several variations each, through the arena room
node .claude/skills/game-sfx/scripts/render.mjs sfxSheet '{"names":["hit","hitHeavy"],"repeat":4,"arena":"stage","champ":"kaiser"}' /tmp/out/hits
python3 .claude/skills/game-sfx/scripts/analyze.py /tmp/out/hits
# a stretch of a song (warm = orchestra notes pre-rendered like in the game; at = arrangement index)
node .claude/skills/game-sfx/scripts/render.mjs song '{"id":"city","seconds":30,"intensity":0.7,"warm":true,"at":3}' /tmp/out/city
npx tsx tools/audio/check_songs.ts
```

`render.mjs` starts Vite if needed, runs `src/core/audio/preview.ts` in headless Chromium, and
writes `.wav`, `.png` (log spectrogram: look at it with Read), `.mp3` (send it to the user) and
`.json` (peak, RMS, timings, cache misses). Read the numbers like this:

| Measure | Healthy | Smell |
|---|---|---|
| RMS per sound (sheet at volume 1) | ults/explosions -15..-20, hits -18..-22, heavy moves -25..-30, movement -28..-36, confirms/UI -34..-42 | 10 dB away from its rank: it vanishes or it shouts |
| Spectral centroid | transients 3-6 kHz, bodies 1-3 kHz | sustained hiss > 8 kHz is harsh; an "impact" under 1 kHz is dull |
| Variation between two plays | 0.3-1.5 dB, a few % pitch | identical numbers: machine-gun repetition |
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
  Enemies' ultimates get an extra threat cue. Cap voices per sound. Duck the music, and the world
  a little, under the biggest moment; never let tails move the "loudness window", only transients.
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
- [ ] Its loudness and brightness sit at its rank in the hierarchy next to its neighbours.
- [ ] Pitched content follows the score's harmony (or is deliberately atonal).
- [ ] It has space: room send and distance cues for world sounds, dry for confirms.
- [ ] It says who did it (champion signature, weapon material) and what happened (hit vs block
      vs crit vs counter are instantly different).
- [ ] Timing matches the animation frame and the hitstop; no 2-frame lag.
- [ ] Voice cap and `dur` set; no unbounded loops or node leaks (every source stops).

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

- **A new SFX**: add an entry to `SFX` in `sfx.ts` using the layer helpers, set metadata, render
  a sheet with neighbours of the same rank, trim `gain` from the measured RMS.
- **A new champion**: add a `case` in `signature()` (one short, characterful layer for swings,
  heavies, dashes and the ult) and new ability names in `SFX`. Give them a timbre family nobody
  else uses (Kaiser = bass wobble, Nova = 4-bit stutter, Akali = vinyl scratch, Qiyana = golden
  ring, Locke = chains and bell, Sera = sung formants, Rex = gun action, Pooh = soft woodblock,
  Elisabbat = wing flutter).
- **A new arena**: add a `RoomSpec` in `reverb.ts`, a surface in `surface()`, and a battle theme
  in `ARENA_SONG`.
- **A new cue**: new file in `songs/`, register it in `songs/index.ts`, run the validator.
