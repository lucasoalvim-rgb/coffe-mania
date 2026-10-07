import { Container, Graphics, Sprite, Text, TextStyle, type Texture } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';
import { ProgressBar } from '../loading/ProgressBar';

// Coordenadas da arte 720²: trilho escuro à esquerda; percentual no cinza à direita.
const TRACK = { x: 130, y: 450, width: 344, height: 36, radius: 10 };
const TRACK_INSET = 4;
const DISH_SIZE = 260 * 0.85;
const INK = 0x603a1e;

export function cookingRemainingLabel(remainingMs: number): string {
  const totalMinutes = Number.isFinite(remainingMs) ? Math.max(0, Math.ceil(remainingMs / 60_000)) : 0;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} ${hours === 1 ? 'Hora' : 'Horas'} e ${minutes} ${minutes === 1 ? 'Minuto' : 'Minutos'}`;
}

/** Informações de cozimento, com a ponta do balão ancorada no topo do fogão. */
export class CookProgressCallout {
  readonly view = new Container();
  private readonly fill = new ProgressBar({
    rect: { left: TRACK.x + TRACK_INSET, top: TRACK.y + TRACK_INSET,
      width: TRACK.width - TRACK_INSET * 2, height: TRACK.height - TRACK_INSET * 2, radius: 7 },
    palette: { base: 0x44801f, stripe: 0x69ae31 },
    glossy: true, striped: true, reducedMotion: true, transitionMs: 0,
  });
  private readonly dish: Sprite;
  private readonly name: Text;
  private readonly percentage: Text;
  private readonly remainingTime: Text;
  private displayedProgress = -1;
  private recipeName = '';

  constructor(background: Texture, clockTexture?: Texture) {
    this.view.label = 'cook-progress-callout';
    this.view.eventMode = 'none';
    this.view.visible = false;
    this.view.pivot.set(360, 622);

    const frame = new Sprite(background);
    const track = new Graphics().roundRect(TRACK.x, TRACK.y, TRACK.width, TRACK.height, TRACK.radius)
      .fill(0x535353);
    this.fill.view.label = 'cook-callout-fill';

    this.dish = new Sprite();
    this.dish.label = 'cook-callout-dish';
    // A arte do prato tem área transparente acima: o centro da parte visível
    // fica em y≈147,5 no canvas 240², alinhado ao centro da borda superior.
    this.dish.anchor.set(0.5, 147.5 / 240);
    this.dish.position.set(360, 114);

    this.name = new Text({ text: '', style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 68, fontWeight: '600', fill: INK,
    }) });
    this.name.label = 'cook-callout-name';
    this.name.anchor.set(0.5);
    this.name.position.set(360, 232);

    this.percentage = new Text({ text: '0,0%', style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 38, fontWeight: '700', fill: 0xffffff,
      stroke: { color: 0x000000, width: 4.5, join: 'round' }, padding: 5,
    }) });
    this.percentage.label = 'cook-callout-percentage';
    this.percentage.anchor.set(0.5);
    this.percentage.position.set(537.5, 468);
    const clock = new Sprite(clockTexture);
    clock.label = 'cook-callout-clock';
    clock.anchor.set(0.5);
    clock.position.set(155, 381);
    clock.visible = clockTexture !== undefined;
    if (clockTexture) clock.scale.set(74 / Math.max(clockTexture.width, clockTexture.height));
    this.remainingTime = new Text({ text: '', style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 38, fontWeight: '600', fill: 0x1266a3,
    }) });
    this.remainingTime.label = 'cook-callout-remaining-time';
    this.remainingTime.anchor.set(0.5);
    this.remainingTime.position.set(410, 381);
    const seasoningHint = new Text({ text: 'Clique para Temperar', style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 30, fontWeight: '600', fill: 0x777777,
    }) });
    seasoningHint.label = 'cook-callout-seasoning-hint';
    seasoningHint.anchor.set(0.5);
    seasoningHint.position.set(360, 537);
    this.view.addChild(frame, track, this.fill.view, this.dish, this.name, this.percentage, clock, this.remainingTime, seasoningHint);
  }

  setRemaining(remainingMs: number): void {
    const text = cookingRemainingLabel(remainingMs);
    if (this.remainingTime.text === text) return;
    this.remainingTime.text = text;
    this.remainingTime.scale.set(1);
    if (this.remainingTime.width > 385) this.remainingTime.scale.set(385 / this.remainingTime.width);
  }

  setRecipe(name: string, readyDish: Texture): void {
    if (this.dish.texture !== readyDish) {
      this.dish.texture = readyDish;
      this.dish.scale.set(DISH_SIZE / Math.max(readyDish.width, readyDish.height));
    }
    if (this.recipeName === name) return;
    this.recipeName = name;
    this.name.text = name;
    this.name.scale.set(1);
    if (this.name.width > 530) this.name.scale.set(530 / this.name.width);
  }

  setProgress(value: number): void {
    const tenth = Math.round(Math.max(0, Math.min(1, value)) * 1000);
    if (tenth === this.displayedProgress) return;
    this.displayedProgress = tenth;
    this.percentage.text = `${(tenth / 10).toFixed(1).replace('.', ',')}%`;
    this.percentage.scale.set(1);
    if (this.percentage.width > 116) this.percentage.scale.set(116 / this.percentage.width);
    this.fill.setProgress(tenth / 10, true);
  }

  destroy(): void {
    this.fill.releaseMask();
    this.view.destroy({ children: true });
  }
}
