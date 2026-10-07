import { TIMING } from './layout';
import { MESSAGE_COUNT } from './messages';

export interface ProgressStateOptions {
  /** Injetável para teste determinístico. */
  random?: () => number;
  messageCount?: number;
  tickMs?: number;
  messageIntervalMs?: number;
  /** Progresso externo de 0 a 100; quando fornecido, substitui a simulação. */

  source?: () => number;
}

/**
 * Dois relógios independentes: um para o progresso, outro para as frases.
 * Travar o progresso não congela as frases.
 */
export class ProgressState {
  private readonly random: () => number;
  private readonly messageCount: number;
  private readonly tickMs: number;
  private readonly messageIntervalMs: number;
  private readonly source?: () => number;

  private progressClock = 0;
  private messageClock = 0;
  private simulated = 0;
  private messageIndexValue = 0;

  /** Trava do painel de ajustes: mantém 100% sem parar as frases. */
  locked = false;

  constructor(options: ProgressStateOptions = {}) {
    this.random = options.random ?? Math.random;
    this.messageCount = options.messageCount ?? MESSAGE_COUNT;
    this.tickMs = options.tickMs ?? TIMING.progressTickMs;
    this.messageIntervalMs = options.messageIntervalMs ?? TIMING.messageIntervalMs;
    this.source = options.source;
  }

  get progress(): number {
    if (this.locked) return 100;
    if (this.source) return Math.max(0, Math.min(100, this.source()));
    return this.simulated;
  }

  get messageIndex(): number {
    return this.messageIndexValue;
  }

  advance(deltaMs: number): void {
    if (deltaMs <= 0) return;

    if (!this.source) {
      this.progressClock += deltaMs;
      while (this.progressClock >= this.tickMs) {
        this.progressClock -= this.tickMs;
        if (this.locked) continue;
        const step = this.random() * TIMING.progressStepRange + TIMING.progressStepBase;
        const next = this.simulated + step;

        this.simulated = next > 100 ? 0 : next;
      }
    }

    this.messageClock += deltaMs;
    while (this.messageClock >= this.messageIntervalMs) {
      this.messageClock -= this.messageIntervalMs;
      this.messageIndexValue = (this.messageIndexValue + 1) % this.messageCount;
    }
  }
}
