# Game SFX craft: what professional teams do, and how it maps to synthesis

Distilled from GDC talks, developer interviews and middleware docs (sources at the end). Lines
marked **[synth]** are translations of a principle into synthesis parameters: starting points to
tune by measurement, not quotes.

## Contents
1. Anatomy and layering
2. Recipes by sound family
3. Variation and anti-repetition
4. Readability and the mix hierarchy
5. Space
6. Loudness and fatigue
7. Hype: anime, fighting games, music-aware SFX
8. What makes SFX sound cheap

## 1. Anatomy and layering

- Transient, body, tail: the three building blocks of a satisfying sound (Marshall McGee).
  Destiny 2's Lorentz Driver is "initial pop, voice/body, tail", plus a rising pitched layer added
  only so it cuts through combat. Assassin's Creed Shadows bounces 8-12 tracks into one attack.
- One job and one band per layer. If a sub carries the weight, roll the low end off everything
  else or the bottom turns to mud. Some designers high-pass all SFX so they never fight the
  music's kick.
- Different sources per layer, so no single source is recognisable (the 2002 Spider-Man web
  shot's whip crack was demoted to a sweetener because it read as "a whip").
  **[synth]** one generator type per layer: noise, FM, pitch-swept sine, waveshaped saw, modal
  partials. Detuned copies of one oscillator are not layers.
- Timing: line transients up for punch, stagger a few ms for a flam, nudge a layer to fix phase.
  Sakurai flagged a Melee sound as "out of sync": it was 2 frames too long.
- Scale with damage: in Mortal Kombat 1 the size and shape of each impact follows the damage and
  the on-screen reaction; Dan Forden: a jab must not sound like an uppercut.
- Small speakers: laptops fall off around 150 Hz, phones around 200 Hz. The ear rebuilds a
  missing fundamental from harmonics, so saturate a parallel copy of every sub layer
  (`sub()` in sfx.ts does this).

## 2. Recipes by sound family

**Swing / whoosh.** Noise through a resonant band-pass whose centre sweeps up to the blade's
fastest frame and falls away; "some resonance is a must". Low-pass = full, high-pass = thin,
band-pass = narrow and hyped. Rising pitch adds tension, falling releases it. Ghost of Tsushima
chose sharp slicing over meaty thuds; Spider-Man put "silky swishes" on combat for speed.
**[synth]** pink noise, Q 2-5, centre ~500 Hz -> 2.5 kHz -> 800 Hz; attack 30-60 ms peaking on
the fastest frame; light 150-250 ms, heavy 300-450 ms with a low-passed body at 150-400 Hz. Two
staggered band-passes (x1 and x1.6, 10-15 ms apart) read as a real edge.

**Impact.** Hitstop references: Street Fighter V 8/12/15 frames (~133/200/250 ms) for
light/medium/heavy; Smash hitlag grows with damage (cap 30 frames) and plays a special sound
during it; killing blows get extra hitstop, zoom and slowdown.
**[synth]** click 2-10 ms high-passed > 2 kHz; punch sine/triangle 180 -> 55 Hz over 60-120 ms,
waveshaped; crunch band-passed noise 1-3 kHz 30-80 ms; tail filtered noise or room 150-400 ms;
sub on heavies only. Fill the hitstop window with body and tail.

**Blade clash / parry.** Four layers: swing, scrape, hit, "enhancers"; a ringing decay reads as
metal; drop a layer 12+ semitones for weight and add a kick. Ghost of Yotei separates the
attacking and defending weapon's sounds. Sekiro: a perfect deflect is a higher, sharper clang,
a block is duller. **[synth]** free-bar partials 1 : 2.756 : 5.404 : 8.933 : 13.3 on a 700-1500
Hz base, each split into a pair 0.5-3 Hz apart (slow beating = real metal), higher partials die
first; 3 ms click; perfect parry +3-5 semitones, longer ring, hitstop and a duck.

**Gunshot / energy shot.** Layers: charge, main shot, mechanical click, bass punch, kick. Fast
attack, pitch movement for "energy", short tail, never too clean. Titanfall 2 swapped reverbs and
tails per room. **[synth]** saw/square falling 2.5 kHz -> 150 Hz in 60-120 ms through a tracking
low-pass, noise click, 60-90 Hz punch ~50 ms, mechanical tick 40 ms later.

**Explosion.** Crack (first 10-20 ms), body, debris, sub shockwave. **[synth]** 10-20 ms
broadband crack through drive; sine 60 -> 30 Hz over 0.5-1 s; brown-noise bloom low-passed
2 kHz -> 150 Hz over 1-1.5 s; rumble < 110 Hz; debris grains 2-20 ms with a falling rate. At
distance drop the crack and highs first and add arrival delay (distance / 340 m/s).

**Dash / teleport ("shun").** Anime sound favours emotion over realism: synthesis, frequency
shifting, ring modulation, distortion on impacts. A teleport is a pull-in whoosh, a shimmer and a
tight pop at arrival. **[synth]** 50-250 ms reverse swell into a high-passed noise zip with a fast
downward sweep; departure at the origin, pop at the destination.

**Grapple** (Valve split TF2's hook into shoot, wind, reel start/stop and per-surface impacts;
God of War put an emitter on the axe itself). **[synth]** fire = gas hiss + pneumatic click; a
cable zip whose band-pass climbs as the line pays out; attach = crisp thunk + metal tick + a
short twang (priority: it is the player's confirmation); reel = a loop whose pitch follows
tension; release = snap + air.

**Wind at speed.** Spider-Man lightened impacts and added wind and cloth for speed; an RTPC
example maps speed 0-20 to gain 0.2 -> 1.0 and pitch 0.8 -> 1.5. **[synth]** three bands that
open with speed (rumble 80-300 Hz, rush 0.4-1.5 kHz, a high-Q 2-6 kHz whistle only near top
speed), cloth flutter as 8-25 Hz amplitude modulation, parameters smoothed over 50-150 ms.

**Footsteps / landings.** Overwatch footsteps identify the hero; 4-8 variations per surface is a
baseline; Apex reworked Foley so distance reads fast. **[synth]** heel and toe 20-40 ms apart,
landing intensity from fall speed, surface texture per arena, debris on hard landings.

**Ultimate.** Overwatch and Valorant ship separate ally and enemy ult lines so players know when
they are in danger; SF6's crowd cheers on Super Arts. **[synth]** 300-600 ms riser or reverse
swell that ducks everything, 80-200 ms of near silence, the hit (transient + key-tuned sub drop +
the champion's motif), then an aura for the ult's duration.

**Hit confirm / kill.** Call of Duty's hit sound took weeks to cut through gunfire and a changed
version caused complaints within hours; Valorant's beta damage feedback was too faint.
**[synth]** 2D, 60-150 ms, centred 1-4 kHz; hit = small tick; kill = fuller rising interval;
multi-kill = +1 semitone per kill.

**UI.** Navigation smallest, select bigger, confirm biggest; hover usually silent; clicks
80-150 ms, notifications 200-600 ms. Intervals as vocabulary: major third positive, tritone or
minor second for errors. Tune UI to the music's key.

## 3. Variation and anti-repetition

- Pitch: 0.95-1.05 playback rate is a common start; 0.9-1.1 wider; about +/-2 semitones and
  +/-1.5 dB is the ceiling before it sounds like a different object.
- Containers: Wwise random containers (shuffle, "avoid repeating last x"), FMOD instance caps
  and stealing (oldest, furthest, quietest). CRI randomises at several levels for "almost
  infinite" variations from one file. **[synth]** pick transient, body and tail sub-variants
  independently and randomise internal parameters (filter centre +/-10-15 %, envelope times
  +/-10-20 %, partial ratios +/-1 %, a new noise seed).
- Combo escalation: raise successive hits a semitone (x1.0595) to reinforce the chain;
  Overwatch's Mercy beam rises as it heals. **[synth]** step only the tonal layer; resolve the
  finisher up a fifth or an octave with more body and hitstop.

## 4. Readability and the mix hierarchy

- Overwatch "play by sound": every sound gets an importance score 0-120 and lands in High,
  Medium, Low or Cull; capping High sounds keeps the mix clear; inputs are who aims at you, who
  shoots you, distance; occlusion uses path distance. Enemy footsteps louder than allies'.
- Apex's Focused Mix lowers your own weapon, removes squadmate footsteps, boosts enemies', with a
  threat score from proximity and line of sight. Titanfall 2 ranks by friend/foe and aim.
- Valorant uses a deliberately flat footstep curve ("rigid realism = bad game design") and admits
  stereo cannot separate front 45 deg from back 45 deg.
- Doom 2016 made the weapons the main character, never ducked by anything. Pick your hero
  category.
- Riot: convey gameplay clearly, keep a hierarchy so the most important moment draws the most
  attention, minimise noise; shields/heals/knock-ups share sonic traits across champions.
- 2D vs 3D: your own jump only you hear; an ult everyone hears. Own confirms and UI are 2D.
- Ducking and snapshots (Rob Bridgett): priorities resolve snapshots; low-health states blend in
  gradually. Ghost of Tsushima brings combat sounds forward as combat music swells.
- HDR audio (DICE): the loudest sound moves a window and quieter ones are pushed down; only
  transients should move it, tails capped. **[synth]** duck the world 2-3 dB for 0.1-0.5 s
  under the biggest events (`duckWorld`), the music more (`duck`).

## 5. Space

- Distance: interpolate a low-pass across distance and raise the reverb send with it; air
  absorption is small (< 0.2 dB/m at 8 kHz, audible beyond ~15 m) so a simple low-pass works.
  **[synth]** ~18 kHz at <= 5 m falling to 3-5 kHz at 60 m.
- Apex weapons have at least 4 distance layers; distance EQ and orientation matter.
- Doppler is usually baked into fast objects' assets; Web Audio has no built-in Doppler, drive
  `detune` yourself.
- Early reflections carry the sense of space; same-direction reflections reinforce localisation,
  lateral ones blur it. Wwise Reflect = multi-tap filtered delays over a static convolution bed.
  **[synth]** one convolver per arena with a generated IR (see synthesis.md section 5).

## 6. Loudness and fatigue

- Console targets around -24 LKFS (+/-2 LU), portable -18, -1 dBTP; for a browser game on laptops
  about -16 to -18 LUFS with a -1 dBTP safety limiter is reasonable.
- Stacked sounds sum into clipping: put a fast high-ratio limiter on the master; budget ~24-32
  voices with per-sound caps (footsteps 6, impacts 8, whooshes 4).
- 2-4 kHz overboost is harsh; narrow 6-9 kHz peaks fatigue. Repetition is the main fatigue.
- Sakurai: 3D animation loses detail and a zoomed-out camera loses impact, so "too much is just
  right"; realistic sounds can carry more information, so balance.

## 7. Hype

- Pre-impact silence (~0.5 s in trailers) makes the next hit enormous; a reverse swell is the
  intake of breath; a riser peaks exactly on the impact; long tails carry attention into silence.
- Sub drops: sine 40-70 Hz with a downward envelope, start note tuned to the key, distorted to
  reach the mids.
- Effects fixed in one key clash with music in others: tune tonal SFX to the score.
- Beat-aware design: Metal: Hellsinger's guns are lethal and musical; Tetris Effect's rotations
  match the beat; Hi-Fi Rush syncs actions to the beat. **[synth]** fire the transient
  immediately, quantise only tonal sweeteners if at all; latency kills feel.
- Character identity: League champions from one region share traits but differ; the True Damage
  skins carry the group's flavour next to always-on music; Overwatch's Echo is built from energy
  sources, Freja is "light and airy" because she is fast.
- Dragon Ball Z's SFX came from Fizz Sound Creation (Kamehameha, punches); the super-heavy
  "PWEEEEN" punch is shared across anime and Smash.

## 8. What makes SFX sound cheap

1. Identical repeats. 2. One unmodified source. 3. Every layer full-band (mud). 4. Too clean:
a pure bleep with a linear envelope, no transient, no tail, no room. 5. No hierarchy (everything
loud). 6. Out of sync with animation or not scaled to damage. 7. Style mismatch with the visuals.
8. Pitch randomisation so wide the object changes. 9. Tonal SFX in the wrong key. 10. No distance
or space. 11. No intent: judge a sound by what it tells the player (Akash Thakkar).

## Sources

Overwatch: gamedeveloper.com/audio/video-how-i-overwatch-i-was-designed-so-people-could-play-by-sound- ;
pcgamer.com/how-overwatch-uses-sound-to-pinpoint-threats-you-cant-see ;
awesomegameaudio.wordpress.com/2017/02/06/overwatch-play-by-sound ;
blog.audiokinetic.com/overwatch-game-audio-using-wwise-1 ;
overwatch.blizzard.com/en-us/news/23411614/from-zero-hour-to-hero-inside-echos-audio ;
overwatch.blizzard.com/en-us/news/24226699/talent-tree-sound-designer-overwatch-2 .
Valorant: theloadout.com/valorant/footsteps ; leahybaker.com/valorant_access .
Apex / Titanfall: ea.com/en/games/apex-legends/apex-legends/news/showdown-audio-update ;
asoundeffect.com/apex-legends-sound ; asoundeffect.com/titanfall-2-sound .
Doom: adsrsounds.com/news/the-sound-design-of-doom-exclusive-qa .
Destiny 2: inverse.com/gaming/destiny-2-sounds-lorentz-driver-stasis .
Spider-Man: asoundeffect.com/marvels-spider-man-sound ;
designingsound.org/2010/06/charles-maynes-special-sound-for-sci-fisuperhero-films-part-1-spid .
Mortal Kombat: asoundeffect.com/mortal-kombat-1-game-audio ; timeextension.com (Dan Forden interview).
Ghost of Tsushima / Yotei: bradleymeyer.com ; asoundeffect.com/ghost-of-yotei-game-audio .
Hitstop: shoryuken.com/2016/06/07/hitstop-in-street-fighter-v ; ssbwiki.com/Hitlag ;
sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1 .
Riot: leagueoflegends.com/en-us/news/dev/clarity-in-league ;
nexus.leagueoflegends.com/en-us/2019/11/giants-pop-stars-making-music-with-sound-design .
Craft: kilohearts.com/blog/marshall_mcgee_on_game_audio_and_sound_design ;
daviddumaisaudio.com (sword layers) ; sfxengine.com/blog/impact-sound-effect ;
gamedeveloper.com/audio/the-power-of-pitch-shifting ; blog.criware.com (randomisation) ;
javierzumer.com/blog/2022/2/26/fmod-event-macros ; GDC09 Clerwall HDR Audio slides ;
audiokinetic.com/a-wwise-approach-to-spatial-audio-part-1 ; pcgamer.com/the-origin-of-call-of-dutys-most-heard-sound ;
uisfx.com/ui-sound-design ; krotosaudio.com/trailer-sound-design-tips-tricks ;
344audio.com/post/article-secrets-of-anime-sound-design ; virzyguns.com (bass on small speakers) ;
gamespot.com (Metal: Hellsinger) ; akashthakkar.com/post/how-to-make-sound-design-a-lot-easier .
