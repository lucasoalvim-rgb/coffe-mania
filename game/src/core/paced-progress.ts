/**
 * Junta o progresso real do carregamento com um tempo mínimo de exibição.
 *
 * A barra nunca corre mais rápido do que `minDurationMs` — sem isso, com os
 * assets em cache, ela salta de 0 a 100 num frame e a tela pisca. E nunca
 * ultrapassa o carregamento real, então continua sendo informação verdadeira.
 */
export class PacedProgress {
  private elapsedMs = 0;
  private real = 0;

  constructor(private readonly minDurationMs: number) {}

  /** Progresso real do loader, de 0 a 1. */
  setReal(value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    if (clamped > this.real) this.real = clamped;
  }

  advance(deltaMs: number): void {
    if (deltaMs > 0) this.elapsedMs += deltaMs;
  }

  /** Valor a mostrar na barra, de 0 a 100. */
  value(): number {
    const paced = this.minDurationMs > 0 ? this.elapsedMs / this.minDurationMs : 1;
    return Math.max(0, Math.min(1, Math.min(this.real, paced))) * 100;
  }

  get complete(): boolean {
    return this.real >= 1 && this.elapsedMs >= this.minDurationMs;
  }

  get elapsed(): number {
    return this.elapsedMs;
  }
}
