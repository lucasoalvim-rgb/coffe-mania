import { Container, Graphics, Rectangle, Sprite, type Texture } from 'pixi.js';

import type { StageTransform } from '../../core/stage';
import { drawLoadingStripes } from './background-stripes';

const DOT_MASKS = [0b000, 0b001, 0b011, 0b111, 0b110, 0b100] as const;
const DOT_STEP_MS = 220;
const IRIS_MS = 900;
const IRIS_HOLD_MS = 500;
const DOT_X = [896, 960, 1024] as const;
const DOT_Y = 672;
const DOT_RADIUS = 16;

export function irisRadius(width: number, height: number, progress: number): number {
  return Math.hypot(width / 2, height / 2) * 1.08 * Math.max(0, Math.min(1, progress));
}

export interface SecondLoadingOverlayOptions {
  texture: Texture;
  onFinished: () => void;
  random?: () => number;
  reducedMotion?: boolean;
}

/** Placa decorativa sobre a sala, revelada por uma abertura circular no centro. */
export class SecondLoadingOverlay {
  readonly view = new Container();

  private readonly content = new Container();
  private readonly stripes = new Graphics();
  private readonly stageArt = new Container();
  private readonly dots = new Graphics();
  private readonly irisMask = new Graphics();
  private readonly onFinished: () => void;
  private readonly targetCycles: number;
  private readonly stepMs: number;
  private readonly irisMs: number;

  private width = 0;
  private height = 0;
  private stepElapsedMs = 0;
  private irisElapsedMs = 0;
  private irisHoldElapsedMs = 0;
  private dotStep = 0;
  private completedCycles = 0;
  private gameReady = false;
  private phase: 'dots' | 'iris' | 'hold' | 'done' = 'dots';

  constructor(options: SecondLoadingOverlayOptions) {
    const sampled = options.random?.() ?? Math.random();
    this.targetCycles = 3 + Math.min(2, Math.max(0, Math.floor(sampled * 3)));
    this.stepMs = options.reducedMotion ? 140 : DOT_STEP_MS;
    this.irisMs = options.reducedMotion ? 350 : IRIS_MS;
    this.onFinished = options.onFinished;

    this.view.label = 'loading-screen-2';
    this.view.eventMode = 'static';
    this.stripes.label = 'loading-screen-2-stripes';
    this.stageArt.label = 'loading-screen-2-stage';
    const sign = new Sprite(options.texture);
    sign.label = 'loading-screen-2-art';
    this.dots.label = 'loading-screen-2-dots';
    this.irisMask.label = 'loading-screen-2-iris-mask';

    this.stageArt.addChild(sign, this.dots);
    this.content.addChild(this.stripes, this.stageArt);
    this.view.addChild(this.content, this.irisMask);
    this.content.setMask({ mask: this.irisMask, inverse: true });
    this.drawDots();
  }

  get debug(): {
    phase: 'dots' | 'iris' | 'hold' | 'done';
    activeDots: number;
    dotMask: number;
    completedCycles: number;
    targetCycles: number;
    ready: boolean;
    irisProgress: number;
  } {
    return {
      phase: this.phase,
      activeDots: DOT_X.reduce((count, _, index) => count + Number(Boolean(DOT_MASKS[this.dotStep] & (1 << index))), 0),
      dotMask: DOT_MASKS[this.dotStep],
      completedCycles: this.completedCycles,
      targetCycles: this.targetCycles,
      ready: this.gameReady,
      irisProgress: Math.min(1, this.irisElapsedMs / this.irisMs),
    };
  }

  setViewport(width: number, height: number, transform: StageTransform): void {
    this.width = width;
    this.height = height;
    this.view.hitArea = new Rectangle(0, 0, width, height);
    drawLoadingStripes(this.stripes, width, height, transform);
    this.stageArt.scale.set(transform.scale);
    this.stageArt.position.set(transform.x, transform.y);
    this.drawIrisMask();
  }

  setGameReady(): void {
    this.gameReady = true;
  }

  update(deltaMs: number): void {
    if (this.phase === 'done') return;
    let remainingMs = Math.max(0, deltaMs);

    if (this.phase === 'dots') {
      while (remainingMs > 0 && this.completedCycles < this.targetCycles) {
        const consumedMs = Math.min(remainingMs, this.stepMs - this.stepElapsedMs);
        this.stepElapsedMs += consumedMs;
        remainingMs -= consumedMs;
        if (this.stepElapsedMs < this.stepMs) break;
        this.stepElapsedMs = 0;
        this.dotStep = (this.dotStep + 1) % DOT_MASKS.length;
        if (this.dotStep === 0) this.completedCycles++;
        this.drawDots();
      }
      if (this.completedCycles < this.targetCycles || !this.gameReady) return;
      this.phase = 'iris';
      this.stepElapsedMs = 0;
    }

    if (this.phase === 'iris') {
      const consumedMs = Math.min(remainingMs, this.irisMs - this.irisElapsedMs);
      this.irisElapsedMs += consumedMs;
      remainingMs -= consumedMs;
      this.drawIrisMask();
      if (this.irisElapsedMs < this.irisMs) return;
      this.phase = 'hold';
    }

    if (this.phase === 'hold') {
      this.irisHoldElapsedMs += remainingMs;
      if (this.irisHoldElapsedMs < IRIS_HOLD_MS) return;
      this.phase = 'done';
      this.onFinished();
    }
  }

  private drawDots(): void {
    const active = DOT_MASKS[this.dotStep];
    this.dots.clear();
    DOT_X.forEach((x, index) => {
      if (!(active & (1 << index))) return;
      this.dots.circle(x, DOT_Y, DOT_RADIUS + 3)
        .fill({ color: 0xffffff, alpha: 0.22 });
      this.dots.circle(x, DOT_Y, DOT_RADIUS)
        .fill(0xffffff);
    });
  }

  private drawIrisMask(): void {
    this.irisMask.clear();
    if (this.width <= 0 || this.height <= 0) return;
    if (this.phase !== 'iris' && this.phase !== 'hold' && this.phase !== 'done') return;

    const progress = Math.min(1, this.irisElapsedMs / this.irisMs);
    const radius = irisRadius(this.width, this.height, progress);
    if (radius <= 0) return;
    // A máscara invertida pode revelar o círculo mesmo quando ele cruza o viewport.

    this.irisMask.circle(this.width / 2, this.height / 2, radius).fill(0xffffff);
  }

  destroy(): void {
    this.content.mask = null;
    if (this.view.parent) this.view.parent.removeChild(this.view);
    this.view.destroy({ children: true });
  }
}
