import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';
import { modalAnimationFrame, type ModalPhase } from './ModalAnimation';

const PANEL = { width: 700, height: 520 } as const;
const BROWN = 0x6b4a2a;

function label(text: string, size: number, fill: number, extra: ConstructorParameters<typeof TextStyle>[0] = {}): Text {
  const value = new Text({ text, style: new TextStyle({
    fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: size, fontWeight: '600', fill, padding: 4, ...extra,
  }) });
  value.eventMode = 'none';
  return value;
}

/**
 * Confirmation popup, with the layout of the original ("Você quer mesmo vender esse item por
 * N Ouros?"). Provisional art: the frame, logo, close and confirm buttons are drawn here until
 * the real pieces arrive. Enter or the check confirms; Esc, the X or a click outside cancels.
 */
export class SellConfirmModal {
  readonly view = new Container();
  private readonly panel = new Container();
  private readonly backdrop = new Graphics();
  private readonly message: Text;
  private phase: ModalPhase = 'closed';
  private animTimer = 0;
  private resolve?: (confirmed: boolean) => void;
  private disposed = false;

  constructor() {
    this.view.label = 'sell-confirm-modal';
    this.view.visible = false;
    this.backdrop.rect(-12000, -12000, 24000, 24000).fill(0x000000);
    this.backdrop.alpha = 0;
    this.backdrop.eventMode = 'static';
    for (const name of ['pointerdown', 'pointerup', 'wheel'] as const) this.backdrop.on(name, (event) => event.stopPropagation());
    this.backdrop.on('pointertap', (event) => { event.stopPropagation(); this.finish(false); });

    this.panel.label = 'sell-confirm-window';
    this.panel.pivot.set(PANEL.width / 2, PANEL.height / 2);
    this.panel.position.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2);
    this.panel.eventMode = 'static';
    this.panel.hitArea = new Rectangle(0, 0, PANEL.width, PANEL.height);
    for (const name of ['pointerdown', 'pointerup', 'pointertap', 'wheel'] as const) this.panel.on(name, (event) => event.stopPropagation());

    const frame = new Graphics()
      .roundRect(0, 0, PANEL.width, PANEL.height, 36).fill(0xc9b27a)
      .roundRect(8, 8, PANEL.width - 16, PANEL.height - 16, 30).fill(0xf3ecbc)
      .roundRect(26, 26, PANEL.width - 52, PANEL.height - 52, 16).fill(0xffffff);
    frame.eventMode = 'none';

    const logo = new Container();
    logo.position.set(PANEL.width / 2, 120);
    const oval = new Graphics().ellipse(0, 0, 160, 76).fill(0xffc21a).stroke({ color: 0xe39a00, width: 6 });
    const logoTop = label('CAFÉ', 54, 0x2f7fb8, { fontWeight: '800', stroke: { color: 0xffffff, width: 7, join: 'round' } });
    const logoBottom = label('MANIA', 54, 0xf08a1c, { fontWeight: '800', stroke: { color: 0xffffff, width: 7, join: 'round' } });
    logoTop.anchor.set(0.5); logoBottom.anchor.set(0.5);
    logoTop.position.set(0, -24); logoBottom.position.set(0, 26);
    logo.addChild(oval, logoTop, logoBottom);

    const title = label('Confirmação!', 40, BROWN);
    title.anchor.set(0.5); title.position.set(PANEL.width / 2, 250);
    this.message = label('', 30, BROWN, { align: 'center', wordWrap: true, wordWrapWidth: PANEL.width - 150, lineHeight: 40 });
    this.message.anchor.set(0.5, 0); this.message.position.set(PANEL.width / 2, 300);

    const close = new Container();
    close.label = 'sell-confirm-close';
    close.position.set(PANEL.width - 52, 38);
    close.eventMode = 'static'; close.cursor = 'pointer';
    close.hitArea = new Rectangle(-34, -34, 68, 68);
    const closeFace = new Graphics().roundRect(-30, -30, 60, 60, 12).fill(0xc92410).stroke({ color: 0x7a0f05, width: 4 })
      .roundRect(-24, -24, 48, 48, 9).fill(0xf24a2a)
      .moveTo(-12, -12).lineTo(12, 12).moveTo(12, -12).lineTo(-12, 12).stroke({ color: 0xffffff, width: 9, cap: 'round' });
    closeFace.eventMode = 'none';
    close.addChild(closeFace);
    close.on('pointertap', (event) => { event.stopPropagation(); this.finish(false); });

    const confirm = new Container();
    confirm.label = 'sell-confirm-ok';
    confirm.position.set(PANEL.width / 2, PANEL.height - 28);
    confirm.eventMode = 'static'; confirm.cursor = 'pointer';
    confirm.hitArea = new Rectangle(-44, -44, 88, 88);
    const confirmFace = new Graphics().roundRect(-40, -40, 80, 80, 14).fill(0x1e9a2c).stroke({ color: 0x0c5a14, width: 5 })
      .roundRect(-33, -33, 66, 66, 10).fill(0x3fcb4a)
      .moveTo(-18, 0).lineTo(-5, 14).lineTo(20, -16).stroke({ color: 0xffffff, width: 11, cap: 'round', join: 'round' });
    confirmFace.eventMode = 'none';
    confirm.addChild(confirmFace);
    for (const button of [close, confirm]) {
      button.on('pointerover', () => button.scale.set(1.1));
      button.on('pointerout', () => button.scale.set(1));
    }
    confirm.on('pointertap', (event) => { event.stopPropagation(); this.finish(true); });

    this.panel.addChild(frame, logo, title, this.message, close, confirm);
    this.view.addChild(this.backdrop, this.panel);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean { return this.phase !== 'closed'; }

  /** Resolves true when the player confirms. Asking again while open cancels the earlier question. */
  ask(text: string): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    this.resolve?.(false);
    this.message.text = text;
    this.phase = 'opening';
    this.animTimer = 0;
    this.view.visible = true;
    this.backdrop.alpha = 0;
    this.panel.alpha = 0;
    this.panel.scale.set(0.7);
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  private finish(confirmed: boolean): void {
    if (this.phase === 'closed' || this.phase === 'closing') return;
    this.phase = 'closing';
    this.animTimer = 0;
    const resolve = this.resolve;
    this.resolve = undefined;
    resolve?.(confirmed);
  }

  update(deltaMs: number): void {
    if (this.phase !== 'opening' && this.phase !== 'closing') return;
    this.animTimer += Math.max(0, deltaMs);
    const frame = modalAnimationFrame(this.phase, this.animTimer);
    this.panel.scale.set(frame.scale);
    this.panel.alpha = frame.alpha;
    this.backdrop.alpha = frame.backdropAlpha;
    if (frame.finished) {
      if (this.phase === 'opening') this.phase = 'open';
      else { this.phase = 'closed'; this.view.visible = false; this.panel.scale.set(0.7); }
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.phase !== 'open' && this.phase !== 'opening') return;
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.finish(event.key === 'Enter');
    } else {
      // The question is modal: no shortcut reaches the room while it is open.
      event.stopImmediatePropagation();
    }
  };

  destroy(): void {
    this.disposed = true;
    this.resolve?.(false);
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.view.destroy({ children: true });
  }
}
