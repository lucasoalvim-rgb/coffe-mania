import { Texture } from 'pixi.js';

import { AVATAR_URLS, loadAvatarAssets } from '../game/asset-manifest';
import { bakeAvatar, type AvatarAtlas, type BakedAvatar } from './AvatarBaker';
import { CLIP } from './clips';
import { variedLooks } from './looks';
import { restoreAppearance } from './appearance';
import { npcLookKey, uniqueNpcLooks, type NpcAppearancePolicy } from './npc-looks';
import { parseAtlas } from './AvatarTexture';
import { resolveLook, type Look } from './wardrobe';

/**
 * Ponte entre o render 3D e o mundo 2D: assa o avatar uma vez e devolve o atlas
 * já como `Texture` do Pixi.
 */

/** Shared actors walk, sit and eat; humans can also prepare dishes. */
export const ROOM_CLIPS: readonly number[] = [CLIP.IDLE, CLIP.WALK, CLIP.SIT, CLIP.EAT];
export const PLAYER_ROOM_CLIPS: readonly number[] = [...ROOM_CLIPS, CLIP.COOKING];

/** Lado da célula do atlas assado, em pixels. 256px garante alta nitidez com assets 2x. */
export const DEFAULT_CELL = 256;

export interface AvatarAtlasBundle {
  baked: AvatarAtlas;
  texture: Texture;
}

export interface BakedAvatarBundle extends AvatarAtlasBundle {
  baked: BakedAvatar;
  /** Canonical rendered appearance, for duplicate-free NPC selection. */
  lookKey?: string;
}

export interface BakeAvatarOptions {
  /** Persisted player look, independent of the NPC allowlist. */
  playerAppearance?: string;
  npcAppearancePolicy?: NpcAppearancePolicy;
  random?: () => number;
  /** Looks a assar. Ausente: só o look padrão do catálogo. */
  looks?: readonly Look[];
  clips?: readonly number[];
  cell?: number;
  /** Lado do quadro 3D antes de reduzir para a célula. */
  renderSize?: number;
}

/** Compartilha um WebGLRenderer entre os looks para limitar contextos GPU. Depois do bake, descarta o renderer; o quarto usa apenas os atlas 2D. */

export async function bakeRoomAvatars(
  count: number,
  options: BakeAvatarOptions = {},
): Promise<BakedAvatarBundle[]> {
  const { wardrobe, atlas } = await loadAvatarAssets();
  const looks = options.npcAppearancePolicy
    ? [wardrobe.defaultLook(), ...uniqueNpcLooks(wardrobe, Math.max(0, count - 1), options.npcAppearancePolicy, options.random, new Set(Object.keys(parseAtlas(atlas).symbols)))]
    : variedLooks(wardrobe, count); // Deterministic standalone renderer probes only.
  looks[0] = restoreAppearance(wardrobe, options.playerAppearance);
  return bakeAvatars({ ...options, looks });
}

export async function bakeAvatars(options: BakeAvatarOptions = {}): Promise<BakedAvatarBundle[]> {
  const { AvatarRenderer } = await import('./AvatarRenderer');
  const { wardrobe, atlas, atlasImage } = await loadAvatarAssets();

  const looks = options.looks?.length ? options.looks : [wardrobe.defaultLook()];

  const renderer = await AvatarRenderer.create({
    modelUrl: AVATAR_URLS.model,
    atlas,
    atlasImage,
    size: options.renderSize ?? 512,
    // MeshBasicMaterial preserva os valores das cores da paleta.
    unlit: true,
  });

  try {
    const assados: BakedAvatarBundle[] = [];

    for (const [index, look] of looks.entries()) {
      const faltando = renderer.setLook(resolveLook(wardrobe, look));
      if (faltando.length > 0) console.warn('[avatar] símbolos ausentes no atlas', faltando);

      const baked = bakeAvatar(renderer, {
        clips: options.clips ?? (index === 0 ? PLAYER_ROOM_CLIPS : ROOM_CLIPS),
        cell: options.cell ?? DEFAULT_CELL,
      });
      const texture = Texture.from(baked.canvas);
      // Filtragem linear preserva as bordas antialiasadas do atlas durante a reamostragem.

      texture.source.scaleMode = 'linear';
      texture.source.autoGenerateMipmaps = true;
      assados.push({ baked, texture, lookKey: npcLookKey(wardrobe, look) });
    }

    return assados;
  } finally {
    renderer.destroy();
  }
}
