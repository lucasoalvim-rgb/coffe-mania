/** O servidor define posse, ocupação e relógio; o cliente só apresenta o progresso. */
export interface StoveCooking {
  id: string;
  recipeId: string;
  preparingAt: string;
  startedAt: string;
  readyAt: string;
  /** Fim da validade do prato pronto; depois disso ele só pode ser jogado fora. */
  spoilsAt: string;
  status: 'preparing' | 'cooking' | 'ready' | 'spoiled';
  /** Tempero usado no prato (um por prato). */
  spice?: string;
}

/** Tempero do fogão, pago em caféGranas. */
export interface CookingSpice {
  id: string;
  name: string;
  granas: number;
  effect: 'speed' | 'instant' | 'recover';
  shortcutSeconds?: number;
}

export interface OwnedStove {
  id: string;
  itemId: number;
  tx: number;
  ty: number;
  /** Levar o prato ao balcão ou jogá-lo fora suja o fogão; o chef precisa limpá-lo. */
  dirty: boolean;
  cooking: StoveCooking | null;
}

export interface CookingSnapshot {
  serverNow: string;
  stoves: OwnedStove[];
  spices?: CookingSpice[];
}

const endpoint = '/api/coffe/cooking';

export function cookingTime(value: string): number {
  return Date.parse(value.replace(' ', 'T'));
}

export class CookingClient {
  constructor(readonly roomId?: string) {}
  private serverAnchorMs = 0;
  private localAnchorMs = 0;

  serverNowMs(): number {
    return this.serverAnchorMs + (performance.now() - this.localAnchorMs);
  }

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(endpoint + path + (!path && this.roomId ? '?room=' + encodeURIComponent(this.roomId) : ''), {
        ...options,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new Error('Não foi possível conectar ao servidor de preparo.');
    }
    if (response.status === 401) {
      window.location.replace('/');
      throw new Error('Sua sessão expirou. Entre novamente.');
    }
    return response;
  }

  /** As recusas do servidor trazem a mensagem para o jogador (ouro, balcão, fogão ocupado). */
  private async reject(response: Response, fallback: string): Promise<never> {
    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    throw new Error(typeof body?.message === 'string' && body.message ? body.message : fallback);
  }

  private async read(response: Response): Promise<CookingSnapshot> {
    if (!response.ok) throw new Error('Não foi possível atualizar os fogões.');
    const snapshot = await response.json() as CookingSnapshot;
    const serverMs = cookingTime(snapshot.serverNow);
    if (!Number.isFinite(serverMs) || !Array.isArray(snapshot.stoves)) {
      throw new Error('Dados de preparo inválidos.');
    }
    this.accept(snapshot);
    return snapshot;
  }

  accept(snapshot: CookingSnapshot): void {
    this.serverAnchorMs = cookingTime(snapshot.serverNow); this.localAnchorMs = performance.now();
  }

  async refresh(): Promise<CookingSnapshot> {
    return this.read(await this.request(''));
  }

  async start(stoveId: string, recipeId: string): Promise<CookingSnapshot> {
    const response = await this.request('/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stoveId, recipeId }),
    });
    if (response.status === 409) return this.reject(response, 'Fogão ocupado.');
    return this.read(response);
  }

  async serve(stoveId: string): Promise<CookingSnapshot> {
    const response = await this.request('/serve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stoveId }),
    });
    if (response.status === 409) return this.reject(response, 'O prato ainda não está pronto.');
    return this.read(response);
  }

  async cancel(stoveId: string): Promise<CookingSnapshot> {
    const response = await this.request('/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stoveId }),
    });
    if (response.status === 409) return this.reject(response, 'Não há prato neste fogão.');
    return this.read(response);
  }

  async spice(stoveId: string, spice: string): Promise<CookingSnapshot> {
    const response = await this.request('/spice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stoveId, spice }),
    });
    if (response.status === 409 || response.status === 400) return this.reject(response, 'Não foi possível usar o tempero.');
    return this.read(response);
  }

  async clean(stoveId: string): Promise<CookingSnapshot> {
    const response = await this.request('/clean', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stoveId }),
    });
    if (response.status === 409) return this.reject(response, 'O fogão já está limpo.');
    return this.read(response);
  }
}
