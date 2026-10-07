import { Container, Graphics, Sprite } from 'pixi.js';

import type { Screen } from '../../core/screen-manager';
import type { StageTransform } from '../../core/stage';
import { BannerWindow } from './BannerWindow';
import { ProgressBar } from './ProgressBar';
import { ProgressState } from './ProgressState';
import { ProgressText } from './ProgressText';
import type { LoadingTextures } from './assets';
import {
  COLORS,
  DEFAULT_LOADING_LAYOUT,
  TIMING,
  WINDOW_BACKDROP,
  cloneLayout,
  type LoadingLayout,
} from './layout';
import { LOADING_MESSAGES, formatProgressLabel } from './messages';
import { drawLoadingStripes } from './background-stripes';

export interface LoadingScreenOptions {
  textures: LoadingTextures;
  layout?: LoadingLayout;
  /** Progresso externo de 0 a 100. Ausente = progresso simulado. */
  progressSource?: () => number;
  /** Quando devolver `true`, e passado o tempo mínimo, dispara `onComplete`. */
  isComplete?: () => boolean;
  onComplete?: () => void;
  minDisplayMs?: number;
  reducedMotion?: boolean;
  messages?: readonly string[];
}

/**
 * Camadas, de trás para a frente:
 *  0. faixas verticais do fundo
 *  1. fundo opaco e banners com crossfade
 *  2. arte da moldura (1920x1080, miolo recortado)
 *  3. barra de carregamento
 *  4. texto "47% - ..."
 */
export class LoadingScreen implements Screen {
  readonly view = new Container();
  /** Fundo em coordenadas do viewport, fora da stage 16:9. */
  readonly viewportBackground = new Graphics();

  private readonly backdrop = new Graphics();
  private readonly frame: Sprite;
  private readonly banners: BannerWindow;
  private readonly bar: ProgressBar;
  private readonly label: ProgressText;
  private readonly state: ProgressState;
  private readonly messages: readonly string[];
  private readonly options: LoadingScreenOptions;
  private readonly minDisplayMs: number;

  private layoutValue: LoadingLayout;
  private elapsedMs = 0;
  private lastTarget = -1;
  private completed = false;

  constructor(options: LoadingScreenOptions) {
    this.options = options;
    this.layoutValue = cloneLayout(options.layout ?? DEFAULT_LOADING_LAYOUT);
    this.messages = options.messages ?? LOADING_MESSAGES;
    this.minDisplayMs = options.minDisplayMs ?? TIMING.minDisplayMs;

    this.view.label = 'loading-screen';

    this.viewportBackground.label = 'loading-background-stripes';

    this.drawBackdrop();

    this.banners = new BannerWindow({
      textures: options.textures.banners,
      rect: this.layoutValue.banner,
      reducedMotion: options.reducedMotion,
    });

    this.frame = new Sprite(options.textures.frame);
    this.frame.label = 'loading-frame';
    this.frame.position.set(0, 0);

    this.bar = new ProgressBar({
      rect: this.layoutValue.bar,
      reducedMotion: options.reducedMotion,
    });

    this.state = new ProgressState({ ...(options.progressSource ? { source: options.progressSource } : {}) });

    this.label = new ProgressText({
      layout: this.layoutValue.text,
      initialText: formatProgressLabel(0, this.messages[0] ?? ''),
    });

    this.view.addChild(this.backdrop, this.banners.view, this.frame, this.bar.view, this.label.view);
  }

  get layout(): LoadingLayout {
    return cloneLayout(this.layoutValue);
  }

  get progress(): number {
    return this.state.progress;
  }

  /** Trava do painel de ajustes: 100% na barra, frases seguem girando. */
  setLocked(locked: boolean): void {
    this.state.locked = locked;
  }

  get locked(): boolean {
    return this.state.locked;
  }

  /** Estado interno exposto para o teste visual automático. */
  get debug(): {
    progress: number;
    displayedProgress: number;
    stripePhase: number;
    bannerIndex: number;
    messageIndex: number;
    elapsedMs: number;
  } {
    return {
      progress: this.state.progress,
      displayedProgress: this.bar.displayedProgress,
      stripePhase: this.bar.stripePhase,
      bannerIndex: this.banners.index,
      messageIndex: this.state.messageIndex,
      elapsedMs: this.elapsedMs,
    };
  }

  applyLayout(layout: LoadingLayout): void {
    this.layoutValue = cloneLayout(layout);
    this.drawBackdrop();
    this.banners.setRect(this.layoutValue.banner);
    this.bar.setRect(this.layoutValue.bar);
    this.label.setLayout(this.layoutValue.text);
  }

  /** Reamostra o texto quando a stage muda de escala. */
  setStageScale(scale: number): void {
    this.label.setStageScale(scale);
  }

  /** Estende as faixas da moldura ate as bordas reais da janela. */
  setViewportBackground(width: number, height: number, transform: StageTransform): void {
    drawLoadingStripes(this.viewportBackground, width, height, transform);
  }

  update(deltaMs: number): void {
    this.elapsedMs += deltaMs;

    this.state.advance(deltaMs);
    this.banners.advance(deltaMs);

    const progress = this.state.progress;
    if (progress !== this.lastTarget) {
      this.lastTarget = progress;
      this.bar.setProgress(progress);
    }
    this.bar.advance(deltaMs);

    this.label.setText(formatProgressLabel(progress, this.messages[this.state.messageIndex] ?? ''));

    this.checkCompletion();
  }

  private checkCompletion(): void {
    if (this.completed || !this.options.onComplete) return;
    // Travado em 100% é modo de calibragem: a tela não sai de cena.
    if (this.state.locked) return;
    if (this.elapsedMs < this.minDisplayMs) return;
    if (!this.options.isComplete?.()) return;
    // Só sai depois de a barra realmente encher na tela.
    if (this.bar.displayedProgress < 99.99) return;

    this.completed = true;
    this.options.onComplete();
  }

  private drawBackdrop(): void {
    // Cobre o recorte real do frame (7px mais alto que a janela calibrada),
    // para não sobrar preto entre a borda de cima e o banner.
    const r = WINDOW_BACKDROP;
    this.backdrop.clear();
    this.backdrop.roundRect(r.left, r.top, r.width, r.height, r.radius).fill(COLORS.windowBackdrop);
  }

  destroy(): void {
    // Solta as máscaras antes de derrubar a árvore, senão o Pixi tenta destruir
    // o mesmo objeto duas vezes.
    this.banners.releaseMask();
    this.bar.releaseMask();
    if (this.viewportBackground.parent) this.viewportBackground.parent.removeChild(this.viewportBackground);
    this.viewportBackground.destroy();
    this.view.destroy({ children: true });
  }
}
