import { Container, Rectangle, Sprite, Text, TextStyle, Texture } from 'pixi.js';

const BUTTON_WIDTH = 440;
const BUTTON_HEIGHT = 62;
const BUTTON_GAP = 2;

export type StoveActionIcon = 'speed' | 'instant' | 'recover' | 'discard' | 'info';

export interface StoveAction {
  icon: StoveActionIcon;
  label: string;
  granas?: number;
  onTap?: () => void;
  disabled?: boolean;
  /** Arte compartilhada com o painel de temperos ou a barra inferior. */
  texture?: Texture;
}

export interface StoveActionTextures {
  row: Texture;
  sponge: Texture;
}

/** Moldura e ícones RGBA; legendas e áreas de clique continuam independentes. */
export class StoveActionMenu {
  readonly view = new Container();
  private signature = '';
  private rows = 0;

  constructor(actions: readonly StoveAction[], private readonly textures?: StoveActionTextures) {
    this.view.label = 'stove-action-menu';
    this.setActions(actions);
  }

  get height(): number { return this.rows * BUTTON_HEIGHT + Math.max(0, this.rows - 1) * BUTTON_GAP; }

  /** Atualiza compra/uso por SSE sem recriar o alvo do mouse a cada quadro. */
  setActions(actions: readonly StoveAction[]): boolean {
    const signature = JSON.stringify(actions.map(({ icon, label, granas, disabled, texture }) => [icon, label, granas, disabled, texture?.uid]));
    if (signature === this.signature) return false;
    this.signature = signature; this.rows = actions.length;
    this.view.removeChildren().forEach((child) => child.destroy({ children: true }));
    actions.forEach((action, index) => this.addButton(index * (BUTTON_HEIGHT + BUTTON_GAP), action));
    return true;
  }

  private addButton(y: number, action: StoveAction): void {
    const button = new Container();
    button.label = 'stove-action-' + action.icon; button.y = y;
    const enabled = !action.disabled && Boolean(action.onTap);
    button.eventMode = 'static'; button.cursor = enabled ? 'pointer' : 'default';
    button.hitArea = new Rectangle(-40, 0, BUTTON_WIDTH + 40, BUTTON_HEIGHT);
    button.alpha = action.disabled ? 0.55 : 1;

    const frame = new Sprite(this.textures?.row ?? Texture.WHITE);
    frame.label = 'stove-action-frame'; frame.eventMode = 'none';
    frame.width = BUTTON_WIDTH; frame.height = BUTTON_HEIGHT;

    const art = action.texture ?? (action.icon === 'discard' ? this.textures?.sponge : undefined) ?? Texture.EMPTY;
    const icon = new Sprite(art); icon.label = 'stove-action-icon-' + action.icon;
    icon.eventMode = 'none'; icon.anchor.set(0.5);
    icon.scale.set(Math.min((action.icon === 'discard' ? 70 : 106) / art.width, 76 / art.height));
    icon.position.set(14, BUTTON_HEIGHT / 2);

    const label = new Text({
      text: action.label,
      style: new TextStyle({ fontFamily: ['Arial', 'sans-serif'], fontSize: 26, fontWeight: '400', fill: 0x70675d, padding: 2 }),
    });
    label.eventMode = 'none'; label.anchor.set(0.5);
    label.position.set(action.granas === undefined ? 255 : 216, BUTTON_HEIGHT / 2);
    label.scale.set(Math.min(1, (action.granas === undefined ? 340 : 265) / label.width));
    button.addChild(frame, icon, label);

    if (action.granas !== undefined) {
      const price = new Text({ text: String(action.granas), style: new TextStyle({
        fontFamily: ['Arial', 'sans-serif'], fontSize: 26, fontWeight: '700', fill: 0x2f8f3a,
      }) });
      price.eventMode = 'none'; price.anchor.set(1, 0.5);
      price.position.set(BUTTON_WIDTH - 20, BUTTON_HEIGHT / 2); button.addChild(price);
    }

    button.on('pointerover', () => { if (enabled) frame.tint = 0xfff2d9; });
    button.on('pointerout', () => { frame.tint = 0xffffff; });
    button.on('pointerdown', (event) => { event.stopPropagation(); if (enabled) frame.tint = 0xefd7b4; });
    button.on('pointerup', () => { frame.tint = 0xffffff; });
    button.on('pointerupoutside', () => { frame.tint = 0xffffff; });
    button.on('pointertap', (event) => { event.stopPropagation(); if (enabled) action.onTap?.(); });
    this.view.addChild(button);
  }

  destroy(): void { this.view.destroy({ children: true }); }
}
