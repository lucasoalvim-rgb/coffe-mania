import { Assets, Texture } from 'pixi.js';
import type { CookingSpice, StoveCooking } from './cooking';

export const SPICE_IDS = ['salt', 'pepper', 'thyme', 'thyme_ultra', 'instant', 'sage'] as const;
export type SpiceId = typeof SPICE_IDS[number];
const assetBase = new URL('assets/ui/spices/', new URL(import.meta.env.BASE_URL ?? '/', document.baseURI));
const assetNames = ['panel', 'salt', 'pepper', 'thyme', 'thyme-ultra', 'instant', 'sage', 'secret', 'button-buy', 'button-use', 'button-disabled', 'button-close', 'stove-menu-row', 'sponge', 'spoiled-callout'] as const;
export const SPICE_ASSET_URLS = assetNames.map((name) => new URL(`${name}.png`, assetBase).href);

export interface SpiceScreenTextures {
  panel: Texture;
  icons: Record<SpiceId, Texture>;
  secret: Texture;
  buy: Texture;
  use: Texture;
  disabled: Texture;
  close: Texture;
  stove: { row: Texture; sponge: Texture; callout: Texture };
}

export async function loadSpiceScreenTextures(): Promise<SpiceScreenTextures> {
  const textures = await Promise.all(SPICE_ASSET_URLS.map((url) => Assets.load<Texture>(url)));
  textures.forEach(({ source }) => {
    source.scaleMode = 'linear';
    source.autoGenerateMipmaps = true;
    source.mipLevelCount = Math.floor(Math.log2(Math.max(source.pixelWidth, source.pixelHeight))) + 1;
  });
  const [panel, salt, pepper, thyme, thyme_ultra, instant, sage, secret, buy, use, disabled, close, row, sponge, callout] = textures;
  return { panel, icons: { salt, pepper, thyme, thyme_ultra, instant, sage }, secret, buy, use, disabled, close, stove: { row, sponge, callout } };
}

/** Regras visuais derivadas do catálogo e do relógio do servidor; a transação revalida tudo. */
export function canUseSpice(spice: CookingSpice, job: StoveCooking | null, serverNow: number): boolean {
  if (!job || job.spice) return false;
  const spoiled = serverNow >= Date.parse(job.spoilsAt.replace(' ', 'T'));
  if (spice.effect === 'recover') return spoiled;
  if (spoiled) return false;
  return spice.effect === 'portions' || serverNow < Date.parse(job.readyAt.replace(' ', 'T'));
}

export function spiceDescription(spice: CookingSpice): string {
  if (spice.effect === 'portions') return `Faz prato\nrender ${spice.bonusPercent ?? 0}% mais\nporções`;
  if (spice.effect === 'instant') return 'Deixa o prato\npronto\nimediatamente';
  if (spice.effect === 'recover') return 'Recupera um\nprato\napodrecido';
  const minutes = (spice.shortcutSeconds ?? 0) / 60;
  return minutes >= 120
    ? `Acelera o\npreparo em ${minutes / 60}\nhoras`
    : `Acelera o\npreparo em ${minutes}\nminutos`;
}
