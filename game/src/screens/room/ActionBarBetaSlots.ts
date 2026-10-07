import { Container, Graphics, Rectangle, Sprite, Text, TextStyle, Texture } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';
import { TOP_BAR_ICON_FRAMES } from './TopBars';

const SLOT_CENTERS = [385, 516, 648, 779, 910, 1041, 1172, 1303] as const;
const SLOT_LEVELS = [7, 24, 51, 68, 83, 104, 127, 150] as const;
const SLOT_TOP = 782;

/** Conteúdo provisório dos oito espaços da barra de amigos. */
export function createActionBarBetaSlots(icons: Texture): Container {
  const view = new Container();
  view.label = 'room-action-bar-beta-slots';
  view.eventMode = 'none';
  const frame = TOP_BAR_ICON_FRAMES[2];
  const spatulaTexture = new Texture({
    source: icons.source,
    frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
  });

  SLOT_CENTERS.forEach((center, index) => {
    const slot = new Container();
    slot.label = `room-action-bar-beta-slot-${index + 1}`;
    slot.position.set(center, SLOT_TOP);
    slot.eventMode = 'none';

    const white = new Graphics()
      .roundRect(-51, 0, 102, 150, 6)
      .fill(0xffffff);
    const title = new Text({
      text: 'beta',
      style: new TextStyle({
        fontFamily: [FONT_FAMILY, 'sans-serif'],
        fontSize: 19,
        fontWeight: '700',
        fill: 0x704721,
      }),
    });
    title.anchor.set(0.5, 0);
    title.position.set(0, 1);
    const square = new Graphics()
      .roundRect(-40, 28, 80, 80, 6)
      .fill(0xffffff)
      .stroke({ color: 0x704721, width: 5 });

    const spatula = new Sprite(spatulaTexture);
    spatula.anchor.set(0.5);
    spatula.height = 44;
    spatula.scale.x = spatula.scale.y;
    const number = new Text({
      text: String(SLOT_LEVELS[index]),
      style: new TextStyle({
        fontFamily: [FONT_FAMILY, 'sans-serif'],
        fontSize: 25,
        fontWeight: '700',
        fill: 0xffd436,
        stroke: { color: 0x704721, width: 6, join: 'round' },
        padding: 3,
      }),
    });
    number.anchor.set(0, 0.5);
    const rowWidth = spatula.width + 3 + number.width;
    spatula.position.set(-rowWidth / 2 + spatula.width / 2, 108);
    number.position.set(-rowWidth / 2 + spatula.width + 3, 108);
    const value = new Text({
      text: String(Math.floor(Math.random() * 10001)),
      style: new TextStyle({
        fontFamily: [FONT_FAMILY, 'sans-serif'],
        fontSize: 15,
        fontWeight: '400',
        fill: 0x000000,
        stroke: { color: 0x000000, width: 0.8, join: 'round' },
      }),
    });
    value.anchor.set(0.5, 0);
    value.position.set(0, 132);
    slot.addChild(white, title, square, spatula, number, value);
    view.addChild(slot);
  });

  return view;
}
