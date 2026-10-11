/**
 * Gameplay data shared by client and server. The server uses the damage tables and ranges to
 * validate hit claims, so clients never send raw damage numbers.
 */

export type Role = 'melee' | 'ranged';
/**
 * sig = signature skill (LoL "Q"-style, on cooldown) · atk = basic attacks · sec = secondary ·
 * abi = special ability · ult = ultimate
 */
export type AbilitySlot = 'atk' | 'sig' | 'sec' | 'abi' | 'ult';
/** display order in the HUD and menus */
export const SLOT_ORDER: AbilitySlot[] = ['sig', 'atk', 'sec', 'abi', 'ult'];

export interface AbilityData {
  slot: AbilitySlot;
  /** default key (the real one comes from the player's bindings) */
  key: 'LMB' | 'RMB' | 'C' | 'F' | 'R';
  name: string;
  desc: string;
  cooldown: number;
  /** damage per hit "part" */
  damage: Record<string, number>;
  /** generous max distance between attacker and target for validation (m) */
  range: number;
  /** max hits per second the server accepts for this ability (anti-spam) */
  maxRate: number;
  /** parts that hit harder when started at speed (momentum strikes) */
  momentum?: string[];
  /** parts that always crit (any hit can also be a counter crit after a perfect dodge or parry) */
  crit?: string[];
  /** parts that crit from behind: the server checks the target's facing */
  backstab?: string[];
  /** parts that crit on the head: the server checks the reported hit point */
  headshot?: string[];
  /** rapid-fire / channelled parts: they miss in i-frames but never count as a perfect dodge */
  stream?: string[];
}

export interface ChampionData {
  id: ChampionId;
  name: string;
  title: string;
  role: Role;
  difficulty: 1 | 2 | 3;
  hp: number;
  speed: number;
  /** damage dealt (not overkill, not from the ultimate) that fills the ultimate bar; other plays add to it */
  ultCharge: number;
  colors: [string, string];
  weapon: string;
  bio: string;
  abilities: Record<AbilitySlot, AbilityData>;
  /** has a held guard (Kaiser's Mute Guard): the server ignores guard flags from anyone else */
  guard?: boolean;
  /**
   * replicated actions that make the champion invulnerable: seconds, and how often the server
   * accepts them (a budget of `burst` uses, refilled one per `every` seconds)
   */
  invulnActs?: Record<string, { sec: number; every: number; burst?: number }>;
  /** always-on effect (shown in champion select) */
  passive?: { name: string; desc: string };
}

export type ChampionId = 'kaiser' | 'nova' | 'rex' | 'sera' | 'akali' | 'qiyana' | 'locke' | 'pooh';
export const CHAMPION_IDS: ChampionId[] = ['kaiser', 'nova', 'rex', 'sera', 'akali', 'qiyana', 'locke', 'pooh'];

/** champions modelled on League of Legends ones (models from tools/blender/build_lol.py) */
export const LOL_CHAMPIONS: ChampionId[] = ['akali', 'qiyana', 'locke'];

export const CHAMPIONS: Record<ChampionId, ChampionData> = {
  kaiser: {
    id: 'kaiser',
    name: 'KAISER',
    title: 'The Bass Drop',
    role: 'melee',
    difficulty: 1,
    hp: 1150,
    speed: 1.0,
    ultCharge: 1400,
    guard: true,
    colors: ['#ffc24a', '#ff2e88'],
    weapon: 'BASSLINE — holo greatsword',
    bio: 'Ex-frontman diventato leggenda dell\'arena. Ogni colpo di BASSLINE è un drop che fa tremare il palco.',
    abilities: {
      sig: { slot: 'sig', key: 'LMB', name: 'Power Chord', desc: 'Fendente dall\'alto che manda avanti un\'onda d\'urto. La punta (sweet spot) fa più danni e lancia in aria.', cooldown: 5, damage: { wave: 95, tip: 150 }, range: 14, maxRate: 4 },
      atk: { slot: 'atk', key: 'RMB', name: 'Verse Combo', desc: 'Combo di 3 fendenti con lo spadone. In aria: Cleave rotante.', cooldown: 0, damage: { c1: 70, c2: 70, c3: 115, air: 85, shock: 55 }, range: 7, maxRate: 6, momentum: ['c1', 'c2', 'c3', 'air'], backstab: ['c1', 'c2', 'c3', 'air'] },
      sec: { slot: 'sec', key: 'C', name: 'Mute Guard', desc: 'Tieni premuto per parare (-75% danni frontali). Parata perfetta: stordisce l\'attaccante e apre la RIPOSTA (attacco base): affondo critico imparabile.', cooldown: 0.6, damage: { riposte: 90 }, range: 12, maxRate: 2 },
      abi: { slot: 'abi', key: 'F', name: 'Drop Dive', desc: 'Affondo devastante in avanti che trafigge tutti sulla traiettoria.', cooldown: 7, damage: { dive: 135 }, range: 22, maxRate: 3, momentum: ['dive'], backstab: ['dive'] },
      ult: { slot: 'ult', key: 'R', name: 'Encore Break', desc: 'Balzo in alto e schianto: onda d\'urto ad area che lancia in aria i nemici.', cooldown: 0, damage: { slam: 380 }, range: 14, maxRate: 4 },
    },
  },
  nova: {
    id: 'nova',
    name: 'NOVA',
    title: 'Glitch Ronin',
    role: 'melee',
    difficulty: 3,
    hp: 950,
    speed: 1.12,
    ultCharge: 1300,
    colors: ['#2ef2ff', '#ff3fd0'],
    weapon: 'SYNTH & SAMPLE — twin holo-katanas',
    bio: 'Hacker del ritmo, si muove tra un beat e l\'altro. Le sue lame lasciano scie glitch nell\'aria.',
    abilities: {
      sig: { slot: 'sig', key: 'LMB', name: 'Cross Fade', desc: 'Taglio a X con le due katane che vola in avanti e trapassa i nemici, marchiandoli per 4 s (Phantom Cut li insegue).', cooldown: 4, damage: { cross: 85 }, range: 22, maxRate: 4 },
      atk: { slot: 'atk', key: 'RMB', name: 'Sample Flurry', desc: 'Combo rapida di 4 colpi con le doppie katane. In aria: Rising Remix.', cooldown: 0, damage: { c1: 44, c2: 44, c3: 52, c4: 85, air: 58 }, range: 6.5, maxRate: 10, momentum: ['c1', 'c2', 'c3', 'c4', 'air'], backstab: ['c1', 'c2', 'c3', 'c4', 'air'] },
      sec: { slot: 'sec', key: 'C', name: 'Glitch Step', desc: 'Scatto istantaneo attraverso i nemici (invulnerabile), lascia un\'eco che taglia e li marchia per 4 s.', cooldown: 4, damage: { pass: 65 }, range: 16, maxRate: 3, momentum: ['pass'] },
      abi: { slot: 'abi', key: 'F', name: 'Phantom Cut', desc: 'Si teletrasporta alle spalle del bersaglio mirato (preferisce i marchiati) e colpisce con un critico. Su un marchiato: metà ricarica.', cooldown: 9, damage: { cut: 155 }, range: 30, maxRate: 3, crit: ['cut'] },
      ult: { slot: 'ult', key: 'R', name: 'Remix Barrage', desc: 'Raffica di 8 tagli glitch a velocità impossibile sui nemici vicini.', cooldown: 0, damage: { hit: 46 }, range: 16, maxRate: 20 },
    },
    // a takedown resets Glitch Step and halves Phantom Cut (4.5 s on a marked target): a few can chain
    invulnActs: { glitch: { sec: 0.25, every: 3.5, burst: 3 }, phantom: { sec: 0.2, every: 4, burst: 3 }, ult: { sec: 1.8, every: 10 } },
  },
  rex: {
    id: 'rex',
    name: 'REX',
    title: 'The Headliner',
    role: 'ranged',
    difficulty: 2,
    hp: 900,
    speed: 1.0,
    ultCharge: 1500,
    colors: ['#9b5cff', '#ffc94a'],
    weapon: 'HEADLINER — bass cannon rifle',
    bio: 'Producer e cecchino. Il suo fucile a onde soniche spara bassi così profondi da spezzare le difese.',
    abilities: {
      sig: { slot: 'sig', key: 'LMB', name: 'Lead Single', desc: 'Un singolo proiettile sonico potenziato a lunga gittata. Se colpisce riduce le altre ricariche di 1,5s. Testa = CRITICO.', cooldown: 4.5, damage: { slug: 125 }, range: 150, maxRate: 2, headshot: ['slug'] },
      atk: { slot: 'atk', key: 'RMB', name: 'Beat Shot', desc: 'Raffica di proiettili sonici veloci. Colpo alla testa = CRITICO. Oltre i 28 m perde potenza.', cooldown: 0, damage: { shot: 46 }, range: 140, maxRate: 7, headshot: ['shot'], stream: ['shot'] },
      sec: { slot: 'sec', key: 'C', name: 'Bass Charge', desc: 'Tieni premuto per caricare, rilascia per un raggio perforante fino a 270 danni. Rilascio perfetto appena carico: 300 danni e ricarica dimezzata. Troppo a lungo: si scarica.', cooldown: 1.2, damage: { charge: 270, perfect: 300 }, range: 180, maxRate: 2, headshot: ['charge'] },
      abi: { slot: 'abi', key: 'F', name: 'Sub Bomb', desc: 'Lancia una granata sonica che esplode e respinge i nemici.', cooldown: 8, damage: { blast: 140 }, range: 70, maxRate: 4 },
      ult: { slot: 'ult', key: 'R', name: 'Drop The Beat', desc: '12 missili-nota a ricerca sui nemici davanti a te.', cooldown: 0, damage: { note: 52 }, range: 120, maxRate: 30 },
    },
  },
  sera: {
    id: 'sera',
    name: 'SERA',
    title: 'Holo Diva',
    role: 'ranged',
    difficulty: 2,
    hp: 950,
    speed: 1.04,
    ultCharge: 1400,
    colors: ['#ff7ad9', '#7af6ff'],
    weapon: 'ENCORE — sonic mic-scepter',
    bio: 'Idol olografica che canta in sette ottave. La sua voce è letteralmente un\'arma.',
    abilities: {
      sig: { slot: 'sig', key: 'LMB', name: 'High Note', desc: 'Lancia una grande nota a parabola che esplode nel punto mirato. Al centro dell\'esplosione i danni aumentano.', cooldown: 5, damage: { note: 90, core: 140 }, range: 60, maxRate: 5 },
      atk: { slot: 'atk', key: 'RMB', name: 'Note Orb', desc: 'Sfere sonore leggermente a ricerca.', cooldown: 0, damage: { orb: 56 }, range: 120, maxRate: 5 },
      sec: { slot: 'sec', key: 'C', name: 'Resonance', desc: 'Canalizza un raggio sonico continuo che rallenta. CRESCENDO: sullo stesso bersaglio il danno sale fino al doppio in 1 s.', cooldown: 2.5, damage: { tick: 22 }, range: 45, maxRate: 14, stream: ['tick'] },
      abi: { slot: 'abi', key: 'F', name: 'Echo Wave', desc: 'Onda sonora circolare: danni, respinta e rallentamento.', cooldown: 9, damage: { wave: 115 }, range: 11, maxRate: 4 },
      ult: { slot: 'ult', key: 'R', name: 'Grand Finale', desc: 'Un riflettore colpisce il punto mirato: colonna di luce devastante e cura per te.', cooldown: 0, damage: { pillar: 400 }, range: 90, maxRate: 4 },
    },
  },
  // ---- League of Legends ports: League kits mapped onto LMB / RMB / F / R ----------------------
  akali: {
    id: 'akali',
    name: 'AKALI',
    title: 'La Ninja Ribelle',
    role: 'melee',
    difficulty: 3,
    hp: 920,
    speed: 1.12,
    ultCharge: 850,
    colors: ['#a15cff', '#ff6a3d'],
    weapon: 'Kama e kunai',
    bio: 'Rapper dei True Damage e assassina senza maestro. Sparisce nel fumo, marchia il bersaglio e chiude il conto prima del ritornello.',
    invulnActs: { flipDash: { sec: 0.5, every: 9 }, exec: { sec: 0.45, every: 10, burst: 2 } },
    passive: { name: 'Marchio dell\'Assassina', desc: 'Kunai, shuriken e scatti marchiano i nemici: il colpo seguente sul bersaglio marchiato infligge danni bonus.' },
    abilities: {
      sig: { slot: 'sig', key: 'LMB', name: 'Five Point Strike', desc: 'Ventaglio di 5 kunai davanti a sé: marchia i nemici colpiti e rallenta quelli sulla punta.', cooldown: 2.5, damage: { q: 80 }, range: 16, maxRate: 5 },
      atk: { slot: 'atk', key: 'RMB', name: 'Kama Strikes', desc: 'Due fendenti e un colpo rotante col kama; sui bersagli marchiati il colpo fa esplodere il Marchio dell\'Assassina. In aria: affondo ascendente.', cooldown: 0, damage: { c1: 42, c2: 42, c3: 50, air: 56, mark: 70 }, range: 9, maxRate: 10 },
      sec: { slot: 'sec', key: 'C', name: 'Twilight Shroud', desc: 'Bomba fumogena: per 5 s nella nube sei invisibile e più veloce. Attaccare ti rivela per un istante.', cooldown: 14, damage: {}, range: 0, maxRate: 0 },
      abi: { slot: 'abi', key: 'F', name: 'Shuriken Flip', desc: 'Capriola all\'indietro lanciando uno shuriken che marchia il primo nemico. Premi di nuovo F entro 3 s per piombargli addosso.', cooldown: 9, damage: { flip1: 70, flip2: 95 }, range: 32, maxRate: 4 },
      ult: { slot: 'ult', key: 'R', name: 'Perfect Execution', desc: 'Scatto attraverso i nemici. Entro 5 s premi di nuovo R: secondo scatto che giustizia, più danni quanta più vita manca.', cooldown: 0, damage: { ex1: 120, ex2: 330 }, range: 16, maxRate: 6 },
    },
  },
  qiyana: {
    id: 'qiyana',
    name: 'QIYANA',
    title: 'L\'Imperatrice degli Elementi',
    role: 'melee',
    difficulty: 3,
    hp: 980,
    speed: 1.08,
    ultCharge: 900,
    colors: ['#57d9ff', '#ffc94a'],
    weapon: 'Lama ad anello d\'oro',
    bio: 'Diva dei True Damage ed erede di Ixaocan. Piega terra, acqua ed erba al ritmo del suo anello d\'oro.',
    passive: { name: 'Privilegio Reale', desc: 'Il primo colpo su ogni nemico infligge danni bonus (di nuovo dopo 12 s).' },
    abilities: {
      sig: { slot: 'sig', key: 'LMB', name: 'Edge of Ixtal', desc: 'Taglio in linea davanti a sé. Con un elemento diventa l\'Ira degli Elementi: Terra fa più danni ai feriti · Acqua blocca e rallenta · Erba rende invisibile e veloce. Terrashape azzera la ricarica.', cooldown: 4, damage: { q: 85, qRock: 125, qWater: 85, qGrass: 85 }, range: 16, maxRate: 4 },
      atk: { slot: 'atk', key: 'RMB', name: 'Royal Slashes', desc: 'Due fendenti con la lama ad anello. In aria: affondo ascendente.', cooldown: 0, damage: { c1: 46, c2: 46, air: 58, royal: 55 }, range: 9, maxRate: 8 },
      sec: { slot: 'sec', key: 'C', name: 'Terrashape', desc: 'Scatto che incanta l\'anello: Terra vicino a un muro, Acqua a terra, Erba in aria. Azzera la ricarica di Edge of Ixtal.', cooldown: 7, damage: {}, range: 0, maxRate: 0 },
      abi: { slot: 'abi', key: 'F', name: 'Audacity', desc: 'Balzo sul nemico mirato fino a 18 m, ferendo chi incontra.', cooldown: 8, damage: { e: 100 }, range: 24, maxRate: 4 },
      ult: { slot: 'ult', key: 'R', name: 'Supreme Display of Talent', desc: 'Onda d\'urto che respinge i nemici; dove incontra muri esplode e stordisce chi è vicino.', cooldown: 0, damage: { wave: 120, burst: 230 }, range: 30, maxRate: 8 },
    },
  },
  locke: {
    id: 'locke',
    name: 'LOCKE',
    title: 'L\'Esorcista Cinereo',
    role: 'melee',
    difficulty: 3,
    hp: 1000,
    speed: 1.06,
    ultCharge: 950,
    colors: ['#3fd6b0', '#7a5cff'],
    weapon: 'Paletto d\'argento e chiodi',
    bio: 'Esorcista demaciano. Inchioda i demoni con chiodi rituali e li sigilla per sempre nel suo reliquiario.',
    invulnActs: { pursuit: { sec: 0.25, every: 9 } },
    passive: { name: 'Paletto d\'Argento', desc: 'I colpi in mischia fanno danni bonus in base alla vita che manca al bersaglio; il colpo seguente fa esplodere i Chiodi Rituali.' },
    abilities: {
      sig: { slot: 'sig', key: 'LMB', name: 'Ritual Nails', desc: 'Lancia una fila di chiodi che rallenta e lascia cariche sul bersaglio (max 3). Rilanciabile 2 volte entro 4 s.', cooldown: 7, damage: { q: 45 }, range: 30, maxRate: 9 },
      atk: { slot: 'atk', key: 'RMB', name: 'Exorcism', desc: 'Combo di 4 colpi con paletto e chiodo; ogni colpo consuma i Chiodi Rituali sul bersaglio. In aria: affondo ascendente.', cooldown: 0, damage: { c1: 44, c2: 44, c3: 52, c4: 80, air: 56, stake: 60, nails: 105, dash: 70 }, range: 14, maxRate: 14 },
      sec: { slot: 'sec', key: 'C', name: 'Soul Ignition', desc: 'L\'anima si accende per 4 s: più velocità e il 25% dei danni inflitti torna in vita (max 220).', cooldown: 18, damage: {}, range: 0, maxRate: 0 },
      abi: { slot: 'abi', key: 'F', name: 'Ashen Pursuit', desc: 'Teletrasporto fino a 10 m e fendente circolare all\'arrivo. Il colpo seguente entro 4 s ti fa scattare sul bersaglio.', cooldown: 9, damage: { e: 90 }, range: 16, maxRate: 4 },
      ult: { slot: 'ult', key: 'R', name: 'Purgatory', desc: 'Lancia il reliquiario nel punto mirato: chiodi ad area che feriscono e rallentano. Per 3 s chi scende sotto il 25% di vita nel cerchio viene sigillato. Raccoglilo per recuperare ultimate.', cooldown: 0, damage: { purg: 140, seal: 300 }, range: 36, maxRate: 8 },
    },
  },
  // ---- guest stars ----------------------------------------------------------------------------
  pooh: {
    id: 'pooh',
    name: 'POOH',
    title: 'Orso di Poco Cervello',
    role: 'ranged',
    difficulty: 1,
    hp: 1100,
    speed: 0.96,
    ultCharge: 1400,
    colors: ['#ffb627', '#e5383b'],
    weapon: 'Barattoli di miele',
    bio: 'Orsetto del Bosco dei Cento Acri, goloso di miele fino all\'ultima goccia. È lento a pensare, ma quando gli viene un\'idea sono guai per tutti.',
    passive: { name: 'Ghiotto di Miele', desc: 'I barattoli lasciano pozze di miele che rallentano i nemici. Pooh le lecca passandoci sopra: si cura (una pozza ogni 3 s).' },
    abilities: {
      sig: { slot: 'sig', key: 'LMB', name: 'Panzata', desc: 'Gonfia la pancia e carica in avanti: chi viene colpito rimbalza via stordito (e Pooh rimbalza indietro). Più arrivi veloce, più fa male.', cooldown: 5, damage: { bump: 95 }, range: 14, maxRate: 3, momentum: ['bump'] },
      atk: { slot: 'atk', key: 'RMB', name: 'Barattolo di Miele', desc: 'Tieni premuto per lanciare barattoli a parabola: si rompono in uno schizzo che sporca di miele, rallenta e lascia una pozza appiccicosa.', cooldown: 0, damage: { pot: 58, big: 92, goo: 6 }, range: 45, maxRate: 12 },
      sec: { slot: 'sec', key: 'C', name: 'Nuvoletta Nera', desc: 'Si aggrappa a un palloncino blu e sale fluttuando per 4 s (tira i barattoli anche da lassù). Premi di nuovo C per lasciarlo.', cooldown: 12, damage: {}, range: 0, maxRate: 0 },
      abi: { slot: 'abi', key: 'F', name: 'Pensa, Pensa, Pensa', desc: 'Si ferma e si picchietta la testa per pensare. Se nessuno lo stordisce gli viene un\'Idea: si cura, la Panzata torna pronta e i 3 barattoli seguenti diventano Super Barattoli.', cooldown: 16, damage: {}, range: 0, maxRate: 0 },
      ult: { slot: 'ult', key: 'R', name: 'Sciame d\'Api', desc: 'Lancia un alveare nel punto mirato: per 4,5 s le api inseguono i nemici vicini pungendoli e rallentandoli. Chi è sporco di miele viene punto più forte.', cooldown: 0, damage: { hive: 120, sting: 20, sting2: 30 }, range: 50, maxRate: 16, stream: ['sting', 'sting2'] },
    },
  },
};

export const MATCH_RULES = {
  killsToWin: 15,
  durationSec: 6 * 60,
  respawnSec: 4,
  spawnProtectSec: 1.5,
  maxPlayers: 6,
  critMultiplier: 1.5,
};
