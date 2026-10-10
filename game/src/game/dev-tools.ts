import type { CookingSnapshot } from './cooking';
import type { PlayerState } from './player-state';

export interface DevWorld {
  roomId: string;
  revision: number;
  tilesX: number;
  tilesY: number;
  units: { unitId: string; itemId: number; tx: number; ty: number; placed: boolean; stoveId?: string }[];
  foods: { id: string; recipeId: string; counterId?: string; portions?: number }[];
}
export interface DevSnapshot { playerState: PlayerState; cooking: CookingSnapshot; world: DevWorld; maxLevel: number }
export type DevStoveCommand = 'finish' | 'spoil' | 'clean' | 'dirty' | 'empty';
export interface DevCommand {
  command: 'resource' | DevStoveCommand | 'clear_counters' | 'refill' | 'add_food' | 'spawn_customers' | 'clear_customers';
  stoveId?: string;
  counterId?: string;
  recipeId?: string;
  resource?: string;
  mode?: 'set' | 'add';
  value?: number;
}

/** A lost acknowledgement must retry the same receipt, never add currency twice. */
export class DevToolsClient {
  private pending?: DevCommand & { requestId: string };
  get hasPending(): boolean { return this.pending !== undefined; }

  async refresh(): Promise<DevSnapshot> { return this.request(''); }

  async execute(command: DevCommand): Promise<DevSnapshot> {
    if (this.pending) throw new Error('Há um comando sem confirmação. Use “Tentar novamente”.');
    this.pending = { ...command, requestId: crypto.randomUUID() };
    return this.retry();
  }

  async retry(): Promise<DevSnapshot> {
    if (!this.pending) throw new Error('Não há comando pendente.');
    const snapshot = await this.request('/command', this.pending);
    this.pending = undefined;
    return snapshot;
  }

  /** Discards an unconfirmed command; the server may still have applied it. */
  discard(): void { this.pending = undefined; }

  private async request(path: string, body?: DevCommand & { requestId: string }): Promise<DevSnapshot> {
    let response: Response;
    try {
      response = await fetch('/api/coffe/dev' + path, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
      });
    } catch { throw new Error('Servidor sem resposta. Tente novamente para confirmar o mesmo comando.'); }
    if (!response.ok) {
      if (body && response.status >= 400 && response.status < 500) this.pending = undefined;
      const error = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(error.message ?? `Falha no servidor (${response.status}).`);
    }
    return response.json() as Promise<DevSnapshot>;
  }
}

export function loadDevMode(user: string): boolean {
  try { return localStorage.getItem(`coffe-mania.dev-mode.${user}`) === 'true'; } catch { return false; }
}
export function saveDevMode(user: string, enabled: boolean): void {
  try { localStorage.setItem(`coffe-mania.dev-mode.${user}`, String(enabled)); } catch { /* Optional preference. */ }
}
