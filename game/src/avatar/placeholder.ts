import { Assets, type Texture } from 'pixi.js';
import { cellKey, type AvatarAtlas, type BakedCell } from './AvatarBaker';
import type { AvatarAtlasBundle } from './bake';
import { AVATAR_PLACEHOLDER_URLS } from '../game/asset-manifest';

export interface SavedAvatarAtlas {
  version: 1;
  width: number;
  height: number;
  cell: number;
  ground: { x: number; y: number };
  scale: number;
  cells: BakedCell[];
}

/** Restores frame lookup directly from JSON; no 3D preparation is involved. */
export function restoreAvatarAtlas(file: SavedAvatarAtlas, width: number, height: number): AvatarAtlas {
  if (file.version !== 1 || file.width !== width || file.height !== height ||
      !Number.isInteger(file.cell) || file.cell <= 0 || !Number.isFinite(file.scale) || file.scale <= 0 ||
      !Number.isFinite(file.ground?.x) || !Number.isFinite(file.ground?.y) || !Array.isArray(file.cells) || file.cells.length === 0) {
    throw new Error('Atlas do placeholder inválido.');
  }
  const index = new Map<string, BakedCell>();
  for (const cell of file.cells) {
    const key = cellKey(cell.clip, cell.direction, cell.frame);
    if (![cell.clip, cell.direction, cell.frame, cell.x, cell.y].every(Number.isInteger) ||
        cell.x < 0 || cell.y < 0 || cell.x + file.cell > width || cell.y + file.cell > height || index.has(key)) {
      throw new Error('Quadro do placeholder inválido.');
    }
    index.set(key, cell);
  }
  return { cell: file.cell, ground: file.ground, scale: file.scale, cells: file.cells, index };
}

let cached: Promise<AvatarAtlasBundle> | undefined;
/** All NPCs and players share the same immutable image and texture source. */
export function loadPlaceholderAvatar(): Promise<AvatarAtlasBundle> {
  return cached ??= Promise.all([
    Assets.load<Texture>(AVATAR_PLACEHOLDER_URLS.sheet),
    Assets.load<SavedAvatarAtlas>(AVATAR_PLACEHOLDER_URLS.metadata),
  ]).then(([texture, metadata]) => {
    const baked = restoreAvatarAtlas(metadata, texture.width, texture.height);
    texture.source.scaleMode = 'linear';
    texture.source.autoGenerateMipmaps = true;
    return { baked, texture };
  });
}
