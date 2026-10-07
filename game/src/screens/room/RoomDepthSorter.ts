import type { Container } from 'pixi.js';
import type { Actor } from '../../world/Actor';
import type { RoomItem } from '../../world/RoomModel';
import { groundScreenRange, orderRoomDepth, type GroundPlane, type RoomDepthGeometry } from '../../world/RoomDepth';
import { DEPTH_BIAS_ITEM, DEPTH_BIAS_WALL_DECOR, TILE_WIDTH_HALF, itemDepth, wallDepth } from '../../world/iso';

type DepthProvider = () => RoomDepthGeometry;
const providers = new WeakMap<Container, { id: number; read: DepthProvider }>();
const actorIds = new WeakMap<Actor, number>();
let nextId = 0;

export function setRoomDepth(view: Container, geometry: RoomDepthGeometry | DepthProvider, stableId?: number): void {
  const previous = providers.get(view);
  providers.set(view, { id: stableId ?? previous?.id ?? nextId++, read: typeof geometry === 'function' ? geometry : () => geometry });
}

/** Wrappers (including store ghosts) share their child's geometry and layers. */
export function inheritRoomDepth(view: Container, child: Container): void {
  const provider = providers.get(child);
  if (provider) setRoomDepth(view, provider.read); else providers.delete(view);
}

export function clearRoomDepth(view: Container): void { providers.delete(view); }

export function setActorRoomDepth(view: Container, actor: Actor): void {
  let stableId = actorIds.get(actor);
  if (stableId === undefined) { stableId = nextId++; actorIds.set(actor, stableId); }
  let previousX = NaN, previousY = NaN;
  let geometry: RoomDepthGeometry;
  setRoomDepth(view, () => {
    if (actor.tileX !== previousX || actor.tileY !== previousY) {
      previousX = actor.tileX; previousY = actor.tileY;
      const point = { x: actor.tileX + .5, y: actor.tileY + .5 };
      geometry = { points: [point], depth: actor.drawPriority, ...groundScreenRange([point], TILE_WIDTH_HALF) };
    }
    return geometry;
  }, stableId);
}

/** The ground edge is the same one used to draw wallGeometry(). */
export function itemGroundPlane(item: RoomItem): GroundPlane {
  return item.rotation % 2 === 0
    ? { a: { x: item.tx + 1, y: item.ty }, b: { x: item.tx + 1, y: item.ty + (item.sizeY ?? 1) } }
    : { a: { x: item.tx, y: item.ty + 1 }, b: { x: item.tx + (item.sizeX ?? 1), y: item.ty + 1 } };
}

export function setItemRoomDepth(view: Container, item: RoomItem, depth = itemDepth(
  item.tx + (item.sizeX ?? 1) - 1, item.ty + (item.sizeY ?? 1) - 1,
)): void {
  const mounted = item.kind === 'wall' || item.kind === 'window' || item.kind === 'panel';
  const plane = mounted ? itemGroundPlane(item) : undefined;
  const points = plane ? [plane.a, plane.b] : [
    { x: item.tx, y: item.ty }, { x: item.tx + (item.sizeX ?? 1), y: item.ty },
    { x: item.tx + (item.sizeX ?? 1), y: item.ty + (item.sizeY ?? 1) },
    { x: item.tx, y: item.ty + (item.sizeY ?? 1) },
  ];
  setRoomDepth(view, { points, plane, depth, ...groundScreenRange(points, mounted ? 14 : 0) });
}

/** Dishes belong to the supporting item's visual layer. Height only positions
 * the PNG; it does not promote the food over actors/objects in front of it.
 */
export function setItemOverlayDepth(view: Container, item: RoomItem, relativeDepth = 1): void {
  const mounted = item.kind === 'wall' || item.kind === 'window' || item.kind === 'panel';
  const depth = mounted ? wallDepth(item.tx, item.ty, DEPTH_BIAS_WALL_DECOR) : itemDepth(
    item.tx + (item.sizeX ?? 1) - 1, item.ty + (item.sizeY ?? 1) - 1, DEPTH_BIAS_ITEM, item.occlusionAnchor,
  );
  setItemRoomDepth(view, item, depth + relativeDepth);
}

export class RoomDepthSorter {
  private previous: Array<{ view: Container; signature: string }> = [];
  private ordered: Container[] = [];

  sync(world: Container): void {
    const entries: Array<{ view: Container; id: number; geometry: RoomDepthGeometry; signature: string }> = [];
    for (const view of world.children) {
      const provider = providers.get(view);
      if (!provider || view.destroyed || !view.visible || !view.renderable || view.alpha <= 0) continue;
      const geometry = provider.read();
      const signature = [geometry.depth, geometry.minScreenX, geometry.maxScreenX,
        ...geometry.points.flatMap(point => [point.x, point.y]),
        ...(geometry.plane ? [geometry.plane.a.x, geometry.plane.a.y, geometry.plane.b.x, geometry.plane.b.y] : [])].join(',');
      entries.push({ view, id: provider.id, geometry, signature });
    }
    // Pixi may have reordered children last frame. Comparing stable identities
    // avoids invalidating the cache because of our own output order.
    entries.sort((a, b) => a.id - b.id);
    const changed = entries.length !== this.previous.length || entries.some((entry, index) =>
      entry.view !== this.previous[index].view || entry.signature !== this.previous[index].signature);
    if (changed) {
      this.ordered = orderRoomDepth(entries.map(entry => entry.geometry), entries.map(entry => entry.id)).map(index => entries[index].view);
      this.previous = entries.map(({ view, signature }) => ({ view, signature }));
    }
    // Renderers reset their nominal zIndex in sync(). Reapply the cached order
    // once, after all actors and moving faces have updated in this frame.
    for (let rank = 0; rank < this.ordered.length; rank++) this.ordered[rank].zIndex = rank;
  }
}
