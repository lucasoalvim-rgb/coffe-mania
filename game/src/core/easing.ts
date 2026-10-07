/** Curvas equivalentes a cubic-bezier do CSS para compartilhar tempos entre canvas e DOM. */

export type Easing = (t: number) => number;

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** `linear` do CSS. */
export const linear: Easing = (t) => clamp01(t);

/** Solver de cubic-bezier com P0=(0,0) e P3=(1,1), como o CSS define. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const curve = (a: number, b: number, t: number): number => {
    // Forma expandida de Bernstein para P0=0, P3=1.
    const c = 3 * a;
    const bTerm = 3 * (b - a) - c;
    const aTerm = 1 - c - bTerm;
    return ((aTerm * t + bTerm) * t + c) * t;
  };
  const slope = (a: number, b: number, t: number): number => {
    const c = 3 * a;
    const bTerm = 3 * (b - a) - c;
    const aTerm = 1 - c - bTerm;
    return (3 * aTerm * t + 2 * bTerm) * t + c;
  };

  return (x: number): number => {
    const target = clamp01(x);
    if (target === 0 || target === 1) return target;

    // Newton-Raphson com fallback para bissecção.
    let t = target;
    for (let i = 0; i < 8; i++) {
      const error = curve(x1, x2, t) - target;
      if (Math.abs(error) < 1e-6) return curve(y1, y2, t);
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }

    let low = 0;
    let high = 1;
    t = target;
    for (let i = 0; i < 24; i++) {
      const value = curve(x1, x2, t);
      if (Math.abs(value - target) < 1e-6) break;
      if (value > target) high = t;
      else low = t;
      t = (low + high) / 2;
    }
    return curve(y1, y2, t);
  };
}

/** `ease-in-out` do CSS: cubic-bezier(0.42, 0, 0.58, 1). */
export const easeInOut: Easing = cubicBezier(0.42, 0, 0.58, 1);
