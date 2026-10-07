/**
 * Gerenciador de música de fundo (BGM).
 *
 * Toca em loop contínuo. Lida com a política de autoplay dos navegadores:
 * se a reprodução for bloqueada antes do primeiro gesto do usuário, aguarda
 * o primeiro clique ou tecla para iniciar automaticamente.
 */
export class BgmPlayer {
  private audio: HTMLAudioElement | null = null;
  private started = false;
  private muted = false;
  private volumePercent: number;

  constructor(
    private readonly url: string,
    volume = 0.4,
  ) {
    this.volumePercent = Math.round(Math.max(0, Math.min(1, volume)) * 100);
  }

  play(): void {
    if (this.started) return;
    this.started = true;

    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;

    try {
      this.audio = new Audio(this.url);
      this.audio.loop = true;
      this.audio.volume = this.volumePercent / 100;
      this.audio.muted = this.muted;

      const promise = this.audio.play();
      if (promise !== undefined) {
        promise.catch(() => {
          // Autoplay policy: aguarda primeira interação do jogador
          const startOnInteraction = () => {
            window.removeEventListener('pointerdown', startOnInteraction);
            window.removeEventListener('keydown', startOnInteraction);
            if (this.audio && this.audio.paused) {
              void this.audio.play().catch(() => {});
            }
          };
          window.addEventListener('pointerdown', startOnInteraction, { once: true });
          window.addEventListener('keydown', startOnInteraction, { once: true });
        });
      }
    } catch {
      // Ignora erro em ambientes sem suporte a áudio
    }
  }

  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    this.started = false;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.audio) this.audio.muted = muted;
  }

  setVolumePercent(percent: number): void {
    this.volumePercent = Number.isFinite(percent) ? Math.round(Math.max(0, Math.min(100, percent))) : 0;
    if (this.audio) this.audio.volume = this.volumePercent / 100;
  }

  get isPlaying(): boolean {
    return this.audio !== null && !this.audio.paused;
  }
}
