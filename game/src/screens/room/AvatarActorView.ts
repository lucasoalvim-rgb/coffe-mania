import { Container, Rectangle, Sprite, Texture } from 'pixi.js';

import { lookupFrame, type AvatarAtlas } from '../../avatar/AvatarBaker';
import { CLIP, clipFrameDelayMs, clipFrames } from '../../avatar/clips';
import type { Actor } from '../../world/Actor';
import { ROOM_ASSET_SCALE, TILE_HEIGHT_HALF } from '../../world/iso';
import { ACTOR_VISUAL_SCALE, createActorShadow } from './actor-appearance';
import { setActorRoomDepth } from './RoomDepthSorter';

/** Avatar 2D usando o atlas renderizado. O relógio dos clipes é independente do frame rate da tela. */

export class AvatarActorView {
  readonly view = new Container();

  private readonly sprite: Sprite;

  /** Uma Texture por célula do atlas, criada uma vez. */
  private readonly cellTextures = new Map<string, Texture>();

  private clip: number = CLIP.IDLE;
  private actionClip: number | null = null;
  private actionElapsedMs?: number;
  private frameIndex = 0;
  private elapsedMs = 0;
  private lastKey = '';
  private carrying = false;
  private carryingHand?: { x: number; y: number };

  constructor(
    private readonly actor: Actor,
    private baked: AvatarAtlas,
    texture: Texture,
  ) {
    this.view.label = `actor:${actor.label}`;
    this.view.scale.set(ACTOR_VISUAL_SCALE);

    for (const cell of baked.cells) {
      this.cellTextures.set(
        `${cell.x},${cell.y}`,
        new Texture({
          source: texture.source,
          frame: new Rectangle(cell.x, cell.y, baked.cell, baked.cell),
        }),
      );
    }

    this.sprite = new Sprite(this.cellTextures.values().next().value ?? texture);
    // Âncora no apoio dos pés, medido no baker.
    this.sprite.anchor.set(baked.ground.x / baked.cell, baked.ground.y / baked.cell);

    // roundPixels alinha o ator interpolado à grade física; a câmera alinha os objetos estáticos.

    this.sprite.roundPixels = true;

    this.view.addChild(createActorShadow(33, 11), this.sprite);
    setActorRoomDepth(this.view, this.actor);

    this.apply();
    this.sync();
  }

  /** Clipe atual, para teste. */
  get currentClip(): number {
    return this.clip;
  }

  get currentFrame(): number {
    return clipFrames(this.clip)[this.frameIndex] ?? 0;
  }

  /** Ação temporária comandada pela sala; caminhar continua tendo prioridade. */
  setActionClip(clip: number | null, elapsedMs?: number): void {
    this.actionClip = clip;
    this.actionElapsedMs = elapsedMs;
  }

  setCarrying(carrying: boolean): void { this.carrying = carrying; }

  /** Coordenadas relativas aos pés em pixels do mundo, no mesmo quadro da arte. */
  getCarriedDishHand(): { x: number; y: number } | undefined {
    if (!this.carryingHand) return undefined;
    return {
      x: (this.carryingHand.x - this.baked.ground.x) * this.sprite.scale.x * this.view.scale.x,
      y: (this.carryingHand.y - this.baked.ground.y) * this.sprite.scale.y * this.view.scale.y,
    };
  }

  /** Replace only the atlas: movement, direction, current action and shadow are retained. */
  setAppearance(baked: AvatarAtlas, texture: Texture): void {
    const previous = [...this.cellTextures.values()];
    this.cellTextures.clear();
    this.baked = baked;
    for (const cell of baked.cells) {
      this.cellTextures.set(`${cell.x},${cell.y}`, new Texture({
        source: texture.source, frame: new Rectangle(cell.x, cell.y, baked.cell, baked.cell),
      }));
    }
    this.sprite.anchor.set(baked.ground.x / baked.cell, baked.ground.y / baked.cell);
    this.sprite.texture = this.cellTextures.values().next().value ?? texture;
    this.lastKey = '';
    this.apply();
    for (const frame of previous) frame.destroy(false);
  }

  update(deltaMs: number): void {
    const carryClip = this.carrying && lookupFrame(this.baked, CLIP.WAITOR_WALK, this.actor.direction, 10)
      ? CLIP.WAITOR_WALK : undefined;
    const desejado = this.actor.moving ? carryClip ?? CLIP.WALK : this.actionClip ?? carryClip ?? CLIP.IDLE;
    if (desejado !== this.clip) {
      this.clip = desejado;
      this.frameIndex = 0;
      this.elapsedMs = 0;
    }

    const frames = clipFrames(this.clip);
    if (!this.actor.moving && this.clip === CLIP.WAITOR_WALK) {
      this.frameIndex = 0;
      this.elapsedMs = 0;
    } else if (!this.actor.moving && this.actionElapsedMs !== undefined && frames.length > 0) {
      const elapsed = Math.max(0, this.actionElapsedMs);
      const step = clipFrameDelayMs(this.clip);
      this.frameIndex = Math.floor(elapsed / step) % frames.length;
      this.elapsedMs = elapsed % step;
    } else if (frames.length > 1) {
      this.elapsedMs += deltaMs;
      const passo = clipFrameDelayMs(this.clip);
      while (this.elapsedMs >= passo) {
        this.elapsedMs -= passo;
        this.frameIndex = (this.frameIndex + 1) % frames.length;
      }
    }

    this.apply();
    this.sync();
  }

  /** Recorta a célula do atlas e espelha quando a direção pede. */
  private apply(): void {
    const encontrado = lookupFrame(this.baked, this.clip, this.actor.direction, this.currentFrame);
    if (!encontrado) { this.carryingHand = undefined; return; }

    const chave = `${encontrado.cell.x},${encontrado.cell.y},${encontrado.mirrored}`;
    if (chave === this.lastKey) return;
    this.lastKey = chave;
    this.carryingHand = encontrado.mirrored ? encontrado.cell.carryingLeftHand : encontrado.cell.carryingHand;

    const textura = this.cellTextures.get(`${encontrado.cell.x},${encontrado.cell.y}`);
    if (textura) this.sprite.texture = textura;
    const s = this.baked.scale ?? ROOM_ASSET_SCALE;
    this.sprite.scale.set(encontrado.mirrored ? -s : s, s);
  }

  /** Sincroniza posição e profundidade com o modelo do ator. */
  sync(): void {
    this.view.position.set(this.actor.x, this.actor.y + TILE_HEIGHT_HALF);
    this.view.zIndex = this.actor.drawPriority;
  }

  destroy(): void {
    for (const textura of this.cellTextures.values()) textura.destroy(false);
    this.cellTextures.clear();
    this.view.destroy({ children: true });
  }
}
