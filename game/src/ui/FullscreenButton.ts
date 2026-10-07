import './ui.css';

const ICON_ENTER = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M4 9V4h5" /><path d="M20 9V4h-5" /><path d="M4 15v5h5" /><path d="M20 15v5h-5" />
</svg>`;

const ICON_EXIT = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M9 4v5H4" /><path d="M15 4v5h5" /><path d="M9 20v-5H4" /><path d="M15 20v-5h5" />
</svg>`;

const ICON_REVEAL = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M6 9l6 6 6-6" class="fullscreen-reveal-outline" />
  <path d="M6 9l6 6 6-6" />
</svg>`;

/**
 * Botão de tela cheia. HTML de verdade: `<button>` focável, com aria-label e
 * aria-pressed, fora do canvas e sem escalar com a stage.
 */
export class FullscreenButton {
  readonly element: HTMLButtonElement;
  readonly container: HTMLDivElement;
  readonly reveal: HTMLButtonElement;

  private readonly target: Element;
  private readonly onChange = () => this.sync();
  private expanded = false;
  private wardrobeOpen = false;
  private stageScale = 1;
  private readonly onOutsidePress = (event: PointerEvent) => {
    if (event.target instanceof Node && !this.container.contains(event.target)) this.setExpanded(false);
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.setExpanded(false);
  };

  constructor(host: HTMLElement, target: Element = document.documentElement) {
    this.target = target;

    this.container = document.createElement('div');
    this.container.className = 'fullscreen-control';
    this.reveal = document.createElement('button');
    this.reveal.type = 'button';
    this.reveal.className = 'fullscreen-reveal';
    this.reveal.innerHTML = ICON_REVEAL;
    this.reveal.setAttribute('aria-controls', 'game-fullscreen-action');
    this.reveal.addEventListener('click', (event) => {
      this.setExpanded(!this.expanded);
      if (this.expanded && event.detail === 0) this.element.focus();
    });

    this.element = document.createElement('button');
    this.element.id = 'game-fullscreen-action';
    this.element.type = 'button';
    this.element.className = 'ui-button ui-fullscreen';
    this.element.addEventListener('click', () => {
      void this.toggle().then(() => this.setExpanded(false));
    });

    this.container.append(this.reveal, this.element);
    host.appendChild(this.container);
    document.addEventListener('fullscreenchange', this.onChange);
    document.addEventListener('pointerdown', this.onOutsidePress);
    document.addEventListener('keydown', this.onKeyDown);
    this.setExpanded(false);
    this.sync();
  }

  setExpanded(expanded: boolean): void {
    const restoreFocus = !expanded && document.activeElement === this.element;
    this.expanded = expanded;
    this.element.hidden = !expanded;
    this.element.disabled = !expanded;
    this.element.tabIndex = expanded ? 0 : -1;
    this.element.setAttribute('aria-hidden', String(!expanded));
    this.container.classList.toggle('is-expanded', expanded);
    this.reveal.setAttribute('aria-expanded', String(expanded));
    const caption = expanded ? 'Recolher botão de tela cheia' : 'Mostrar botão de tela cheia';
    this.reveal.setAttribute('aria-label', caption);
    this.reveal.title = caption;
    if (restoreFocus) this.reveal.focus({ preventScroll: true });
  }

  setWardrobeOpen(open: boolean): void {
    if (this.wardrobeOpen !== open) this.setExpanded(false);
    this.wardrobeOpen = open;
    this.container.classList.toggle('is-wardrobe', open);
    this.updatePosition();
  }

  setStageScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0) return;
    this.stageScale = scale;
    this.updatePosition();
  }

  private updatePosition(): void {
    if (!this.wardrobeOpen) {
      this.container.style.removeProperty('--fullscreen-top');
      this.container.style.removeProperty('--fullscreen-right');
      return;
    }
    // Match the wardrobe close button's physical size/inset, leaving 48px below it.
    const closeSize = Math.max(44, Math.min(64, 56 * this.stageScale));
    this.container.style.setProperty('--fullscreen-top', `${20 + closeSize + 48}px`);
    this.container.style.setProperty('--fullscreen-right', `${20 + closeSize / 2 - 24}px`);
  }

  get isFullscreen(): boolean {
    return document.fullscreenElement !== null && document.fullscreenElement !== undefined;
  }

  async toggle(): Promise<void> {
    try {
      if (this.isFullscreen) await document.exitFullscreen();
      else await this.target.requestFullscreen?.();
    } catch (error) {
      // Navegador pode negar (sem gesto do usuário, iframe sem allow, iOS).
      console.warn('[fullscreen] recusado', error);
    }
    this.sync();
  }

  private sync(): void {
    const active = this.isFullscreen;
    this.element.innerHTML = active ? ICON_EXIT : ICON_ENTER;
    this.element.setAttribute('aria-pressed', String(active));
    this.element.setAttribute('aria-label', active ? 'Sair da tela cheia' : 'Entrar em tela cheia');
    this.element.title = active ? 'Sair da tela cheia' : 'Tela cheia';
  }

  destroy(): void {
    document.removeEventListener('fullscreenchange', this.onChange);
    document.removeEventListener('pointerdown', this.onOutsidePress);
    document.removeEventListener('keydown', this.onKeyDown);
    this.container.remove();
  }
}
