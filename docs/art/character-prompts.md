# Prompt per i modelli dei campioni (Gemini → immagine → 3D)

Pipeline: **Gemini** genera una scheda personaggio pulita (T-pose, fronte e retro) → un
convertitore **immagine→3D con rigging** (Tripo o Meshy) produce un `.glb` con scheletro →
il gioco lo carica con lo shader toon, i contorni, le armi e le animazioni esistenti.

## Impostazioni Gemini

- Modello: **Nano Banana Pro** (Gemini 3 Pro Image). Thinking **disattivato**.
- Prima del prompt carica i due render del modello attuale come riferimento di design:
  `docs/art/refs/<campione>_front.png` e `docs/art/refs/<campione>_back.png`.
- Una generazione per prompt. Se il risultato non va, apri una chat nuova e reinvia il
  prompt completo: le correzioni a catena fanno "derivare" il personaggio.
- Per un singolo dettaglio sbagliato usa il prompt di correzione in fondo.
- Salva le immagini come `docs/art/sheets/<campione>_front.png` e `<campione>_back.png`.

Perché questi vincoli: i convertitori ricostruiscono molto meglio una figura sola, intera,
a braccia aperte, su sfondo neutro e con luce uniforme (la luce del disegno finisce "cotta"
nelle texture). Le armi vanno generate a parte: il gioco le aggancia alle mani da solo.

## Prompt comune (fronte)

Sostituisci `[NOME]` e `[ASPETTO]` con i blocchi dei singoli campioni qui sotto.

```
I'm uploading two renders of the current in-game model of [NOME] (front and back). Use them
as the design reference: keep the outfit, the color palette, the hairstyle and the
accessories, but redraw the character as a refined, higher-detail anime design with better
proportions and cleaner shapes.

Full-body character model sheet, front view, of [NOME], an original character for a stylish
anime action game. [ASPETTO]

The character stands in a clean T-pose facing the camera: arms held straight out to the
sides at shoulder height, palms facing down, fingers together, legs straight and slightly
apart, feet flat on the ground, neutral expression. The whole figure is visible from the top
of the hair to the soles of the shoes, centered with a small margin. Empty hands, no weapon.

Modern anime cel-shaded rendering like a polished Japanese action-RPG character model sheet:
crisp clean lineart, flat vivid colors with simple two-tone shading, soft even studio
lighting. Plain light grey background. Portrait 3:4 format.
```

## Prompt comune (retro)

Da usare nella stessa chat subito dopo il fronte, oppure caricando l'immagine del fronte.

```
Using the character you just drew as strict reference (same design, colors, proportions and
line style), draw the same character from directly behind, in the same T-pose, with the same
soft even lighting and plain light grey background. Show every back detail clearly: [RETRO].
Portrait 3:4 format.
```

---

## KAISER — The Bass Drop (mischia, spadone)

**[ASPETTO]**
```
A tall athletic young man, about 1.85 m, with silver-white spiky hair swept back in sharp
layered spikes. He wears a black Persona-style domino mask with sharp wings, through which
his amber-gold eyes are visible. Long black coat reaching below the knees with a magenta
inner lining, thin gold trim along the front edges and a tall stiff collar; a layered gold
and black armored pauldron on his right shoulder only. Under the open coat: a fitted black
top with a diagonal black harness strap and a small gold buckle, a thin gold chain necklace
with a small pink diamond pendant. Slim black trousers, black boots with white soles, black
gloves with gold knuckle plates, a thin gold band on the left upper arm. A compact
mechanical grappling-gear belt around the hips: two dark metal gas canisters at the sides
with gold rings and small hook launchers.
```

**[RETRO]**
```
the long black coat falling straight down the back, and a gold winged speaker crest
embroidered between the shoulder blades (a magenta ring around a gold disc, three gold
feathers on each side, small equalizer bars above and a magenta downward chevron below)
```

**Arma a parte**
```
Isolated game prop concept: BASSLINE, a huge two-handed holographic greatsword, about 1.6 m
long, with a broad dark charcoal blade, a glowing gold neon cutting edge, magenta equalizer
light panels along the flat of the blade, a black and gold hilt with a long grip. Shown flat
in side view, centered, clean anime cel-shaded style, soft even lighting, plain light grey
background. Landscape 16:9 format.
```

## NOVA — Glitch Ronin (mischia, doppie katane)

**[ASPETTO]**
```
A slim agile young woman, about 1.68 m, with hot-pink spiky hair tied in a high ponytail
whose long tail fades from pink to cyan, and a side-swept bang. A thin cyan holographic visor
band sits across her eyes; her magenta eyes are visible through it. Cropped black bomber
jacket with glowing cyan neon piping on the seams and cuffs, black crop top, bare midriff,
black shorts over dark purple tights with small cyan glowing knee accents, white sneakers
with hot-pink soles. A long scarf fading from pink to cyan around her neck, fingerless black
gloves with white wrist wraps, small gold earrings. A compact mechanical grappling-gear belt
around the hips with two dark gas canisters accented in cyan.
```

**[RETRO]**
```
the ponytail hanging down the spine, the scarf tails, and a small glitched letter "N" patch
on the right shoulder blade of the jacket (white letter with offset cyan and magenta copies
and a few thin horizontal glitch bars)
```

**Armi a parte**
```
Isolated game prop concept: a matching pair of holographic katanas named SYNTH and SAMPLE,
each about 0.9 m long, slender black blades with a glowing edge (SYNTH cyan, SAMPLE
magenta), black wrapped grips and small square guards with neon accents. Both shown flat in
side view, one above the other, centered, clean anime cel-shaded style, soft even lighting,
plain light grey background. Landscape 16:9 format.
```

## REX — The Headliner (distanza, fucile bass-cannon)

**[ASPETTO]**
```
A relaxed confident young man, about 1.80 m, with dark brown skin, short black spiky hair on
top and teal shaved undercut sides. He wears purple holographic shades with a thin gold
frame; his teal eyes are visible behind the lenses. Oversized open purple hoodie with gold
zipper trim, white drawstrings and the hood bunched at the back of the neck, sleeves pushed
to the elbows; black t-shirt with a gold music-note print; a gold chain; large black DJ
headphones resting around his neck with gold rings and violet centers. Black cargo trousers
with side pockets, white sneakers, a black tech bracer with a small violet light on the left
forearm, a gold ring bracelet on the right wrist. A compact mechanical grappling-gear belt
around the hips with two dark gas canisters accented in violet.
```

**[RETRO]**
```
the hood bunched at the back of the neck and a large back print on the hoodie: a gold crown
above a big gold music note, with a short violet neon line underneath
```

**Arma a parte**
```
Isolated game prop concept: HEADLINER, a stylish bass-cannon rifle about 1.1 m long: a black
and purple body, a barrel made of stacked glowing pink speaker rings, a round sub-woofer drum
magazine under the body, a small equalizer screen on the side, gold details and a padded
stock. Shown flat in side view, centered, clean anime cel-shaded style, soft even lighting,
plain light grey background. Landscape 16:9 format.
```

## SERA — Holo Diva (distanza, scettro-microfono)

**[ASPETTO]**
```
A graceful young woman, about 1.65 m, with very long blonde twin tails that fade to lavender
at the tips, straight bangs and small pink bows holding the tails. She wears an elegant white
masquerade mask with gold edges; her violet eyes are visible through it. A thin floating
halo made of a pink ring and a cyan ring hovers behind her head. White and gold idol stage
dress: fitted bodice with gold piping and a pink bow with a gold center on the chest, a short
flared white skirt over a glowing cyan holographic petticoat, a pink waist sash. Detached
white bell sleeves from the elbows with a lavender lining and wavy gold frill cuffs, white
gloves, white thigh-high boots with gold trim. A compact grappling-gear belt around the hips
in white with pink accents.
```

**[RETRO]**
```
the twin tails falling down the back, the halo behind the head and a big pink bow tied at
the back of the waist
```

**Arma a parte**
```
Isolated game prop concept: ENCORE, an idol's microphone scepter about 1.5 m long: a slim
white and gold staff topped with a glowing star-shaped microphone head, two thin floating
holographic rings (pink and cyan) around the top and a long pink ribbon. Shown flat in side
view, centered, clean anime cel-shaded style, soft even lighting, plain light grey
background. Landscape 16:9 format.
```

---

## Prompt di correzione (un solo dettaglio)

```
Fix only the [dettaglio, es. "left glove"]. Keep every other element (character, pose,
colors, lighting, background) completely identical. It should look like this: [descrizione].
```

## Conversione in 3D

Con **Tripo** o **Meshy**, per ogni campione:

1. Image to 3D. Se lo strumento accetta più viste, carica fronte e retro (multiview).
2. Mesh **quad**, texture attive; obiettivo 20–40k triangoli e texture 2048 px.
3. **Auto-rig humanoid** (scheletro umanoide standard tipo Mixamo).
4. Esporta **GLB con skin**, in T-pose.
5. Salva in `public/models/<campione>.glb` (`kaiser`, `nova`, `rex`, `sera`).
   Le armi, se convertite, in `public/models/weapons/<nome>.glb`.

Per un gioco pubblicato serve un piano che consenta l'uso commerciale dei modelli generati.
