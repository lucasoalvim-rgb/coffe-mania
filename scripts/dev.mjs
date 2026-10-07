import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startNgrok } from './ngrok-tunnel.mjs';

const root = resolve(import.meta.dirname, '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
const serversOnly = process.argv.includes('--servers-only');
const ngrok = process.argv.includes('--ngrok');
const children = new Set();
let stopping = false;
let ownsRooms = false;
let gameURL;
let environment;

function port(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Porta inválida: ${name}`);
  return value;
}
function available(port, host) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`Porta ${port} ocupada. Configure outra porta no .env ou encerre o serviço que a utiliza.`)));
    probe.listen(port, host, () => probe.close(resolve));
  });
}
function launch(command, args, cwd, options = {}, service = false) {
  // Separate process groups keep terminal interrupts from stopping PocketBase before the final save.
  const child = spawn(command, args, { cwd, env: environment, detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  if (!options.stdio) {
    child.stdout?.on('data', chunk => process.stdout.write(chunk));
    child.stderr?.on('data', chunk => process.stderr.write(chunk));
  }
  children.add(child);
  child.once('close', () => children.delete(child));
  if (service) {
    child.once('error', (error) => { console.error(error.message); void stop(1); });
    child.once('close', (code) => { if (!stopping) void stop(code || 1); });
  }
  return child;
}
function compile(go, path, binary) {
  return new Promise((resolve, reject) => {
    const child = launch(go, ['build', '-o', binary, path], root);
    child.once('error', () => reject(new Error('Go não encontrado. Instale Go 1.27+ ou configure COFFE_GO.')));
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`Falha ao compilar ${path}.`)));
  });
}
async function ready(url, accepts = response => response.ok) {
  for (let attempt = 0; attempt < 80 && !stopping; attempt++) {
    try {
      if (accepts(await fetch(url, { signal: AbortSignal.timeout(700) }))) return;
    } catch {}
    await delay(250);
  }
  if (!stopping) throw new Error(`Serviço indisponível: ${url}`);
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // Flush room state before terminating its persistence service.
  if (ownsRooms) {
    try {
      const secret = environment.COFFE_GAME_SECRET ?? readFileSync(environment.COFFE_GAME_SECRET_FILE, 'utf8').trim();
      const result = await fetch(gameURL + '/internal/shutdown', {
        method: 'POST', headers: { Authorization: 'Bearer ' + secret }, signal: AbortSignal.timeout(33000),
      });
      if (!result.ok) throw new Error('Salvamento recusado.');
    } catch { console.warn('Não foi possível confirmar o salvamento final dos quartos.'); }
  }
  const remaining = [...children];
  const exits = remaining.map(child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('close', resolve);
  }));
  for (const child of remaining) {
    if (!child.pid) continue;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    }
  }
  await Promise.race([Promise.all(exits), delay(5000)]);
  process.exit(code);
}
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });

async function main() {
  if (ngrok && serversOnly) throw new Error('--ngrok requer o cliente web.');
  const databasePort = port('COFFE_DATABASE_PORT', 8090);
  const gamePort = port('COFFE_GAME_PORT', 8091);
  const webPort = port('COFFE_WEB_PORT', 5173);
  if (new Set([databasePort, gamePort, webPort]).size !== 3) throw new Error('Os três serviços precisam de portas diferentes.');
  await available(databasePort, '127.0.0.1');
  await available(gamePort, '127.0.0.1');
  if (!serversOnly) await available(webPort, '0.0.0.0');
  const backendURL = `http://127.0.0.1:${databasePort}`;
  gameURL = `http://127.0.0.1:${gamePort}`;
  environment = {
    ...process.env,
    COFFE_BACKEND_URL: backendURL,
    COFFE_GAME_URL: gameURL,
    COFFE_GAME_ADDR: `127.0.0.1:${gamePort}`,
    COFFE_WEB_PORT: String(webPort),
    COFFE_DEV_SEED: process.env.COFFE_DEV_SEED ?? 'true',
    COFFE_GAME_SECRET_FILE: resolve(root, process.env.COFFE_GAME_SECRET_FILE ?? '.runtime/game-secret'),
  };
  const binaryDir = join(root, '.runtime', 'bin');
  mkdirSync(binaryDir, { recursive: true });
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const databaseBinary = join(binaryDir, 'coffe-database' + suffix);
  const gameBinary = join(binaryDir, 'coffe-game-server' + suffix);
  const windowsGo = join(process.env.ProgramFiles ?? 'C:/Program Files', 'Go', 'bin', 'go.exe');
  const go = process.env.COFFE_GO ?? (process.platform === 'win32' && existsSync(windowsGo) ? windowsGo : 'go');
  console.info(`Coffe Mania ${version}: preparando PocketBase e servidor WebSocket…`);
  await compile(go, './database', databaseBinary);
  if (stopping) return;
  await compile(go, './game-server', gameBinary);
  if (stopping) return;
  const databaseDir = resolve(root, process.env.COFFE_DATABASE_DIR ?? 'database/pb_data');
  launch(databaseBinary, ['serve', `--http=127.0.0.1:${databasePort}`, `--dir=${databaseDir}`], join(root, 'database'), {}, true);
  await ready(backendURL + '/api/coffe/session', response => response.status === 401);
  if (stopping) return;
  launch(gameBinary, [], join(root, 'game-server'), {}, true);
  ownsRooms = true;
  await ready(gameURL + '/game/health');
  if (stopping) return;
  console.info(`PocketBase: ${backendURL}/_/ | WebSocket: ${gameURL}/game/ws`);
  if (environment.COFFE_DEV_SEED === 'true') console.info('Banco novo: conta dev test@local.mail / 123456');
  if (serversOnly) return;
  let tunnelOrigin;
  if (ngrok) {
    tunnelOrigin = await startNgrok({
      port: webPort,
      launch: (command, args, options) => launch(command, args, root, options),
      onExit: error => { if (!stopping) { console.error(error.message); void stop(1); } },
    });
  }
  if (stopping) return;
  const require = createRequire(join(root, 'game/package.json'));
  const vite = join(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  launch(process.execPath, [vite, '--strictPort'], join(root, 'game'), {
    env: { ...environment, COFFE_NGROK_ORIGIN: tunnelOrigin ?? '' },
  }, true);
  await ready(`http://127.0.0.1:${webPort}/`);
  if (stopping) return;
  console.info(`Jogo ${version}: http://localhost:${webPort}/`);
  if (tunnelOrigin) console.info(`ngrok: ${tunnelOrigin}/`);
}
main().catch(error => { console.error(error.message); void stop(1); });
