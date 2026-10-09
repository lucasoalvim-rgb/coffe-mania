import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { FONT_FAMILY } from '../../core/font-tokens';

/** Balão vetorial com exterior transparente e ponta apoiada sobre o fogão. */
export class ReadyDishCallout {
  readonly view = new Container();

  constructor() {
    this.view.label = 'ready-dish-callout';
    this.view.eventMode = 'none';
    this.view.visible = false;
    this.view.pivot.set(140, 110);

    const frame = new Graphics()
      .moveTo(12, 0).lineTo(268, 0).quadraticCurveTo(280, 0, 280, 12)
      .lineTo(280, 74).quadraticCurveTo(280, 86, 268, 86)
      .lineTo(154, 86).lineTo(140, 110).lineTo(126, 86)
      .lineTo(12, 86).quadraticCurveTo(0, 86, 0, 74)
      .lineTo(0, 12).quadraticCurveTo(0, 0, 12, 0).closePath()
      .fill(0xffffff).stroke({ color: 0x603a1e, width: 7, join: 'round' });
    const title = new Text({ text: 'Prato pronto.', style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 28, fontWeight: '700', fill: 0x603a1e,
    }) });
    title.anchor.set(0.5);
    title.position.set(140, 29);
    const hint = new Text({ text: 'Clique para servir!', style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 23, fontWeight: '400', fill: 0x777777,
    }) });
    hint.anchor.set(0.5);
    hint.position.set(140, 60);
    this.view.addChild(frame, title, hint);
  }

  destroy(): void { this.view.destroy({ children: true }); }
}
