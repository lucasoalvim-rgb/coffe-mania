/** Projeção isométrica 2:1 com tiles de 160×80 px. screenX = (tx - ty) × 80; screenY = (tx + ty) × 40. */

export const SOURCE_TILE_WIDTH = 80;
export const ROOM_ASSET_SCALE = 2;
export const TILE_WIDTH = SOURCE_TILE_WIDTH * ROOM_ASSET_SCALE;
export const TILE_HEIGHT = TILE_WIDTH / 2;
export const TILE_WIDTH_HALF = TILE_WIDTH / 2;
export const TILE_HEIGHT_HALF = TILE_HEIGHT / 2;

/** Dimensões máximas da grade usadas no cálculo de índices. */
export const MAX_NUM_TILES_X = 20;
export const MAX_NUM_TILES_Y = 40;

export interface Point {
  x: number;
  y: number;
}

export interface Tile {
  tx: number;
  ty: number;
}

export const tileToScreenX = (tx: number, ty: number): number => (tx - ty) * TILE_WIDTH_HALF;
export const tileToScreenY = (tx: number, ty: number): number => (tx + ty) * TILE_HEIGHT_HALF;

export const tileToScreen = (tx: number, ty: number): Point => ({
  x: tileToScreenX(tx, ty),
  y: tileToScreenY(tx, ty),
});

/**
 * Viés minúsculo para resolver o empate exatamente sobre a divisa de dois tiles.
 *
 * Pontos sobre a aresta podem produzir um índice abaixo do correto por erro
 * de ponto flutuante (~1e-13). O viés estabiliza cliques e destinos; o ator
 * em movimento usa um tile lógico independente, definido pelo tempo do passo.
 */
const TILE_EDGE_BIAS = 1e-6;

/** Inverso da projeção com Math.floor, incluindo coordenadas negativas fora da sala. */

export function screenToTile(x: number, y: number): Tile {
  return {
    tx: Math.floor((x + 2 * y + TILE_EDGE_BIAS) / TILE_WIDTH),
    ty: Math.floor((2 * y - x + TILE_EDGE_BIAS) / (2 * TILE_HEIGHT)),
  };
}

/** Nitro's visual depth follows the nearest interpolated world coordinate.
 * At an exact half tile, MovingObjectLogic nudges time toward the destination;
 * resolve that tie here without displacing the rendered sprite by a pixel.
 * This is separate from screenToTile(), which locates the tile under a click.
 */
export function screenToMovementTile(x: number, y: number, speedX: number, speedY: number): Tile {
  const nearest = (value: number, direction: number): number => {
    const lower = Math.floor(value);
    if (Math.abs(value - lower - .5) <= 1e-9) return direction < 0 ? lower : lower + 1;
    return Math.round(value) || 0;
  };
  return {
    tx: nearest((x + 2 * y) / TILE_WIDTH, speedX + 2 * speedY),
    ty: nearest((2 * y - x) / (2 * TILE_HEIGHT), 2 * speedY - speedX),
  };
}

export const tileIndex = (tx: number, ty: number): number => ty * MAX_NUM_TILES_X + tx;
export const tileXFromIndex = (index: number): number => index % MAX_NUM_TILES_X;
export const tileYFromIndex = (index: number): number => Math.floor(index / MAX_NUM_TILES_X);

/**
 * Ponto de apoio no chão de um tile: o centro do losango.
 * `tileToScreen` devolve o canto de cima, que não serve como referência de
 * profundidade porque o ator e o móvel são desenhados no meio do tile.
 */
export const tileFootY = (tx: number, ty: number): number => tileToScreenY(tx, ty) + TILE_HEIGHT_HALF;

/**
 * Chave de profundidade do painter's algorithm.
 *
 * Como `screenY = (tx + ty) * tileHeightHalf`, o ponto de apoio fornece a
 * profundidade nominal. Todos os atores usam o centro do tile lógico, que
 * troca na metade do passo; a imagem continua interpolada. O RoomDepthSorter
 * resolve as relações com faces e volumes antes de atribuir o zIndex final.
 *
 * A escala existe para o `zIndex` continuar inteiro com resolução de subpixel; os
 * dois vieses fazem o desempate quando o apoio é exatamente o mesmo.
 */
export const DEPTH_SCALE = 64;

/**
 * Dados intrínsecos de sobreposição: o móvel fica atrás do ator no mesmo tile;
 * a parede, seu revestimento e a decoração mantêm sua ordem na faixa externa.
 * Um passo para qualquer eixo positivo vale 40 px de profundidade e sempre
 * supera o desempate.
 */
export const DEPTH_BIAS_ITEM = 4;
export const DEPTH_BIAS_ACTOR = 5;
export const DEPTH_BIAS_WALL = 6;
export const DEPTH_BIAS_WALLPAPER = 7;
export const DEPTH_BIAS_WALL_DECOR = 8;

/** Âncora intrínseca opcional; a altura da imagem não escolhe a profundidade. */
export type OcclusionAnchor = 'center' | 'front-edge';
// Menor que um pixel visual, mas maior que todos os vieses de desempate / DEPTH_SCALE.
const FRONT_EDGE_EPSILON = 0.125;

export const screenDepth = (footY: number, bias = 0): number => Math.round(footY * DEPTH_SCALE) + bias;

/** Converte o apoio escolhido pelo ator em uma chave de profundidade. */
export const actorDepth = (footY: number): number => screenDepth(footY, DEPTH_BIAS_ACTOR);

/** Camadas que não participam da ordenação dos objetos da sala. */
export const FLOOR_DRAW_PRIORITY = -1000002;
export const SHADOW_DRAW_PRIORITY = -1000000;
export const POPUP_DRAW_PRIORITY = 1000000;

/** Cada parte de um móvel ocupa seu próprio tile e recebe profundidade independente, permitindo intercalar atores e outros volumes. */

export const itemDepth = (
  tx: number,
  ty: number,
  bias: number = DEPTH_BIAS_ITEM,
  anchor: OcclusionAnchor = 'center',
): number => screenDepth(
  anchor === 'front-edge' ? tileToScreenY(tx, ty) + TILE_HEIGHT - FRONT_EDGE_EPSILON : tileFootY(tx, ty),
  bias,
);

/**
 * Desempate nominal de parede e decoração. A comparação efetiva com atores
 * considera a face no chão, independentemente do estado interno/externo.
 */
export const wallDepth = (tx: number, ty: number, bias: number = DEPTH_BIAS_WALL): number =>
  screenDepth(tileFootY(tx, ty) - FRONT_EDGE_EPSILON, bias);

/** Limites de rolagem da câmera em pixels de tela. */
export const RESTAURANT_BOUND = { top: -550, bottom: 1200, left: -1450, right: 1100 } as const;

/** Direção pelo deslocamento projetado: 0 baixo, 1 baixo-direita, 2 direita, 3 cima-direita, 4 cima, 5 cima-esquerda, 6 esquerda, 7 baixo-esquerda. */

export function directionFromDelta(deltaX: number, deltaY: number): number {
  const sx = Math.sign(deltaX);
  const sy = Math.sign(deltaY);
  if (sx === 0 && sy === 0) return 0;

  // atan2 usa y positivo para cima nesta convenção de direções.
  let angle = Math.atan2(-sy, sx) + Math.PI / 2;
  const twoPi = Math.PI * 2;
  if (angle < 0) angle += twoPi;
  else if (angle >= twoPi) angle -= twoPi;

  return Math.round(angle / (Math.PI / 4)) % 8;
}

/** Direções dos atores correspondentes às quatro rotações de item. */
export const ITEM_ROTATION_TO_DIRECTION: readonly number[] = [1, 7, 5, 3];

/** Tile adjacente à face do item. */
export function facingTile(tx: number, ty: number, rotation: number): Tile {
  switch (rotation) {
    case 0:
      return { tx: tx + 1, ty };
    case 1:
      return { tx, ty: ty + 1 };
    case 2:
      return { tx: tx - 1, ty };
    default:
      return { tx, ty: ty - 1 };
  }
}
