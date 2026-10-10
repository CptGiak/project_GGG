import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `npm run share`: builds the client, starts the game server and opens a free Cloudflare quick
 * tunnel, then prints a public https link anyone can open to play with you (no account, no port
 * forwarding). The link lives as long as this terminal stays open.
 *   npm run share              build + serve + tunnel
 *   npm run share -- --no-build reuse the existing ./dist
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8080);
const WIN = process.platform === 'win32';
const children: ChildProcess[] = [];

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: WIN });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`))));
  });
}

function shutdown(code = 0): never {
  for (const c of children) c.kill();
  process.exit(code);
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

async function main(): Promise<void> {
  if (!process.argv.includes('--no-build') || !fs.existsSync(path.join(root, 'dist', 'index.html'))) {
    console.log('\n  [share] building the client...\n');
    await run('npx', ['vite', 'build']);
  }

  process.env.PORT = String(PORT);
  await import('../server/index');

  console.log('  [share] opening a Cloudflare tunnel (first run downloads cloudflared)...\n');
  const tunnel = spawn('npx', ['--yes', 'cloudflared', 'tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { cwd: root, shell: WIN });
  children.push(tunnel);
  let announced = false;
  const scan = (buf: Buffer) => {
    const m = buf.toString().match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/);
    if (!m || announced) return;
    announced = true;
    const line = '='.repeat(m[0].length + 8);
    console.log(`\n  ${line}\n     ${m[0]}\n  ${line}`);
    console.log('  Mandalo agli amici su Discord: ONLINE PVP -> stessa STANZA (o PARTITA VELOCE).');
    console.log('  In partita, ESC -> COPIA LINK INVITO porta gli amici dritti nella tua stanza.');
    console.log('  Chiudi con CTRL+C.\n');
  };
  tunnel.stdout?.on('data', scan);
  tunnel.stderr?.on('data', scan);
  tunnel.on('exit', (code) => {
    console.error(`\n  [share] tunnel closed (code ${code}). Try again, or deploy the server (see README).`);
    shutdown(1);
  });
  setTimeout(() => {
    if (!announced) console.log('  [share] still waiting for the tunnel... (check your connection / firewall)');
  }, 30000);
}

main().catch((e) => {
  console.error(e);
  shutdown(1);
});
