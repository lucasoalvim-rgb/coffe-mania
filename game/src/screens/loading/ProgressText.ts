import { Text, TextStyle } from 'pixi.js';

import { FONT_FAMILY } from '../../core/fonts';
import { COLORS, type LoadingLayout } from './layout';

export interface ProgressTextOptions {
  layout: LoadingLayout['text'];
  initialText?: string;
}

/**
 * Texto "47% - ...", uma linha só, centrado.
 *
 * O contorno do Pixi 8 (`stroke: { color, width }`) é centrado na letra e sai
 * atrás do preenchimento, que é o mesmo resultado de
 * `-webkit-text-stroke` + `paint-order: stroke fill` no CSS.
 */
export class ProgressText {
  readonly view: Text;

  private layout: LoadingLayout['text'];
  private stageScale = 1;

  constructor(options: ProgressTextOptions) {
    this.layout = { ...options.layout };
    this.view = new Text({
      text: options.initialText ?? '',
      style: this.buildStyle(),
      resolution: this.resolutionFor(1),
    });
    this.view.label = 'progress-text';
    this.view.anchor.set(0.5);
    this.applyPosition();
  }

  private buildStyle(): TextStyle {
    return new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'],
      fontSize: this.layout.fontSize,
      fontWeight: String(this.layout.fontWeight) as TextStyle['fontWeight'],
      fill: COLORS.text,
      stroke: { color: COLORS.textStroke, width: this.layout.strokeWidth, join: 'round' },
      letterSpacing: this.layout.letterSpacing,
      align: 'center',
      wordWrap: false,
      // Espaço extra na textura para o contorno não ser cortado.
      padding: Math.ceil(this.layout.strokeWidth),
    });
  }

  private applyPosition(): void {
    this.view.position.set(this.layout.centerX, this.layout.centerY);
  }

  /**
   * O texto é rasterizado no tamanho de projeto; quando a stage cresce, ele
   * embaça. Reamostrar pela escala resolve, com teto para não estourar memória.
   */
  private resolutionFor(stageScale: number): number {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    return Math.min(4, Math.max(1, stageScale * dpr));
  }

  setText(value: string): void {
    if (this.view.text !== value) this.view.text = value;
  }

  setLayout(layout: LoadingLayout['text']): void {
    this.layout = { ...layout };
    this.view.style = this.buildStyle();
    this.applyPosition();
  }

  setStageScale(scale: number): void {
    const rounded = Math.round(scale * 100) / 100;
    if (rounded === this.stageScale) return;
    this.stageScale = rounded;
    this.view.resolution = this.resolutionFor(rounded);
  }

  destroy(): void {
    this.view.destroy();
  }
}
