# Arte delle arene (Blender)

Le tre arene usano arte modellata in Blender e generata da script, in headless, con il modulo
`bpy`. Gli script producono due tipi di risorse in `public/models/arenas/`:

- **tile di texture** (`<tema>_<nome>.png`): pezzi di facciata o di pavimento in metri reali,
  ripetibili senza cuciture. Il canale RGB è l'albedo (con un'ombreggiatura morbida già cotta), il
  canale alpha, quando c'è, è la maschera delle luci (finestre, LED, rune);
- **kit di pezzi 3D** (`<tema>.glb` + `<tema>_atlas.png`): oggetti statici (cisterne, lampioni,
  fari, catene, bare...) mappati su un piccolo atlante a tinte piatte, con due soli materiali
  (`atlas` in cel shading, `glow` non illuminato). Ogni arena costa una texture per il kit.

I pezzi del kit sono solo grafica: i collider restano scritti nei file delle arene
(`src/world/arenas/*.ts`), così la forma del gameplay non dipende mai dall'arte. Il restyle ha
lasciato identici tutti i collider e l'ordine dei numeri casuali che genera il layout.

## Requisiti

- Python 3.11+ con il modulo `bpy` di Blender (testato con bpy 5.2.2 su Python 3.13), `numpy` e
  `Pillow`, ad esempio in un venv: `python3.13 -m venv ~/blender-venv && ~/blender-venv/bin/pip install bpy numpy pillow`;
- per le insegne: Noto Sans CJK (giapponese) e un font latino bold (vedi `JP_FONT_PATHS` e
  `LATIN_FONT_PATHS` in `kit.py`).

Il rendering usa Cycles su CPU; un tema intero richiede uno o due minuti.

## Comandi

```sh
PY=~/blender-venv/bin/python
$PY -I tools/blender/arenas/build.py city --textures          # tile della città
$PY -I tools/blender/arenas/build.py stage --kit --preview    # kit dello stadio + foglio di anteprima
$PY -I tools/blender/arenas/build.py tartarus --textures --only tower,obelisk
$PY -I tools/blender/arenas/build.py all --textures --kit
```

Le anteprime (albedo e maschere dei tile, foglio dei pezzi del kit) finiscono in `_cache/`, che è
ignorata da git.

## File

| File | Contenuto |
| --- | --- |
| `kit.py` | utilità condivise: materiali, primitive (box, cilindri, prismi, tori, testo), booleane, render dei tile in Cycles, atlante e export GLB, foglio di anteprima |
| `city.py` | SHIBUYA VELVET: facciate (uffici, piastrelle, villette, vetro, quattro negozi, skyline lontano) e kit dei tetti, della ferrovia e della torre dei cartelloni |
| `stage.py` | TRUE NOTE ARENA: pavimento, palco, grigliati, sedute e balconate per lato (est verde acqua, sud viola, ovest rosa), casse, truss; kit di fari, teste mobili, flight case, transenne, droni |
| `tartarus.py` | MIDNIGHT TARTARUS: piani della torre (con fregio rosso ogni tre piani), bordi delle isole, pietra, obelischi runici, scacchiera, lastricato; kit di rocce, colonne, lanterne, catene, bare, piramidione |
| `build.py` | riga di comando |

## Convenzioni

- **Tile**: costruiti in `[0, L] x [0, A]` metri; vista `front` (piano XZ rivolto a -Y) per le
  facciate, `top` (piano XY) per i pavimenti. Vengono renderizzati in una griglia 3 x 3 di copie,
  quindi ombre e giunti continuano oltre i bordi. Un blocco che attraversa il bordo va modellato
  intero su un solo lato (la copia vicina fa il resto): due facce sovrapposte e complanari creano
  righe scure sul bordo.
- **Maschera delle luci**: i materiali che iniziano con `glass` o `lit` valgono 1, quelli con `dim`
  0.55, il resto 0. Nel gioco `facadeMaterial` accende la maschera come finestre casuali
  (`windows`) o come luce propria (`selflit`, con `steady` per i LED tutti uguali).
- **Pezzi del kit**: origine al centro della base (o in cima per i pezzi appesi: catene, fari,
  rocce sotto le isole), fronte verso -Y in Blender, cioè +Z nel gioco. I materiali con `emit > 0`
  finiscono nel materiale `glow`.
- **Comfort visivo**: le parti luminose restano sotto la soglia del bloom (luminanza circa 1.45),
  niente lampeggi, motivi procedurali anti-aliasati, griglie LED che sfumano alla media in
  lontananza, movimenti lenti.

## Nel gioco

- `src/world/ArenaArt.ts` carica texture (`artTexture`) e kit (GLB) appena il modulo viene
  importato; se manca una texture il materiale resta a tinta unita (senza luci), se manca un kit
  restano le forme semplici.
- `src/world/ArenaBuilder.ts`: `piece()` piazza i pezzi del kit (uniti nei batch per materiale),
  `tiledBox()` crea scatole con UV che contano i tile (finestre allineate piano per piano),
  `beamBox()` travi e truss, `lightbox()` / `signFace()` le insegne (un unico atlante canvas).
- `src/world/materials.ts`: `facadeMaterial`, `worldMaterial` (texture proiettate in coordinate
  mondo), `groundMaterial` (strisce pedonali, cerchi dello stadio, acqua calma con il riflesso della
  luna), `ledScreenMaterial` (schermi LED tranquilli), `skyMaterial`.
