import { Container, Graphics, Rectangle, Text, TextStyle } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';

const BUTTON_WIDTH = 440;
const BUTTON_HEIGHT = 72;
const BUTTON_GAP = 4;
const INK = 0x603a1e;
const CASH = 0x2f8f3a;

type ButtonState = 'rest' | 'hover' | 'pressed';
export type StoveActionIcon = 'speed' | 'instant' | 'recover' | 'discard' | 'info';

export interface StoveAction {
  icon: StoveActionIcon;
  label: string;
  /** Preço em caféGranas mostrado à direita. */
  granas?: number;
  onTap?: () => void;
  disabled?: boolean;
}

/**
 * Ações do fogão com prato, com as mesmas três camadas dos painéis de cor. Como no original, o
 * preparo é acelerado com temperos pagos em caféGranas; o tempo restante fica no balão do hover.
 */
export class StoveActionMenu {
  readonly view = new Container();

  constructor(actions: readonly StoveAction[]) {
    this.view.label = 'stove-action-menu';
    actions.forEach((action, index) => this.addButton(index * (BUTTON_HEIGHT + BUTTON_GAP), action));
  }

  private addButton(y: number, action: StoveAction): void {
    const button = new Container();
    button.label = `stove-action-${action.icon}`;
    button.y = y;
    const enabled = !action.disabled && Boolean(action.onTap);
    button.eventMode = enabled ? 'static' : 'none';
    button.cursor = enabled ? 'pointer' : 'default';
    button.hitArea = new Rectangle(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT);
    button.alpha = action.disabled ? 0.55 : 1;

    const frame = new Graphics();
    frame.eventMode = 'none';
    const draw = (state: ButtonState) => {
      frame.clear();
      frame.roundRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, 12).fill(0x68401e);
      frame.roundRect(4, 4, BUTTON_WIDTH - 8, BUTTON_HEIGHT - 8, 10).fill(0xb7863b);
      frame.roundRect(9, 9, BUTTON_WIDTH - 18, BUTTON_HEIGHT - 18, 8)
        .fill(action.icon === 'info' ? 0xf3e6c4 : state === 'rest' ? 0xffffff : state === 'hover' ? 0xffefae : 0xf7d47a);
    };
    draw('rest');

    const icon = this.drawIcon(action.icon);
    const label = new Text({
      text: action.label,
      style: new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 25, fontWeight: '600', fill: INK }),
    });
    label.eventMode = 'none';
    label.anchor.set(0, 0.5);
    label.position.set(74, BUTTON_HEIGHT / 2);
    button.addChild(frame, icon, label);

    if (action.granas !== undefined) {
      const price = new Text({
        text: String(action.granas),
        style: new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 26, fontWeight: '700', fill: CASH }),
      });
      price.eventMode = 'none';
      price.anchor.set(1, 0.5);
      price.position.set(BUTTON_WIDTH - 58, BUTTON_HEIGHT / 2);
      // Nota verde de caféGrana.
      const bill = new Graphics()
        .roundRect(BUTTON_WIDTH - 52, BUTTON_HEIGHT / 2 - 11, 32, 22, 4).fill(0x4caf50).stroke({ color: 0x1f6b2a, width: 2.5 })
        .circle(BUTTON_WIDTH - 36, BUTTON_HEIGHT / 2, 5).stroke({ color: 0xe8f5e9, width: 2 });
      bill.eventMode = 'none';
      button.addChild(price, bill);
    }

    if (enabled) {
      button.on('pointerover', () => draw('hover'));
      button.on('pointerout', () => draw('rest'));
      button.on('pointerdown', (event) => { event.stopPropagation(); draw('pressed'); });
      button.on('pointerup', () => draw('hover'));
      button.on('pointerupoutside', () => draw('rest'));
      button.on('pointertap', (event) => {
        event.stopPropagation();
        action.onTap?.();
      });
    }
    this.view.addChild(button);
  }

  private drawIcon(kind: StoveActionIcon): Graphics {
    const icon = new Graphics();
    icon.eventMode = 'none';
    const cy = BUTTON_HEIGHT / 2;
    switch (kind) {
      case 'speed':
        icon.circle(38, cy, 17).stroke({ color: INK, width: 4 });
        icon.moveTo(38, cy - 11).lineTo(38, cy).lineTo(47, cy + 5).stroke({ color: INK, width: 3.5, cap: 'round', join: 'round' });
        break;
      case 'instant':
        icon.poly([42, cy - 20, 26, cy + 3, 37, cy + 3, 33, cy + 20, 50, cy - 4, 39, cy - 4]).fill(0xf2b230).stroke({ color: INK, width: 3, join: 'round' });
        break;
      case 'recover':
        icon.ellipse(38, cy, 10, 18).fill(0x6dbb4a).stroke({ color: INK, width: 3 });
        icon.moveTo(38, cy - 16).lineTo(38, cy + 16).stroke({ color: INK, width: 2.5 });
        break;
      case 'discard':
        icon.moveTo(26, cy - 12).lineTo(50, cy + 12).moveTo(50, cy - 12).lineTo(26, cy + 12).stroke({ color: INK, width: 4.5, cap: 'round' });
        break;
      case 'info':
        icon.circle(38, cy, 15).stroke({ color: INK, width: 3.5 });
        icon.moveTo(38, cy - 2).lineTo(38, cy + 8).stroke({ color: INK, width: 3.5, cap: 'round' });
        icon.circle(38, cy - 8, 2.2).fill(INK);
        break;
    }
    return icon;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
