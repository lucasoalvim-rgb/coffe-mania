/**
 * Executor de efeitos sonoros (SFX).
 */
let muted = false;
let volumePercent = 50;
const activeEffects = new Map<HTMLAudioElement, number>();

export function setSfxMuted(value: boolean): void {
  muted = value;
  for (const audio of activeEffects.keys()) audio.muted = value;
}

export function setSfxVolumePercent(percent: number): void {
  volumePercent = Number.isFinite(percent) ? Math.round(Math.max(0, Math.min(100, percent))) : 0;
  for (const [audio, baseVolume] of activeEffects) audio.volume = baseVolume * volumePercent / 100;
}

export function playRandomSfx(urls: readonly string[], volume = 1): HTMLAudioElement | null {
  if (muted || volumePercent === 0 || typeof window === 'undefined' || typeof Audio === 'undefined' || urls.length === 0) {
    return null;
  }

  try {
    const randomIndex = Math.floor(Math.random() * urls.length);
    const audio = new Audio(urls[randomIndex]);
    const baseVolume = Math.max(0, Math.min(1, volume));
    audio.volume = baseVolume * volumePercent / 100;
    activeEffects.set(audio, baseVolume);
    const release = () => { activeEffects.delete(audio); };
    audio.addEventListener('ended', release, { once: true });
    audio.addEventListener('error', release, { once: true });
    void audio.play().catch(() => {
      release();
      // Ignora erro se autoplay for restringido
    });
    return audio;
  } catch {

    return null;
  }
}
