import { Container, Graphics, Sprite, type Texture } from 'pixi.js';

import type { IndoorArtFrame } from '../../game/indoor-art';
import type { RoomItem } from '../../world/RoomModel';
import { wallDepth, tileToScreen, TILE_HEIGHT, TILE_WIDTH_HALF } from '../../world/iso';
import { WALL_COLORS, WALL_HEIGHT, wallCornerGeometry, wallDoorOpeningGeometry, wallGeometry } from '../../world/wallGeometry';
import { setItemRoomDepth, setRoomDepth } from './RoomDepthSorter';
import { groundScreenRange, screenToGround } from '../../world/RoomDepth';

export interface WallWallpaper {
  frame: IndoorArtFrame;
  texture: Texture;
  /** Rotação em que a face de origem foi desenhada. */
  sourceRotation?: number;
}

/** Estrutura vetorial e revestimento na mesma origem; uma porta recorta ambos sob a verga. */
export function createProceduralWallView(
  item: RoomItem,
  wallpaper?: WallWallpaper,
  doorLintelRatio?: number,
  showEnd = true,
): Container {
  const view = new Container();
  const origin = tileToScreen(item.tx, item.ty);
  const height = item.wallHeight ?? WALL_HEIGHT;
  view.label = `item:${item.name}:${item.tx},${item.ty}`;
  view.position.set(origin.x, origin.y);
  view.zIndex = wallDepth(item.tx, item.ty);
  setItemRoomDepth(view, item, view.zIndex);
  view.eventMode = 'none';

  const structure = new Graphics();
  structure.label = 'wall:structure';
  structure.roundPixels = true;
  view.addChild(structure);

  if (item.className === 'WallCorner' || (item.tx === 0 && item.ty === 0)) {
    const corner = wallCornerGeometry(height);
    structure.poly(corner.left).fill(WALL_COLORS.end)
      .poly(corner.right).fill(WALL_COLORS.end)
      .poly(corner.cap).fill(WALL_COLORS.top);
    const points = [corner.left[2], corner.left[3], corner.right[2], corner.right[3]]
      .map(point => screenToGround({ x: origin.x + point.x, y: origin.y + point.y }));
    setRoomDepth(view, { points, depth: view.zIndex, ...groundScreenRange(points) });
    return view;
  }

  const geometry = doorLintelRatio === undefined
    ? wallGeometry(item.rotation, height)
    : wallDoorOpeningGeometry(item.rotation, height, doorLintelRatio);
  if (showEnd) structure.poly(geometry.end).fill(WALL_COLORS.end);
  structure.poly(geometry.face).fill(WALL_COLORS.face)
    .poly(geometry.cap).fill(WALL_COLORS.top);

  if (wallpaper) {
    const sprite = new Sprite(wallpaper.texture);
    sprite.label = `item:${item.name}:paper:${item.tx},${item.ty}`;
    sprite.roundPixels = true;
    const { frame, texture } = wallpaper;
    const sourceRotation = wallpaper.sourceRotation ?? item.rotation;
    if (texture.width === frame.width && texture.height === frame.height) {
      sprite.position.set(frame.left, frame.top);
    } else {
      // Assets com enquadramentos diferentes usam a caixa visível para alinhar a face ao piso.

      const croppedFace = texture.width <= TILE_WIDTH_HALF + 8;
      const margin = croppedFace ? Math.max(0, (texture.width - TILE_WIDTH_HALF) / 2) : 0;
      const left = croppedFace
        ? (sourceRotation % 2 === 0 ? 0 : -TILE_WIDTH_HALF) - margin
        : -texture.width / 2;
      sprite.position.set(left, TILE_HEIGHT - texture.height + margin);
    }
    if ((sourceRotation % 2 === 0) !== (item.rotation % 2 === 0)) {
      // Mirror around the tile origin, including the frame's registration offset.
      sprite.scale.x = -1;
      sprite.x = -sprite.x;
    }
    const mask = new Graphics().poly(geometry.face).fill(0xffffff);
    mask.label = 'wall:paper-mask';
    mask.roundPixels = true;
    view.addChild(sprite, mask);
    sprite.mask = mask;
  }
  return view;
}
