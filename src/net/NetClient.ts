import { PROTOCOL_VERSION, type C2S, type S2C } from '../../shared/protocol';
import type { ChampionId } from '../../shared/champions';
import type { ModeId } from '../../shared/modes';

/** Thin WebSocket wrapper with a message queue drained once per frame. */
export class NetClient {
  ws: WebSocket | null = null;
  readonly queue: S2C[] = [];
  connected = false;
  error: string | null = null;
  rtt = 0;
  private pingTimer: number | null = null;
  onClose: ((reason: string) => void) | null = null;

  static defaultUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  connect(name: string, champ: ChampionId, room?: string, mode?: ModeId, url = NetClient.defaultUrl()): Promise<Extract<S2C, { t: 'welcome' }>> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Timeout di connessione al server.'));
          ws.close();
        }
      }, 8000);
      ws.onopen = () => {
        this.connected = true;
        this.send({ t: 'hello', v: PROTOCOL_VERSION, name, champ, room, mode });
      };
      ws.onmessage = (ev) => {
        let msg: S2C;
        try {
          msg = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (msg.t === 'pong') {
          this.rtt = performance.now() - msg.c;
          return;
        }
        if (!settled && msg.t === 'welcome') {
          settled = true;
          window.clearTimeout(timeout);
          this.startPing();
          resolve(msg);
          return;
        }
        if (!settled && msg.t === 'error') {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error(msg.msg));
          return;
        }
        this.queue.push(msg);
      };
      ws.onerror = () => {
        this.error = 'Errore di rete';
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error('Impossibile connettersi al server PvP. Avvia il gioco con "npm run dev".'));
        }
      };
      ws.onclose = () => {
        this.connected = false;
        this.stopPing();
        if (settled) this.onClose?.('Connessione chiusa');
      };
    });
  }

  private startPing(): void {
    this.pingTimer = window.setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  send(msg: C2S): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.onClose = null;
    this.stopPing();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}
