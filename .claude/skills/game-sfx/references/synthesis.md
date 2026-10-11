# Synthesis recipes with numbers

Parameters for building instruments and SFX with Web Audio and plain-JS DSP. **(est.)** marks
engineering starting points, not sourced values. Where this project already implements a recipe
the file is named.

## Contents
0. General rules
1. Drums and percussion
2. Distorted guitar (Karplus-Strong)
3. Brass, strings, choir, lead
4. SFX recipes
5. Procedural reverb
6. Performance

## 0. General rules

- Partials decay independently and high ones first: modal decay tau ~ 1/(pi f eta), eta = loss
  factor (steel ~0.0002).
- Exponential envelopes. Per-sample multiplier for a T60: `g = 10^(-3/(T60*fs))`;
  `setTargetAtTime` tau = T60/6.91; `exponentialRampToValueAtTime` cannot reach 0: ramp to 1e-4.
- Nonlinearity is glue: a tanh on summed layers makes them fuse (intermodulation).
- Vary every trigger: +/-3-5 % pitch, +/-1.5 dB, +/-4 % timing, new noise seed.
- Stereo: independent noise per channel (decorrelated) beats one mono noise panned; avoid Haas
  copies (they collapse in mono).

## 1. Drums and percussion (samples.ts)

- **Kick 808**: sine with exponential pitch drop (Tone.js MembraneSynth: f*2^octaves -> f over
  50 ms; amp attack 1 ms, decay 0.4 s). riffmaster: 170 -> 48 Hz over 35 ms, amp T60 0.45 s,
  10 ms noise click through a 3 kHz low-pass at 0.5. A rock kick is tighter (body T60 ~0.3 s,
  sub ~0.2 s).
- **Kick 909**: saw/triangle with a pitch envelope through a shaper to a near-sine, click =
  low-passed noise + pulse. (est.) 250 -> 50 Hz tau 20 ms, T60 0.35 s, tanh drive 2-3.
- **Snare**: 909 = two sines at 180 and 330 Hz with their own decays + band-passed noise;
  riffmaster 240 -> 175 Hz (T60 0.12 s), 420 -> 330 Hz (0.08 s), noise HP 1.5 kHz (T60 0.18 s).
  Second head mode ~1.59x.
- **Clap**: noise band-pass ~1.1 kHz Q ~2, about 4 bursts ~11 ms apart, then a 150-250 ms tail.
- **Hi-hats**: six inharmonic squares 200-800 Hz then a steep high-pass (808); TR-606 tunings
  245, 306, 365, 415, 437, 619 Hz; Tone.js MetalSynth ratios 1, 1.483, 1.932, 2.546, 2.63, 3.897.
  Closed HP 6.5 kHz T60 45 ms, pedal 50 ms, open 0.45 s; a closed hit chokes an open one.
- **Cymbals**: same metal bank + noise, HP 2.4-4 kHz, +6 dB at ~7 kHz, T60 1.4-2.6 s; energy
  climbs to several kHz over a few hundred ms and the highs die first. China: lower partials,
  HP 2.5 kHz, peak 3.5 kHz, saturated.
- **Toms**: kick model at 80-250 Hz, less sweep, longer ring, membrane modes 1, 1.59, 2.14, 2.30,
  2.65, 2.92, 3.16 at -10 to -18 dB.
- **Timpani**: partials 1.00, 1.50, 1.98, 2.44 of the principal; every mode starts 2-4 % sharp and
  falls over ~100 ms; rolls at ~18 strokes/s with a crescendo.
- **Taiko**: two coupled heads split the fundamental (sines ~55 and 60 Hz, 5 % sharp falling over
  80 ms), membrane partials 1.59, 2.14, a 15 ms stick slap at 2 kHz, long hall.
- **Orchestra hit**: short stacked chord (brass + strings + timpani), 5 ms attack, 250-400 ms
  decay, saturation, big reverb send.
- **Gong / tam-tam**: inharmonic partials whose upper ones bloom late (tens to hundreds of ms)
  and shimmer; 4+ s decay.

## 2. Distorted guitar (dsp.ts pluck, samples.ts guitarTake)

- The string: plain JS (a DelayNode in a feedback cycle has a 128-sample minimum, capping pitch
  near E4). Delay N = fs/f0; excitation = one period of noise through a one-pole low-pass
  (k = 0.15 + 0.8 * brightness), DC removed, combed at the pick position (1 - z^-bN); loop =
  two-point average + first-order allpass for the fraction (C = (1-frac)/(1+frac)); loop gain
  rho = 10^(-3/(T60*f0)). Palm mute: T60 ~0.1-0.35 s, darker; dead note T60 0.06 s.
- What separates "guitar" from "buzz":
  1. Distort the summed chord, not each string: root + fifth make a difference tone an octave
     below (the weight of a power chord). Strum 5-15 ms between strings, +/-3 cents.
  2. Tighten before the clipper: HP 85-110 Hz (Tube Screamer style), clip, low-pass after.
  3. Amp: pre-gain 6-30, `tanh(d x)/tanh(d)`, asymmetric bias `tanh(x+0.1)-tanh(0.1)` for even
     harmonics, then a DC blocker.
  4. Cabinet (the most important stage): 24 dB/oct low-pass around 5 kHz (4 warm, 6 aggressive),
     mid scoop around 500-600 Hz, presence +2-4 dB at 2.3-3.2 kHz, cut fizz, +3 dB at 110 Hz.
  5. Double-track: two independent takes (different seeds, 10-20 ms drift) hard L/R, never a
     delayed copy.

## 3. Brass, strings, choir, lead (instruments.ts)

- **Brass** (Synth Secrets 25-26): saw, filter cutoff tracking pitch 100 % and velocity (louder =
  brighter). Minimoog swell: amp attack 100 ms; filter attack 600 ms, decay 800 ms, sustain 50 %.
  Stab (est.): filter attack 20-40 ms, decay 250 ms. Pitch instability ~50 ms at the onset (a
  scoop), delayed vibrato ~5 Hz +/-5-15 cents, breath noise. Section: 3-5 saws +/-5-12 cents,
  per-voice attack jitter. Stabs end with a fall of -2 semitones over ~120 ms.
- **Strings**: two to four saws, PWM or detune, low-pass half closed with key tracking,
  trapezoid envelope, chorus (Tone.js 1.5 Hz, 3.5 ms, depth 0.7). Body resonances: band-passes
  at 300 Hz, 700 Hz, 3 kHz. Vibrato 5-8 Hz up to a quarter tone, delayed.
- **Choir "aah"**: parallel band-passes on a saw (three formants recognisable, five lifelike).
  Csound table, F1-F5 (Hz): soprano a 800 1150 2900 3900 4950; o 450 800 2830 3800 4950;
  u 325 700 2700 3800 4950; tenor a 650 1080 2650 2900 3250; bass a 600 1040 2250 2450 2750.
  Levels for soprano a: 0, -6, -32, -20, -50 dB; bandwidths 80-140 Hz. Morph vowels by ramping
  F2. Ensemble 4-8 voices +/-8-15 cents, vibrato 5-6 Hz +/-20 cents, attack 200-400 ms.
- **Synth lead**: 2-3 saws +/-7-12 cents + sub, 24 dB/oct low-pass Q 4-8 with an envelope, 40 ms
  glide, delayed vibrato 5.5 Hz, tanh, 3/16 delay with 0.3 feedback.

## 4. SFX recipes (sfx.ts helpers in brackets)

- **Sword whoosh** [whoosh]: band-pass centre tracks swing speed (a study mapped 100 -> 3500 Hz
  to speed); several sources along the blade; loudest at closest approach, centre drops ~30 %
  after it. Three band-passes x1, x1.6, x2.5, Q 2-5, staggered, 150-350 ms.
- **Metal clang** [metal]: decaying sinusoids, free-bar ratios 1, 2.756, 5.404, 8.933, 13.3;
  weight mode n by 1/n and by contact time; split modes into pairs 0.5-3 Hz apart. Other sets:
  vibraphone 1, 3.984, 10.668, 17.979; wine glass 1, 2.32, 4.25, 6.63, 9.38; Tibetan bowl
  1, 2.778, 5.181, 8.163, 11.661. FM bell (Chowning): carrier:modulator 1:1.4, index 10
  decaying; ratio 2.41 = metallic.
- **Punch / body hit** [impact]: crack > 1 kHz 2-5 ms, mid body (noise 150-250 Hz + sine
  150 -> 80 Hz over 40 ms), sub 30-60 Hz falling over 200-400 ms; glue with drive.
- **Gunshot** [zap + sub]: muzzle blast is a Friedlander pulse P(t) = Pp (1 - t/tau) e^(-t/tau),
  < 3 ms; supersonic crack is an N-wave < 200 us before the blast. Game layers: transient, body,
  sub, mechanical, tail (short very wet + long quiet reverb).
- **Energy blast / laser** [zap]: square/saw with a fast downward slide (sfxr laserShoot);
  5 kHz -> 100 Hz in ~0.1 s; falling inharmonic = discharge, rising with fast shallow vibrato =
  charge or arrival. Optional FM layer ratio 1.5-2.4, index 3 -> 0.
- **Explosion** [boom]: crack 10 ms clipped noise; thump 60 -> 30 Hz over 300 ms; bloom brown
  noise LP 2 kHz -> 150 Hz over 1.5 s, driven; rumble LP 100 Hz 4 s; debris Poisson pings
  2-20 ms band-passed 1-6 kHz, rate 40/s -> 2/s.
- **Magic shimmer** [shimmer]: 20-60 grains/s of high sines on scale tones (2-8 kHz), 30-120 ms
  each, gliding slightly up.
- **Teleport / zip** [swell + zap]: rise 200 Hz -> 4 kHz over 300 ms with 30 Hz +/-3 % vibrato,
  rising noise band, reverse swell; zip = 60 ms rise 300 Hz -> 3 kHz.
- **Wind** (Audio.ts Loops): noise through resonant bands with slow swell; a narrow whistle only
  in strong wind; realism grows with the number of time-varying bands.
- **Rope / cable creak**: stick-slip impulses at 20-120 Hz into resonators at 180, 420, 950,
  2100 Hz, Q 8-15; higher force = lower creak rate.
- **Mechanical click / ratchet**: 1-3 ms noise into 3-4 metal modes 2-8 kHz, T60 10-40 ms;
  ratchet 10-30 clicks/s +/-10 %, alternating two timbres.
- **Glitch** [crush]: bitcrush `round(x*2^(b-1))/2^(b-1)` with b = 3-8; stutter a 10-60 ms slice
  3-8 times; tape-stop ramps playbackRate 1 -> 0 over 300 ms.

## 5. Procedural reverb (reverb.ts)

- Moorer-style: exponentially decaying noise, `decay = (1/1000)^(1/(T60*fs))`, independent per
  channel, frequency-dependent decay by splitting bands (highs die faster), fade-in, pre-delay.
- Early reflections: discrete taps (time, gain, pan); 5-35 ms fuse with the source, > ~40 ms are
  heard as echoes. The ConvolverNode buffer must match the context sample rate.
- Environments (est.): street T60 ~1.5 s, facade taps at 35/52 ms, flutter between facades;
  stadium T60 ~3-4 s, pre-delay ~40-60 ms, stand echoes; void T60 4-8 s, slow bloom, no early
  reflections, dark.
- Cheaper alternative: Freeverb (combs 1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116 samples at
  44.1 kHz; allpasses 225, 556, 441, 341; room 0.7; damping 3 kHz).

## 6. Performance

- Pre-render one-shots to buffers (a buffer source is "very inexpensive to create" and buffers
  are reused). Memory = length x channels x 4 bytes: keep tails off buffers, use a reverb send.
- Live graphs only for continuous or parametric sounds.
- Costs (Paul Adenot): ConvolverNode very expensive and scales with IR length (one per bus);
  HRTF PannerNode very expensive (use StereoPanner); biquad ~5 mul + 4 add per sample;
  WaveShaper oversampling costs and copies its curve (build once); DynamicsCompressor adds
  ~6 ms look-ahead.
- AudioParam event lists grow: recycle fresh gain nodes per note instead of automating one
  node forever.
- Voice management: per-category caps, steal oldest/quietest with a 5-10 ms fade, merge
  identical triggers within 30-50 ms, choke groups.
- Scheduling: a 25 ms timer with ~100-160 ms look-ahead (MDN advanced techniques).

## Sources

Synth Secrets mirror github.com/micjamking/synth-secrets (parts 23, 25, 26, 31, 34, 36-41, 46,
49) ; Csound manual formants and modal tables (github.com/csound/manual) ; Tone.js instruments
and effects (github.com/Tonejs/Tone.js) ; ZzFX ; jsfxr ; MDN Web Audio (github.com/mdn/content) ;
Paul Adenot, web-audio-perf ; reverbGen (github.com/adelespinasse/reverbGen) ; riffmaster
(github.com/gonza56d/riffmaster) ; RP.Sound ; pygunshot ; R. Maher gunshot acoustics (montana.edu) ;
Farnell, Designing Sound (MIT Press companion code) ; Designing Sound in SuperCollider (wikibooks) ;
JOS Electric Guitars / Extended Karplus-Strong (dsprelated.com, ccrma) ; Selfridge, Moffat & Reiss,
sword swing model (QMUL) ; Cycling '74 FM tutorial ; Cherry Audio 808 cymbal ; KVR clap/909 threads ;
diystompboxes (Tube Screamer) ; Fractal Audio forum and Anderton/gearnews (cabinet EQ) ;
violetrecording (impact layering) ; pixflow (explosions) ; UBC JASS creaking ; Minnaert (arXiv 1706.08113).
