import { Container, MeshSimple, type Texture } from 'pixi.js';

import type { IndoorArtFrame } from '../../game/indoor-art';
import type { Actor } from '../../world/Actor';
import type { RoomItem } from '../../world/RoomModel';
import { doorLeafVertices, doorOpeningTile, type DoorArtGeometry } from '../../world/doorGeometry';
import { groundPlaneFootY, groundScreenRange, screenToGround, type RoomDepthGeometry } from '../../world/RoomDepth';
import { DEPTH_BIAS_WALL_DECOR, screenDepth, tileToScreenX, tileToScreenY } from '../../world/iso';
import { setRoomDepth } from './RoomDepthSorter';

const OPEN_DURATION_MS = 280;
const CLOSE_DURATION_MS = 360;
const OPEN_ANGLE = Math.PI / 2;

/** Uma porta é uma folha de dois triângulos, articulada na borda da textura. */
export class DoorView {
  readonly view = new Container();
  readonly front: MeshSimple;
  readonly back: MeshSimple;
  private readonly hingeX: number;
  private readonly hingeY: number;
  private readonly baseSlope: number;
  private readonly width: number;
  private readonly height: number;
  private readonly opening: { tx: number; ty: number };
  private depthInfo: RoomDepthGeometry;
  private progress = 0;

  constructor(readonly item: RoomItem, frame: IndoorArtFrame, texture: Texture, geometry?: DoorArtGeometry) {
    this.width = frame.width;
    this.height = frame.height;
    this.opening = doorOpeningTile(item);
    const sourceRotation = geometry?.sourceRotation ?? 0;
    const mirror = item.rotation % 2 !== sourceRotation;
    const sourceHingeX = geometry?.hinge.x ?? (sourceRotation === 0 ? frame.width : 0);
    this.baseSlope = geometry?.baseSlope ?? (sourceRotation === 0 ? -0.5 : 0.5);
    const hingeSide = mirror ? (sourceHingeX >= frame.width / 2 ? 'left' : 'right')
      : (sourceHingeX >= frame.width / 2 ? 'right' : 'left');
    this.hingeX = item.doorHingeRatio !== undefined
      ? frame.width * Math.max(0, Math.min(1, item.doorHingeRatio))
      : item.doorHinge && item.doorHinge !== hingeSide ? frame.width - sourceHingeX : sourceHingeX;
    this.hingeY = (geometry?.hinge.y ?? -frame.top) + (this.hingeX - sourceHingeX) * this.baseSlope;

    const vertices = this.verticesFor(0);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    this.front = new MeshSimple({
      texture,
      vertices: vertices.slice(),
      uvs,
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.back = new MeshSimple({
      texture,
      vertices: vertices.slice(),
      uvs: uvs.slice(),
      indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
    });
    this.back.tint = 0xb9b4a8;
    this.back.visible = false;
    this.front.autoUpdate = false;
    this.back.autoUpdate = false;
    this.view.addChild(this.front, this.back);

    this.view.label = `item:${item.name}:${item.tx},${item.ty}`;
    this.view.scale.x = mirror ? -1 : 1;
    this.view.position.set(tileToScreenX(item.tx, item.ty) + this.view.scale.x * frame.left,
      tileToScreenY(item.tx, item.ty) + frame.top);
    this.depthInfo = this.depthGeometry();
    this.view.zIndex = this.depthInfo.depth;
    setRoomDepth(this.view, () => this.depthInfo);
  }

  get openness(): number { return this.progress; }

  destroy(): void { if (!this.view.destroyed) this.view.destroy({ children: true }); }

  /** Atualiza a malha apenas enquanto a folha se move. */
  update(deltaMs: number, actors: readonly Actor[]): void {
    const target = actors.some((actor) => this.atDoorTile(actor.tileX, actor.tileY)) ? 1 : 0;
    const duration = target ? OPEN_DURATION_MS : CLOSE_DURATION_MS;
    const next = Math.max(0, Math.min(1, this.progress + Math.sign(target - this.progress) * Math.max(0, deltaMs) / duration));
    if (next === this.progress) return;
    this.progress = next;
    const eased = next * next * (3 - 2 * next);
    this.depthInfo = this.depthGeometry();
    this.view.zIndex = this.depthInfo.depth;
    const vertices = this.verticesFor(eased);
    // Quando a folha passa de perfil, a face visível muda. Os mesmos UVs
    // aparecem naturalmente espelhados no verso; o tint simula a sombra.
    const backVisible = Math.cos(eased * OPEN_ANGLE) - Math.sin(eased * OPEN_ANGLE) < 0;
    const mesh = backVisible ? this.back : this.front;
    mesh.vertices.set(vertices);
    mesh.geometry.getBuffer('aPosition').update();
    this.front.visible = !backVisible;
    this.back.visible = backVisible;
  }

  private atDoorTile(tx: number, ty: number): boolean {
    return (tx === this.item.tx && ty === this.item.ty)
      || (tx === this.opening.tx && ty === this.opening.ty);
  }

  private verticesFor(open: number): Float32Array {
    return doorLeafVertices(this.width, this.height, this.hingeX, this.baseSlope, open);
  }

  /** The animated face supplies geometry to the same sorter as any wall or
   * furniture part. Texture margins and vertical height do not alter its base.
   */
  private depthGeometry(): RoomDepthGeometry {
    const eased = this.progress * this.progress * (3 - 2 * this.progress);
    const vertices = this.verticesFor(eased);
    const points = [0, this.width].map((originalX, index) => screenToGround({
      x: this.view.x + this.view.scale.x * vertices[index * 2],
      y: this.view.y + this.hingeY + (originalX - this.hingeX) * this.baseSlope + vertices[index * 2 + 1],
    }));
    const plane = { a: points[0], b: points[1] };
    return { points, plane, depth: screenDepth(groundPlaneFootY(plane), DEPTH_BIAS_WALL_DECOR),
      ...groundScreenRange(points) };
  }
}
