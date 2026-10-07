/** Preferências de áudio locais, separadas por jogador neste navegador. */
export interface AudioPreferences {
  musicPercent: number;
  effectsPercent: number;
  muted: boolean;
}

export const DEFAULT_AUDIO_PREFERENCES: Readonly<AudioPreferences> = {
  musicPercent: 40,
  effectsPercent: 50,
  muted: false,
};

const STORAGE_PREFIX = 'coffe-mania.audio.v1.';

export const audioPreferencesKey = (playerId: string): string =>
  `${STORAGE_PREFIX}${encodeURIComponent(playerId)}`;

export function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : 0;
}

export function sanitizeAudioPreferences(raw: unknown): AudioPreferences {
  const source = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  return {
    musicPercent: typeof source.musicPercent === 'number' && Number.isFinite(source.musicPercent)
      ? clampPercent(source.musicPercent) : DEFAULT_AUDIO_PREFERENCES.musicPercent,
    effectsPercent: typeof source.effectsPercent === 'number' && Number.isFinite(source.effectsPercent)
      ? clampPercent(source.effectsPercent) : DEFAULT_AUDIO_PREFERENCES.effectsPercent,
    muted: typeof source.muted === 'boolean' ? source.muted : DEFAULT_AUDIO_PREFERENCES.muted,
  };
}

export function loadAudioPreferences(
  storage: Pick<Storage, 'getItem'> | undefined,
  playerId: string,
): AudioPreferences {
  try {
    const saved = storage?.getItem(audioPreferencesKey(playerId));
    return saved ? sanitizeAudioPreferences(JSON.parse(saved)) : { ...DEFAULT_AUDIO_PREFERENCES };
  } catch {
    return { ...DEFAULT_AUDIO_PREFERENCES };
  }
}

export function saveAudioPreferences(
  storage: Pick<Storage, 'setItem'> | undefined,
  playerId: string,
  preferences: AudioPreferences,
): void {
  try {
    storage?.setItem(audioPreferencesKey(playerId), JSON.stringify(sanitizeAudioPreferences(preferences)));
  } catch {
    // Storage indisponível ou cheio: o áudio continua funcionando nesta sessão.
  }
}
