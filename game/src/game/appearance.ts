import { serializeAppearance } from '../avatar/appearance';
import type { Look } from '../avatar/wardrobe';
import type { PlayerState } from './player-state';

export async function saveAppearance(look: Look): Promise<PlayerState> {
  let response: Response;
  try {
    response = await fetch('/api/coffe/appearance', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appearance: serializeAppearance(look) }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error('Não foi possível salvar o visual. Tente novamente.');
  }
  if (response.status === 401) {
    window.location.replace('/');
    throw new Error('Sua sessão expirou. Entre novamente.');
  }
  if (!response.ok) throw new Error('Não foi possível salvar o visual. Tente novamente.');
  return response.json() as Promise<PlayerState>;
}
