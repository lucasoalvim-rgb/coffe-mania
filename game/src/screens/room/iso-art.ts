import { Graphics, Sprite, type Texture } from 'pixi.js';

import type { IndoorArtFrame, IndoorSceneBackground } from '../../game/indoor-art';
import {
  DEPTH_BIAS_ITEM,
  DEPTH_BIAS_WALL,
  DEPTH_BIAS_WALL_DECOR,
  FLOOR_DRAW_PRIORITY,
  TILE_HEIGHT_HALF,
  TILE_WIDTH_HALF,
  itemDepth,
  wallDepth,
  type OcclusionAnchor,
  tileToScreenX,
  tileToScreenY,
} from '../../world/iso';
import type { RoomItem, RoomItemStyle, RoomModel } from '../../world/RoomModel';
import { ITEM_STYLES, footprintTiles } from '../../world/RoomModel';
import { setItemRoomDepth } from './RoomDepthSorter';
import { alphaHitArea } from './alpha-hit';

/** Desenho procedural de fallback e grade de diagnóstico, independente dos sprites. */

const FLOOR_LIGHT = 0xbf9f74;
const FLOOR_DARK = 0xb08f66;
const FLOOR_LINE = 0x8a6f4d;

/** Centro do losango do tile. `tileToScreen` devolve o canto de cima. */
export function tileCenter(tx: number, ty: number): { x: number; y: number } {
  return { x: tileToScreenX(tx, ty), y: tileToScreenY(tx, ty) + TILE_HEIGHT_HALF };
}

/** Losango de um tile, em coordenadas de tela. */
export function tileDiamond(tx: number, ty: number): { x: number; y: number }[] {
  return [
    { x: tileToScreenX(tx, ty), y: tileToScreenY(tx, ty) },
    { x: tileToScreenX(tx + 1, ty), y: tileToScreenY(tx + 1, ty) },
    { x: tileToScreenX(tx + 1, ty + 1), y: tileToScreenY(tx + 1, ty + 1) },
    { x: tileToScreenX(tx, ty + 1), y: tileToScreenY(tx, ty + 1) },
  ];
}

export function drawFloor(graphics: Graphics, model: RoomModel): Graphics {
  graphics.clear();

  for (let ty = 0; ty < model.tilesY; ty++) {
    for (let tx = 0; tx < model.tilesX; tx++) {
      if (!model.hasFloor(tx, ty)) continue;
      graphics
        .poly(tileDiamond(tx, ty))
        .fill((tx + ty) % 2 === 0 ? FLOOR_LIGHT : FLOOR_DARK)
        .stroke({ color: FLOOR_LINE, width: 1, alpha: 0.5 });
    }
  }

  return graphics;
}

/** Limites da grade de teste estendida para inspecionar a calçada e rua do lado de fora. */
export const TEST_GRID = {
  minTx: -14,
  maxTx: 26,
  minTy: -10,
  maxTy: 16,
};

/** Grade de teste cobrindo a área visível do cenário externo (rua, calçada, árvores). */
export function drawTestGrid(graphics: Graphics, model: RoomModel): Graphics {
  graphics.clear();

  for (let ty = TEST_GRID.minTy; ty <= TEST_GRID.maxTy; ty++) {
    for (let tx = TEST_GRID.minTx; tx <= TEST_GRID.maxTx; tx++) {
      // Tiles físicos da sala já têm piso e arte própria
      if (model.hasFloor(tx, ty)) continue;

      graphics
        .poly(tileDiamond(tx, ty))
        .stroke({ color: 0x5a9cf8, width: 1, alpha: 0.35 });
    }
  }

  return graphics;
}

/**
 * Volume isométrico de um móvel, com o topo e as duas faces visíveis.
 * A origem local é o centro do tile, na altura do piso.
 */
export function drawItemVolume(graphics: Graphics, style: RoomItemStyle): Graphics {
  const w = TILE_WIDTH_HALF * style.inset;
  const h = TILE_HEIGHT_HALF * style.inset;
  const top = -style.height;

  graphics
    .poly([
      { x: -w, y: 0 },
      { x: 0, y: h },
      { x: 0, y: h + top },
      { x: -w, y: top },
    ])
    .fill(style.leftColor);

  graphics
    .poly([
      { x: 0, y: h },
      { x: w, y: 0 },
      { x: w, y: top },
      { x: 0, y: h + top },
    ])
    .fill(style.rightColor);

  graphics
    .poly([
      { x: 0, y: -h + top },
      { x: w, y: top },
      { x: 0, y: h + top },
      { x: -w, y: top },
    ])
    .fill(style.topColor)
    .stroke({ color: 0x3b2a17, width: 1, alpha: 0.35 });

  return graphics;
}

/** Divide o volume por tile da pegada para permitir a ordenação independente das partes. Um móvel inteiro pode criar ciclos de oclusão. */

export function createItemViews(item: RoomItem): Graphics[] {
  const style = ITEM_STYLES[item.kind];
  let bias = DEPTH_BIAS_ITEM;
  if (item.kind === 'wall') {
    bias = DEPTH_BIAS_WALL;
  } else if (item.kind === 'window' || item.kind === 'door' || item.kind === 'panel') {
    bias = DEPTH_BIAS_WALL_DECOR;
  }

  return footprintTiles(item).map((tile) => {
    const graphics = new Graphics();
    graphics.label = `item:${item.name}:${tile.tx},${tile.ty}`;
    drawItemVolume(graphics, style);
    const center = tileCenter(tile.tx, tile.ty);
    graphics.position.set(center.x, center.y);
    graphics.zIndex = bias === DEPTH_BIAS_ITEM
      ? itemDepth(tile.tx, tile.ty, bias, item.occlusionAnchor)
      : wallDepth(tile.tx, tile.ty, bias);
    setItemRoomDepth(graphics, { ...item, ...tile, sizeX: 1, sizeY: 1 }, graphics.zIndex);
    return graphics;
  });
}

/** Sprites ancorados em tileToScreen + left/top. A profundidade nominal usa a frente da pegada; RoomDepthSorter resolve relações geométricas entre faces e volumes. */

export function createArtView(
  item: RoomItem,
  frame: IndoorArtFrame,
  texture: Texture,
  options: { bias?: number; suffix?: string; occlusionAnchor?: OcclusionAnchor } = {},
): Sprite {
  const sprite = new Sprite(texture);
  sprite.roundPixels = true;
  const frenteX = item.tx + (item.sizeX ?? 1) - 1;
  const frenteY = item.ty + (item.sizeY ?? 1) - 1;

  sprite.label = `item:${item.name}${options.suffix ?? ''}:${frenteX},${frenteY}`;
  sprite.position.set(tileToScreenX(item.tx, item.ty) + frame.left, tileToScreenY(item.tx, item.ty) + frame.top);
  const wallMounted = item.kind === 'wall' || item.kind === 'window' || item.kind === 'door' || item.kind === 'panel';
  const bias = options.bias ?? (wallMounted ? DEPTH_BIAS_WALL_DECOR : DEPTH_BIAS_ITEM);
  sprite.zIndex = wallMounted
    ? wallDepth(frenteX, frenteY, bias)
    : itemDepth(frenteX, frenteY, bias, options.occlusionAnchor ?? item.occlusionAnchor);
  setItemRoomDepth(sprite, item, sprite.zIndex);
  // Só pesa quando o sprite é interativo: o clique segue o desenho, não o retângulo da imagem.
  sprite.hitArea = alphaHitArea(texture);

  return sprite;
}

/** Quarter turns on the floor plane preserve the 2:1 diamond and its registration point. */
export function rotateFloorSprite(sprite: Sprite, frame: IndoorArtFrame, rotation: number): void {
  const turn = ((Math.floor(rotation) % 4) + 4) % 4;
  const pivotX = -frame.left, pivotY = TILE_HEIGHT_HALF - frame.top;
  sprite.position.set(sprite.x + pivotX, sprite.y + pivotY);
  sprite.pivot.set(pivotX, pivotY);
  sprite.rotation = turn * Math.PI / 2;
  sprite.scale.set(turn % 2 ? .5 : 1, turn % 2 ? 2 : 1);
}

/** Piso texturizado com um losango por tile. */
export function createFloorViews(model: RoomModel, frame: IndoorArtFrame, texture: Texture): Sprite[] {
  const views: Sprite[] = [];

  for (let ty = 0; ty < model.tilesY; ty++) {
    for (let tx = 0; tx < model.tilesX; tx++) {
      if (!model.hasFloor(tx, ty)) continue;
      const sprite = new Sprite(texture);
      sprite.roundPixels = true;
      sprite.label = `floor:${tx},${ty}`;
      sprite.position.set(tileToScreenX(tx, ty) + frame.left, tileToScreenY(tx, ty) + frame.top);
      // O piso é plano: uma camada só, abaixo de tudo.
      sprite.zIndex = FLOOR_DRAW_PRIORITY + 1;
      views.push(sprite);
    }
  }

  return views;
}

/** Cenário fora do quarto, na mesma raiz para acompanhar a câmera. */
export function createSceneBackgroundView(
  background: Pick<IndoorSceneBackground, 'left' | 'top'>,
  texture: Texture,
  label = 'room-city-background',
): Sprite {
  const sprite = new Sprite(texture);
  sprite.roundPixels = true;
  sprite.label = label;
  sprite.position.set(background.left, background.top);
  return sprite;
}
