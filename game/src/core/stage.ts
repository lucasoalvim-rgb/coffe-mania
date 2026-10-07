import { Container } from 'pixi.js';

/** Resolução de projeto. Todo número de layout é escrito neste espaço. */
export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

export interface StageTransform {
  /** Fator único aplicado nos dois eixos (nunca distorce). */
  scale: number;
  /** Deslocamento para centralizar; a sobra vira barra preta. */
  x: number;
  y: number;
}

/**
 * Função pura: dado o viewport, devolve escala e offset da stage 1920x1080.
 * Testável sem navegador.
 */
export function computeStageTransform(
  viewportWidth: number,
  viewportHeight: number,
  stageWidth: number = STAGE_WIDTH,
  stageHeight: number = STAGE_HEIGHT,
): StageTransform {
  const safeW = Math.max(0, viewportWidth);
  const safeH = Math.max(0, viewportHeight);
  const scale = Math.min(safeW / stageWidth, safeH / stageHeight);
  return {
    scale,
    x: (safeW - stageWidth * scale) / 2,
    y: (safeH - stageHeight * scale) / 2,
  };
}

export type StageListener = (transform: StageTransform) => void;

/**
 * Container raiz travado em 1920x1080, escalado e centralizado no viewport.
 * Quem desenha só pensa em coordenadas de projeto.
 */
export class Stage {
  readonly root = new Container();

  private transform: StageTransform = { scale: 1, x: 0, y: 0 };
  private readonly listeners = new Set<StageListener>();
  private readonly onWindowChange = () => this.layout();
  private viewport: () => { width: number; height: number };

  constructor(viewport: () => { width: number; height: number }) {
    this.root.label = 'stage-root';
    this.viewport = viewport;
    window.addEventListener('resize', this.onWindowChange);
    window.addEventListener('orientationchange', this.onWindowChange);
    this.layout();
  }

  get currentTransform(): StageTransform {
    return this.transform;
  }

  /** Recalcula escala e offset a partir do viewport atual. */
  layout(): StageTransform {
    const { width, height } = this.viewport();
    this.transform = computeStageTransform(width, height);
    this.root.scale.set(this.transform.scale);
    this.root.position.set(this.transform.x, this.transform.y);
    for (const listener of this.listeners) listener(this.transform);
    return this.transform;
  }

  /** Avisa quando a escala muda (usado para reamostrar texto). */
  onResize(listener: StageListener): () => void {
    this.listeners.add(listener);
    listener(this.transform);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    window.removeEventListener('resize', this.onWindowChange);
    window.removeEventListener('orientationchange', this.onWindowChange);
    this.listeners.clear();
    this.root.destroy({ children: true });
  }
}
