/**
 * Geometria da tela de carregamento, independente do renderer.
 */

export interface CoverFit {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Enquadramento estilo `object-fit: cover`: escala única (nunca estica), o
 * excedente sai para fora, centrado, no eixo que sobra.
 */
export function coverFit(
  frameWidth: number,
  frameHeight: number,
  textureWidth: number,
  textureHeight: number,
): CoverFit {
  if (textureWidth <= 0 || textureHeight <= 0) {
    return { scale: 1, x: 0, y: 0, width: 0, height: 0 };
  }
  const scale = Math.max(frameWidth / textureWidth, frameHeight / textureHeight);
  const width = textureWidth * scale;
  const height = textureHeight * scale;
  return { scale, x: (frameWidth - width) / 2, y: (frameHeight - height) / 2, width, height };
}

/** Largura visível da barra para um progresso de 0 a 100. */
export function progressToWidth(progress: number, barWidth: number): number {
  const clamped = Math.max(0, Math.min(100, progress));
  return (barWidth * clamped) / 100;
}

/** Raio usável sem estourar o retângulo (o CSS faz o mesmo clamp). */
export function clampRadius(radius: number, width: number, height: number): number {
  return Math.max(0, Math.min(radius, Math.min(width, height) / 2));
}
