import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';

const BUTTON_WIDTH = 400;
const BUTTON_HEIGHT = 72;
const BUTTON_GAP = 4;
const INK = 0x603a1e;

type ButtonState = 'rest' | 'hover' | 'pressed';
type IconKind = 'clock' | 'cancel';

/** Ações contextuais do fogão, com as mesmas três camadas dos painéis de cor. */
export class StoveActionMenu {
  static readonly HEIGHT = BUTTON_HEIGHT * 2 + BUTTON_GAP;
  readonly view = new Container();
  private readonly timerLabel: Text;
  private remainingSeconds = 0;
  private timeRevealed = false;
  private spoiled = false;

  constructor(onRefresh: () => void, onCancel: () => void) {
    this.view.label = 'stove-action-menu';
    this.timerLabel = this.addButton(0, 'clock', 'Ver tempo', () => {
      this.timeRevealed = true;
      this.updateTimerLabel();
      onRefresh();
    });
    // Jogar fora vale em qualquer estágio, como no original; o fogão fica sujo.
    this.addButton(BUTTON_HEIGHT + BUTTON_GAP, 'cancel', 'Jogar fora', onCancel);
  }

  setRemaining(ms: number): void {
    this.remainingSeconds = Math.max(0, Math.ceil(ms / 1000));
    this.updateTimerLabel();
  }

  /** Prato pronto que passou da validade: só resta jogá-lo fora. */
  setSpoiled(spoiled: boolean): void {
    if (this.spoiled === spoiled) return;
    this.spoiled = spoiled;
    if (spoiled) this.timeRevealed = true;
    this.updateTimerLabel();
  }

  private updateTimerLabel(): void {
    if (!this.timeRevealed) return;
    if (this.spoiled) {
      this.timerLabel.text = 'Prato estragado';
      return;
    }
    this.timerLabel.text = `Faltam ${String(Math.floor(this.remainingSeconds / 60)).padStart(2, '0')}:${String(this.remainingSeconds % 60).padStart(2, '0')}`;
  }

  private addButton(y: number, iconKind: IconKind, caption: string, onTap: () => void): Text {
    const button = new Container();
    button.label = `stove-action-${iconKind}`;
    button.y = y;
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.hitArea = new Rectangle(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT);

    const frame = new Graphics();
    frame.eventMode = 'none';
    const draw = (state: ButtonState) => {
      frame.clear();
      frame.roundRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, 12).fill(0x68401e);
      frame.roundRect(4, 4, BUTTON_WIDTH - 8, BUTTON_HEIGHT - 8, 10).fill(0xb7863b);
      frame.roundRect(9, 9, BUTTON_WIDTH - 18, BUTTON_HEIGHT - 18, 8)
        .fill(state === 'rest' ? 0xffffff : state === 'hover' ? 0xffefae : 0xf7d47a);
    };
    draw('rest');

    const icon = new Graphics();
    icon.eventMode = 'none';
    if (iconKind === 'clock') {
      icon.circle(38, BUTTON_HEIGHT / 2, 17).stroke({ color: INK, width: 4 });
      icon.moveTo(38, BUTTON_HEIGHT / 2 - 11).lineTo(38, BUTTON_HEIGHT / 2)
        .lineTo(47, BUTTON_HEIGHT / 2 + 5).stroke({ color: INK, width: 3.5, cap: 'round', join: 'round' });
    } else {
      icon.moveTo(26, 24).lineTo(50, 48).moveTo(50, 24).lineTo(26, 48)
        .stroke({ color: INK, width: 4.5, cap: 'round' });
    }

    const label = new Text({
      text: caption,
      style: new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 29, fontWeight: '600', fill: INK }),
    });
    label.eventMode = 'none';
    label.anchor.set(0, 0.5);
    label.position.set(74, BUTTON_HEIGHT / 2);
    button.on('pointerover', () => draw('hover'));
    button.on('pointerout', () => draw('rest'));
    button.on('pointerdown', () => draw('pressed'));
    button.on('pointerup', () => draw('hover'));
    button.on('pointerupoutside', () => draw('rest'));
    button.on('pointertap', (event) => {
      event.stopPropagation();
      onTap();
    });
    button.addChild(frame, icon, label);
    this.view.addChild(button);
    return label;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
