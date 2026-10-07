import type { Graphics } from 'pixi.js';

export const CATEGORY_PULSE_DURATION_MS = 3000;

export interface CategorySelectionPulseStyle {
  centerAlpha?: number;
  ringWidth?: number;
  fadeExponent?: number;
}

/** Shared bullseye palette, timing and curves for wardrobe and store categories. */
export function drawCategorySelectionPulse(effect: Graphics, elapsedMs: number, scale = 1, reducedMotion = false, style: CategorySelectionPulseStyle = {}): void {
  const ringWidth = (style.ringWidth ?? 6) * scale;
  effect.clear().circle(0, 0, 24 * scale).fill({ color: 0x258fe7, alpha: style.centerAlpha ?? 0.48 });
  if (reducedMotion) {
    effect.circle(0, 0, 30 * scale).stroke({ color: 0x238eea, alpha: 1, width: ringWidth });
    return;
  }
  for (let ring = 0; ring < 2; ring++) {
    const progress = (elapsedMs / CATEGORY_PULSE_DURATION_MS + ring / 2) % 1;
    effect.circle(0, 0, (18 + progress * 31) * scale)
      .stroke({ color: 0x238eea, alpha: Math.pow(1 - progress, style.fadeExponent ?? 0.5), width: ringWidth });
  }
}
