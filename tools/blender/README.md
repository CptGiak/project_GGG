# Modelli dei campioni da Blender (headless)

Questa pipeline ricostruisce i modelli 3D dei campioni partendo dalle schede Gemini in
`docs/art/sheets/`, interamente da script Python, e li esporta in `public/models/<id>.glb`.
Il gioco li carica all'avvio. Se il file manca o non si carica, resta il modello procedurale
(per forzarlo: `?models=0`).

## Setup

```bash
python3 -m venv /root/blender-venv
/root/blender-venv/bin/pip install bpy==5.2.2 pillow numpy scipy   # bpy 5.2 richiede Python 3.13
npm install                                                       # serve per tsx (dump delle pose)
```

Il render usa Cycles su CPU. EEVEE e Workbench in modalità headless richiedono libEGL, che non serve.

## Uso

```bash
PY=/root/blender-venv/bin/python
$PY tools/blender/build_kaiser.py --iter 9      # confronto docs/art/blender/kaiser_v9.png
$PY tools/blender/build_kaiser.py --poses       # docs/art/blender/kaiser_poses.png
$PY tools/blender/build_kaiser.py --export      # public/models/kaiser.glb
$PY tools/blender/sheet_measure.py kaiser       # solo le misure delle schede
```

Ogni esecuzione rigenera tutto da zero: scena vuota, misure, palette, texture, mesh, rig e pesi.
I flag si possono combinare (`--iter 10 --poses --export`).

## Cosa fa

1. **Misure** (`sheet_measure.py`, PIL + numpy + scipy)
   - Isola la figura (riquadri di annotazione esclusi).
   - Ricava la scala dal viso: linea degli occhi a metà testa, mento, quindi sommità del cranio. Kaiser è 1,85 m dalla suola al cranio, capelli esclusi.
   - Misura i profili di larghezza per altezza, le punte dei capelli sulla sagoma e il contorno della maschera.
   - Ritaglia lo stemma del retro come texture con trasparenza.
2. **Palette**: colori piatti campionati in riquadri per materiale (tono luce e tono ombra). La provenienza di ogni campione è in `kaiser_measurements.json`.
3. **Modello in T-pose** (assi Blender: X = sinistra del personaggio, −Y = fronte, Z = su)
   - Corpo: Skin modifier + subdivision.
   - Abiti come profili estrusi (loft di anelli superellittici). Cappotto con fodera magenta via Solidify (la fodera si vede solo vicino ai bordi). Falde anteriori corte, pannello posteriore lungo con spacco.
   - Capelli a ciocche con sezione a rombo, così la luce divide le facce in due toni.
   - Maschera tracciata dalla scheda, spallaccio a lamine solo sulla spalla destra, cintura con bombole, guanti, stivali.
   - Circa 15,5k triangoli.
4. **Rig**: stesse 19 ossa, gerarchia e formula delle articolazioni di `src/fighter/Rig.ts`. Le proporzioni stanno negli extras del GLB (`ggg_spec`). Ossa extra: 6 catene da 3 ossa per le falde del cappotto e dita (2 + pollice).
   - Pesi automatici (bone heat) per pezzo, limitati alle ossa ammesse.
   - Correzioni: il cappotto non ha pesi sulle gambe e la fascia sotto la cintura segue le anche; il colletto sta sul petto; lo spallaccio è pesato su clavicola e braccio; i bordini d'oro copiano i pesi del capo su cui stanno; al massimo 4 influenze per vertice.
5. **Verifica**
   - `--iter N`: render ortografico fronte/retro con la stessa inquadratura e lo stesso sfondo delle schede, nella posa A delle schede ottenuta dall'armatura. Accanto la scheda, con differenza di sagoma, IoU ed errore di larghezza.
   - `--poses`: pose vere del gioco esportate da `dump_poses.ts` (stesse animazioni e stessa IK di `FighterAnimator`) applicate allo scheletro del GLB.
6. **Export** GLB (metri, Y-up, T-pose), una mesh con una primitiva per materiale. Negli extras: catene delle falde e socket di rampini e ugello.

## Nel gioco

`src/champions/glbModels.ts` e `kaiserGlb.ts`:

- Il `Rig` procedurale resta lo scheletro "pilota", quindi animazioni, IK e armi restano quelle esistenti. Dopo l'IK, `syncPose` copia ogni osso sull'osso del GLB con lo stesso nome (retarget in model space).
- Le dita si chiudono sull'impugnatura.
- Le falde sono catene verlet che collidono con le sfere del corpo (gambe).
- I materiali diventano `toon()` con i parametri per materiale; il contorno è un unico guscio invertito con skinning (`outlineMaterialSkinned`).

## Campioni importati da League of Legends

Esperimento per giocare tra amici: Akali (True Damage), Qiyana (True Damage) e Locke con le mesh e
le texture originali di LoL, mosse e numeri presi in prestito dai kit esistenti (Akali e Locke
giocano col kit di Nova, Qiyana con quello di Kaiser; `KIT_OF` in `shared/champions.ts`).

I file di LoL e tutto ciò che ne deriva **non vanno in git** (`tools/blender/lol/_cache/`,
`public/models/lol/` sono ignorati): ogni copia del gioco li rigenera con i due comandi qui sotto.
Senza i file i tre campioni non compaiono nei menu e il gioco resta quello di prima. Finché ci
sono, il menu principale mostra la nota richiesta da Riot per i progetti dei fan.

```bash
PY=/root/blender-venv/bin/python
python3 -I tools/blender/lol/fetch.py akali qiyana locke          # scarica da raw.communitydragon.org
$PY -I tools/blender/build_lol.py akali qiyana locke --export      # public/models/lol/<id>.glb
$PY -I tools/blender/build_lol.py locke --render --poses           # render di controllo in _cache/<id>/renders
$PY -I tools/blender/build_lol.py akali --preview                  # la mesh com'è nei file di gioco
```

Le skin, la scala, le armi (impugnatura e assi) e gli eventuali pezzi da nascondere stanno in
`tools/blender/lol/skins.py`.

### Come funziona

1. **Download** (`lol/fetch.py`): dai dati della skin (`skinN.bin.json`) prende la mesh `.skn`, le
   texture di ogni pezzo (il mirror le converte in PNG) e i pezzi nascosti di default.
2. **Mesh** (`lol/lolfmt.py`): lettura della `.skn` (sotto-mesh, vertici, 4 influenze per vertice).
   LoL è sinistrorso: X specchiato e avvolgimento dei triangoli invertito. Il controllo è il testo
   sulle texture: dopo l'import si legge dritto ("TRUE DAMAGE" sulla gamba di Qiyana).
3. **Scheletro** (`lol/rig_infer.py`): il mirror non pubblica gli scheletri `.skl`, quindi
   l'ossatura si ricostruisce dai pesi.
   - Due influenze che condividono vertici sono collegate. L'articolazione è il centro
     dell'anello dove i loro pesi si mescolano.
   - Albero di copertura massimo dal bacino.
   - Gambe risalendo dai piedi, colonna fino alla testa, braccia verso l'esterno fino alla mano
     (dove partono le dita).
   - Ginocchio e gomito per posizione lungo l'arto. Se una manica imbottita sposta il gomito, si
     usa il 52% della distanza spalla-polso.
   - Tutto il resto (viso, capelli, vestiti, accessori) va all'osso del gioco più vicino.
   - Le catene lunghe che pendono dal tronco diventano ossa a parte: sono le falde del cappotto
     di Locke.
   - I pesi originali di LoL restano: si sommano per osso del gioco, al massimo 4 per vertice.
4. **T-pose** (`build_lol.py`): con un'armatura provvisoria nella posa di bind, braccia orizzontali e
   dritte, gambe verticali; la coda di Akali viene abbassata e diventa una catena appesa alla testa.
   La deformazione si applica alla mesh, poi le proporzioni del `Rig` del gioco (`ggg_spec`) si
   ricavano dalle articolazioni. Le ossa del GLB restano sulle articolazioni vere (il gioco copia
   solo le rotazioni).
5. **Armi**: i pezzi delle armi vengono portati nel sistema del perno della mano (impugnatura
   nell'origine, punta lungo +Z) ed esportati come mesh separate `weapon_R` / `weapon_L`.
6. **Animazioni**: le clip dei kit hanno bersagli assoluti pensati per il corpo di Nova o di Kaiser;
   `animScale` (spalle del modello / spalle del corpo del kit, negli extras del GLB) scala bersagli
   delle armi e spostamenti del bacino.

Nel gioco `src/champions/lolGlb.ts` usa lo stesso retarget di Kaiser (`glbModels.ts`). Le armi stanno
su perni attaccati alle mani del modello (`handPivot`), così restano nel pugno visibile. Le falde e
la coda sono catene verlet che collidono con le sfere del corpo.
