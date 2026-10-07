import { STRIPE } from './layout';

export interface StripeBand {
  /** Posição inicial da faixa na coordenada diagonal x + y. */
  u: number;
  points: [[number, number], [number, number], [number, number], [number, number]];
}

export interface StripeGeometry {
  bands: StripeBand[];
  thickness: number;
  cyclePx: number;
}

/** Distância real entre duas retas x + y = constante. */
export function perpendicularDistance(first: number, second: number): number {
  return Math.abs(second - first) / Math.SQRT2;
}

/** Losangos inclinados 45° que ultrapassam a barra e permitem deslocamento contínuo. */
export function buildStripeGeometry(width: number, height: number): StripeGeometry {
  const thickness = STRIPE.thickness;
  const cyclePx = STRIPE.cyclePx;
  const bands: StripeBand[] = [];
  if (width <= 0 || height <= 0) return { bands, thickness, cyclePx };

  const diagonalThickness = thickness * Math.SQRT2;
  const first = Math.floor((-STRIPE.overscan - diagonalThickness) / cyclePx) * cyclePx;
  const last = Math.ceil((width + STRIPE.overscan + height) / cyclePx) * cyclePx;
  for (let u = first; u <= last + 1e-9; u += cyclePx) {
    bands.push({
      u,
      points: [
        [u, 0],
        [u + diagonalThickness, 0],
        [u + diagonalThickness - height, height],
        [u - height, height],
      ],
    });
  }
  return { bands, thickness, cyclePx };
}

export function isInsideStripe(
  bands: readonly StripeBand[],
  x: number,
  y: number,
  thickness: number,
): boolean {
  const u = x + y;
  const endOffset = thickness * Math.SQRT2;
  return bands.some((band) => u >= band.u - 1e-9 && u <= band.u + endOffset + 1e-9);
}
