import { parseNpcAppearancePolicy, type NpcAppearancePolicy } from '../avatar/npc-looks';

export const NPC_APPEARANCE_CACHE_KEY = 'coffe-mania.npc-appearance.v1';
let policyPromise: Promise<NpcAppearancePolicy> | undefined;

/** One authenticated request per game boot; spawns only use the in-memory snapshot. */
export function loadNpcAppearancePolicy(storage = localStorageIfAvailable()): Promise<NpcAppearancePolicy> {
  policyPromise ??= fetchPolicy(storage);
  return policyPromise;
}

async function fetchPolicy(storage: Pick<Storage, 'setItem'> | undefined): Promise<NpcAppearancePolicy> {
  let response: Response;
  try {
    response = await fetch('/api/coffe/npc-appearance', {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error('Não foi possível carregar as roupas permitidas para os NPCs.');
  }
  if (response.status === 401) {
    window.location.replace('/');
    throw new Error('Sua sessão expirou. Entre novamente.');
  }
  if (!response.ok) throw new Error('Não foi possível carregar o catálogo dos NPCs. Tente novamente.');
  const policy = parseNpcAppearancePolicy(await response.json());
  try { storage?.setItem(NPC_APPEARANCE_CACHE_KEY, JSON.stringify(policy)); } catch { /* Memory cache remains available. */ }
  // Refresh on every boot: never resurrect disabled clothes from an old local snapshot.
  return policy;
}

function localStorageIfAvailable(): Pick<Storage, 'setItem'> | undefined {
  try { return window.localStorage; } catch { return undefined; }
}
