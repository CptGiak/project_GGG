/**
 * Gameplay data shared by client and server. The server uses the damage tables and ranges to
 * validate hit claims, so clients never send raw damage numbers.
 */

export type Role = 'melee' | 'ranged';
export type AbilitySlot = 'atk' | 'sec' | 'abi' | 'ult';

export interface AbilityData {
  slot: AbilitySlot;
  key: 'LMB' | 'RMB' | 'F' | 'R';
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
}

export type ChampionId = 'kaiser' | 'nova' | 'rex' | 'sera';
export const CHAMPION_IDS: ChampionId[] = ['kaiser', 'nova', 'rex', 'sera'];

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
      atk: { slot: 'atk', key: 'LMB', name: 'Verse Combo', desc: 'Combo di 3 fendenti con lo spadone. In aria: Cleave rotante.', cooldown: 0, damage: { c1: 70, c2: 70, c3: 115, air: 85, shock: 55 }, range: 7, maxRate: 6, momentum: ['c1', 'c2', 'c3', 'air'], backstab: ['c1', 'c2', 'c3', 'air'] },
      sec: { slot: 'sec', key: 'RMB', name: 'Mute Guard', desc: 'Tieni premuto per parare (-75% danni frontali). Parata perfetta: stordisce l\'attaccante e apre la RIPOSTA (LMB): affondo critico imparabile.', cooldown: 0.6, damage: { riposte: 90 }, range: 12, maxRate: 2 },
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
      atk: { slot: 'atk', key: 'LMB', name: 'Sample Flurry', desc: 'Combo rapida di 4 colpi con le doppie katane. In aria: Rising Remix.', cooldown: 0, damage: { c1: 44, c2: 44, c3: 52, c4: 85, air: 58 }, range: 6.5, maxRate: 10, momentum: ['c1', 'c2', 'c3', 'c4', 'air'], backstab: ['c1', 'c2', 'c3', 'c4', 'air'] },
      sec: { slot: 'sec', key: 'RMB', name: 'Glitch Step', desc: 'Scatto istantaneo attraverso i nemici (invulnerabile), lascia un\'eco che taglia e li marchia per 4 s.', cooldown: 4, damage: { pass: 65 }, range: 16, maxRate: 3, momentum: ['pass'] },
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
      atk: { slot: 'atk', key: 'LMB', name: 'Beat Shot', desc: 'Raffica di proiettili sonici veloci. Colpo alla testa = CRITICO. Oltre i 28 m perde potenza.', cooldown: 0, damage: { shot: 46 }, range: 140, maxRate: 7, headshot: ['shot'], stream: ['shot'] },
      sec: { slot: 'sec', key: 'RMB', name: 'Bass Charge', desc: 'Tieni premuto per caricare, rilascia per un raggio perforante fino a 270 danni. Rilascio perfetto appena carico: 300 danni e ricarica dimezzata. Troppo a lungo: si scarica.', cooldown: 1.2, damage: { charge: 270, perfect: 300 }, range: 180, maxRate: 2, headshot: ['charge'] },
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
      atk: { slot: 'atk', key: 'LMB', name: 'Note Orb', desc: 'Sfere sonore leggermente a ricerca.', cooldown: 0, damage: { orb: 56 }, range: 120, maxRate: 5 },
      sec: { slot: 'sec', key: 'RMB', name: 'Resonance', desc: 'Canalizza un raggio sonico continuo che rallenta. CRESCENDO: sullo stesso bersaglio il danno sale fino al doppio in 1 s.', cooldown: 2.5, damage: { tick: 22 }, range: 45, maxRate: 14, stream: ['tick'] },
      abi: { slot: 'abi', key: 'F', name: 'Echo Wave', desc: 'Onda sonora circolare: danni, respinta e rallentamento.', cooldown: 9, damage: { wave: 115 }, range: 11, maxRate: 4 },
      ult: { slot: 'ult', key: 'R', name: 'Grand Finale', desc: 'Un riflettore colpisce il punto mirato: colonna di luce devastante e cura per te.', cooldown: 0, damage: { pillar: 400 }, range: 90, maxRate: 4 },
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
