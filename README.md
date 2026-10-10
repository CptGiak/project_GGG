# PROJECT GGG — Neon Grapple Arena

Arena brawler **PvP per browser** con movimento tridimensionale in stile *Attack on Titan* (manovra
3D con doppio rampino e gas) / *Spider-Man* (swing, wall-run), grafica **cel-shading stile Persona**
e campioni dal design *Final Fantasy* con armi moderne e "vibranti" ispirate alle skin *True Damage*.

Tutto è generato proceduralmente nel codice: modelli 3D, animazioni, arene, effetti, musica e suoni
(nessun asset esterno).

![stack](https://img.shields.io/badge/three.js-r186-black) ![ts](https://img.shields.io/badge/TypeScript-strict-blue) ![node](https://img.shields.io/badge/Node-22+-green)

---

## Avvio rapido

```bash
npm install
npm run dev          # client + server PvP su http://localhost:5173
```

Apri `http://localhost:5173` nel browser (Chrome/Edge/Firefox desktop). Per giocare in LAN con gli amici
apri `http://<IP-del-tuo-PC>:5173` dagli altri computer.

Build di produzione:

```bash
npm run build        # compila il client in ./dist
npm start            # serve ./dist + WebSocket PvP (porta 8080, configurabile con PORT=...)
```

### Giocare con gli amici (Discord)

**Subito, dal tuo PC** — nessun account, nessuna porta da aprire:

```bash
npm install
npm run share        # build + server + tunnel Cloudflare gratuito
```

Nel terminale compare un link `https://xxxx.trycloudflare.com`: mandalo su Discord. Tutti scelgono
**ONLINE PVP** e inseriscono lo stesso codice **STANZA** (oppure *Partita veloce*). In partita,
**ESC → COPIA LINK INVITO** copia un link che porta gli amici dritti nella tua stanza
(`...?room=CODICE`). Il link resta valido finché il terminale è aperto; tu ospiti il server, quindi
gli altri giocano col ping verso il tuo PC.

**Server sempre acceso** — il server serve gioco e WebSocket sullo stesso URL:
- **Render** (gratis): *New → Blueprint* e scegli questo repo; usa `render.yaml`. Il piano free va in
  pausa dopo ~15 minuti di inattività (la prima apertura impiega ~1 minuto).
- **Docker** (Fly.io, Railway, VPS): `Dockerfile` incluso, ascolta su `$PORT` (default 8080).

Una build statica (`VITE_STATIC=1`) può puntare a un server remoto con
`VITE_SERVER_URL=https://mio-server.onrender.com` in fase di build, oppure aggiungendo
`?server=mio-server.onrender.com` all'indirizzo della pagina.

Versione statica senza server (solo allenamento contro i bot), come pagina unica da pubblicare
anche come artifact di Claude: `node tools/build_static.mjs` scrive `dist-static/index.html`
(three.js da jsDelivr, il resto inline) e `dist-static/models.json` (i modelli GLB in base64).

Avvio diretto di una partita di test: `http://localhost:5173/?play&champ=nova&arena=stage&bots=3`
Visualizzatore modelli/animazioni: `http://localhost:5173/?viewer&champ=kaiser&anims=idle,run@0.2,atk1@0.13`

---

## Comandi

| Tasto | Azione |
|---|---|
| **W A S D** | movimento / sterzata in volo (orbita attorno al punto d'aggancio) |
| **Mouse** | mira (clicca nella finestra per bloccare il cursore) |
| **Q / E** | rampino sinistro / destro — tieni premuto per restare agganciato (ogni lancio costa gas) |
| **SPAZIO** | salto · agganciato: **boost a gas** · in aria: doppio salto a gas |
| **SHIFT** | scatto con frame di invulnerabilità |
| **LMB** | **abilità firma** del campione (stile "Q" di LoL, con ricarica) |
| **RMB** | attacco base / fuoco (come il click destro di LoL) |
| **C** | abilità secondaria |
| **F** | abilità speciale |
| **R** | ultimate (si carica infliggendo danni) |
| **T** | provocazione (emote, a terra e da fermo) |
| **TAB** | classifica · **ESC** pausa |

Tutti i tasti d'azione si possono **riassegnare** da *COMANDI* (menu principale) o da
*IMPOSTAZIONI → TASTI* (anche in pausa): clicca il tasto e premi quello nuovo, anche un pulsante
del mouse. Se il tasto è già usato da un'altra azione, le due si scambiano.

### Il sistema di movimento
- Il rampino punta dove miri (con *aim assist* a cono se manchi il bersaglio); con due rampini formi una V e puoi orbitare.
- Agganciarsi dà uno strattone verso il punto d'aggancio; **SPAZIO** spinge col gas (consuma la barra GAS).
- La corda è un vincolo fisico: cadendo **oscilli come un pendolo**; lascia il tasto al momento giusto per essere catapultato.
- Sbattendo contro un muro ad alta velocità mentre premi **W** ci **corri sopra** (wall-run) e scavalchi i tetti.
- Puoi agganciare anche **i nemici** (puntali e premi Q/E) per raggiungerli.
- Atterrando ad alta velocità esegui in automatico una **capriola** che conserva lo slancio.
- In aria solo il **primo attacco** di un salto ti solleva o ti tiene sospeso; i successivi cadono
  normalmente. Si ricarica toccando terra, correndo su un muro o agganciandoti.
- Il serbatoio del gas è grande ma si ricarica lentamente (più veloce a terra), e solo dopo un secondo
  dall'ultimo consumo. **Ogni lancio di rampino costa gas**: col serbatoio vuoto Q/E fanno solo *clic*,
  e dovrai correre o cadere finché non si ricarica.

---

## Campioni

| | Ruolo | Arma | LMB (abilità firma) | RMB (attacco base) | C | F | R (Ultimate) |
|---|---|---|---|---|---|---|---|
| **KAISER** — *The Bass Drop* | Mischia | BASSLINE, spadone olografico con equalizzatore live | **Power Chord**: fendente dall'alto che manda avanti un'onda d'urto; la punta (*sweet spot*) fa più danni e lancia in aria | Combo 3 fendenti (in aria: cleave rotante) | Guardia + **parata perfetta** (stordisce) | Drop Dive: affondo perforante (anche in picchiata) | Encore Break: balzo e schianto ad area |
| **NOVA** — *Glitch Ronin* | Mischia | SYNTH & SAMPLE, doppie holo-katane | **Cross Fade**: taglio a X che vola in avanti, trapassa e marchia i nemici | Combo 4 colpi (in aria: Rising Remix) | Glitch Step: scatto invulnerabile che taglia | Phantom Cut: teletrasporto alle spalle, critico garantito | Remix Barrage: 8 tagli a teletrasporto |
| **REX** — *The Headliner* | Distanza | HEADLINER, fucile bass-cannon | **Lead Single**: proiettile pesante a lunga gittata; se colpisce riduce le ricariche | Raffica (colpi alla testa = critici) | Bass Charge: carica con zoom, raggio perforante | Sub Bomb: granata sonica rimbalzante | Drop The Beat: 12 missili-nota a ricerca |
| **SERA** — *Holo Diva* | Distanza | ENCORE, scettro-microfono | **High Note**: nota lanciata a parabola che esplode nel punto mirato, più forte al centro | Sfere sonore a ricerca | Resonance: raggio canalizzato che rallenta | Echo Wave: onda di respinta | Grand Finale: colonna di luce + cura |
| **AKALI** — *True Damage* | Mischia | kama e kunai | **Five Point Strike** (la sua Q): ventaglio di 5 kunai che marchia e rallenta sulla punta | 2 fendenti + colpo rotante col kama (in aria: affondo ascendente) | Twilight Shroud: nube di fumo, invisibile e più veloce | Shuriken Flip: capriola + shuriken, ripremi F per piombare sul bersaglio | Perfect Execution: doppio scatto che giustizia |
| **QIYANA** — *True Damage* | Mischia | lama ad anello d'oro | **Edge of Ixtal** (la sua Q): taglio in linea, con un elemento diventa l'Ira degli Elementi | 2 fendenti (in aria: affondo ascendente) | Terrashape: scatto che incanta l'anello (Terra / Acqua / Erba) e azzera la Q | Audacity: balzo sul nemico mirato | Supreme Display of Talent: onda che esplode contro i muri |
| **LOCKE** — *L'Esorcista Cinereo* | Mischia | paletto d'argento e chiodi | **Ritual Nails** (la sua Q): fila di chiodi che rallenta e lascia cariche, rilanciabile 2 volte | Exorcism: combo di 4 colpi che fa esplodere le cariche | Soul Ignition (la sua W): velocità e cura sui danni per 4 s | Ashen Pursuit: teletrasporto + fendente circolare | Purgatory: reliquiario che sigilla i nemici sotto il 25% |

Ogni modello è costruito da primitive scolpite (lathe, sweep, estrusioni avvolte, ciocche curve) su uno
scheletro di 19 ossa, con **cloth simulation** (cappotti, gonne, sciarpe, code di cavallo, nastri),
animazioni a keyframe con easing, **IK a due ossa** guidata dall'arma (le traiettorie della lama sono
autorate e le braccia seguono), scie delle lame, inclinazione/banking in volo e mira che segue la camera.

### Stile e animazioni
- **Occhi anime** a strati (sclera, iride bicolore, pupilla, riflessi, ciglia) visibili attraverso
  maschere e visori, con battito di ciglia; capelli con l'"anello di luce" anime.
- **Tutto a tempo di musica**: neon delle armi, equalizzatori e schermi delle arene pulsano su cassa e
  rullante della colonna sonora procedurale.
- **Immagini residue olografiche** delle armi durante i fendenti; durante l'**ultimate** l'arma si
  trasforma in un ologramma gigante (lo spadone di Kaiser diventa una colonna di luce).
- **Cut-in stile Persona** all'attivazione dell'ultimate (primo piano degli occhi + nome della mossa),
  compatti e ai bordi dello schermo per non coprire l'azione: i tuoi eventi (ultimate, TAKE DOWN,
  parata) entrano da sinistra, le ultimate nemiche da destra sotto il kill feed.
- In volo il corpo segue la tensione delle corde come un pendolo; lasciando i rampini mentre sali parte
  un **salto mortale** (o un avvitamento dopo uno swing laterale), anche nel doppio salto a gas.
- Reazioni ai colpi **direzionali** (più forti con i colpi pesanti), avvitamento all'indietro quando
  vieni lanciato in aria, provocazioni personali (**T**) e inquadratura del vincitore a fine partita.

## Arene
- **SHIBUYA VELVET** — città notturna rosso/nera stile Persona 5, incrocio "scramble", cavalcavia e ferrovia sopraelevata.
- **TRUE NOTE ARENA** — stadio-concerto: palco con muro LED, torri di casse, un enorme anello di luci sospeso su cui fare swing.
- **MIDNIGHT TARTARUS** — l'"ora nascosta" di Persona 3: luna verde gigante, torre centrale, isole fluttuanti sull'acqua.

## Modalità
- **Allenamento**: contro 1–5 bot (che usano anche i rampini) in tre livelli di difficoltà.
- **Online PvP**: deathmatch fino a 6 giocatori, primi a 15 uccisioni o 6 minuti. *Partita veloce* o
  **stanza privata** con codice da condividere. Al termine parte una nuova partita con arena a rotazione.

---

## Architettura

```
shared/            dati condivisi client/server (campioni, danni, arene, protocollo)
server/            server Node: HTTP (Vite middleware in dev / dist in prod) + WebSocket /ws
  Room.ts          stanza: relay movimento, validazione colpi, HP/kill/respawn, rotazione arene
src/
  core/            Engine (renderer + post-processing), Input, Audio sintetizzato, Settings
  render/          toon shader (2 toni, rim, ombre colorate), outline a scafo invertito, ologrammi, PostFX
  fighter/         Rig, Animator (pose/clip/IK), locomozione, cloth (verlet), costruttore di modelli
  champions/       i 4 campioni: modello, materiali, animazioni
  combat/          kit delle abilità, proiettili, colpi corpo a corpo
  game/            Fighter (fisica + rampini), Match, camera, controller locale, IA dei bot
  world/           mondo di collisione (box orientati + griglia), costruttore arene, le 3 arene
  vfx/             particelle istanziate, scie delle lame, onde d'urto, raggi
  net/             client WebSocket e sessione online (interpolazione, danni autoritativi)
  ui/              HUD e menu stile Persona, stage 3D dei menu
```

**Rete**: ogni client simula il proprio personaggio (movimento reattivo) e invia lo stato a 20 Hz; il
server inoltra gli snapshot e i client interpolano gli avversari (~110 ms) stimando l'orologio del server.
I colpi sono rilevati dall'attaccante ma **validati dal server** (abilità/parte esistente, rate-limit,
distanza plausibile, guardia/parata): il client non invia mai numeri di danno.

## Roadmap
- nuovi campioni e skin, modalità a squadre, matchmaking pubblico
- rebinding dei tasti, supporto gamepad, ottimizzazioni per GPU integrate
