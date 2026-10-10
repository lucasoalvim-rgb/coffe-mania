export type ModalPhase = 'closed' | 'opening' | 'open' | 'closing';

export const MODAL_OPEN_DURATION_MS = 260;
export const MODAL_CLOSE_DURATION_MS = 200;
export const MODAL_OVERLAY_ALPHA = 0.65;

/** Livro e temperos usam a mesma escala, fade e pequeno rebote ao abrir. */
export function modalAnimationFrame(phase: 'opening' | 'closing', elapsedMs: number): {
  scale: number; alpha: number; backdropAlpha: number; finished: boolean;
} {
  const progress = Math.max(0, Math.min(1, elapsedMs / (phase === 'opening' ? MODAL_OPEN_DURATION_MS : MODAL_CLOSE_DURATION_MS)));
  if (phase === 'opening') {
    const c1 = 1.70158;
    const back = 1 + (c1 + 1) * Math.pow(progress - 1, 3) + c1 * Math.pow(progress - 1, 2);
    return { scale: 0.7 + 0.3 * back, alpha: 1 - Math.pow(1 - progress, 3), backdropAlpha: MODAL_OVERLAY_ALPHA * progress, finished: progress >= 1 };
  }
  return { scale: 1 - 0.25 * Math.pow(progress, 3), alpha: 1 - progress, backdropAlpha: MODAL_OVERLAY_ALPHA * (1 - progress), finished: progress >= 1 };
}
