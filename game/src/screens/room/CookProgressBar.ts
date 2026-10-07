import { Container, Graphics, Rectangle, Sprite, Text, TextStyle, Texture } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';

/** A arte tem um canvas 480², mas o desenho da barra ocupa só y=197..248. */
const FRAME = new Rectangle(8, 195, 456, 56);
const FILL_X = 8;
const FILL_Y = 9;
const FILL_WIDTH = 440;
const FILL_HEIGHT = 38;
const TEXT_Y = FRAME.height / 2;
const TEXT_INSET = 22;

/** Fundo original, preenchimento e moldura, como as barras superiores. */
export class CookProgressBar {
  readonly view = new Container();
  private readonly fill = new Graphics();
  private readonly percentage: Text;
  private readonly backTexture: Texture;
  private readonly frontTexture: Texture;
  private readonly mode: 'cooking' | 'serving';

  constructor(back: Texture, front: Texture, mode: 'cooking' | 'serving' = 'cooking') {
    this.mode = mode;
    this.view.label = `stove-${mode}-progress`;
    this.view.eventMode = 'none';
    this.view.pivot.set(FRAME.width / 2, FRAME.height / 2);
    this.backTexture = new Texture({ source: back.source, frame: FRAME.clone() });
    this.frontTexture = new Texture({ source: front.source, frame: FRAME.clone() });

    const base = new Sprite(this.backTexture);
    base.label = 'stove-cooking-progress-back';
    const border = new Sprite(this.frontTexture);
    border.label = 'stove-cooking-progress-front';
    this.fill.label = 'stove-cooking-progress-fill';

    const style = new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'],
      fontSize: 36,
      fontWeight: '700',
      fill: 0xffffff,
      stroke: { color: 0x4f331c, width: 4, join: 'round' },
      padding: 3,
    });
    const label = new Text({ text: mode === 'serving' ? 'Servindo' : 'Cozinhar', style });
    label.label = 'stove-cooking-progress-label';
    label.anchor.set(0, 0.5);
    label.position.set(TEXT_INSET, TEXT_Y);
    this.percentage = new Text({ text: '%0', style });
    this.percentage.label = 'stove-cooking-progress-percentage';
    this.percentage.anchor.set(1, 0.5);
    this.percentage.position.set(FRAME.width - TEXT_INSET, TEXT_Y);
    this.view.addChild(base, this.fill, border, label, this.percentage);
    this.setProgress(0);
  }

  setProgress(value: number): void {
    const progress = Math.max(0, Math.min(1, value));
    const width = FILL_WIDTH * progress;
    this.percentage.text = `%${Math.round(progress * 100)}`;
    this.fill.clear();
    if (width <= 0) return;
    const radius = Math.min(13, width / 2);
    this.fill.roundRect(FILL_X, FILL_Y, width, FILL_HEIGHT, radius)
      .fill(this.mode === 'serving' ? 0x58a827 : 0xe98919);
    this.fill.roundRect(FILL_X + 2, FILL_Y + 2, Math.max(0, width - 4), 13, Math.min(8, width / 2))
      .fill({ color: this.mode === 'serving' ? 0xc3ee84 : 0xffd575, alpha: 0.52 });
    this.fill.roundRect(FILL_X + 2, FILL_Y + 25, Math.max(0, width - 4), 10, Math.min(6, width / 2))
      .fill({ color: this.mode === 'serving' ? 0x326414 : 0x9b4a0c, alpha: 0.25 });
  }

  destroy(): void {
    this.view.destroy({ children: true });
    this.backTexture.destroy(false);
    this.frontTexture.destroy(false);
  }
}
