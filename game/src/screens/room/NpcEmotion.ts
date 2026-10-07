import { Sprite, type Container, type Texture } from 'pixi.js';
import { POPUP_DRAW_PRIORITY } from '../../world/iso';

/** Tamanho e altura no mundo 2x: próximo da largura da cabeça do avatar. */
const EMOTION_SIZE = 72;
const HEIGHT_ABOVE_FEET = 225;
const FRAME_MS = 190;
const FADE_IN_MS = 130;
const FADE_OUT_START_MS = FRAME_MS * 4 + 5000;
const DURATION_MS = FADE_OUT_START_MS + 250;

/** Expressão única que segue o NPC; não repete nem altera o atlas compartilhado. */
export class NpcEmotion {
  readonly view: Sprite;
  private elapsedMs = 0;

  constructor(private readonly frames: readonly Texture[]) {
    this.view = new Sprite(frames[0]);
    this.view.label = 'npc-exit-emotion';
    this.view.anchor.set(0.5);
    this.view.eventMode = 'none';
    this.view.alpha = 0;
    this.view.scale.set(EMOTION_SIZE / frames[0].height * 0.55);
  }

  /** Retorna true ao terminar, para o manager remover o sprite da cena. */
  update(deltaMs: number, actorView: Container): boolean {
    this.elapsedMs = Math.min(DURATION_MS, this.elapsedMs + Math.max(0, deltaMs));
    const index = Math.min(this.frames.length - 1, Math.floor(this.elapsedMs / FRAME_MS));
    const texture = this.frames[index];
    this.view.texture = texture;

    const enter = Math.min(1, this.elapsedMs / FADE_IN_MS);
    const exit = Math.min(1, Math.max(0, (DURATION_MS - this.elapsedMs) / (DURATION_MS - FADE_OUT_START_MS)));
    const size = this.elapsedMs < FADE_IN_MS
      ? 0.55 + 0.45 * enter
      : this.elapsedMs > FADE_OUT_START_MS
        ? 0.55 + 0.45 * exit
        : 1;

    this.view.scale.set(EMOTION_SIZE / texture.height * size);
    this.view.alpha = enter * exit;
    this.sync(actorView);
    return this.elapsedMs >= DURATION_MS;
  }

  /** Position and ordering can be refreshed without advancing the animation. */
  sync(actorView: Container): void {
    this.view.position.set(actorView.x, actorView.y - HEIGHT_ABOVE_FEET);
    this.view.zIndex = POPUP_DRAW_PRIORITY + actorView.zIndex;
  }

  /** Seek to the shared room clock, including late entry and reconnect. */
  seek(elapsedMs: number, actorView: Container): boolean {
    this.elapsedMs = Math.max(0, elapsedMs);
    return this.update(0, actorView);
  }

  destroy(): void {
    this.view.destroy();
  }
}
