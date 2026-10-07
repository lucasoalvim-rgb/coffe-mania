export interface BootFlags {
  /** `?lock=1`: trava o progresso em 100% (calibragem e teste visual). */
  lock100: boolean;
  /** `?motion=off`: desliga as animações, mesmo sem prefers-reduced-motion. */
  forceReducedMotion: boolean;
  /** `?grid=1`: desenha as réguas da stage (contorno, cantos e centro). */
  grid: boolean;
  /**
   * `?screen=room` entra direto no room; `?screen=avatar` abre a sonda do avatar
   * 3D (só em desenvolvimento).
   */
  startScreen: 'loading' | 'room' | 'avatar';
}

const truthy = new Set(['1', 'true', 'on', 'yes']);

/** Função pura: lê as flags de boot de uma query string. */
export function readBootFlags(search: string): BootFlags {
  const params = new URLSearchParams(search);
  return {
    lock100: truthy.has((params.get('lock') ?? '').toLowerCase()),
    forceReducedMotion: (params.get('motion') ?? '').toLowerCase() === 'off',
    grid: truthy.has((params.get('grid') ?? '').toLowerCase()),
    startScreen: readStartScreen(params.get('screen')),
  };
}

function readStartScreen(value: string | null): BootFlags['startScreen'] {
  const nome = (value ?? '').toLowerCase();
  if (nome === 'room') return 'room';
  if (nome === 'avatar') return 'avatar';
  return 'loading';
}

/** `true` quando o sistema pede menos movimento. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
