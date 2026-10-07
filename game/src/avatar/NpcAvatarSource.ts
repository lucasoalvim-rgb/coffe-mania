import { Texture } from 'pixi.js';
import { AVATAR_URLS, loadAvatarAssets } from '../game/asset-manifest';
import { bakeAvatarIncrementally } from './AvatarBaker';
import type { AvatarRenderer } from './AvatarRenderer';
import { parseAtlas } from './AvatarTexture';
import { DEFAULT_CELL, ROOM_CLIPS, PLAYER_ROOM_CLIPS, type BakedAvatarBundle } from './bake';
import { NpcLookHistory, npcLookKey, type NpcAppearancePolicy } from './npc-looks';
import { resolveLook, type Wardrobe } from './wardrobe';
import { restoreAppearance } from './appearance';

export interface NpcAvatarSource {
  next(): Promise<BakedAvatarBundle>;
  bakeAppearance?(appearance: string, human?: boolean, signal?: AbortSignal): Promise<BakedAvatarBundle>;
  destroy(): void;
}

export function releaseNpcAvatar(bundle: BakedAvatarBundle): void {
  bundle.texture.destroy(true);
  bundle.baked.canvas.width = 0;
  bundle.baked.canvas.height = 0;
}

/** One reusable model, no per-look atlas cache; the caller owns each returned atlas. */
export async function createNpcAvatarSource(policy: NpcAppearancePolicy): Promise<NpcAvatarSource> {
  const { AvatarRenderer } = await import('./AvatarRenderer');
  const { wardrobe, atlas, atlasImage } = await loadAvatarAssets();
  const renderer = await AvatarRenderer.create({ modelUrl: AVATAR_URLS.model, atlas, atlasImage, size: 512, unlit: true });
  try {
    // Warm the render pipeline while the initial loading overlay is still visible.
    renderer.setLook(resolveLook(wardrobe, wardrobe.defaultLook()));
    renderer.render();
    return new IncrementalNpcAvatarSource(renderer, wardrobe, policy, new Set(Object.keys(parseAtlas(atlas).symbols)));
  } catch (error) { renderer.destroy(); throw error; }
}

class IncrementalNpcAvatarSource implements NpcAvatarSource {
  private readonly controller = new AbortController();
  private readonly history: NpcLookHistory;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly renderer: AvatarRenderer, private readonly wardrobe: Wardrobe, policy: NpcAppearancePolicy, textures: ReadonlySet<string>) {
    this.history = new NpcLookHistory(wardrobe, policy, Math.random, textures);
  }

  next(): Promise<BakedAvatarBundle> {
    return this.bakeLook();
  }

  bakeAppearance(appearance: string, human = false, signal?: AbortSignal): Promise<BakedAvatarBundle> {
    return this.bakeLook(appearance, human, signal);
  }

  private bakeLook(appearance?: string, human = false, actorSignal?: AbortSignal): Promise<BakedAvatarBundle> {
    const signal = actorSignal ? AbortSignal.any([this.controller.signal, actorSignal]) : this.controller.signal;
    const task = this.queue.then(async () => {
      signal.throwIfAborted();
      const look = appearance === undefined ? this.history.next() : restoreAppearance(this.wardrobe, appearance);
      const missing = this.renderer.setLook(resolveLook(this.wardrobe, look));
      if (missing.length) throw new Error('O visual do NPC possui texturas indisponíveis.');
      const baked = await bakeAvatarIncrementally(this.renderer, {
        clips: human ? PLAYER_ROOM_CLIPS : ROOM_CLIPS, cell: DEFAULT_CELL, signal,
      });
      if (signal.aborted) {
        baked.canvas.width = 0;
        baked.canvas.height = 0;
        signal.throwIfAborted();
      }
      const texture = Texture.from(baked.canvas);
      texture.source.scaleMode = 'linear';
      texture.source.autoGenerateMipmaps = true;
      return { baked, texture, lookKey: npcLookKey(this.wardrobe, look) };
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.abort();
    this.history.clear();
    this.renderer.destroy();
  }
}
