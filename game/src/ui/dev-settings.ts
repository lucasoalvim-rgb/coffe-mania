import { DEFAULT_LOADING_LAYOUT, cloneLayout, type LoadingLayout } from '../screens/loading/layout';

export const DEV_LAYOUT_STORAGE_KEY = 'coffe-mania.dev.loading-layout';
export const DEV_LOCK_STORAGE_KEY = 'coffe-mania.dev.lock-100';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Aceita só números finitos e ignora qualquer outra coisa que esteja no
 * localStorage (versão antiga do painel, edição manual, lixo).
 */
export function sanitizeLayout(raw: unknown, defaults: LoadingLayout = DEFAULT_LOADING_LAYOUT): LoadingLayout {
  const result = cloneLayout(defaults);
  if (typeof raw !== 'object' || raw === null) return result;

  const source = raw as Record<string, unknown>;
  for (const group of ['banner', 'bar', 'text'] as const) {
    const groupValue = source[group];
    if (typeof groupValue !== 'object' || groupValue === null) continue;
    const entries = groupValue as Record<string, unknown>;
    const target = result[group] as unknown as Record<string, number>;
    for (const key of Object.keys(target)) {
      const value = entries[key];
      if (isFiniteNumber(value)) target[key] = value;
    }
  }

  return result;
}

export function loadStoredLayout(
  storage: Pick<Storage, 'getItem'> | undefined,
  defaults: LoadingLayout = DEFAULT_LOADING_LAYOUT,
  key: string = DEV_LAYOUT_STORAGE_KEY,
): LoadingLayout {
  if (!storage) return cloneLayout(defaults);
  try {
    const raw = storage.getItem(key);
    if (!raw) return cloneLayout(defaults);
    return sanitizeLayout(JSON.parse(raw), defaults);
  } catch {
    return cloneLayout(defaults);
  }
}

export function saveLayout(
  storage: Pick<Storage, 'setItem'> | undefined,
  layout: LoadingLayout,
  key: string = DEV_LAYOUT_STORAGE_KEY,
): void {
  try {
    storage?.setItem(key, JSON.stringify(layout));
  } catch {
    // Modo privado ou storage cheio: seguir sem persistir.
  }
}

export function loadStoredLock(
  storage: Pick<Storage, 'getItem'> | undefined,
  key: string = DEV_LOCK_STORAGE_KEY,
): boolean {
  try {
    return storage?.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function saveLock(
  storage: Pick<Storage, 'setItem'> | undefined,
  locked: boolean,
  key: string = DEV_LOCK_STORAGE_KEY,
): void {
  try {
    storage?.setItem(key, String(locked));
  } catch {
  }
}
