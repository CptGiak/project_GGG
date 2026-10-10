import { Engine, QUALITY_PRESETS } from './core/Engine';
import { Input } from './core/Input';
import { AudioEngine } from './core/Audio';
import { loadSettings, saveSettings, type Settings } from './core/Settings';
import { Match, type MatchOptions } from './game/Match';
import { CHAMPION_IDS, CHAMPIONS, type ChampionId } from '../shared/champions';
import { arenaMeta } from '../shared/arenas';
import type { PlayerInfo } from '../shared/protocol';
import { HUD } from './ui/HUD';
import { MenuStage } from './ui/MenuStage';
import { champSelect, controlsPanel, h, loadingScreen, mainMenu, pauseMenu, resultsScreen, settingsPanel, toast, STATIC_BUILD, inviteLink, copyText } from './ui/Menus';
import { OnlineSession } from './net/OnlineSession';
import { Beat } from './core/Beat';

type PracticeOpts = { champ: ChampionId; arena: string; bots: number; difficulty: number };

const BOT_NAMES = ['VELVET', 'JOKER-B', 'MONA', 'NAVI', 'AKIRA', 'RYU', 'YUKI', 'ZERO'];

/**
 * Top-level app: owns the renderer, input, audio, settings and the current screen.
 * Screens: main menu (3D lineup) -> champion select -> match (practice or online).
 */
export class App {
  readonly canvas: HTMLCanvasElement;
  readonly ui: HTMLElement;
  readonly engine: Engine;
  readonly input: Input;
  readonly audio = new AudioEngine();
  settings: Settings;
  match: Match | null = null;
  session: OnlineSession | null = null;
  private stage: MenuStage | null = null;
  private screen: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private last = performance.now();
  private mode: 'practice' | 'online' = 'practice';
  private practice: PracticeOpts | null = null;
  private onlineChamp: ChampionId = 'kaiser';

  constructor(readonly params: URLSearchParams) {
    this.canvas = document.getElementById('game') as HTMLCanvasElement;
    this.ui = document.getElementById('ui') as HTMLElement;
    this.settings = loadSettings();
    if (!this.settings.name) this.settings.name = `AGENT-${Math.floor(100 + Math.random() * 900)}`;
    this.engine = new Engine(this.canvas);
    const q = (params.get('quality') as Settings['quality']) ?? this.settings.quality;
    this.engine.setQuality(QUALITY_PRESETS[q] ?? QUALITY_PRESETS.medium);
    this.input = new Input(this.canvas);
    this.applySettings();
    const unlock = () => {
      const first = !this.audio.ctx;
      this.audio.unlock();
      if (first && this.audio.ctx) this.audio.startMusic(this.match ? 'battle' : 'menu');
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.canvas.addEventListener('click', () => {
      if (this.match && !this.overlay && this.match.state !== 'ended') this.input.requestLock();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.overlay && this.match && this.match.state !== 'ended') {
        // second ESC closes the pause menu
        this.resume();
      }
    });
  }

  start(): void {
    if (this.params.has('play')) {
      const champ = (this.params.get('champ') as ChampionId) ?? 'kaiser';
      this.startPractice({
        champ: CHAMPION_IDS.includes(champ) ? champ : 'kaiser',
        arena: this.params.get('arena') ?? 'neon_city',
        bots: Number(this.params.get('bots') ?? 1),
        difficulty: Number(this.params.get('diff') ?? 0.5),
      });
    } else if (this.params.get('room') && !STATIC_BUILD) {
      // invite link: land on champion select with the friend's room filled in
      this.settings.room = this.params.get('room')!.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      this.showSelect('online');
    } else {
      this.showMenu();
    }
    requestAnimationFrame(this.frame);
  }

  // ===========================================================================================
  // screens
  // ===========================================================================================

  private setScreen(el: HTMLElement | null): void {
    this.screen?.remove();
    this.screen = el;
    if (el) this.ui.append(el);
  }

  private setOverlay(el: HTMLElement | null): void {
    this.overlay?.remove();
    this.overlay = el;
    if (el) this.ui.append(el);
  }

  private ensureStage(): MenuStage {
    if (!this.stage) this.stage = new MenuStage();
    this.stage.activate();
    this.engine.setView(this.stage.scene, this.stage.camera);
    this.engine.fx.uniforms.uSpeed.value = 0;
    this.engine.fx.uniforms.uDamage.value = 0;
    this.engine.fx.uniforms.uDesat.value = 0;
    this.engine.fx.uniforms.uFlash.value = 0;
    return this.stage;
  }

  showMenu(): void {
    this.endMatch();
    this.setOverlay(null);
    const stage = this.ensureStage();
    stage.setLineup();
    this.audio.startMusic('menu');
    this.setScreen(mainMenu(this.settings, {
      practice: () => this.showSelect('practice'),
      online: () => {
        if (STATIC_BUILD) toast(this.ui, 'IL PVP ONLINE RICHIEDE IL SERVER: SCARICA IL PROGETTO E AVVIA NPM RUN DEV');
        else this.showSelect('online');
      },
      settings: () => this.showSettings(),
      controls: () => this.setOverlay(controlsPanel(() => this.setOverlay(null))),
      setName: (n) => {
        this.settings.name = n;
        saveSettings(this.settings);
      },
      sfx: (n) => this.audio.play(n),
    }));
  }

  showSelect(mode: 'practice' | 'online'): void {
    this.endMatch();
    this.setOverlay(null);
    const stage = this.ensureStage();
    stage.setFocus(this.settings.champ);
    this.setScreen(champSelect(mode, this.settings, {
      pick: (id) => {
        stage.setFocus(id);
        stage.showOff(id);
      },
      back: () => this.showMenu(),
      confirm: (o) => {
        this.settings.champ = o.champ;
        if (mode === 'practice') {
          this.settings.arena = o.arena;
          this.settings.bots = o.bots;
          this.settings.botDifficulty = o.difficulty;
          saveSettings(this.settings);
          this.startPractice({ champ: o.champ, arena: o.arena, bots: o.bots, difficulty: o.difficulty });
        } else {
          this.settings.room = o.room;
          saveSettings(this.settings);
          void this.startOnline(o.champ, o.room || undefined);
        }
      },
      sfx: (n) => this.audio.play(n),
    }));
  }

  showSettings(after?: () => void): void {
    this.setOverlay(settingsPanel({ ...this.settings }, (s) => {
      this.settings = s;
      saveSettings(s);
      this.applySettings();
    }, () => {
      this.setOverlay(null);
      after?.();
    }));
  }

  private applySettings(): void {
    const s = this.settings;
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    if (this.engine.quality !== QUALITY_PRESETS[s.quality]) this.engine.setQuality(QUALITY_PRESETS[s.quality]);
    this.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    if (this.match) this.match.cam.baseFov = s.fov;
  }

  // ===========================================================================================
  // matches
  // ===========================================================================================

  private createMatch(opts: MatchOptions): Match {
    this.match?.dispose();
    this.match?.hud?.dispose();
    const m = new Match(this.engine, this.input, this.audio, opts);
    m.hud = new HUD(this.ui, m.local);
    m.cam.baseFov = this.settings.fov;
    this.match = m;
    return m;
  }

  private endMatch(): void {
    if (this.match) {
      this.match.dispose();
      this.match.hud?.dispose();
      this.match = null;
    }
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    this.input.exitLock();
  }

  startPractice(p: PracticeOpts): void {
    this.mode = 'practice';
    this.practice = p;
    this.endMatch();
    this.setScreen(null);
    this.setOverlay(loadingScreen(arenaMeta(p.arena).name));
    // let the loading screen paint before the (synchronous) arena build
    window.setTimeout(() => {
      const others = CHAMPION_IDS.filter((c) => c !== p.champ);
      const bots = Array.from({ length: p.bots }, (_, i) => ({
        champion: (i < others.length ? others[i] : CHAMPION_IDS[i % CHAMPION_IDS.length]) as ChampionId,
        difficulty: p.difficulty,
        name: BOT_NAMES[i % BOT_NAMES.length],
      }));
      const m = this.createMatch({ arenaId: p.arena, mode: 'practice', localChampion: p.champ, localName: this.settings.name, bots });
      m.onEnd = (winner) => this.showPracticeResults(winner?.id ?? null);
      this.setOverlay(null);
      this.audio.startMusic('battle');
      m.hud?.setPauseHint(!this.input.locked);
    }, 60);
  }

  async startOnline(champ: ChampionId, room?: string): Promise<void> {
    this.mode = 'online';
    this.onlineChamp = champ;
    this.endMatch();
    this.setScreen(null);
    this.setOverlay(loadingScreen('CONNESSIONE...'));
    const session = new OnlineSession();
    this.session = session;
    try {
      const w = await session.connect(this.settings.name, champ, room);
      if (this.session !== session) return;
      this.buildOnlineMatch(w.arena);
      if (w.phase === 'ended') this.match!.state = 'ended';
      toast(this.ui, `STANZA ${w.room} · ${w.players.length} GIOCATOR${w.players.length === 1 ? 'E' : 'I'}`);
    } catch (e) {
      this.session = null;
      session.close();
      this.showSelect('online');
      toast(this.ui, (e as Error).message);
      return;
    }
    session.onNewMatch = (arena) => {
      this.buildOnlineMatch(arena);
      this.setOverlay(null);
    };
    session.onEnd = (winner, players, next) => this.showOnlineResults(winner, players, next);
    session.onDisconnect = () => {
      if (this.session === session) {
        this.showMenu();
        toast(this.ui, 'DISCONNESSO DAL SERVER');
      }
    };
    session.onError = (msg) => toast(this.ui, msg);
  }

  private buildOnlineMatch(arena: string): void {
    const session = this.session!;
    const champ = session.players.get(session.myId)?.champ ?? this.onlineChamp;
    this.setOverlay(loadingScreen(arenaMeta(arena).name));
    const m = this.createMatch({ arenaId: arena, mode: 'online', localChampion: champ, localName: this.settings.name, localId: session.myId });
    m.state = 'playing';
    session.attach(m);
    this.setOverlay(null);
    this.audio.startMusic('battle');
    m.hud?.setPauseHint(!this.input.locked);
  }

  private showPracticeResults(winner: string | null): void {
    const m = this.match;
    if (!m) return;
    this.input.exitLock();
    const players: PlayerInfo[] = m.fighters.map((f) => ({ id: f.id, name: f.name, champ: f.champId, kills: f.kills, deaths: f.deaths, hp: f.hp, alive: f.alive }));
    window.setTimeout(() => {
      if (this.match !== m) return;
      this.setOverlay(resultsScreen({
        players,
        myId: m.local.id,
        winner,
        online: false,
        onRematch: () => this.practice && this.startPractice(this.practice),
        onMenu: () => this.showMenu(),
        sfx: (n) => this.audio.play(n),
      }));
    }, 1200);
  }

  private showOnlineResults(winner: string | null, players: PlayerInfo[], next: number): void {
    this.input.exitLock();
    this.setOverlay(resultsScreen({ players, myId: this.session?.myId ?? '', winner, online: true, next, onMenu: () => this.showMenu(), sfx: (n) => this.audio.play(n) }));
  }

  // ===========================================================================================
  // pause
  // ===========================================================================================

  private onLockChange(locked: boolean): void {
    const m = this.match;
    if (!m) return;
    m.hud?.setPauseHint(!locked && !this.overlay);
    if (!locked && m.state !== 'ended' && !this.overlay) this.pause();
  }

  private pause(): void {
    const m = this.match;
    if (!m) return;
    if (this.mode === 'practice') m.paused = true;
    m.input.enabled = false;
    this.setOverlay(pauseMenu({
      online: this.mode === 'online',
      room: this.session?.room,
      onInvite: () => void this.copyInvite(),
      onResume: () => this.resume(),
      onChampion: () => this.pickChampionInMatch(),
      onSettings: () => this.showSettings(() => this.pause()),
      onQuit: () => this.showMenu(),
      sfx: (n) => this.audio.play(n),
    }));
  }

  private async copyInvite(): Promise<void> {
    const room = this.session?.room;
    if (!room) return;
    const ok = await copyText(inviteLink(room));
    toast(this.ui, ok ? 'LINK COPIATO: INCOLLALO SU DISCORD' : inviteLink(room));
  }

  private resume(): void {
    this.setOverlay(null);
    if (this.match) {
      this.match.paused = false;
      this.input.enabled = true;
      this.input.requestLock();
      this.match.hud?.setPauseHint(!this.input.locked);
    }
  }

  private pickChampionInMatch(): void {
    if (this.mode === 'practice') {
      this.showSelect('practice');
      return;
    }
    const wrap = h('div', { class: 'overlay' }, h('div', { class: 'cs-cards', style: 'position:relative;left:0;top:0' }, ...CHAMPION_IDS.map((id) => {
      const c = CHAMPIONS[id];
      return h('div', { class: 'cs-card', style: `--c1:${c.colors[0]};--c2:${c.colors[1]}`, onclick: () => {
        this.audio.play('uiSelect');
        this.session?.changeChampion(id);
        this.onlineChamp = id;
        toast(this.ui, `${c.name} AL PROSSIMO RESPAWN`);
        this.resume();
      } }, h('div', { class: 'role' }, c.role === 'melee' ? 'MELEE' : 'RANGED'), h('div', { class: 'in' }, h('div', { class: 'nm' }, c.name), h('div', { class: 'tt' }, c.title)));
    })));
    this.setOverlay(wrap);
  }

  // ===========================================================================================
  // loop
  // ===========================================================================================

  private frame = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    Beat.update(dt);
    if (this.match) {
      this.session?.update(dt);
      this.match.update(dt);
      this.match.render();
    } else if (this.stage) {
      this.stage.update(dt, this.engine.aspect);
      this.engine.render(now / 1000);
      this.input.endFrame();
    }
    requestAnimationFrame(this.frame);
  };
}
