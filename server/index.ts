import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { CHAMPION_IDS, MATCH_RULES, type ChampionId } from '../shared/champions';
import { MODE_IDS, type ModeId } from '../shared/modes';
import { PROTOCOL_VERSION, type C2S } from '../shared/protocol';
import { Room } from './Room';

/**
 * PROJECT GGG server: serves the client (Vite middleware in dev, ./dist in production) and
 * hosts the PvP rooms on /ws.
 *   npm run dev    -> http://localhost:5173
 *   npm run build && npm start
 */

const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT ?? (DEV ? 5173 : 8080));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const rooms = new Map<string, Room>();

function findRoom(code?: string, mode?: ModeId): Room {
  if (code) {
    const id = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PRIVATE';
    let r = rooms.get(id);
    if (!r) {
      // a private room keeps the mode its creator picked
      r = new Room(id, true, removeRoom, mode);
      rooms.set(id, r);
    }
    return r;
  }
  for (const r of rooms.values()) if (!r.isPrivate && !r.full) return r;
  const id = `PUB${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const r = new Room(id, false, removeRoom);
  rooms.set(id, r);
  return r;
}

function removeRoom(r: Room): void {
  r.dispose();
  rooms.delete(r.id);
  console.log(`[room] ${r.id} closed`);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function main(): Promise<void> {
  const server = http.createServer();
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  if (DEV) {
    const { createServer } = await import('vite');
    const vite = await createServer({ root, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
    handler = (req, res) => vite.middlewares(req, res);
  } else {
    const dist = path.join(root, 'dist');
    handler = (req, res) => {
      const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
      if (url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
        return;
      }
      let file = path.join(dist, url);
      if (!file.startsWith(dist)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
      if (!fs.existsSync(file)) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('Client not built. Run "npm run build" first.');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    };
  }
  server.on('request', (req, res) => handler(req, res));

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = (req.url ?? '').split('?')[0];
    if (url !== '/ws') return; // leave other upgrades (vite HMR) alone
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
  });

  server.listen(PORT, () => {
    console.log(`\n  PROJECT GGG ${DEV ? '(dev)' : ''} running on http://localhost:${PORT}`);
    console.log(`  PvP websocket: ws://localhost:${PORT}/ws\n`);
  });
}

function onConnection(ws: WebSocket): void {
  let room: Room | null = null;
  let playerId: string | null = null;
  let msgCount = 0;
  let windowStart = Date.now();
  ws.on('message', (raw) => {
    // flood protection
    const t = Date.now();
    if (t - windowStart > 1000) {
      windowStart = t;
      msgCount = 0;
    }
    if (++msgCount > 120) return;
    let msg: C2S;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (!room) {
      if (msg.t !== 'hello') return;
      if (msg.v !== PROTOCOL_VERSION) {
        ws.send(JSON.stringify({ t: 'error', msg: 'Versione del client non compatibile, ricarica la pagina.' }));
        ws.close();
        return;
      }
      const champ: ChampionId = CHAMPION_IDS.includes(msg.champ) ? msg.champ : 'kaiser';
      const name = String(msg.name ?? 'PLAYER').replace(/[^\p{L}\p{N} _\-.]/gu, '').slice(0, 16) || 'PLAYER';
      const mode = MODE_IDS.includes(msg.mode as ModeId) ? msg.mode : undefined;
      room = findRoom(typeof msg.room === 'string' && msg.room.trim() ? msg.room : undefined, mode);
      if (room.full) {
        ws.send(JSON.stringify({ t: 'error', msg: `Stanza piena (max ${MATCH_RULES.maxPlayers}).` }));
        ws.close();
        room = null;
        return;
      }
      const p = room.join(ws, name, champ);
      playerId = p.id;
      console.log(`[room] ${room.id}: ${name} joined as ${champ} (${room.players.size} players)`);
      return;
    }
    const p = room.players.get(playerId!);
    if (p) room.handle(p, msg);
  });
  ws.on('close', () => {
    if (room && playerId) {
      console.log(`[room] ${room.id}: ${playerId} left`);
      room.leave(playerId);
    }
  });
  ws.on('error', () => ws.close());
}

void main();
