import { resolveLook, type Look, type Wardrobe, type WardrobeItem } from './wardrobe';

export interface NpcAppearancePolicy {
  readonly version: 1;
  readonly itemIds: readonly number[];
  readonly skinColours: readonly number[];
  readonly hairColours: readonly number[];
}

const RARE_APPEARANCE_CHANCE = 0.05;
const OPTIONAL_ACCESSORY_SLOTS = new Set(['Hat', 'Miscellaneous', 'Facial Hair']);
// Blue (including lavender blue), pink, green and grey palette variants.
const RARE_SKIN_COLOURS = new Set([0xa4dfe3, 0xa4aee3, 0xe3a4dd, 0x98e3a0, 0xb3b3b3, 0xcce3e2]);
// Black, red, burgundy and both purple shades from the shipped hair palette.
const RARE_HAIR_COLOURS = new Set([0x332e26, 0x000000, 0xbd4040, 0x852121, 0x541152, 0x7a69bf]);

function isAbsentAccessory(item: WardrobeItem): boolean {
  return !item.texture && item.objects.length === 0;
}

/** Catalogue placeholders/hidden shop entries must never erase essential geometry. */
function isUsableNpcItem(wardrobe: Wardrobe, item: WardrobeItem, availableTextures?: ReadonlySet<string>): boolean {
  if (item.invisible || (item.texture && availableTextures && !availableTextures.has(item.texture))) return false;
  const slot = wardrobe.slotOf(item);
  if (item.hideGroups.some((group) => ['Pants', 'Shirt', 'Eyes', 'Mouth'].includes(wardrobe.group(group)?.parent ?? group))) return false;
  if (slot === 'Hair') return item.objects.some((name) => name.startsWith('hair'));
  if (slot === 'Pants') return Boolean(item.texture) && item.objects.some((name) => name.startsWith('pants'));
  if (slot === 'Shirt') {
    return Boolean(item.texture) && ['shirt', 'armleft', 'armright'].every((prefix) => item.objects.some((name) => name.startsWith(prefix)));
  }
  if (slot === 'Eyes' || slot === 'Mouth') return Boolean(item.texture);
  // Genuine "No Hat", "No Extra", "No Beard" and "No Eyebrow" are valid.
  return Boolean(item.texture) || item.objects.length > 0 || OPTIONAL_ACCESSORY_SLOTS.has(slot) || slot === 'Eyebrows';
}

/** Compare rendered appearances, not invisible/covered item IDs. */
export function npcLookKey(wardrobe: Wardrobe, look: Look): string {
  const resolved = resolveLook(wardrobe, look);
  return JSON.stringify([
    [...resolved.objects].sort(), resolved.textureLayers, resolved.skinColour,
    resolved.objects.some((name) => name.startsWith('hair')) ? resolved.hairColour : null,
  ]);
}

interface AppearancePool<T> { common: T[]; rare: T[] }

function splitAppearancePool<T>(pool: readonly T[], isRare: (item: T) => boolean): AppearancePool<T> {
  const common: T[] = [];
  const rare: T[] = [];
  for (const item of pool) (isRare(item) ? rare : common).push(item);
  return { common, rare };
}

/** Reject malformed/empty allowlists instead of falling back to forbidden options. */
export function parseNpcAppearancePolicy(raw: unknown): NpcAppearancePolicy {
  if (!raw || typeof raw !== 'object') throw new Error('Catálogo dos NPCs inválido.');
  const source = raw as Record<string, unknown>;
  if (source.version !== 1) throw new Error('Versão do catálogo dos NPCs inválida.');
  const integers = (value: unknown, minimum: number, maximum: number): readonly number[] => {
    if (!Array.isArray(value) || value.length === 0 || value.length > 10000 ||
      value.some((entry) => !Number.isSafeInteger(entry) || entry < minimum || entry > maximum)) {
      throw new Error('Opções do catálogo dos NPCs inválidas.');
    }
    return Object.freeze([...new Set<number>(value)]);
  };
  return Object.freeze({
    version: 1,
    itemIds: integers(source.itemIds, 1, Number.MAX_SAFE_INTEGER),
    skinColours: integers(source.skinColours, 0, 0xffffff),
    hairColours: integers(source.hairColours, 0, 0xffffff),
  });
}

/** Randomize allowed slots, with a 5% gate for each accessory/special-colour group. */
export function randomNpcLooks(wardrobe: Wardrobe, count: number, policy: NpcAppearancePolicy, random = Math.random, availableTextures?: ReadonlySet<string>): Look[] {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Quantidade de NPCs inválida.');
  if (count === 0) return [];
  const allowed = new Set(policy.itemIds);
  const pools = new Map<string, WardrobeItem[]>();
  for (const group of wardrobe.groups) {
    if (group.kind === 'item') pools.set(group.parent ?? group.name, []);
  }
  for (const item of wardrobe.items) {
    if (!allowed.has(item.id) || !isUsableNpcItem(wardrobe, item, availableTextures)) continue;
    pools.get(wardrobe.slotOf(item))?.push(item);
  }
  // Hairstyles marked noHat cannot be combined with a visible hat. If the DB
  // forbids every absent-hat option, only compatible hairstyles may be sampled.
  const hats = pools.get('Hat');
  if (hats && !hats.some(isAbsentAccessory)) {
    const hair = pools.get('Hair');
    if (hair) pools.set('Hair', hair.filter((item) => !item.noHat));
  }
  const compatibleHair = pools.get('Hair');
  if (hats && compatibleHair?.length && compatibleHair.every((item) => item.noHat)) {
    pools.set('Hat', hats.filter(isAbsentAccessory));
  }
  for (const [slot, pool] of pools) {
    if (pool.length === 0) throw new Error(`O catálogo dos NPCs não permite nenhuma peça para ${slot}.`);
  }
  if (!policy.skinColours.length || !policy.hairColours.length) throw new Error('Paleta dos NPCs vazia.');
  const pick = <T>(pool: readonly T[]): T => {
    const value = random();
    const index = Math.min(pool.length - 1, Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) * pool.length)));
    return pool[index];
  };
  const pickAppearance = <T>(pool: AppearancePool<T>): T => {
    // Restrictions take precedence: never restore a disabled "none" or colour.
    if (!pool.common.length) return pick(pool.rare);
    if (!pool.rare.length) return pick(pool.common);
    return pick(random() < RARE_APPEARANCE_CHANCE ? pool.rare : pool.common);
  };
  const itemPools = [...pools].map(([slot, pool]) => ({ slot, ...splitAppearancePool(
    pool, (item) => OPTIONAL_ACCESSORY_SLOTS.has(slot) && !isAbsentAccessory(item),
  ) }));
  const hairItems = itemPools.find((pool) => pool.slot === 'Hair');
  const hatItems = itemPools.find((pool) => pool.slot === 'Hat');
  const hairWithHat = hairItems ? splitAppearancePool(
    [...hairItems.common, ...hairItems.rare].filter((item) => !item.noHat), () => false,
  ) : undefined;
  const skinPool = splitAppearancePool(policy.skinColours, (colour) => RARE_SKIN_COLOURS.has(colour));
  const hairPool = splitAppearancePool(policy.hairColours, (colour) => RARE_HAIR_COLOURS.has(colour));
  return Array.from({ length: count }, () => {
    const hat = hatItems ? pickAppearance(hatItems) : undefined;
    const hair = hairItems ? pickAppearance(hat && !isAbsentAccessory(hat) ? hairWithHat! : hairItems) : undefined;
    return {
      itemIds: itemPools.map((pool) => {
        if (pool.slot === 'Hair' && hair) return hair.id;
        if (pool.slot === 'Hat' && hat) return hat.id;
        return pickAppearance(pool).id;
      }),
      skinColour: pickAppearance(skinPool),
      hairColour: pickAppearance(hairPool),
    };
  });
}

/** Fill the bounded bake pool with distinct renderable looks, without inventing allowed pieces. */
export function uniqueNpcLooks(wardrobe: Wardrobe, count: number, policy: NpcAppearancePolicy, random = Math.random, availableTextures?: ReadonlySet<string>): Look[] {
  const first = randomNpcLooks(wardrobe, count, policy, random, availableTextures);
  const looks: Look[] = [];
  const keys = new Set<string>();
  const add = (look: Look) => {
    const key = npcLookKey(wardrobe, look);
    if (keys.has(key)) return;
    keys.add(key);
    looks.push(look);
  };
  first.forEach(add);
  for (let attempt = 0; looks.length < count && attempt < count * 32; attempt++) {
    add(randomNpcLooks(wardrobe, 1, policy, random, availableTextures)[0]);
  }
  // A severely restricted catalogue may have only one possible appearance.
  // Keep fewer atlases instead of duplicating it or escaping the allowlist.
  return looks;
}

export class NpcAppearanceExhaustedError extends Error {
  constructor() { super('Não há um novo visual de NPC disponível nas opções permitidas.'); }
}

/** History contains small signatures only, never atlas textures or renderers. */
export class NpcLookHistory {
  private readonly used = new Set<string>();

  constructor(
    private readonly wardrobe: Wardrobe,
    private readonly policy: NpcAppearancePolicy,
    private readonly random = Math.random,
    private readonly availableTextures?: ReadonlySet<string>,
  ) {}

  next(): Look {
    for (let attempt = 0; attempt < 256; attempt++) {
      const [look] = randomNpcLooks(this.wardrobe, 1, this.policy, this.random, this.availableTextures);
      const key = npcLookKey(this.wardrobe, look);
      if (this.used.has(key)) continue;
      this.used.add(key);
      return look;
    }
    // Never substitute an old/fixed look, even if a tiny catalogue is exhausted.
    throw new NpcAppearanceExhaustedError();
  }

  clear(): void { this.used.clear(); }
}
