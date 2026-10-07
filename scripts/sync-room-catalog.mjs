import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'game/public/assets/items');
const items = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
  const item = JSON.parse(readFileSync(resolve(directory, entry.name, 'item.json'), 'utf8'));
  if (item.classname !== entry.name || !/^[a-z][a-z0-9_]*$/.test(item.classname) ||
    !Number.isSafeInteger(item.id) || item.id <= 0 || typeof item.name !== 'string' ||
    ![0, 1, 2, 3].includes(item.type) || !Number.isSafeInteger(item.priceGold) || item.priceGold < 0 || typeof item.purchasable !== 'boolean' ||
    !['wall', 'window', 'door', 'table', 'chair', 'stove', 'bush', 'panel', 'letterbox', 'decor'].includes(item.kind) ||
    ![item.sizeX, item.sizeY].every((n) => Number.isInteger(n) && n >= 1 && n <= 8) ||
    !Array.isArray(item.parts) || item.parts.length === 0 || !Number.isFinite(item.itemHeight) || item.itemHeight < 0 ||
    (item.type === 2 && item.kind !== 'door') ||
    (item.type === 2 && (!Number.isFinite(item.wall_cutter_index) || item.wall_cutter_index < 0 || item.wall_cutter_index > 1))) {
    throw new Error(`Manifesto inválido: ${entry.name}`);
  }
  for (const part of item.parts) {
    if (!/^[a-zA-Z0-9_-]+\.png$/.test(part.file) || ![part.left, part.top].every(Number.isFinite) ||
      ![part.width, part.height].every((n) => Number.isInteger(n) && n > 0) ||
      (part.rotation !== undefined && (!Number.isInteger(part.rotation) || part.rotation < 0 || part.rotation > 3))) throw new Error(`Parte inválida: ${entry.name}`);
    const png = readFileSync(resolve(directory, entry.name, part.file));
    if (png.readUInt32BE(16) !== part.width || png.readUInt32BE(20) !== part.height) throw new Error(`Dimensões incorretas: ${entry.name}/${part.file}`);
  }
  return item;
}).sort((a, b) => a.id - b.id);
if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('IDs de catálogo duplicados.');
writeFileSync(resolve(directory, 'catalog.json'), JSON.stringify({ items: items.map((item) => ({ id: item.id, classname: item.classname, manifest: `${item.classname}/item.json` })) }, null, 2) + '\n');
writeFileSync(resolve(root, 'shared/roomcatalog/catalog.json'), JSON.stringify({ items }, null, 2) + '\n');
console.log(`Catálogo do servidor sincronizado com ${items.length} pastas de itens.`);
