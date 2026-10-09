// Confere e encaixa a arte dos móveis na pegada isométrica 2:1, com a mesma geometria do Asset Studio
// (tools/asset-positioner/fit-geometry.js).
//
//   npm run assets:fit                                   relatório de todos os móveis de chão
//   npm run assets:fit -- starter_stove starter_counter:top
//   npm run assets:fit -- starter_stove --mode=angle --preview=<pasta>
//   npm run assets:fit -- starter_stove --mode=angle --write
//
// classname:top usa o tampo como referência (balcões com tampo maior que o corpo); o padrão é a base.
// --mode: translate (1:1, sem reamostrar), uniform (escala uniforme, sem distorção) ou angle (arestas a
// 26,565° com verticais preservadas). --write regrava os PNGs e os offsets das parts do item.json e exige
// nomes explícitos; depois rode npm run assets:room. --preview grava a arte sobre o contorno do tile.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPng, writePng } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ITEMS = path.join(ROOT, 'game', 'public', 'assets', 'items');
await import(pathToFileURL(path.join(ROOT, 'tools', 'asset-positioner', 'fit-geometry.js')).href);
const fit = globalThis.AssetFitGeometry;

const WALL_KINDS = new Set(['wall', 'window', 'panel']);
const MODES = ['translate', 'uniform', 'angle'];

function parseArgs(argv) {
  const options = { names: [], mode: null, write: false, preview: null, threshold: 128 };
  for (const arg of argv) {
    if (arg === '--write') options.write = true;
    else if (arg.startsWith('--mode=')) options.mode = arg.slice(7);
    else if (arg.startsWith('--preview=')) options.preview = path.resolve(arg.slice(10));
    else if (arg.startsWith('--threshold=')) options.threshold = Number(arg.slice(12));
    else if (arg.startsWith('--')) throw new Error(`Opção desconhecida: ${arg}`);
    else {
      const [name, plane = 'base'] = arg.split(':');
      if (!['base', 'top'].includes(plane)) throw new Error(`Plano inválido em ${arg}: use :base ou :top.`);
      options.names.push({ name, plane });
    }
  }
  if (options.mode && !MODES.includes(options.mode)) throw new Error(`--mode deve ser ${MODES.join(', ')}.`);
  if (options.write && (!options.mode || options.names.length === 0)) {
    throw new Error('--write exige --mode e os classnames dos itens a regravar.');
  }
  if (!Number.isInteger(options.threshold) || options.threshold < 1 || options.threshold > 255) {
    throw new Error('--threshold deve ser um inteiro entre 1 e 255.');
  }
  return options;
}

function listItems(options) {
  if (options.names.length) return options.names;
  return fs.readdirSync(ITEMS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ITEMS, entry.name, 'item.json'), 'utf8'));
    return manifest.type === 3 && !WALL_KINDS.has(manifest.kind) ? { name: entry.name, plane: 'base' } : null;
  }).filter(Boolean);
}

const fmt = (n, digits = 1) => Number.isFinite(n) ? n.toFixed(digits).replace('.', ',') : '—';
const angles = (a) => a ? `${fmt(a.left)}° / ${fmt(a.right)}°` : 'não detectado';

/** Arte sobre o losango do tile (contorno vermelho por cima, semitransparente), ampliada 3× para conferência. */
function writePreview(file, image, left, top, sizeX, sizeY) {
  const D = fit.footprintCorners(sizeX, sizeY);
  const margin = 12, minX = Math.min(left, D.left.x) - margin, minY = Math.min(top, D.back.y) - margin;
  const maxX = Math.max(left + image.width, D.right.x) + margin, maxY = Math.max(top + image.height, D.front.y) + margin;
  const width = Math.ceil(maxX - minX), height = Math.ceil(maxY - minY), zoom = 3;
  const base = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) base.set([96, 128, 160, 255], i * 4);
  const blend = (x, y, rgb, alpha) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) base[o + c] = base[o + c] * (1 - alpha) + rgb[c] * alpha;
  };
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      blend(x + left - minX, y + top - minY, image.data.subarray(i, i + 3), image.data[i + 3] / 255);
    }
  }
  const corners = [D.back, D.right, D.front, D.left];
  corners.forEach((a, index) => {
    const b = corners[(index + 1) % 4], steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
    for (let s = 0; s <= steps; s++) {
      blend(Math.floor(a.x + (b.x - a.x) * s / steps - minX), Math.floor(a.y + (b.y - a.y) * s / steps - minY), [230, 40, 60], .55);
    }
  });
  const big = new Uint8ClampedArray(width * zoom * height * zoom * 4);
  for (let y = 0; y < height * zoom; y++) {
    for (let x = 0; x < width * zoom; x++) {
      const o = ((Math.floor(y / zoom) * width) + Math.floor(x / zoom)) * 4;
      big.set(base.subarray(o, o + 4), (y * width * zoom + x) * 4);
    }
  }
  writePng(file, { width: width * zoom, height: height * zoom, data: big });
}

function processItem({ name, plane }, options) {
  const folder = path.join(ITEMS, name);
  const manifestFile = path.join(folder, 'item.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`Item não encontrado: ${name}`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  console.log(`\n${name} (${manifest.sizeX}×${manifest.sizeY}, referência: ${plane === 'top' ? 'tampo' : 'base'})`);
  const oldMaxTop = Math.max(...manifest.parts.map((part) => -part.top));
  const written = new Set();
  let changed = false;
  for (const part of manifest.parts) {
    const rotation = part.rotation ?? 0;
    const [sizeX, sizeY] = rotation % 2 ? [manifest.sizeY, manifest.sizeX] : [manifest.sizeX, manifest.sizeY];
    const file = path.join(folder, part.file);
    const image = readPng(file);
    const label = `  rot ${rotation} ${part.file}`;
    let points;
    try { points = fit.detect(fit.alphaChannel(image.data, image.width, image.height), image.width, image.height, { threshold: options.threshold }); }
    catch (error) { console.log(`${label}: ${error.message}`); continue; }
    const current = fit.evaluate({ points, plane, transform: fit.rectTransform(part.left, part.top), sizeX, sizeY });
    console.log(`${label}: arte base ${angles(current.angles.before.base)} · tampo ${angles(current.angles.before.top)} (tile ${fmt(fit.TILE_ANGLE, 2)}°)`);
    if (current.maxDeviation === null) {
      console.log('    cantos de referência não detectados; marque-os no Asset Studio (Encaixe no tile).');
      continue;
    }
    const rms = (plane === 'top' ? points.top : points.base).rms;
    console.log(`    desvio atual: ${fmt(current.maxDeviation)} px${plane === 'top' ? ` (tampo a ${fmt(current.height)} px)` : ''}` +
      `${rms > 1.5 ? ` · contorno irregular (rms ${fmt(rms)} px): confira os cantos no Asset Studio` : ''}`);
    for (const mode of options.mode ? [options.mode] : MODES) {
      let result;
      try { result = fit.solve({ points, plane, mode, sizeX, sizeY }); }
      catch (error) { console.log(`    ${mode}: ${error.message}`); continue; }
      const t = result.transform;
      const scale = mode === 'angle'
        ? `escala horizontal ${fmt(t.aL * 100)}%/${fmt(t.aR * 100)}%, vertical ${fmt(t.c * 100)}%`
        : `escala ${fmt(t.c * 100)}%`;
      console.log(`    ${mode}: desvio ${fmt(result.maxDeviation)} px · base ${angles(result.angles.after.base)} · ${scale}` +
        `${result.notes.length ? ` · ${result.notes.join(' ')}` : ''}`);
      if (!options.preview && !options.write) continue;
      const output = fit.render(image.data, image.width, image.height, t);
      const box = fit.alphaBox(output.data, output.width, output.height);
      if (!box) { console.log('    resultado vazio; nada gravado.'); continue; }
      const trimmed = new Uint8ClampedArray(box.width * box.height * 4);
      for (let y = 0; y < box.height; y++) {
        const start = ((y + box.top) * output.width + box.left) * 4;
        trimmed.set(output.data.subarray(start, start + box.width * 4), y * box.width * 4);
      }
      const frame = { width: box.width, height: box.height, data: trimmed, left: output.left + box.left, top: output.top + box.top };
      if (options.preview) {
        fs.mkdirSync(options.preview, { recursive: true });
        writePreview(path.join(options.preview, `${name}-rot${rotation}-${mode}.png`), frame, frame.left, frame.top, sizeX, sizeY);
        if (mode === (options.mode ?? MODES[0])) {
          writePreview(path.join(options.preview, `${name}-rot${rotation}-atual.png`), image, part.left, part.top, sizeX, sizeY);
        }
      }
      if (options.write) {
        if (written.has(part.file)) throw new Error(`${part.file} é usado por mais de uma part; encaixe-o no Asset Studio.`);
        written.add(part.file);
        writePng(file, frame);
        Object.assign(part, { width: frame.width, height: frame.height, left: frame.left, top: frame.top });
        changed = true;
      }
    }
  }
  if (!changed) return;
  // itemHeight acompanha o topo das parts quando era igual ao maior -top; outros valores são preservados.
  if (manifest.itemHeight === oldMaxTop) manifest.itemHeight = Math.max(...manifest.parts.map((part) => -part.top));
  else console.log(`    itemHeight ${manifest.itemHeight} mantido (não era o topo das parts).`);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`    gravado: PNGs e parts de ${path.relative(ROOT, manifestFile)}`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  for (const item of listItems(options)) processItem(item, options);
  if (options.write) console.log('\nExecute npm run assets:room para validar e sincronizar os catálogos.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
