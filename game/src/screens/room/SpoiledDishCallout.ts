import { Container, Sprite, Text, TextStyle, type Texture } from 'pixi.js';

/** A ponta acompanha o tampo; o balão não participa da profundidade dos móveis. */
export class SpoiledDishCallout {
  readonly view = new Container();

  constructor(sage: Texture, background: Texture) {
    this.view.label = 'spoiled-dish-callout';
    this.view.eventMode = 'none'; this.view.visible = false;
    this.view.pivot.set(134, 143);
    const frame = new Sprite(background); frame.width = 560; frame.height = 148;
    const icon = new Sprite(sage); icon.label = 'spoiled-dish-sage'; icon.anchor.set(0.5);
    icon.scale.set(Math.min(166 / sage.width, 111 / sage.height)); icon.position.set(75, 54);
    const title = new Text({ text: 'Comida estragada', style: new TextStyle({
      fontFamily: ['Arial', 'sans-serif'], fontSize: 36, fontWeight: '700', fill: 0x49651e, padding: 2,
    }) });
    title.position.set(168, 15);
    const hint = new Text({ text: 'Clique para opções', style: new TextStyle({
      fontFamily: ['Arial', 'sans-serif'], fontSize: 27, fill: 0x716654, padding: 2,
    }) });
    hint.position.set(169, 55);
    this.view.addChild(frame, icon, title, hint);
  }

  destroy(): void { this.view.destroy({ children: true }); }
}
