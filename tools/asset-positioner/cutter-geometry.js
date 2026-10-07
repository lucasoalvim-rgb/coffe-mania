/* Geometria compartilhada entre prévia e PNG; coordenadas nativas relativas à origem do tile. */
'use strict';
(() => {
  const project = (tx, ty) => ({ x: (tx - ty) * 80, y: (tx + ty) * 40 });

  function shape({ type = 'floor', sizeX = 1, sizeY = 1, side = 'left', span = 1, height = 208, heightAboveTile = 0, thickness = 8 } = {}) {
    if (type === 'door') {
      // Thin floor-standing slab near a BACK edge, never the wall's front face.
      // Both orientations preserve the same 1x1 tile origin and native 2:1 angle.
      const inset = 2 / 80;
      const depth = Math.max(1, Math.min(40, thickness)) / 80;
      const basePoints = side === 'right'
        ? [project(0, inset), project(1, inset), project(1, inset + depth), project(0, inset + depth)]
        : [project(inset, 0), project(inset + depth, 0), project(inset + depth, 1), project(inset, 1)];
      const [back, right, front, left] = basePoints;
      const a = side === 'right' ? back : left;
      const b = side === 'right' ? right : back;
      return { sizeX: 1, sizeY: 1, basePoints,
        leafPoints: [{ x: a.x, y: a.y - height }, { x: b.x, y: b.y - height }, b, a],
        points: [{ x: back.x, y: back.y - height }, { x: right.x, y: right.y - height },
          right, front, left, { x: left.x, y: left.y - height }] };
    }
    if (type === 'wall') {
      sizeX = side === 'left' ? span : 1;
      sizeY = side === 'right' ? span : 1;
      // Faces verticais projetadas a partir das arestas dianteiras da pegada.
      const a = side === 'left' ? project(0, sizeY) : project(sizeX, 0);
      const b = project(sizeX, sizeY);
      return { sizeX, sizeY, points: [
        { x: a.x, y: a.y - height }, { x: b.x, y: b.y - height }, b, a
      ] };
    }
    if (heightAboveTile > 0) {
      const back = project(0, 0), right = project(sizeX, 0);
      const front = project(sizeX, sizeY), left = project(0, sizeY);
      // Extrude the tile upward, preserving its ground footprint and origin.
      return { sizeX, sizeY, points: [
        { x: back.x, y: back.y - heightAboveTile },
        { x: right.x, y: right.y - heightAboveTile }, right, front, left,
        { x: left.x, y: left.y - heightAboveTile },
      ] };
    }
    return { sizeX, sizeY, points: [project(0, 0), project(sizeX, 0), project(sizeX, sizeY), project(0, sizeY)] };
  }

  function bounds(points) {
    const left = Math.floor(Math.min(...points.map((p) => p.x)));
    const top = Math.floor(Math.min(...points.map((p) => p.y)));
    return { left, top, width: Math.ceil(Math.max(...points.map((p) => p.x))) - left,
      height: Math.ceil(Math.max(...points.map((p) => p.y))) - top };
  }

  function trace(context, points, offsetX = 0, offsetY = 0) {
    context.beginPath();
    points.forEach((p, index) => context[index ? 'lineTo' : 'moveTo'](p.x + offsetX, p.y + offsetY));
    context.closePath();
  }

  globalThis.AssetCutterGeometry = Object.freeze({ project, shape, bounds, trace });
})();
