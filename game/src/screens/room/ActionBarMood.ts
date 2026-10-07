import { Container, Sprite, Text, TextStyle } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';
import type { NpcEmotionTextures } from '../../game/asset-manifest';
import { resourcePercentage, type ResourceValue } from '../../game/player-state';

const BROWN = 0x66391e;

/** Expressão e nota da coluna elevada, em coordenadas da arte da barra. */
export class ActionBarMood {
  readonly view = new Container();
  private readonly icon: Sprite;
  private readonly valueText: Text;
  private readonly maximumText: Text;
  private readonly testerText: Text;

  constructor(
    private readonly textures: NpcEmotionTextures,
    scale: number,
    satisfaction?: ResourceValue,
    cafeName = '',
  ) {
    this.view.label = 'room-action-bar-mood';
    this.view.scale.set(scale);
    this.view.eventMode = 'none';

    this.icon = new Sprite(textures.satisfied[0]);
    this.icon.label = 'room-action-bar-mood-icon';
    this.icon.anchor.set(0.5);
    this.icon.position.set(260, 696);

    this.valueText = new Text({
      text: '0.0',
      style: new TextStyle({
        fontFamily: [FONT_FAMILY, 'sans-serif'],
        fontSize: 28,
        fontWeight: '600',
        fill: 0xffffff,
        stroke: { color: BROWN, width: 6, join: 'round' },
        padding: 5,
      }),
    });
    this.valueText.label = 'room-action-bar-mood-value';
    this.valueText.anchor.set(0, 0.5);
    this.valueText.position.set(306, 697);

    this.maximumText = new Text({
      text: '/105',
      style: new TextStyle({
        fontFamily: [FONT_FAMILY, 'sans-serif'],
        fontSize: 20,
        fontWeight: '700',
        fill: BROWN,
      }),
    });
    this.maximumText.label = 'room-action-bar-mood-maximum';
    this.maximumText.anchor.set(0, 0.5);
    this.maximumText.y = 701;

    this.testerText = new Text({
      text: cafeName,
      style: new TextStyle({
        fontFamily: [FONT_FAMILY, 'sans-serif'],
        fontSize: 18,
        fontWeight: '600',
        fill: BROWN,
        wordWrap: false,
        align: 'center',
      }),
    });
    this.testerText.label = 'room-action-bar-mood-tester';
    this.testerText.anchor.set(0.5, 0);
    this.testerText.position.set(356, 727);

    this.view.addChild(this.icon, this.valueText, this.maximumText, this.testerText);
    this.setSatisfaction(satisfaction ?? { current: 0, maximum: 105 });
    this.view.visible = satisfaction !== undefined;
  }

  setCafeName(name: string): void {
    this.testerText.text = name;
  }

  setSatisfaction(value: ResourceValue): void {
    this.view.visible = true;
    // Do vermelho mais irritado ao sorriso mais aberto, em dez faixas iguais.
    const step = Math.min(9, Math.floor(resourcePercentage(value) / 10));
    const texture = step < 5
      ? this.textures.dissatisfied[4 - step]
      : this.textures.satisfied[step - 5];
    this.icon.texture = texture;
    this.icon.scale.set(52 / texture.height);
    this.valueText.text = value.current.toFixed(1);
    this.maximumText.text = `/${value.maximum}`;
    this.maximumText.x = this.valueText.x + this.valueText.width - 3;
  }
}
