import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/** Width and height from a PNG or WebP header, without decoding the image. */
function imageSize(buffer) {
  if (buffer.toString('ascii', 1, 4) === 'PNG') return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = buffer.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
  }
  throw new Error('Formato de imagem não suportado.');
}
const directory = resolve(root, 'game/public/assets/items');
const items = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
  const item = JSON.parse(readFileSync(resolve(directory, entry.name, 'item.json'), 'utf8'));
  if (item.classname !== entry.name || !/^[a-z][a-z0-9_]*$/.test(item.classname) ||
    !Number.isSafeInteger(item.id) || item.id <= 0 || typeof item.name !== 'string' ||
    ![0, 1, 2, 3].includes(item.type) || !Number.isSafeInteger(item.priceGold) || item.priceGold < 0 || typeof item.purchasable !== 'boolean' ||
    !['wall', 'window', 'door', 'table', 'chair', 'stove', 'counter', 'bush', 'panel', 'letterbox', 'decor'].includes(item.kind) ||
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
  // Animação: folha de sprites em grade, quadros iguais à primeira parte, com margem transparente.
  if (item.animation !== undefined) {
    const a = item.animation;
    const part = item.parts[0];
    const resolution = a.resolution ?? 1;
    if (!/^[a-zA-Z0-9_-]+\.(png|webp)$/.test(a.file) || ![a.frames, a.columns, a.frameWidth, a.frameHeight, resolution].every((n) => Number.isInteger(n) && n > 0) || resolution > 4 ||
      !Number.isInteger(a.gutter) || a.gutter < 0 || !Number.isFinite(a.fps) || a.fps <= 0 || a.fps > 60 ||
      a.frameWidth !== part.width || a.frameHeight !== part.height || a.columns > a.frames) throw new Error(`Animação inválida: ${entry.name}`);
    const sheet = imageSize(readFileSync(resolve(directory, entry.name, a.file)));
    const rows = Math.ceil(a.frames / a.columns);
    // The sheet may be drawn at `resolution` pixels per room pixel; frame sizes stay in room pixels.
    const width = a.columns * (a.frameWidth + 2 * a.gutter) * resolution, height = rows * (a.frameHeight + 2 * a.gutter) * resolution;
    if (sheet.width !== width || sheet.height !== height || width > 4096 || height > 4096) {
      throw new Error(`Folha de animação com dimensões incorretas: ${entry.name}/${a.file}`);
    }
  }
  return item;
}).sort((a, b) => a.id - b.id);
if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('IDs de catálogo duplicados.');
writeFileSync(resolve(directory, 'catalog.json'), JSON.stringify({ items: items.map((item) => ({ id: item.id, classname: item.classname, manifest: `${item.classname}/item.json` })) }, null, 2) + '\n');
writeFileSync(resolve(root, 'shared/roomcatalog/catalog.json'), JSON.stringify({ items }, null, 2) + '\n');
console.log(`Catálogo do servidor sincronizado com ${items.length} pastas de itens.`);

// Receitas: cada pasta de foods/ tem recipe.json, stage_1.png (o que fica no fogão durante o preparo: tábua,
// panela...) e stage_2.png (o prato pronto). O livro segue a ordem do tempo de preparo, como no original.
const foodsDirectory = resolve(root, 'game/public/assets/foods');
const recipes = readdirSync(foodsDirectory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
  const recipe = JSON.parse(readFileSync(resolve(foodsDirectory, entry.name, 'recipe.json'), 'utf8'));
  const counts = [recipe.level, recipe.durationSeconds, recipe.portions, recipe.profitGold, recipe.costGold, recipe.xp];
  if (recipe.id !== entry.name || !/^[a-z][a-z0-9_]*$/.test(recipe.id) || typeof recipe.name !== 'string' || !recipe.name ||
    !counts.every((n) => Number.isSafeInteger(n) && n >= 0) || recipe.level < 1 || recipe.durationSeconds < 1 || recipe.portions < 1 ||
    typeof recipe.inBook !== 'boolean' || typeof recipe.source !== 'string' ||
    (recipe.validitySeconds !== undefined && (!Number.isSafeInteger(recipe.validitySeconds) || recipe.validitySeconds < 1))) {
    throw new Error(`Receita inválida: ${entry.name}`);
  }
  for (const stage of ['stage_1.png', 'stage_2.png']) readFileSync(resolve(foodsDirectory, entry.name, stage));
  return recipe;
}).sort((a, b) => a.durationSeconds - b.durationSeconds || a.id.localeCompare(b.id));
writeFileSync(resolve(foodsDirectory, 'catalog.json'), JSON.stringify({ recipes }, null, 2) + '\n');
writeFileSync(resolve(root, 'shared/recipecatalog/catalog.json'), JSON.stringify({ recipes }, null, 2) + '\n');
console.log(`Catálogo de receitas sincronizado com ${recipes.length} receitas.`);
