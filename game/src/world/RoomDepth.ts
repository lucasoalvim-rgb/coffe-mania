import { TILE_WIDTH_HALF, tileToScreenX, tileToScreenY, type Point } from './iso';

/** Ground coordinates, before isometric projection; y is not a screen pixel. */
export interface GroundPoint { x: number; y: number }
export interface GroundPlane { a: GroundPoint; b: GroundPoint }
export interface RoomDepthGeometry {
  points: readonly GroundPoint[];
  /** A vertical face, represented by its intersection with the ground. */
  plane?: GroundPlane;
  /** Shared projected depth plus an intrinsic visual-layer offset. */
  depth: number;
  minScreenX: number;
  maxScreenX: number;
}

const EPSILON = 1e-6;

export function screenToGround(point: Point): GroundPoint {
  return { x: (point.x + 2 * point.y) / (2 * TILE_WIDTH_HALF),
    y: (2 * point.y - point.x) / (2 * TILE_WIDTH_HALF) };
}

export function groundScreenRange(points: readonly GroundPoint[], padding = 0): { minScreenX: number; maxScreenX: number } {
  const xs = points.map(point => tileToScreenX(point.x, point.y));
  return { minScreenX: Math.min(...xs) - padding, maxScreenX: Math.max(...xs) + padding };
}

/** Depth of a face comes from its ground geometry, never from the PNG height. */
export function groundPlaneFootY(plane: GroundPlane): number {
  return tileToScreenY((plane.a.x + plane.b.x) / 2, (plane.a.y + plane.b.y) / 2);
}

/** +1 means all of the object is on the camera side of the plane. */
function planeSide(plane: GroundPlane, points: readonly GroundPoint[]): -1 | 0 | 1 {
  const dx = plane.b.x - plane.a.x, dy = plane.b.y - plane.a.y;
  // Camera rays on the ground run along (1, 1). A face seen edge-on cannot
  // occlude another object and must not introduce an unstable depth division.
  const denominator = dx - dy;
  if (Math.abs(denominator) < EPSILON) return 0;
  let min = Infinity, max = -Infinity;
  for (const point of points) {
    const side = (dx * (point.y - plane.a.y) - dy * (point.x - plane.a.x)) / denominator;
    min = Math.min(min, side); max = Math.max(max, side);
  }
  if (min >= -EPSILON && max > EPSILON) return 1;
  if (max <= EPSILON && min < -EPSILON) return -1;
  return 0;
}

/** Parts drawn on the same physical face, or layers sharing one ground
 * support, have an intrinsic order. Another object's animation cannot swap
 * a joined wall segment or a seated occupant with its own chair.
 */
function shareLayerReference(a: RoomDepthGeometry, b: RoomDepthGeometry): boolean {
  if (a.plane && b.plane) {
    const dx = a.plane.b.x - a.plane.a.x, dy = a.plane.b.y - a.plane.a.y;
    const length = Math.hypot(dx, dy);
    if (length < EPSILON) return false;
    return b.points.every(point => Math.abs(
      dx * (point.y - a.plane!.a.y) - dy * (point.x - a.plane!.a.x),
    ) / length < EPSILON);
  }
  if (a.plane || b.plane) return false;
  const center = (points: readonly GroundPoint[]): GroundPoint => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  };
  const ac = center(a.points), bc = center(b.points);
  return Math.abs(ac.x - bc.x) < EPSILON && Math.abs(ac.y - bc.y) < EPSILON;
}

/** -1: a behind b; +1: a in front; 0: no geometric constraint. */
export function roomDepthRelation(a: RoomDepthGeometry, b: RoomDepthGeometry): -1 | 0 | 1 {
  // Compare only sprites whose projected horizontal ranges can intersect.
  if (a.maxScreenX < b.minScreenX || b.maxScreenX < a.minScreenX) return 0;
  if (shareLayerReference(a, b)) return Math.sign(a.depth - b.depth) as -1 | 0 | 1;
  const bSide = a.plane ? planeSide(a.plane, b.points) : 0;
  const aSide = b.plane ? planeSide(b.plane, a.points) : 0;
  if (bSide || aSide) {
    // Perpendicular faces that meet at a corner can disagree. Their intrinsic
    // layer depths resolve that junction; neither face gets an arbitrary boost.
    if (bSide && aSide && bSide === aSide) return 0;
    return bSide ? (bSide === 1 ? -1 : 1) : aSide;
  }
  // A face intersected by a footprint needs its own parts to establish an
  // order. A scalar fallback is preferable to pretending the box is a wall.
  if (a.plane || b.plane) return 0;
  const ax = a.points.map(p => p.x), ay = a.points.map(p => p.y);
  const bx = b.points.map(p => p.x), by = b.points.map(p => p.y);
  const aBehind = Math.max(...ax) <= Math.min(...bx) + EPSILON || Math.max(...ay) <= Math.min(...by) + EPSILON;
  const bBehind = Math.max(...bx) <= Math.min(...ax) + EPSILON || Math.max(...by) <= Math.min(...ay) + EPSILON;
  // Opposite separations on X and Y do not establish an occlusion order.
  return aBehind === bBehind ? 0 : aBehind ? -1 : 1;
}

/** Stable topological ordering: geometric constraints take precedence over a
 * single screen-Y key, while unconstrained sprites retain their normal depth.
 * The caller caches this result until a ground position/face actually changes.
 */
export function orderRoomDepth(geometries: readonly RoomDepthGeometry[], stableIds: readonly number[]): number[] {
  const edges = geometries.map(() => [] as number[]);
  const incoming = geometries.map(() => 0);
  const candidates: Array<{ before: number; after: number; priority: number; overlap: number }> = [];
  const byScreenX = geometries.map((_, index) => index).sort((a, b) => geometries[a].minScreenX - geometries[b].minScreenX);
  for (let first = 0; first < byScreenX.length; first++) for (let second = first + 1; second < byScreenX.length; second++) {
    const a = byScreenX[first], b = byScreenX[second];
    if (geometries[b].minScreenX > geometries[a].maxScreenX) break;
    const intrinsic = shareLayerReference(geometries[a], geometries[b]);
    const relation = intrinsic
      ? Math.sign(geometries[a].depth - geometries[b].depth || stableIds[a] - stableIds[b])
      : roomDepthRelation(geometries[a], geometries[b]);
    if (!relation) continue;
    const before = relation < 0 ? a : b, after = relation < 0 ? b : a;
    candidates.push({ before, after,
      priority: intrinsic ? 0 : geometries[a].plane && geometries[b].plane ? 1 : 2,
      overlap: Math.min(geometries[a].maxScreenX, geometries[b].maxScreenX)
        - Math.max(geometries[a].minScreenX, geometries[b].minScreenX) });
  }
  // Establish intrinsic layers, then the relationships between physical faces.
  // A moving billboard's padded horizontal range can touch the extension of a
  // face without crossing it. Such a constraint must not reverse the order of
  // that face against its neighbours. Within each priority prefer the larger
  // overlap, and reject cycles before the topological walk.
  candidates.sort((a, b) => a.priority - b.priority || b.overlap - a.overlap
    || stableIds[a.before] - stableIds[b.before] || stableIds[a.after] - stableIds[b.after]);
  const visited = new Uint32Array(geometries.length);
  let visitId = 0;
  const reaches = (start: number, target: number): boolean => {
    const stack = [start]; visitId++;
    while (stack.length) {
      const current = stack.pop()!;
      if (current === target) return true;
      if (visited[current] === visitId) continue;
      visited[current] = visitId;
      for (const next of edges[current]) stack.push(next);
    }
    return false;
  };
  for (const { before, after } of candidates) {
    if (reaches(after, before)) continue;
    edges[before].push(after); incoming[after]++;
  }
  const fallback = geometries.map((_, index) => index).sort((a, b) =>
    geometries[a].depth - geometries[b].depth || stableIds[a] - stableIds[b]);
  const remaining = new Set(fallback), ordered: number[] = [];
  while (remaining.size) {
    // The accepted graph is acyclic; equal depths keep the same object identity.
    const next = fallback.find(index => remaining.has(index) && incoming[index] === 0)
      ?? fallback.find(index => remaining.has(index))!;
    remaining.delete(next); ordered.push(next);
    for (const after of edges[next]) incoming[after]--;
  }
  return ordered;
}
