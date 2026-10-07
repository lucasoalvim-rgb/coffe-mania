/** O servidor define posse, ocupação e relógio; o cliente só apresenta o progresso. */
export interface StoveCooking {
  id: string;
  recipeId: string;
  preparingAt: string;
  startedAt: string;
  readyAt: string;
  status: 'preparing' | 'cooking' | 'ready';
}

export interface OwnedStove {
  id: string;
  itemId: number;
  tx: number;
  ty: number;
  cooking: StoveCooking | null;
}

export interface CookingSnapshot {
  serverNow: string;
  stoves: OwnedStove[];
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
    if (response.status === 409) throw new Error('Fogão ocupado.');
    return this.read(response);
  }

  async serve(stoveId: string): Promise<CookingSnapshot> {
    const response = await this.request('/serve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stoveId }),
    });
    if (response.status === 409) throw new Error('O prato ainda não está pronto.');
    return this.read(response);
  }

  async cancel(stoveId: string): Promise<CookingSnapshot> {
    const response = await this.request('/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stoveId }),
    });
    if (response.status === 409) throw new Error('Este preparo não pode mais ser cancelado.');
    return this.read(response);
  }
}
