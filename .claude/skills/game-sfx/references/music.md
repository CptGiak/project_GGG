# Writing the score: Dragon Ball / anisong-style adaptive music in code

## Contents
1. What makes it sound like Dragon Ball
2. Harmony and melody toolkit
3. The motif and how to develop it
4. Form, arrangement and the adaptive layers
5. Score notation (score.ts) and the validator
6. Humanisation and mix
7. Not sounding like generic AI music

## 1. What makes it sound like Dragon Ball

- **Shunsuke Kikuchi** (DB / DBZ TV and films): a "hybrid sound" of strings, brass, drum kit and
  electric instruments; fight cues with horn stabs, electric bass, funk guitar and a pulsing
  rhythm section. Norihito Sumitomo: Kikuchi "expertly utilized brass", a world neither
  classical nor pop. Sections answer each other (horn phrase, strings answer, brass answer).
  He wrote 300+ standalone cues placed scene by scene: write a library (loops, stingers,
  transitions), not one monolithic track.
- **Sumitomo** (Super, Broly): orchestra + rock + electronics, electric guitar on Battle of Gods;
  composed in story order so one motif evolves through the score.
- **Vocal openings** (the "hype" grammar): Cha-La Head-Cha-La ~154 BPM with pedal slash chords
  (bVII/I, bVI/bVII); We Gotta Power ~170 BPM; Ultimate Battle ~171 BPM; Chozetsu Dynamic
  pre-chorus bVI-bVII into I and V/V in the chorus; Limit Break x Survivor i-bIII-IV-bVII and
  i-bIII-IV-V (Dorian IV plus harmonic-minor V).
- **Games**: Budokai (Kenji Yamamoto) jazz-rock with funk and ska; Burst Limit rock + jazz +
  orchestra; Raging Blast 2 cues around 206 BPM; FighterZ character themes from smooth jazz to
  upbeat rock; the US dub (Faulconer) used chord-heavy guitar riffs.
- **Originality**: Toei dropped Yamamoto in 2011 after cues were found to resemble Hollywood
  scores. Borrow devices, never melodic contours.

## 2. Harmony and melody toolkit

| Device | Numerals | Example | Use |
|---|---|---|---|
| Royal road (odo shinko) | IVmaj7-V7-iii7-vi | Bbmaj7-C7-Am7-Dm7 in F | pre-chorus |
| Mario / power-up cadence | bVI-bVII-I | Db-Eb-F; in minor Bb-C-D major | lead-ins, intros, the "transform" moment |
| Pedal slash chords | bVII/I, bVI/bVII | Eb/F, Db/Eb | bright, unresolved Showa colour |
| Dorian IV | i-bIII-IV-V | Dm-F-G-A | battle verse |
| Phrygian dominant | over V | A Bb C# D E F G on A | villain, breakdowns |
| Chromatic mediants | I->bIII, I->bVI | F->Ab; Dm->Fm->Abm | section lifts, risers |
| Diminished passing | bVI-#vi dim7-bVII-vii dim7/i | Bb-Bdim7-C-C#dim7-Dm | pre-chorus climb |
| Neapolitan | bII | Eb in D minor | chorus surprise |
| Pedal points | dominant pedal, tension then release | Dm/A, Bb/A, Gm/A | transformations, breakdowns |

- Key changes: lift the last chorus a half or whole step; anime songs often relate sections by
  minor thirds, with the pre-chorus as the pivot.
- Melody: brass fanfares on major pentatonic with 4th/5th leaps; battle melodies natural minor
  with the raised 7th at cadences and the Dorian 6th for brightness; start phrases with pickups
  and leave rests; avoid long runs of even 8ths.
- "Just the Two of Us" (IVmaj7-III7-vi7) at most once: it reads as city-pop and goes generic.

## 3. The motif ("Ki motif" in this project)

Five notes, scale degrees 1-5-b7-6-5, rhythm 8th, 8th, dotted 8th, 16th, half note
(`D5:2 A5:2 C6:3 B5:1 A5:8` in D minor). Develop it everywhere:
augmentation (menu intro, brass chorale at half speed); diminution (16th string ostinato
`1586515865158651`, a 5-note cell across 4/4); fragmentation (the "1-5" head as a kime call);
inversion (the final-minute horns, answered by the original in the trumpets); sequence (rising by
minor thirds in risers); the completed form 1-5-b7-6-8 rising to the octave in the victory jingle.

## 4. Form, arrangement and adaptive layers

- Japanese song form: intro -> A-melo (verse) -> B-melo (pre-chorus) -> sabi (chorus); later the
  ochisabi (stripped build) and the osabi (lifted final chorus). Kime: whole band hits in unison
  with silence between (`X..X..X...X.X...`).
- Grooves (16 steps): verse "2-beat" at 160-172 BPM (kick on beats, snare on every off-8th:
  `X...x...X...x...` / `..x...x...x...x.`); chorus backbeat with 16th hats; breakdown half-time;
  riser snare 8ths -> 16ths -> 32nds.
- Fills: a short fill closing every 4th bar (random template), a big fill every 8-16; the next
  bar starts with crash + kick. Stop everything for one 8th before a chorus downbeat ("breath").
- Second passes differ: melody moves to the strings, a counter-line appears, toms replace hats.
- Adaptive: intensity gates layers (`gate`), the final minute switches to the `climax`
  arrangement at the next 4-bar phrase with a transition fill, the local ultimate fires a
  stinger (`stinger('power')`) on the current chord, low health muffles the score
  (`setMuffle`), match end plays the victory fanfare or the lament, then the results loop.
- Lengths: battle loop >= ~100 s, menu loop >= 2 min; short loops make players mute the game.

## 5. Score notation and validation

```ts
sections: {
  sabi: {
    bars: 8,
    chords: 'F | C/E | Dm7 | Am7:8 F7:8 | Bbmaj7 | C | Am7:8 D7:8 | Gm7:8 C7:8',
    brass: 'F4:2 C5:2 Eb5:3 D5:1 C5:8 | -:2 C5:2 D5:2 E5:2 G5:4 E5:2 C5:2 | ...',
    oct: true,                       // horns double the brass an octave below
    strings: 'A5:8 C6:8 | ...',      // counter-melody (notes) or an ostinato ('1585...')
    pad: 'choir',                    // sustained voice-led chords: strings | choir | both
    gtr: 'X-x-x-x-X-x-x-x-',         // rhythm on the chords, or riff tokens (power chords)
    bass: 'R-r-r-r-R-r-5-8-',        // R/r root, 5, 8, 3, 7, a/A approach, or note tokens
    stabs: '...X.......X....',       // brass chord stabs (X falls off), '<' swells
    hit: 'H..H..H...H.H...',         // orchestra hits (brass + strings + timpani + crash)
    timp: 'R.......5.......',        // on the chord's bass (pedals work), r = roll
    drums: { k: '...', s: '...', h: '...', c: '...', t: '...' },
    fill: 'toms|big', minifill: false, gate: { strings: 0.4 }, mix: { gtr: 0.8 },
  },
}
order: ['intro', 'A', 'B', 'sabi', ..., 'sabi+3', 'turn'], loopAt: 1, climax: [...]
```

- Notes: `E5:4` (length in sixteenths, sticky), `-` rest, `_` tie, `[C5,E5,G5]` chord, flags
  `!` accent, `'` staccato, `^` scoop, `~` wide vibrato, `/` fall, `m` palm mute and `s` single
  string in riffs. Chords: lengths sticky within a bar only. Rhythm strings: exactly 16
  characters per bar, `-` holds, `.` silence. Lists shorter than the section cycle.
- Drums: k `x X g`; s `x X(rim) g(ghost) f(flam) r(two 32nds) c(clap)`; h `x X o p r R b`;
  c `c C(both) n(china) s(splash) g(gong)`; t `1-4` toms, `k K` taiko.
- `'name+N'` in an arrangement transposes the whole section N semitones.
- Run `npx tsx tools/audio/check_songs.ts`: errors on any bar that does not add up, warnings for
  out-of-range notes and for notes held on beats 1/3 that rub a minor second against the chord.
  Warnings can be deliberate (Phrygian ♭9 over a pedal): read each one.
- `songs/util.ts` has `up(line, semis)` to transpose a line and `rep(bar, n)`.

## 6. Humanisation and mix

- Listeners notice ~2.5 % of a beat (~9 ms at 172 BPM): random jitter 2-4 ms, and put feel in
  patterned offsets (snare ~3 ms early for push, 10-15 ms late for laid-back).
- Hi-hat velocity cycle [1, .45, .7, .5] +/-10-20 %; ghost notes 0.15-0.3 at ~60-70 %
  probability; fill velocities ramp 0.55 -> 1.
- Guitars: strum 3-6 ms per string, upstrokes softer, double-tracked takes hard L/R; slide into
  accented chorus chords.
- Brass 5-15 ms behind the drums, stabs fall -2 semitones over ~120 ms, octave doublings with
  their own jitter and tuning; vibrato 5-6 Hz after 200-350 ms.
- EQ slots: kick HP 35, body 60-80, click 3-4 kHz; bass HP 40; guitars HP 90-100, LP 6-10 kHz;
  brass HP 120-200; choir HP 200; reverb returns HP 350 / LP 6-10 kHz. Dip guitars around
  2.5 kHz when the brass melody plays. Tame energy below 60 Hz.
- Panning: guitars +/-0.8, violins -0.5, celli +0.3, trumpets +0.2, horns -0.25, choir +/-0.4,
  kick/snare/bass/lead centred.

## 7. Not sounding like generic AI music

1. No four chords for a whole track: every cue needs a real cadence, a pedal section and a key
   change. 2. Every melody comes from the motif, with pickups, rests and syncopation.
3. Density changes every 8 bars (kime, stop-time, half-time). 4. Second passes are
   re-orchestrated. 5. Long enough loops. 6. Expressive variation (dynamics, fills, articulation).
7. Layer and section switches land on 4-bar boundaries.

## Sources

kanzenshuu.com (Sumitomo interview, K-304, Music in Dragon Ball, Battle of Gods OST, Dragon Ball
Kai) ; dreamnews.jp/press/0000215593 ; gamerant.com (music of Dragon Ball) ; otakurevolution.com ;
en.wikipedia.org/wiki/Cha-La_Head-Cha-La ; ja.chordwiki.org (CHA-LA HEAD-CHA-LA, WE GOTTA POWER) ;
guitartabsexplorer.com (Chozetsu Dynamic, Limit Break x Survivor) ; vgmonline.net (Budokai 3, Burst
Limit) ; hooktheory.com (Raging Blast 2) ; dragonballfighterz.fandom.com ;
en.wikipedia.org/wiki/Royal_road_progression ; blog.flat.io/jpop-anime-chord-progressions ;
mtosmt.org/issues/mto.26.32.1 (Li, minor-third relations) ; signalsmusic.studio (Mario cadence) ;
guitarworld.com (Phrygian dominant) ; opensauceguitar.com (chromatic mediants) ;
robin-hoffmann.com (pedal points, ostinato) ; vaia.com (motif development) ;
revuemusicaleoicrm.org/?p=26094 (timing perception) ; soundonsound.com (humanising drums, adding
feel, brass synthesis, arranging strings) ; mixelite.com (humanising MIDI drums) ;
masteringthemix.com (distorted guitar) ; vi-control.net (orchestral mixing) ;
bugnet.io (adaptive music) ; audient.com (composing for games) ; world.hey.com/thome (music fatigue) ;
chaoticblue.com (victory themes).
