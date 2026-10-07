import type { Container } from 'pixi.js';

/** Contrato mínimo de uma tela do jogo. */
export interface Screen {
  readonly view: Container;
  /** Chamado a cada frame com o delta em milissegundos. */
  update?(deltaMs: number): void;
  /** Escala atual da stage, para reamostrar texto. */
  setStageScale?(scale: number): void;
  destroy(): void;
}

/** Gerencia uma tela ativa; trocar de tela destrói a anterior. */

export class ScreenManager {
  private current: Screen | null = null;
  private stageScale = 1;

  constructor(private readonly root: Container) {}

  get active(): Screen | null {
    return this.current;
  }

  show(screen: Screen): void {
    if (this.current === screen) return;
    this.dispose();
    this.current = screen;
    this.root.addChild(screen.view);
    screen.setStageScale?.(this.stageScale);
  }

  update(deltaMs: number): void {
    this.current?.update?.(deltaMs);
  }

  /**
   * Repassa a escala para a tela ativa. Passa por aqui, e não direto na tela,
   * para não falar com uma tela já destruída depois de uma troca.
   */
  setStageScale(scale: number): void {
    this.stageScale = scale;
    this.current?.setStageScale?.(scale);
  }

  private dispose(): void {
    if (!this.current) return;
    const previous = this.current;
    this.current = null;
    if (previous.view.parent) previous.view.parent.removeChild(previous.view);
    previous.destroy();
  }

  destroy(): void {
    this.dispose();
  }
}
