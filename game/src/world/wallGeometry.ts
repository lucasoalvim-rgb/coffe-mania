import { TILE_HEIGHT, TILE_HEIGHT_HALF, TILE_WIDTH_HALF, type Point } from './iso';

/** Altura útil da parede; exclui o cabeçalho transparente do revestimento. */
export const WALL_HEIGHT = 208;
/** Perfil mais fino (14×7 px), sem deslocar a face interior em direção à calçada. */
export const WALL_THICKNESS = 14;
export const WALL_COLORS = { face: 0xf1f2f2, top: 0xe7e8e9, end: 0xaaacae } as const;

export interface WallGeometry {
  face: Point[];
  cap: Point[];
  end: Point[];
}

/** Origem no canto superior do tile; a base da face coincide com a aresta interior do piso. */
export function wallGeometry(rotation: number, height = WALL_HEIGHT): WallGeometry {
  const direction = rotation % 2 === 0 ? 1 : -1;
  const a = { x: direction * TILE_WIDTH_HALF, y: TILE_HEIGHT_HALF };
  const b = { x: 0, y: TILE_HEIGHT };
  const outer = (p: Point): Point => ({ x: p.x - direction * WALL_THICKNESS, y: p.y - WALL_THICKNESS / 2 });
  const top = (p: Point): Point => ({ x: p.x, y: p.y - height });
  const outerA = outer(a), outerB = outer(b);
  return {
    face: [top(a), top(b), b, a],
    cap: [top(a), top(outerA), top(outerB), top(b)],
    end: [top(b), top(outerB), outerB, b],
  };
}

/** Mantém só a verga superior de um segmento, deixando a passagem livre até o piso. */
export function wallDoorOpeningGeometry(rotation: number, height = WALL_HEIGHT, lintelRatio = 0.1): WallGeometry {
  const whole = wallGeometry(rotation, height);
  const ratio = Math.max(0, Math.min(1, lintelRatio));
  const toward = (top: Point, bottom: Point): Point => ({
    x: top.x + (bottom.x - top.x) * ratio,
    y: top.y + (bottom.y - top.y) * ratio,
  });
  const [topA, topB, bottomB, bottomA] = whole.face;
  const [, topOuterB, bottomOuterB] = whole.end;
  return {
    face: [topA, topB, toward(topB, bottomB), toward(topA, bottomA)],
    cap: whole.cap,
    end: [topB, topOuterB, toward(topOuterB, bottomOuterB), toward(topB, bottomB)],
  };
}

/** Fecha o encontro das duas paredes com a mesma espessura e altura dos segmentos. */
export function wallCornerGeometry(height = WALL_HEIGHT): { cap: Point[]; left: Point[]; right: Point[] } {
  const front = { x: 0, y: TILE_HEIGHT };
  const left = { x: -WALL_THICKNESS, y: TILE_HEIGHT - WALL_THICKNESS / 2 };
  const right = { x: WALL_THICKNESS, y: left.y };
  const back = { x: 0, y: TILE_HEIGHT - WALL_THICKNESS };
  const top = (p: Point): Point => ({ x: p.x, y: p.y - height });
  return {
    cap: [top(back), top(right), top(front), top(left)],
    left: [top(left), top(front), front, left],
    right: [top(front), top(right), right, front],
  };
}
