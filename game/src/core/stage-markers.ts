import { Container, Graphics } from 'pixi.js';

import { STAGE_HEIGHT, STAGE_WIDTH } from './stage';

/**
 * Réguas da stage 1920x1080: contorno, marcador nos quatro cantos e cruz no
 * centro. Ligadas com `?grid=1`.
 *
 * Serve para conferir o letterbox: redimensionando a janela de qualquer forma,
 * os marcadores não podem se deslocar entre si nem sair da arte.
 */
export function createStageMarkers(): Container {
  const layer = new Container();
  layer.label = 'stage-markers';

  const outline = new Graphics();
  outline.rect(0.5, 0.5, STAGE_WIDTH - 1, STAGE_HEIGHT - 1).stroke({ color: 0xff00ff, width: 2 });
  layer.addChild(outline);

  const size = 64;
  const corners: [number, number, number, number][] = [
    [0, 0, 1, 1],
    [STAGE_WIDTH, 0, -1, 1],
    [0, STAGE_HEIGHT, 1, -1],
    [STAGE_WIDTH, STAGE_HEIGHT, -1, -1],
  ];

  for (const [x, y, dx, dy] of corners) {
    const mark = new Graphics();
    mark
      .moveTo(x, y)
      .lineTo(x + size * dx, y)
      .moveTo(x, y)
      .lineTo(x, y + size * dy)
      .stroke({ color: 0x00ffff, width: 6 });
    layer.addChild(mark);
  }

  const center = new Graphics();
  const cx = STAGE_WIDTH / 2;
  const cy = STAGE_HEIGHT / 2;
  center
    .moveTo(cx - size, cy)
    .lineTo(cx + size, cy)
    .moveTo(cx, cy - size)
    .lineTo(cx, cy + size)
    .stroke({ color: 0xffff00, width: 4 });
  center.circle(cx, cy, 10).stroke({ color: 0xffff00, width: 4 });
  layer.addChild(center);

  return layer;
}
