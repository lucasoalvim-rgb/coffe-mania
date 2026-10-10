import { CanvasSource, Container, Graphics, Rectangle, Sprite, Text, TextStyle, Texture } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';

export type HudCurrency = 'cash' | 'gold';

/** Coordenadas locais; a moeda cobre a emenda entre os dois preenchimentos. */
export const CURRENCY_HUD_LAYOUT = {
  width: 394,
  height: 43,
  seam: 199,
  cash: { valueLeft: 36, valueWidth: 84, buttonLeft: 124 },
  gold: { valueLeft: 231, valueWidth: 111, buttonLeft: 347 },
  buttonSize: 38,
} as const;

const PALETTES = {
  cash: { edge: 0x2e6818, base: 0x729900, highlight: 0xb8cf23, shade: 0x4f8100, ink: 0x245d23 },
  gold: { edge: 0xa96720, base: 0xdf951f, highlight: 0xffc263, shade: 0xbc781d, ink: 0x533016 },
} as const;

const SHADOW_PADDING = 14;
/** Limites da arte restaurada, com a margem de antialiasing preservada. */
const ADD_BUTTON_FRAME = new Rectangle(111, 51, 1122, 1067);

/** Sombra rasterizada uma vez; o HUD não precisa de filtros em cada frame. */
function createShadow(width: number, height: number, radius: number, outline?: readonly number[]): Sprite {
  const padding = SHADOW_PADDING;
  const canvas = document.createElement('canvas');
  canvas.width = (width + padding * 2) * 2;
  canvas.height = (height + padding * 2) * 2;
  const context = canvas.getContext('2d')!;
  context.scale(2, 2);
  context.shadowColor = 'rgba(0, 0, 0, 0.38)';
  context.shadowBlur = 12;
  context.shadowOffsetY = 10;
  context.fillStyle = 'rgba(0, 0, 0, 0.38)';
  context.beginPath();
  if (outline) {
    context.moveTo(padding + outline[0], padding + outline[1]);
    for (let i = 2; i < outline.length; i += 2) context.lineTo(padding + outline[i], padding + outline[i + 1]);
    context.closePath();
    context.lineWidth = 4;
    context.lineJoin = 'round';
    context.strokeStyle = context.fillStyle;
    context.stroke();
  } else {
    context.roundRect(padding, padding, width, height, radius);
  }
  context.fill();
  const sprite = new Sprite(new Texture({ source: new CanvasSource({ resource: canvas, resolution: 2 }) }));
  sprite.position.set(-padding, -padding);
  sprite.eventMode = 'none';
  return sprite;
}

/** Botão independente; o handler pode ser conectado quando houver uma ação de compra. */
export class CurrencyAddButton {
  readonly view = new Container();

  constructor(currency: HudCurrency, onAdd?: (currency: HudCurrency) => void, texture?: Texture) {
    const size = CURRENCY_HUD_LAYOUT.buttonSize;
    this.view.label = `room-currency-add-${currency}`;
    this.view.hitArea = new Rectangle(0, 0, size, size);
    this.view.eventMode = 'static';
    this.view.cursor = onAdd ? 'pointer' : 'default';
    const face = texture ? new Sprite(texture) : new Graphics()
      .roundRect(0, 0, size, size, 7).fill(0x005629)
      .roundRect(2.5, 2.5, size - 5, size - 5, 5.5).fill(0x008b25)
      .roundRect(size - 7, 4, 4, size - 8, 2).fill(0x007625);
    if (texture) { face.width = size; face.height = size; }
    const plus = new Graphics()
      .poly([16, 9, 22, 9, 22, 15, 28, 15, 28, 22, 22, 22, 22, 28, 16, 28, 16, 22, 10, 22, 10, 15, 16, 15])
      .fill(0xffffff).stroke({ color: 0x174419, width: 2.2, join: 'round' });
    face.eventMode = plus.eventMode = 'none';
    this.view.addChild(face);
    if (!texture) this.view.addChild(plus);
    else plus.destroy();
    this.view.on('pointertap', (event) => {
      event.stopPropagation();
      onAdd?.(currency);
    });
    if (onAdd) {
      this.view.on('pointerover', () => { face.tint = 0xcaffbf; });
      this.view.on('pointerout', () => { face.tint = 0xffffff; });
    }
  }
}

/** Valor e botão têm espaço reservado: saldos longos não invadem o ícone ou o +. */
export class CurrencyCounter {
  readonly view = new Container();
  private readonly value: Text;
  private readonly valueWidth: number;

  constructor(currency: HudCurrency, onAdd?: (currency: HudCurrency) => void, addTexture?: Texture) {
    const layout = CURRENCY_HUD_LAYOUT[currency];
    this.valueWidth = layout.valueWidth;
    this.view.label = `room-currency-counter-${currency}`;
    this.value = new Text({
      text: '0',
      style: new TextStyle({
        fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 28, fontWeight: '700',
        fill: 0xffffff, stroke: { color: PALETTES[currency].ink, width: 5, join: 'round' },
        padding: 5,
      }),
    });
    this.value.label = `room-top-bar-label-${currency === 'cash' ? 1 : 2}`;
    this.value.anchor.set(0, 0.5);
    this.value.position.set(layout.valueLeft, CURRENCY_HUD_LAYOUT.height / 2 - 0.5);
    this.value.skew.x = 0.08;
    this.value.eventMode = 'none';
    const button = new CurrencyAddButton(currency, onAdd, addTexture);
    button.view.position.set(layout.buttonLeft, 2.5);
    this.view.addChild(this.value, button.view);
  }

  get text(): string { return this.value.text; }

  setValue(value: number): void {
    this.value.text = String(value);
    this.value.scale.set(1);
    this.value.scale.x = Math.min(1, this.valueWidth / this.value.width);
  }
}

function createCashIcon(): Container {
  const icon = new Container();
  icon.label = 'room-top-bar-icon-1';
  // As quatro arestas conservam a perspectiva da nota, além de sua inclinação.
  const art = new Graphics()
    .poly([-27, -7, 10, -26, 27, -7, -5, 28]).fill(0xffffff)
    .stroke({ color: 0xffffff, width: 4, join: 'round' })
    .poly([-25, -7, 10, -23, 24, -7, -5, 25]).fill(0x156831)
    .poly([-20, -5, 9, -18, 19, -6, -5, 19]).fill(0x52af43)
    .poly([-15, -4, 7, -14, 15, -6, -5, 14]).fill(0xa2d681)
    .circle(3, -5, 5.5).fill(0x40ad43)
    .circle(-15, -4, 3).fill(0x52af43)
    .circle(7, -14, 3).fill(0x52af43)
    .circle(15, -6, 3).fill(0x52af43)
    .circle(-5, 14, 3).fill(0x52af43);
  icon.addChild(art);
  icon.eventMode = 'none';
  return icon;
}

function createGoldIcon(): Container {
  const icon = new Container();
  icon.label = 'room-top-bar-icon-2';
  const art = new Graphics()
    .circle(0, 0, 25).fill(0xf4f4f1)
    .circle(-1.5, -0.5, 21.5).fill(0xb58927)
    .circle(0.5, -1, 19.5).fill(0xffd600)
    .circle(0.5, 0, 13.5).fill(0xd39220)
    .circle(2.5, 1, 11.7).fill(0xe6a224)
    .moveTo(12, -23).lineTo(17, -21).lineTo(14.5, -14)
    .stroke({ color: 0xffffff, width: 3.5, join: 'round' });
  icon.addChild(art);
  icon.eventMode = 'none';
  return icon;
}

/** Moldura contínua → preenchimentos → contadores → sombras locais → ícones. */
export class CurrencyHud {
  readonly view = new Container();
  private readonly cash: CurrencyCounter;
  private readonly gold: CurrencyCounter;
  private readonly shadowTextures: Texture[] = [];
  private readonly addTexture?: Texture;

  constructor(onAdd?: (currency: HudCurrency) => void, addTexture?: Texture) {
    const { width, height, seam } = CURRENCY_HUD_LAYOUT;
    this.view.label = 'room-currency-hud';
    this.view.addChild(this.shadow(width, height, 14));
    const frame = new Graphics().roundRect(0, 0, width, height, 14).fill(0xf3f3f1);
    const fill = new Graphics();
    (['cash', 'gold'] as const).forEach((currency) => {
      const palette = PALETTES[currency];
      const x = currency === 'cash' ? 4 : seam;
      const w = currency === 'cash'
        ? CURRENCY_HUD_LAYOUT.cash.buttonLeft + CURRENCY_HUD_LAYOUT.buttonSize / 2 - x
        : CURRENCY_HUD_LAYOUT.gold.buttonLeft + CURRENCY_HUD_LAYOUT.buttonSize / 2 - x;
      // A ponta reta termina dentro do botão: seus cantos não aparecem atrás da curva.
      fill.rect(x, 3.5, w, height - 7).fill(palette.edge)
        .rect(x, 7, w, height - 14).fill(palette.base)
        .rect(x, 8, w, 3).fill(palette.highlight)
        .rect(x, height - 12, w, 3.5).fill(palette.shade)
        .rect(x, height - 7, w, 2).fill(palette.highlight);
    });
    frame.eventMode = fill.eventMode = 'none';
    this.addTexture = addTexture ? new Texture({ source: addTexture.source, frame: ADD_BUTTON_FRAME }) : undefined;
    this.cash = new CurrencyCounter('cash', onAdd, this.addTexture);
    this.gold = new CurrencyCounter('gold', onAdd, this.addTexture);
    this.view.addChild(frame, fill, this.cash.view, this.gold.view);

    const cashShadow = this.shadow(58, 58, 0, [2, 21, 39, 2, 56, 21, 24, 56]);
    cashShadow.position.set(3 - 29 - SHADOW_PADDING, height / 2 - 28 - SHADOW_PADDING);
    const goldShadow = this.shadow(50, 50, 25);
    goldShadow.position.set(seam - 25 - SHADOW_PADDING, height / 2 - 25 - SHADOW_PADDING);
    const cashIcon = createCashIcon();
    cashIcon.position.set(3, height / 2);
    const goldIcon = createGoldIcon();
    goldIcon.position.set(seam, height / 2);
    this.view.addChild(cashShadow, goldShadow, cashIcon, goldIcon);
  }

  private shadow(width: number, height: number, radius: number, outline?: readonly number[]): Sprite {
    const sprite = createShadow(width, height, radius, outline);
    this.shadowTextures.push(sprite.texture);
    return sprite;
  }

  get labelTexts(): readonly string[] { return [this.cash.text, this.gold.text]; }

  setValues(cash: number, gold: number): void {
    this.cash.setValue(cash);
    this.gold.setValue(gold);
  }

  containsGlobalPoint(global: { x: number; y: number }): boolean {
    if (!this.view.visible || !this.view.renderable) return false;
    const point = this.view.toLocal(global);
    // Inclui os ícones salientes; exclui a extensão puramente visual da sombra.
    return new Rectangle(-30, -8, CURRENCY_HUD_LAYOUT.width + 30, 65).contains(point.x, point.y);
  }

  destroy(): void {
    this.view.destroy({ children: true });
    this.shadowTextures.forEach((texture) => texture.destroy(true));
    this.addTexture?.destroy();
  }
}
