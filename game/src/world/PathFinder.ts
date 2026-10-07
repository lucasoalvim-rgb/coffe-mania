import { MAX_NUM_TILES_X, MAX_NUM_TILES_Y, tileIndex, type Tile } from './iso';

/** A* em oito direções: custo 10 cardinal e 14 diagonal. A heurística Manhattan × 10 pode superestimar diagonais. Destinos ocupados são permitidos; tiles intermediários devem ser livres, e nós fechados não reabrem. */

export interface IsWalkable {
  (tx: number, ty: number): boolean;
}

export interface FindPathOptions {
  start: Tile;
  dest: Tile;
  isWalkable: IsWalkable;
  /** Para no primeiro tile vizinho do destino, sem exigir caminho até ele. */
  stopNextToDest?: boolean;
  /** Libera o corte de canto na diagonal. */
  allowCornerCut?: boolean;
  maxTilesX?: number;
  maxTilesY?: number;
  /** Trava de segurança: nós expandidos antes de desistir. */
  maxExpansions?: number;
}

const STRAIGHT_SCORE = 10;
const DIAGONAL_SCORE = 14;

const STATE_OPEN = 1;
const STATE_CLOSED = 2;

interface Node {
  tx: number;
  ty: number;
  parent: Node | null;
  g: number;
  f: number;
  state: number;
}

/** Valida a passagem cardinal ou diagonal entre tiles. */
export function isWalkableFrom(
  isWalkable: IsWalkable,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  ignoreTarget = false,
  allowCornerCut = false,
): boolean {
  if (!ignoreTarget && !isWalkable(toX, toY)) return false;
  if (!allowCornerCut && toX - fromX !== 0 && toY - fromY !== 0) {
    if (!isWalkable(toX, fromY) && !isWalkable(fromX, toY)) return false;
  }
  return true;
}

/**
 * Devolve o caminho do tile seguinte até o destino (o tile de partida fica de
 * fora, como em PathFinder.getFinalPath), ou `null` se não houver caminho.
 */
export function findPath(options: FindPathOptions): Tile[] | null {
  const {
    start,
    dest,
    isWalkable,
    stopNextToDest = false,
    allowCornerCut = false,
    maxTilesX = MAX_NUM_TILES_X,
    maxTilesY = MAX_NUM_TILES_Y,
    maxExpansions = 20_000,
  } = options;

  if (start.tx === dest.tx && start.ty === dest.ty) return [];

  const nodes = new Map<number, Node>();
  const open: Node[] = [];

  const root: Node = { tx: start.tx, ty: start.ty, parent: null, g: 0, f: 0, state: STATE_OPEN };
  open.push(root);
  nodes.set(tileIndex(start.tx, start.ty), root);

  const heuristic = (tx: number, ty: number): number =>
    (Math.abs(dest.tx - tx) + Math.abs(dest.ty - ty)) * STRAIGHT_SCORE;

  const insert = (node: Node): void => {
    for (let i = 0; i < open.length; i++) {
      if (node.f <= open[i].f) {
        open.splice(i, 0, node);
        return;
      }
    }
    open.push(node);
  };

  const canStep = (fromX: number, fromY: number, toX: number, toY: number): boolean => {
    if (toX === dest.tx && toY === dest.ty) {
      if (stopNextToDest) return true;
      // Destino: ignora a andabilidade do próprio tile, mas ainda não corta canto.
      return isWalkableFrom(isWalkable, fromX, fromY, toX, toY, true, allowCornerCut);
    }
    return isWalkableFrom(isWalkable, fromX, fromY, toX, toY, false, allowCornerCut);
  };

  let expansions = 0;
  while (open.length > 0 && expansions++ < maxExpansions) {
    const current = open[0];

    if (current.tx === dest.tx && current.ty === dest.ty) {
      const path: Tile[] = [];
      let node: Node | null = current;
      while (node && node.parent) {
        path.unshift({ tx: node.tx, ty: node.ty });
        node = node.parent;
      }
      return path;
    }

    current.state = STATE_CLOSED;
    open.splice(0, 1);

    for (let tx = current.tx - 1; tx <= current.tx + 1; tx++) {
      if (tx < 0 || tx >= maxTilesX) continue;
      for (let ty = current.ty - 1; ty <= current.ty + 1; ty++) {
        if (ty < 0 || ty >= maxTilesY) continue;
        if (tx === current.tx && ty === current.ty) continue;

        const key = tileIndex(tx, ty);
        const known = nodes.get(key);
        const straight = tx === current.tx || ty === current.ty;
        const g = current.g + (straight ? STRAIGHT_SCORE : DIAGONAL_SCORE);

        if (!known) {
          if (!canStep(current.tx, current.ty, tx, ty)) continue;
          const node: Node = { tx, ty, parent: current, g, f: g + heuristic(tx, ty), state: STATE_OPEN };
          insert(node);
          nodes.set(key, node);
        } else if (known.state === STATE_OPEN && g < known.g) {
          known.g = g;
          known.f = g + heuristic(tx, ty);
          known.parent = current;
        }
      }
    }
  }

  return null;
}
