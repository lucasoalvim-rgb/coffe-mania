/** Câmera numérica, sem dependência do Pixi. Aplica tela = mundo × zoom + deslocamento, com limites de pan e zoom. */

export interface CameraRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CameraSize {
  width: number;
  height: number;
}

export interface CameraPoint {
  x: number;
  y: number;
}

export interface CameraHorizontalCover {
  left: number;
  right: number;
  /** Bordas realmente visíveis, inclusive fora da stage 16:9. */
  viewportLeft?: number;
  viewportRight?: number;
}

/**
 * Limites como fatores do zoom de referência — ver `baseZoom`.
 * A faixa padrão preserva a qualidade da arte; o modo bitter libera 40%–240%.
 */
export const ZOOM_OUT_FACTOR = 0.55;
export const ZOOM_IN_FACTOR = 1;
export const BITTER_ZOOM_OUT_FACTOR = 0.4;
export const BITTER_ZOOM_IN_FACTOR = 2.4;

/** Passos de 5% preservam a grade isométrica de 40 px em pixels físicos inteiros. */
export const ZOOM_GRID_STEP = 0.05;

/** Um dente de roda de mouse. Multiplicativo, para o passo ser igual em qualquer zoom. */
export const ZOOM_WHEEL_STEP = 1.12;

/** Passo do teclado, maior porque não tem inércia nem precisão de roda. */
export const ZOOM_KEY_STEP = 1.2;

/** Quanto o teclado desloca por tecla, em px de stage. */
export const PAN_KEY_STEP = 80;

/** Folga de pan como fração do viewport por lado, permitindo deslocamento mesmo quando a sala cabe inteira na tela. */

export const PAN_OVERSCROLL = 0.12;

export class RoomCamera {
  private content: CameraRect;
  private viewport: CameraSize;
  private horizontalCover: CameraHorizontalCover | null = null;

  private currentZoom = 1;
  private currentX = 0;
  private currentY = 0;
  private bitterModeEnabled = false;

  /** Pixels físicos por pixel de stage: escala do letterbox vezes o dpr. */
  private pixelScale = 1;

  constructor(content: CameraRect, viewport: CameraSize) {
    this.content = content;
    this.viewport = viewport;
    this.reset();
  }

  get zoom(): number {
    return this.currentZoom;
  }

  /** Zoom de referência que aproxima a escala da arte de um número inteiro de pixels físicos. Compensa letterbox × DPR com k / pixelScale. */

  baseZoom(): number {
    const k = Math.max(1, Math.round(this.pixelScale));
    return k / this.pixelScale;
  }

  get minZoom(): number {
    return this.baseZoom() * this.minZoomFactor;
  }

  get maxZoom(): number {
    return this.baseZoom() * this.maxZoomFactor;
  }

  get bitterMode(): boolean { return this.bitterModeEnabled; }

  private get minZoomFactor(): number { return this.bitterModeEnabled ? BITTER_ZOOM_OUT_FACTOR : ZOOM_OUT_FACTOR; }
  private get maxZoomFactor(): number { return this.bitterModeEnabled ? BITTER_ZOOM_IN_FACTOR : ZOOM_IN_FACTOR; }

  /** Changing the limits immediately clamps the zoom around the current center. */
  setBitterMode(enabled: boolean): void {
    if (enabled === this.bitterModeEnabled) return;
    const center = this.center;
    this.bitterModeEnabled = enabled;
    this.currentZoom = this.clampZoom(this.currentZoom);
    this.centerOn(center);
  }

  /** Pixels físicos por pixel de arte. Inteiro significa escala 1:1 ou ampliação exata. */
  get netScale(): number {
    return this.currentZoom * this.pixelScale;
  }

  get pixelPerfect(): boolean {
    return Math.abs(this.netScale - Math.round(this.netScale)) < 1e-6;
  }

  /**
   * Informa a escala externa (letterbox × dpr).
   *
   * Preserva a intenção do jogador: o que fica constante é a razão entre o zoom
   * atual e o de referência, não o zoom absoluto. Redimensionar a janela não deve
   * tirar quem estava aproximado do lugar onde estava olhando.
   */
  setPixelScale(scale: number): void {
    if (!(scale > 0) || !Number.isFinite(scale)) return;

    const razao = this.currentZoom / this.baseZoom();
    const centro = this.center;

    this.pixelScale = scale;
    this.currentZoom = this.clampZoom(razao * this.baseZoom());
    this.centerOn(centro);
  }

  get x(): number {
    return this.currentX;
  }

  get y(): number {
    return this.currentY;
  }

  /**
   * `true` no eixo em que o conteúdo é maior que a viewport, ou seja, em que existe
   * parte da sala fora da tela. Arrastar funciona nos dois casos, por causa de
   * `PAN_OVERSCROLL`; usado para diagnóstico.
   */
  get overflowing(): { x: boolean; y: boolean } {
    return {
      x: (this.content.right - this.content.left) * this.currentZoom > this.viewport.width,
      y: (this.content.bottom - this.content.top) * this.currentZoom > this.viewport.height,
    };
  }

  /** Retângulo do mundo que está visível agora. Usado no HUD e nos testes. */
  get visibleRect(): CameraRect {
    return {
      left: -this.currentX / this.currentZoom,
      top: -this.currentY / this.currentZoom,
      right: (this.viewport.width - this.currentX) / this.currentZoom,
      bottom: (this.viewport.height - this.currentY) / this.currentZoom,
    };
  }

  /** Centro da viewport em coordenadas do mundo. */
  get center(): CameraPoint {
    return this.toWorld({ x: this.viewport.width / 2, y: this.viewport.height / 2 });
  }

  toWorld(screen: CameraPoint): CameraPoint {
    return {
      x: (screen.x - this.currentX) / this.currentZoom,
      y: (screen.y - this.currentY) / this.currentZoom,
    };
  }

  toScreen(world: CameraPoint): CameraPoint {
    return {
      x: world.x * this.currentZoom + this.currentX,
      y: world.y * this.currentZoom + this.currentY,
    };
  }

  /** A sala pode crescer em jogo; o limite acompanha. */
  setContent(content: CameraRect): void {
    this.content = content;
    this.clamp();
  }

  setViewport(viewport: CameraSize): void {
    this.viewport = viewport;
    this.clamp();
  }

  /** Impede que o arraste exponha as laterais fora da textura do cenário. */
  setHorizontalCover(bounds: CameraHorizontalCover | null): void {
    this.horizontalCover = bounds;
    this.clamp();
  }

  /** Retorna ao mínimo da faixa selecionada com a cena centrada. */
  reset(): void {
    this.currentZoom = this.minZoom;
    this.centerOn({
      x: (this.content.left + this.content.right) / 2,
      y: (this.content.top + this.content.bottom) / 2,
    });
  }

  centerOn(world: CameraPoint): void {
    this.currentX = this.viewport.width / 2 - world.x * this.currentZoom;
    this.currentY = this.viewport.height / 2 - world.y * this.currentZoom;
    this.clamp();
  }

  /** Desloca em px de tela. */
  panBy(deltaX: number, deltaY: number): void {
    this.currentX += deltaX;
    this.currentY += deltaY;
    this.clamp();
  }

  /**
   * Zoom mantendo fixo o ponto do mundo que está embaixo de `focus`.
   *
   * Sem isso, dar zoom leva a câmera para o centro da tela e o jogador perde de
   * vista o que estava olhando. O corte do zoom vem ANTES de recalcular a
   * posição: se o fator estourasse o limite depois, o foco escorregaria no
   * último passo.
   */
  private clampZoom(zoom: number): number {
    const base = this.baseZoom();
    const factor = Math.min(this.maxZoomFactor, Math.max(this.minZoomFactor, zoom / base));
    const stepsPerUnit = Math.round(1 / ZOOM_GRID_STEP);
    let snapped = Math.round(factor * stepsPerUnit) / stepsPerUnit;
    if (this.horizontalCover) {
      const visibleWidth = (this.horizontalCover.viewportRight ?? this.viewport.width) -
        (this.horizontalCover.viewportLeft ?? 0);
      const coverWidth = this.horizontalCover.right - this.horizontalCover.left;
      if (coverWidth > 0) {
        snapped = Math.max(snapped, Math.ceil(visibleWidth / coverWidth / base * stepsPerUnit) / stepsPerUnit);
      }
    }
    return Math.min(this.maxZoomFactor, Math.max(this.minZoomFactor, snapped)) * base;
  }

  /** Zoom final válido (limites e degraus da grade) para um zoom desejado qualquer. */
  snapZoom(zoom: number): number {
    return this.clampZoom(zoom);
  }

  /**
   * `snap = false` só para os quadros intermediários de uma animação de zoom: respeita os limites,
   * mas não os degraus de pixel inteiro; o último quadro sempre volta a usar a grade.
   */
  setZoom(zoom: number, focus?: CameraPoint, snap = true): void {
    const alvo = snap ? this.clampZoom(zoom) : Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
    const ponto = focus ?? { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    const mundo = this.toWorld(ponto);

    this.currentZoom = alvo;
    this.currentX = ponto.x - mundo.x * alvo;
    this.currentY = ponto.y - mundo.y * alvo;
    this.clamp(snap);
  }

  zoomBy(factor: number, focus?: CameraPoint): void {
    this.setZoom(this.currentZoom * factor, focus);
  }

  /** Prende a câmera no conteúdo, com a folga de `PAN_OVERSCROLL`. */
  private clamp(snap = true): void {
    if (snap) this.currentZoom = this.clampZoom(this.currentZoom);
    this.currentX = this.clampAxis(this.currentX, this.content.left, this.content.right, this.viewport.width);
    this.currentY = this.clampAxis(this.currentY, this.content.top, this.content.bottom, this.viewport.height);
    if (this.horizontalCover) {
      const minX = (this.horizontalCover.viewportRight ?? this.viewport.width) -
        this.horizontalCover.right * this.currentZoom;
      const maxX = (this.horizontalCover.viewportLeft ?? 0) -
        this.horizontalCover.left * this.currentZoom;
      this.currentX = minX <= maxX
        ? Math.min(maxX, Math.max(minX, this.currentX))
        : (minX + maxX) / 2;
    }
  }

  /** Conteúdo menor que o viewport fica centrado com folga; conteúdo maior usa suas bordas como limites, acrescidas da mesma folga. */

  private clampAxis(position: number, min: number, max: number, extent: number): number {
    const tamanho = (max - min) * this.currentZoom;
    const folga = extent * PAN_OVERSCROLL;

    if (tamanho <= extent) {
      const centrado = (extent - tamanho) / 2 - min * this.currentZoom;
      return Math.min(centrado + folga, Math.max(centrado - folga, position));
    }

    const menor = extent - max * this.currentZoom - folga;
    const maior = -min * this.currentZoom + folga;
    return Math.min(maior, Math.max(menor, position));
  }
}
