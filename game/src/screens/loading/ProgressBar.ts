import { Container, Graphics } from 'pixi.js';

import { clampRadius, progressToWidth } from './geometry';
import { COLORS, STRIPE, TIMING, type RoundedRect } from './layout';
import { buildStripeGeometry } from './stripes';

export interface ProgressBarOptions {
  rect: RoundedRect;
  reducedMotion?: boolean;
  transitionMs?: number;
  palette?: { base: number; stripe: number };
  glossy?: boolean;
  striped?: boolean;
}

/** Barra de progresso com preenchimento recortado; paleta, listras e brilho são configuráveis. */
export class ProgressBar {
  readonly view = new Container();

  private readonly fill = new Container();
  private readonly base = new Graphics();
  private readonly stripesLayer = new Container();
  private readonly stripes = new Graphics();
  private readonly fillMask = new Graphics();
  private readonly gloss: Graphics | null;

  private rect: RoundedRect;
  private readonly reducedMotion: boolean;
  private readonly transitionMs: number;
  private readonly palette: { base: number; stripe: number };
  private readonly striped: boolean;

  private stripeOffset = 0;
  private target = 0;
  private displayed = 0;
  private tweenFrom = 0;
  private tweenElapsed = -1;

  constructor(options: ProgressBarOptions) {
    this.rect = { ...options.rect };
    this.reducedMotion = options.reducedMotion ?? false;
    this.transitionMs = options.transitionMs ?? TIMING.barTransitionMs;
    this.palette = options.palette ?? { base: COLORS.barBase, stripe: COLORS.barStripe };
    this.gloss = options.glossy ? new Graphics() : null;
    this.striped = options.striped ?? true;

    this.view.label = 'progress-bar';
    this.fill.addChild(this.base);
    if (this.striped) {
      this.stripesLayer.addChild(this.stripes);
      this.fill.addChild(this.stripesLayer);
    }
    if (this.gloss) {
      this.gloss.label = 'progress-gloss';
      this.fill.addChild(this.gloss);
    }
    this.fill.mask = this.fillMask;
    this.view.addChild(this.fillMask, this.fill);

    this.setRect(this.rect);
    this.setProgress(0, true);
  }

  /** Progresso desenhado neste instante (depois da transição de 200ms). */
  get displayedProgress(): number {
    return this.displayed;
  }

  get stripePhase(): number {
    return this.stripeOffset;
  }

  setRect(rect: RoundedRect): void {
    this.rect = { ...rect };
    this.view.position.set(rect.left, rect.top);

    this.base.clear();
    this.base.rect(0, 0, rect.width, rect.height).fill(this.palette.base);

    this.stripes.clear();
    if (this.striped) {
      const geometry = buildStripeGeometry(rect.width, rect.height);
      for (const band of geometry.bands) {
        this.stripes.poly(band.points.map(([x, y]) => ({ x, y }))).fill(this.palette.stripe);
      }
    }

    if (this.gloss) {
      // Três faixas de uma pill lustrosa. As divisórias são curvas em S únicas,
      // sem emendas; a máscara corta o conjunto sem alterar suas coordenadas.
      const w = rect.width;
      const h = rect.height;
      this.gloss.clear();
      this.gloss
        .moveTo(0, 0)
        .lineTo(w, 0)
        .lineTo(w, h * 0.4)
        .bezierCurveTo(w * 0.72, -h * 0.08, w * 0.28, h * 0.62, 0, h * 0.2)
        .closePath()
        .fill({ color: 0xffffff, alpha: 0.28 })
        .moveTo(0, h * 0.2)
        .bezierCurveTo(w * 0.28, h * 0.62, w * 0.72, -h * 0.08, w, h * 0.4)
        .lineTo(w, h * 0.76)
        .bezierCurveTo(w * 0.68, h * 0.42, w * 0.32, h * 0.78, 0, h * 0.56)
        .closePath()
        .fill({ color: 0xffffff, alpha: 0.12 })
        .moveTo(0, h * 0.56)
        .bezierCurveTo(w * 0.32, h * 0.78, w * 0.68, h * 0.42, w, h * 0.76)
        .lineTo(w, h)
        .lineTo(0, h)
        .closePath()
        .fill({ color: 0x170e06, alpha: 0.15 });
    }

    this.redrawMask();
  }

  setProgress(progress: number, immediate = false): void {
    const clamped = Math.max(0, Math.min(100, progress));
    this.target = clamped;

    if (immediate || this.transitionMs <= 0) {
      this.displayed = clamped;
      this.tweenElapsed = -1;
      this.redrawMask();
      return;
    }

    this.tweenFrom = this.displayed;
    this.tweenElapsed = 0;
  }

  advance(deltaMs: number): void {
    if (this.tweenElapsed >= 0) {
      this.tweenElapsed += deltaMs;
      const t = Math.min(1, this.tweenElapsed / this.transitionMs);

      this.displayed = this.tweenFrom + (this.target - this.tweenFrom) * t;
      if (t >= 1) {
        this.displayed = this.target;
        this.tweenElapsed = -1;
      }
      this.redrawMask();
    }

    if (this.striped && !this.reducedMotion) {
      this.stripeOffset = (this.stripeOffset + (deltaMs / STRIPE.cycleMs) * STRIPE.cyclePx) % STRIPE.cyclePx;
      this.stripesLayer.x = this.stripeOffset;
    }
  }

  private redrawMask(): void {
    const width = progressToWidth(this.displayed, this.rect.width);
    this.fillMask.clear();
    if (width <= 0) {
      this.fill.visible = false;
      return;
    }
    this.fill.visible = true;
    const radius = clampRadius(this.rect.radius, width, this.rect.height);
    this.fillMask.roundRect(0, 0, width, this.rect.height, radius).fill(0xffffff);
  }

  /** Solta a máscara sem destruir nada (usado antes de derrubar a árvore). */
  releaseMask(): void {
    this.fill.mask = null;
  }

  destroy(): void {
    this.releaseMask();
    this.view.destroy({ children: true });
  }
}
