import { CHAMPION_IDS, CHAMPIONS, LOL_CHAMPIONS, SLOT_ORDER, type ChampionId } from '../../shared/champions';
import { championAvailable } from '../champions';
import { ARENA_META } from '../../shared/arenas';
import { MODES, MODE_IDS, type ModeId } from '../../shared/modes';
import type { PlayerInfo } from '../../shared/protocol';
import type { Settings } from '../core/Settings';
import { DEFAULT_BINDINGS, REBINDABLE, SLOT_ACTION, actionLabel, keyLabel, resolveBindings, type Action } from '../core/Input';
import { NetClient } from '../net/NetClient';

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

/** tiny hyperscript helper */
export function h(tag: string, attrs: Attrs = {}, ...children: Array<Node | string | null | undefined | false>): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') e.className = String(v);
    else if (k === 'style') e.setAttribute('style', String(v));
    else if (k === 'html') e.innerHTML = String(v);
    else e.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

/** Persona-5 ransom-note lettering */
export function ransom(text: string, big = true, seed = 7): HTMLElement {
  const wrap = h('div', { class: `ransom ${big ? 'big' : ''}` });
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (const ch of text) {
    if (ch === ' ') {
      wrap.append(h('span', { style: 'width:2vh;background:none' }));
      continue;
    }
    wrap.append(h('span', { class: `r${Math.floor(rnd() * 5)}` }, ch));
  }
  return wrap;
}

export interface MenuCallbacks {
  practice(): void;
  online(): void;
  settings(): void;
  controls(): void;
  setName(n: string): void;
  sfx(name: string): void;
}

/** static builds (no game server alongside, e.g. a hosted demo page) offer practice only, unless
 *  they are pointed at a remote game server (VITE_SERVER_URL or ?server=) */
export const STATIC_BUILD = import.meta.env.VITE_STATIC === '1' && !NetClient.customServer();

/** link that drops a friend straight into the given room */
export function inviteLink(room: string): string {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  const server = new URLSearchParams(location.search).get('server');
  if (server) u.searchParams.set('server', server);
  u.searchParams.set('room', room);
  return u.toString();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard API refused (insecure origin / embedded page): fall back to a hidden textarea
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }) as HTMLTextAreaElement;
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function mainMenu(s: Settings, cb: MenuCallbacks): HTMLElement {
  const items: Array<[string, string, () => void]> = [
    ['ALLENAMENTO', 'Sfida i bot nelle arene', cb.practice],
    ['ONLINE PVP', STATIC_BUILD ? 'Richiede il server di gioco (npm run dev)' : 'Partita veloce o stanza privata', cb.online],
    ['COMANDI', 'Rampini, gas, combo', cb.controls],
    ['IMPOSTAZIONI', 'Grafica, audio, mouse', cb.settings],
  ];
  const list = h('div', { class: 'mm-list' });
  items.forEach(([label, sub, fn], i) => {
    const it = h('div', { class: `mm-item ${i === 0 ? 'sel' : ''}`, onclick: () => { cb.sfx('uiSelect'); fn(); }, onmouseenter: () => {
      list.querySelectorAll('.mm-item').forEach((x) => x.classList.remove('sel'));
      it.classList.add('sel');
      cb.sfx('uiMove');
    } }, h('span', { class: 'lbl' }, label), h('span', { class: 'sub' }, sub));
    list.append(it);
  });
  const input = h('input', { maxlength: 16, placeholder: 'IL TUO NOME', value: s.name }) as HTMLInputElement;
  input.addEventListener('input', () => cb.setName(input.value.toUpperCase()));
  const title = h('div', { class: 'title' }, ransom('PROJECT GGG'), h('div', { class: 'tag' }, 'NEON ', h('b', {}, 'GRAPPLE'), ' ARENA'));
  return h('div', { class: 'screen fade-in' },
    h('div', { class: 'bg-slash' }, h('div', { class: 's1' }), h('div', { class: 's2' }), h('div', { class: 'stars' })),
    title,
    list,
    h('div', { class: 'mm-name' }, h('label', {}, 'CODENAME'), input),
    h('div', { class: 'mm-foot' }, 'Q/E RAMPINI · SPAZIO GAS · SHIFT SCATTO', h('br'), 'v0.1 — browser build'),
    riotNotice(),
    // touch-only devices: the game needs a keyboard and a mouse
    window.matchMedia?.('(hover: none) and (pointer: coarse)').matches
      ? h('div', { class: 'mm-touch' }, 'PROJECT GGG si gioca da computer con tastiera e mouse.')
      : null,
  );
}

/**
 * Notice required by Riot's fan-project policy ("Legal Jibber Jabber") while League of Legends
 * models are in the game (public/models/lol, see tools/blender/build_lol.py).
 */
function riotNotice(): HTMLElement | null {
  const lol = LOL_CHAMPIONS.filter(championAvailable);
  if (!lol.length) return null;
  return h('div', { class: 'mm-legal' },
    `${lol.map((id) => CHAMPIONS[id].name).join(', ')}: modelli e texture da League of Legends © Riot Games. `,
    'PROJECT GGG isn\'t endorsed by Riot Games and doesn\'t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. ',
    'Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.');
}

export interface SelectCallbacks {
  pick(id: ChampionId): void;
  confirm(opts: { champ: ChampionId; arena: string; bots: number; difficulty: number; room: string; quick: boolean; mode: ModeId }): void;
  back(): void;
  sfx(name: string): void;
}

export function champSelect(mode: 'practice' | 'online', s: Settings, cb: SelectCallbacks): HTMLElement {
  const ids = CHAMPION_IDS.filter(championAvailable);
  let champ: ChampionId = ids.includes(s.champ) ? s.champ : ids[0];
  let arena = s.arena;
  let bots = s.bots;
  let diff = s.botDifficulty;
  const keys = resolveBindings(s.bindings);
  let gameMode: ModeId = s.mode ?? 'dm';
  const root = h('div', { class: 'screen fade-in' });
  const cards = h('div', { class: ids.length > 4 ? 'cs-cards many' : 'cs-cards' });
  const info = h('div', { class: 'cs-info' });
  const renderInfo = () => {
    const c = CHAMPIONS[champ];
    root.style.setProperty('--c1', c.colors[0]);
    root.style.setProperty('--c2', c.colors[1]);
    info.innerHTML = '';
    info.append(
      h('div', { class: 'cs-name' }, c.name),
      h('div', { class: 'cs-title' }, c.title.toUpperCase()),
      h('div', { class: 'cs-meta' }, h('span', { class: 'role' }, c.role === 'melee' ? 'MISCHIA' : 'DISTANZA'), h('span', {}, `DIFFICOLTÀ ${'★'.repeat(c.difficulty)}${'☆'.repeat(3 - c.difficulty)}`), h('span', {}, `HP ${c.hp}`), h('span', {}, c.weapon.toUpperCase())),
      h('div', { class: 'cs-bio' }, c.bio),
      h('div', { class: 'cs-abs' }, ...(c.passive ? [h('div', { class: 'cs-ab passive' }, h('div', { class: 'k' }, 'P'), h('div', {}, h('div', { class: 'n' }, c.passive.name.toUpperCase() + '  ·  PASSIVA'), h('div', { class: 'd' }, c.passive.desc)))] : []), ...SLOT_ORDER.map((slot) => {
        const a = c.abilities[slot];
        return h('div', { class: `cs-ab ${slot === 'ult' ? 'ult' : ''}` }, h('div', { class: 'k' }, actionLabel(keys, SLOT_ACTION[slot])), h('div', {}, h('div', { class: 'n' }, a.name.toUpperCase() + (a.cooldown >= 1 ? `  ·  ${a.cooldown}s` : slot === 'ult' ? '  ·  ULTIMATE' : '')), h('div', { class: 'd' }, a.desc)));
      })),
    );
    cards.querySelectorAll('.cs-card').forEach((e) => e.classList.toggle('sel', (e as HTMLElement).dataset.id === champ));
  };
  for (const id of ids) {
    const c = CHAMPIONS[id];
    const card = h('div', { class: 'cs-card', 'data-id': id, style: `--c1:${c.colors[0]};--c2:${c.colors[1]}`, onclick: () => {
      if (champ !== id) {
        champ = id;
        cb.sfx('uiSelect');
        cb.pick(id);
        renderInfo();
      }
    }, onmouseenter: () => cb.sfx('uiMove') },
    h('div', { class: 'role' }, c.role === 'melee' ? 'MELEE' : 'RANGED'),
    h('div', { class: 'in' }, h('div', { class: 'nm' }, c.name), h('div', { class: 'tt' }, c.title)));
    cards.append(card);
  }
  // options
  const opts = h('div', { class: 'cs-opts' });
  let roomInput: HTMLInputElement | null = null;
  const modeSeg = h('div', { class: 'seg' });
  const modeSub = h('div', { class: 'mode-sub' });
  const renderMode = () => {
    modeSeg.innerHTML = '';
    for (const id of MODE_IDS) modeSeg.append(h('button', { class: id === gameMode ? 'on' : '', onclick: () => { gameMode = id; cb.sfx('uiMove'); renderMode(); } }, MODES[id].name));
    modeSub.textContent = mode === 'practice' ? MODES[gameMode].sub : `${MODES[gameMode].sub}. Vale per le stanze private nuove: la partita veloce alterna le modalità.`;
  };
  renderMode();
  const modeField = h('div', { class: 'field' }, h('label', {}, 'MODALITÀ'), h('div', {}, modeSeg, modeSub));
  if (mode === 'practice') {
    const arenaRow = h('div', { class: 'arena-pick' });
    const renderArenas = () => {
      arenaRow.innerHTML = '';
      for (const a of ARENA_META) {
        arenaRow.append(h('div', { class: `arena-chip ${a.id === arena ? 'sel' : ''}`, style: `--a1:${a.colors[0]};--a2:${a.colors[1]}`, onclick: () => {
          arena = a.id;
          cb.sfx('uiMove');
          renderArenas();
        } }, h('span', {}, a.name)));
      }
    };
    renderArenas();
    const botSeg = h('div', { class: 'seg' });
    const renderBots = () => {
      botSeg.innerHTML = '';
      for (const n of [1, 2, 3, 5]) botSeg.append(h('button', { class: n === bots ? 'on' : '', onclick: () => { bots = n; cb.sfx('uiMove'); renderBots(); } }, String(n)));
    };
    renderBots();
    const diffSeg = h('div', { class: 'seg' });
    const renderDiff = () => {
      diffSeg.innerHTML = '';
      for (const [lbl, v] of [['FACILE', 0.2], ['NORMALE', 0.5], ['DIFFICILE', 0.85]] as const) diffSeg.append(h('button', { class: Math.abs(v - diff) < 0.05 ? 'on' : '', onclick: () => { diff = v; cb.sfx('uiMove'); renderDiff(); } }, lbl));
    };
    renderDiff();
    opts.append(modeField, h('div', { class: 'field' }, h('label', {}, 'ARENA'), arenaRow), h('div', { class: 'field' }, h('label', {}, 'BOT'), botSeg), h('div', { class: 'field' }, h('label', {}, 'LIVELLO'), diffSeg));
  } else {
    roomInput = h('input', { maxlength: 8, placeholder: 'CODICE (opz.)', value: s.room }) as HTMLInputElement;
    opts.append(h('div', { class: 'field' }, h('label', {}, 'STANZA'), roomInput), modeField);
  }
  const confirm = (quick: boolean) => {
    cb.sfx('uiSelect');
    cb.confirm({ champ, arena, bots, difficulty: diff, room: quick ? '' : (roomInput?.value ?? '').toUpperCase(), quick, mode: gameMode });
  };
  const bottom = h('div', { class: 'cs-bottom' });
  if (mode === 'practice') bottom.append(h('div', { class: 'btn red', onclick: () => confirm(true) }, h('span', {}, 'COMBATTI!')));
  else bottom.append(h('div', { class: 'btn dark', onclick: () => confirm(false) }, h('span', {}, 'ENTRA IN STANZA')), h('div', { class: 'btn red', onclick: () => confirm(true) }, h('span', {}, 'PARTITA VELOCE')));
  root.append(
    h('div', { class: 'cs-head' }, 'SCEGLI IL TUO CAMPIONE', h('small', {}, mode === 'practice' ? 'ALLENAMENTO CONTRO BOT' : 'ONLINE PVP · DEATHMATCH E RIFLETTORE')),
    cards,
    info,
    opts,
    bottom,
    h('div', { class: 'btn dark back', onclick: () => { cb.sfx('uiBack'); cb.back(); } }, h('span', {}, '◀ INDIETRO')),
  );
  renderInfo();
  return root;
}

export function loadingScreen(text: string): HTMLElement {
  const tips = [
    'Tieni premuto Q o E per agganciarti, SPAZIO per tirarti col gas.',
    'Lascia il rampino al momento giusto per essere catapultato in avanti.',
    'Correndo contro un muro ad alta velocità ci corri sopra!',
    'SHIFT è uno scatto con frame di invulnerabilità.',
    'Puoi agganciare anche i nemici: puntali e premi Q/E.',
    'Il click sinistro è l\'abilità firma del campione (la sua Q), il destro l\'attacco base.',
    'Ogni lancio di rampino costa gas: col serbatoio vuoto non ti agganci.',
    'KAISER: tieni la guardia (C) e para al momento giusto per stordire, poi l\'attacco base per la RIPOSTA.',
    'REX: i colpi alla testa sono CRITICI. Rilascia la carica appena è piena: COLPO PERFETTO.',
    'SCHIVATA PERFETTA: scatta proprio mentre arriva il colpo. Il prossimo colpo è CRITICO.',
    'Gli scatti a raffica perdono l\'invulnerabilità: aspetta un attimo tra uno e l\'altro.',
    'Arriva in velocità: i colpi di slancio fanno fino al 60% di danni in più.',
    'NOVA: Glitch Step marchia i nemici; Phantom Cut li insegue anche fuori mira.',
    'SERA: tieni il raggio sullo stesso bersaglio per il CRESCENDO.',
    'RIFLETTORE: resta da solo nella luce per fare punti a ogni battuta.',
    'AKALI: nella nube di fumo sei invisibile, ma attaccare ti rivela per un istante.',
    'QIYANA: Terrashape vicino a un muro incanta l\'anello con la Terra.',
    'LOCKE: i Chiodi Rituali lasciano cariche che il colpo successivo fa esplodere.',
  ];
  return h('div', { class: 'overlay loading' }, ransom(text, false, 3), h('div', { class: 'bar' }, h('i')), h('div', { class: 'tip' }, tips[Math.floor(Math.random() * tips.length)]));
}

export function toast(container: HTMLElement, msg: string): void {
  const t = h('div', { class: 'toast' }, msg);
  container.append(t);
  window.setTimeout(() => t.remove(), 4100);
}

export function pauseMenu(opts: { online: boolean; room?: string; onInvite?(): void; onResume(): void; onChampion(): void; onSettings(): void; onQuit(): void; sfx(n: string): void }): HTMLElement {
  const b = (label: string, cls: string, fn: () => void) => h('div', { class: `btn ${cls}`, onclick: () => { opts.sfx('uiSelect'); fn(); } }, h('span', {}, label));
  return h('div', { class: 'overlay pause' }, h('div', { class: 'panel' },
    h('h2', {}, 'PAUSA'),
    opts.online && opts.room ? h('div', { class: 'info' }, 'STANZA ', h('b', {}, opts.room), ' — condividi il codice con gli amici') : null,
    b('RIPRENDI', 'red', opts.onResume),
    opts.online && opts.room && opts.onInvite ? b('COPIA LINK INVITO', 'dark', opts.onInvite) : null,
    b(opts.online ? 'CAMBIA CAMPIONE (al respawn)' : 'CAMBIA CAMPIONE', 'dark', opts.onChampion),
    b('IMPOSTAZIONI', 'dark', opts.onSettings),
    b('ESCI AL MENU', 'dark', opts.onQuit),
  ));
}

export function settingsPanel(s: Settings, onChange: (s: Settings) => void, onClose: () => void, onKeys?: () => void): HTMLElement {
  const row = (label: string, el: HTMLElement) => h('div', { class: 'field' }, h('label', {}, label), el);
  const slider = (key: 'sensitivity' | 'fov' | 'master' | 'music' | 'sfx', min: number, max: number, step: number, fmt: (v: number) => string) => {
    const val = h('span', { class: 'val' }, fmt(s[key]));
    const input = h('input', { type: 'range', min, max, step, value: s[key] }) as HTMLInputElement;
    input.addEventListener('input', () => {
      s[key] = Number(input.value);
      val.textContent = fmt(s[key]);
      onChange(s);
    });
    return h('div', { style: 'display:flex;gap:1.2vh;align-items:center' }, input, val);
  };
  const qual = h('div', { class: 'seg' });
  const renderQ = () => {
    qual.innerHTML = '';
    for (const [q, lbl] of [['low', 'BASSA'], ['medium', 'MEDIA'], ['high', 'ALTA']] as const) qual.append(h('button', { class: s.quality === q ? 'on' : '', onclick: () => { s.quality = q; renderQ(); onChange(s); } }, lbl));
  };
  renderQ();
  const inv = h('div', { class: 'seg' });
  const renderInv = () => {
    inv.innerHTML = '';
    for (const [v, lbl] of [[false, 'NO'], [true, 'SÌ']] as const) inv.append(h('button', { class: s.invertY === v ? 'on' : '', onclick: () => { s.invertY = v; renderInv(); onChange(s); } }, lbl));
  };
  renderInv();
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return h('div', { class: 'overlay settings' }, h('div', { class: 'panel' },
    h('h2', {}, 'IMPOSTAZIONI'),
    row('GRAFICA', qual),
    row('SENSIBILITÀ', slider('sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2))),
    row('INVERTI Y', inv),
    row('FOV', slider('fov', 60, 100, 1, (v) => `${v}°`)),
    row('VOLUME', slider('master', 0, 1, 0.01, pct)),
    row('MUSICA', slider('music', 0, 1, 0.01, pct)),
    row('EFFETTI', slider('sfx', 0, 1, 0.01, pct)),
    onKeys ? row('TASTI', h('div', { class: 'seg' }, h('button', { onclick: onKeys }, 'PERSONALIZZA'))) : null,
    h('div', { style: 'margin-top:1vh' }, h('div', { class: 'btn red', onclick: onClose }, h('span', {}, 'FATTO'))),
  ));
}

/** keys the rebinding UI never hands out (movement, menus) */
const RESERVED = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Escape']);

/**
 * Controls: every action key can be rebound (click a key, then press the new key or mouse
 * button; ESC cancels). A key taken by another action is swapped with it.
 */
export function controlsPanel(custom: Partial<Record<Action, string[]>>, onChange: (b: Partial<Record<Action, string[]>>) => void, onClose: () => void): HTMLElement {
  let b = resolveBindings(custom);
  const grid = h('div', { class: 'grid' });
  let stopCapture: (() => void) | null = null;
  const save = () => {
    const out: Partial<Record<Action, string[]>> = {};
    for (const [a] of REBINDABLE) if (b[a].join() !== DEFAULT_BINDINGS[a].join()) out[a] = b[a].slice();
    onChange(out);
  };
  const assign = (a: Action, code: string) => {
    const old = b[a][0];
    for (const [o] of REBINDABLE) {
      if (o === a) continue;
      const i = b[o].indexOf(code);
      if (i < 0) continue;
      // swap: the other action takes this one's old key
      if (i === 0 && old && !b[o].includes(old)) b[o][0] = old;
      else b[o].splice(i, 1);
    }
    b[a] = [code, ...b[a].filter((c) => c !== code && c !== old)];
    save();
  };
  const capture = (a: Action, chip: HTMLElement) => {
    stopCapture?.();
    chip.classList.add('wait');
    chip.textContent = 'PREMI UN TASTO…';
    const done = (code: string | null) => {
      stopCapture?.();
      if (code) assign(a, code);
      render();
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') return done(null);
      if (RESERVED.has(e.code)) return;
      done(e.code);
    };
    const onMouse = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      done(`Mouse${e.button}`);
    };
    const noMenu = (e: Event) => e.preventDefault();
    // start listening after the click that opened the capture
    const t = window.setTimeout(() => {
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('mousedown', onMouse, true);
      window.addEventListener('contextmenu', noMenu, true);
    }, 0);
    stopCapture = () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      // the context menu of a right click arrives after mousedown
      window.setTimeout(() => window.removeEventListener('contextmenu', noMenu, true), 300);
      stopCapture = null;
    };
  };
  const fixed: Array<[string, string]> = [
    ['W A S D', 'Movimento / sterzata in volo'],
    ['MOUSE', 'Mira (clicca per bloccare il cursore)'],
    ['TAB', 'Classifica'],
    ['ESC', 'Pausa'],
  ];
  const render = () => {
    grid.innerHTML = '';
    for (const [a, label] of REBINDABLE) {
      const chip = h('div', { class: 'k rebind', title: 'Clicca per cambiare tasto' }, b[a].map(keyLabel).join(' / '));
      chip.addEventListener('click', () => capture(a, chip));
      grid.append(chip, h('div', { class: 'v' }, label));
    }
    for (const [k, v] of fixed) grid.append(h('div', { class: 'k fixed' }, k), h('div', { class: 'v' }, v));
  };
  render();
  const close = () => {
    stopCapture?.();
    onClose();
  };
  return h('div', { class: 'overlay controls' }, h('div', { class: 'panel' },
    h('h2', {}, 'COMANDI'),
    h('div', { class: 'sub' }, 'Clicca un tasto per cambiarlo, poi premi il nuovo tasto o pulsante del mouse (ESC annulla).'),
    grid,
    h('div', { class: 'tips', html: '<b>Movimento 3D:</b> aggancia un edificio coi rampini, tieni il salto per tirarti col gas, lascia andare per essere lanciato. Usa due rampini per orbitare. Sbattendo contro un muro mentre avanzi ci corri sopra. Ogni lancio di rampino costa gas.<br><b>Combattimento:</b> il click sinistro è l\'abilità firma del campione (con ricarica), il destro l\'attacco base. Gli attacchi corpo a corpo hanno un leggero aggancio sul bersaglio; i colpi alle spalle sono CRITICI.' }),
    h('div', { style: 'margin-top:2vh;display:flex;gap:1.5vh' },
      h('div', { class: 'btn dark', onclick: () => { stopCapture?.(); b = resolveBindings(); save(); render(); } }, h('span', {}, 'PREDEFINITI')),
      h('div', { class: 'btn red', onclick: close }, h('span', {}, 'OK'))),
  ));
}

export function resultsScreen(opts: { players: PlayerInfo[]; myId: string; winner: string | null; online: boolean; next?: number; onRematch?(): void; onMenu(): void; sfx(n: string): void }): HTMLElement {
  // RIFLETTORE: points decide the ranking
  const spot = opts.players.some((p) => p.score !== undefined);
  const sorted = [...opts.players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.kills - a.kills || a.deaths - b.deaths);
  const win = sorted.find((p) => p.id === opts.winner) ?? sorted[0];
  const iWon = win && win.id === opts.myId;
  const nextEl = h('div', { class: 'next' });
  if (opts.online && opts.next) {
    let n = opts.next;
    nextEl.textContent = `PROSSIMA PARTITA TRA ${n}s`;
    const timer = window.setInterval(() => {
      n--;
      nextEl.textContent = n > 0 ? `PROSSIMA PARTITA TRA ${n}s` : 'SI PARTE!';
      if (n <= 0 || !nextEl.isConnected) window.clearInterval(timer);
    }, 1000);
  }
  return h('div', { class: 'overlay results' },
    h('div', { class: 'win' }, iWon ? 'VITTORIA!' : 'FINE MATCH'),
    h('div', { class: 'who' }, 'MVP: ', h('b', {}, win ? `${win.name} · ${CHAMPIONS[win.champ].name}` : '—')),
    h('table', {},
      h('tr', {}, h('th', {}, '#'), h('th', {}, 'GIOCATORE'), h('th', {}, 'CAMPIONE'), spot ? h('th', {}, 'PUNTI') : null, h('th', {}, 'K'), h('th', {}, 'D')),
      ...sorted.map((p, i) => h('tr', { class: p.id === opts.myId ? 'me' : '' }, h('td', {}, String(i + 1)), h('td', {}, p.name), h('td', { style: `color:${CHAMPIONS[p.champ].colors[0]}` }, CHAMPIONS[p.champ].name), spot ? h('td', {}, String(p.score ?? 0)) : null, h('td', {}, String(p.kills)), h('td', {}, String(p.deaths))))),
    nextEl,
    h('div', { class: 'acts' },
      opts.onRematch ? h('div', { class: 'btn red', onclick: () => { opts.sfx('uiSelect'); opts.onRematch!(); } }, h('span', {}, 'RIVINCITA')) : null,
      h('div', { class: 'btn dark', onclick: () => { opts.sfx('uiBack'); opts.onMenu(); } }, h('span', {}, 'MENU PRINCIPALE'))),
  );
}
