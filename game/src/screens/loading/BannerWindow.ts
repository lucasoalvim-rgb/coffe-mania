import { Container, Graphics, Sprite, Texture } from 'pixi.js';

import { easeInOut } from '../../core/easing';
import { clampRadius, coverFit } from './geometry';
import { TIMING, type RoundedRect } from './layout';

/** Pequena sobra atrás da moldura para esconder frestas da máscara suavizada. */
const FRAME_BLEED = 2;

export interface BannerWindowOptions {
  textures: Texture[];
  rect: RoundedRect;
  intervalMs?: number;
  fadeMs?: number;
  reducedMotion?: boolean;
}

/**
 * Janela dos banners: dois sprites empilhados, troca com crossfade.
 * Fica atrás da moldura, recortada pela máscara de canto arredondado.
 */
export class BannerWindow {
  readonly view = new Container();

  private readonly maskGraphics = new Graphics();
  private readonly slots: [Sprite, Sprite];
  private readonly textures: Texture[];
  private readonly intervalMs: number;
  private readonly fadeMs: number;

  private rect: RoundedRect;
  private currentIndex = 0;
  private frontSlot = 0;
  private holdElapsed = 0;
  private fadeElapsed = -1;

  constructor(options: BannerWindowOptions) {
    this.textures = options.textures;
    this.rect = { ...options.rect };
    this.intervalMs = options.intervalMs ?? TIMING.bannerIntervalMs;
    this.fadeMs = options.reducedMotion ? 0 : (options.fadeMs ?? TIMING.bannerFadeMs);

    this.view.label = 'banner-window';
    this.slots = [new Sprite(), new Sprite()];

    this.view.addChild(this.maskGraphics, this.slots[0], this.slots[1]);
    this.view.mask = this.maskGraphics;

    this.slots[0].texture = this.textures[0] ?? Texture.EMPTY;
    this.slots[1].alpha = 0;
    if (this.textures.length > 1) this.slots[1].texture = this.textures[1];

    this.setRect(this.rect);
  }

  get index(): number {
    return this.currentIndex;
  }

  /** Alfa dos dois slots, na ordem [slot0, slot1]. Usado nos testes. */
  get slotAlphas(): [number, number] {
    return [this.slots[0].alpha, this.slots[1].alpha];
  }

  setRect(rect: RoundedRect): void {
    this.rect = { ...rect };
    this.view.position.set(rect.left, rect.top);

    const radius = clampRadius(rect.radius, rect.width, rect.height);
    this.maskGraphics.clear();
    this.maskGraphics.roundRect(
      -FRAME_BLEED,
      -FRAME_BLEED,
      rect.width + FRAME_BLEED * 2,
      rect.height + FRAME_BLEED * 2,
      radius + FRAME_BLEED,
    ).fill(0xffffff);

    for (const slot of this.slots) this.fitSlot(slot);
  }

  private fitSlot(slot: Sprite): void {
    const texture = slot.texture;
    if (!texture || texture.width === 0) return;
    const fit = coverFit(
      this.rect.width + FRAME_BLEED * 2,
      this.rect.height + FRAME_BLEED * 2,
      texture.width,
      texture.height,
    );
    slot.scale.set(fit.scale);
    slot.position.set(fit.x - FRAME_BLEED, fit.y - FRAME_BLEED);
  }

  advance(deltaMs: number): void {
    if (this.textures.length < 2) return;

    if (this.fadeElapsed >= 0) {
      this.fadeElapsed += deltaMs;
      const t = this.fadeMs > 0 ? Math.min(1, this.fadeElapsed / this.fadeMs) : 1;
      const alpha = easeInOut(t);
      this.slots[this.frontSlot].alpha = alpha;
      this.slots[1 - this.frontSlot].alpha = 1 - alpha;
      if (t >= 1) {
        this.fadeElapsed = -1;
        this.slots[1 - this.frontSlot].alpha = 0;
      }
      return;
    }

    this.holdElapsed += deltaMs;
    if (this.holdElapsed >= this.intervalMs) {
      this.holdElapsed = 0;
      this.startFade();
    }
  }

  private startFade(): void {
    this.currentIndex = (this.currentIndex + 1) % this.textures.length;
    this.frontSlot = 1 - this.frontSlot;

    const incoming = this.slots[this.frontSlot];
    incoming.texture = this.textures[this.currentIndex];
    incoming.alpha = 0;
    this.fitSlot(incoming);
    this.view.addChild(incoming); 

    this.fadeElapsed = 0;
    if (this.fadeMs === 0) this.advance(0);
  }

  /** Solta a máscara sem destruir nada (usado antes de derrubar a árvore). */
  releaseMask(): void {
    this.view.mask = null;
  }

  destroy(): void {
    this.releaseMask();
    this.view.destroy({ children: true });
  }
}
