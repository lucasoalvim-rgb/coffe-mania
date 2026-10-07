/** Server-owned values. Percentages are derived, never persisted independently. */
export interface ResourceValue {
  current: number;
  maximum: number;
}

export interface PlayerState {
  /** Versioned JSON string; empty/absent means the catalogue's default avatar. */
  appearance?: string;
  cafeName: string;
  cash: number;
  gold: number;
  level: number;
  experience: ResourceValue;
  energy: ResourceValue;
  crates: ResourceValue;
  satisfaction: ResourceValue;
}

export function resourcePercentage(value: ResourceValue): number {
  if (!Number.isFinite(value.current) || !Number.isFinite(value.maximum) || value.maximum <= 0) return 0;
  return Math.min(100, Math.max(0, value.current * 100 / value.maximum));
}

/** Unloaded HUDs are hidden; this only keeps isolated screens deterministic. */
export function emptyPlayerState(): PlayerState {
  return {
    cafeName: '',
    cash: 0, gold: 0, level: 1,
    experience: { current: 0, maximum: 1 },
    energy: { current: 0, maximum: 50 },
    crates: { current: 0, maximum: 4 },
    satisfaction: { current: 0, maximum: 105 },
  };
}

/** Authenticated snapshot at entry or after realtime notifications; no polling. */
export async function loadPlayerState(signal?: AbortSignal): Promise<PlayerState> {
  let response: Response;
  try {
    response = await fetch('/api/coffe/player-state', {
      credentials: 'same-origin', cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error('Não foi possível conectar ao servidor para carregar seus dados.');
  }
  if (response.status === 401) {
    window.location.replace('/');
    throw new Error('Sua sessão expirou. Entre novamente.');
  }
  if (!response.ok) throw new Error('Não foi possível carregar seus dados. Tente novamente.');
  return response.json() as Promise<PlayerState>;
}
