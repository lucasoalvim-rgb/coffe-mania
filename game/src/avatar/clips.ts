/** Clipes como intervalos de uma trilha Collada de 146 keyframes, espaçados em 100 ms. O intervalo de reprodução é independente: 160 ms parado e 140 ms andando. */

export const ANIMATION_FPS = 10;
export const ANIMATION_SPF = 1 / ANIMATION_FPS;
export const DEFAULT_FRAME_DELAY = 80;

/** Índices do Avatar3D, na ordem das constantes ANIMATION_*. */
export const CLIP = {
  IDLE: 0,
  WALK: 1,
  SIT: 2,
  EAT: 3,
  WAITOR_WALK: 4,
  COOKING: 5,
  EDITOR_IDLE: 6,
  EDITOR_OUTFIT_CHANGE: 7,
  EDITOR_HEAD_CHANGE: 8,
  EDITOR_PANTS_CHANGE: 9,
  DEAD: 10,
  HIRE_TRASHCAN: 11,
  HIRE_BUS: 12,
  HIRE_BENCE: 13,
  WAITOR_WORKING: 14,
  STREET_WALK: 15,
  STREET_IDLE: 16,
  CLEAN: 17,
  CLEANER_WALK: 18,
  CLEANER_IDLE: 19,
  CLEANER_DEAD: 20,
  CLEANER_REPAIR: 21,
} as const;

export type ClipIndex = (typeof CLIP)[keyof typeof CLIP];

export const CLIP_NAMES: readonly string[] = Object.keys(CLIP);

/** ANIMATION_FRAME_RANGE, já em pares [primeiro, último]. */
export const CLIP_FRAME_RANGE: readonly [number, number][] = [
  [20, 23],
  [0, 3],
  [35, 35],
  [36, 39],
  [10, 13],
  [30, 33],
  [45, 68],
  [72, 90],
  [92, 101],
  [103, 129],
  [133, 133],
  [132, 132],
  [131, 131],
  [130, 130],
  [30, 33],
  [0, 3],
  [20, 23],
  [136, 140],
  [10, 13],
  [20, 23],
  [133, 133],
  [141, 144],
];

/** ANIMATION_FRAME_DELAY_MULTIPLIER. */
export const CLIP_DELAY_MULTIPLIER: readonly number[] = [
  2, 1.75, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 2, 2, 1, 1,
];

/** ANIMATION_SHOW_OBJECTS: props que o clipe acende na malha. */
export const CLIP_SHOW_OBJECTS: readonly (readonly string[])[] = [
  [],
  [],
  [],
  [],
  ['tray'],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  ['bucket', 'brush'],
  ['bucket', 'brush'],
  ['bucket', 'brush'],
  ['bucket', 'brush'],
  ['repair'],
];

export const DIRECTIONS_ALL: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7];
export const DIRECTIONS_DIAGONAL: readonly number[] = [1, 3, 5, 7];

/**
 * ANIMATION_CACHE_DIRECTIONS: quais direções cada clipe precisa.
 * Sentar, comer e cozinhar só existem nas diagonais; andar na rua só em dois
 * sentidos.
 */
export const CLIP_DIRECTIONS: readonly (readonly number[])[] = [
  DIRECTIONS_ALL,
  DIRECTIONS_ALL,
  DIRECTIONS_DIAGONAL,
  DIRECTIONS_DIAGONAL,
  DIRECTIONS_ALL,
  DIRECTIONS_DIAGONAL,
  DIRECTIONS_ALL,
  DIRECTIONS_ALL,
  DIRECTIONS_ALL,
  DIRECTIONS_ALL,
  DIRECTIONS_ALL,
  DIRECTIONS_ALL,
  DIRECTIONS_ALL,
  DIRECTIONS_ALL,
  DIRECTIONS_ALL,
  [2, 6],
  [0, 4],
  DIRECTIONS_ALL,
  DIRECTIONS_ALL,
  DIRECTIONS_ALL,
  DIRECTIONS_ALL,
  DIRECTIONS_ALL,
];

export const CLIP_COUNT = CLIP_FRAME_RANGE.length;

/** Passos de 45 graus: 8 direções. */
export const CACHE_DIRECTIONS = 8;
export const ANGLE_PER_DIRECTION = 360 / CACHE_DIRECTIONS;

/** Keyframes do clipe, na ordem de reprodução. */
export function clipFrames(clip: number): number[] {
  const range = CLIP_FRAME_RANGE[clip];
  if (!range) return [];
  const frames: number[] = [];
  for (let frame = range[0]; frame <= range[1]; frame++) frames.push(frame);
  return frames;
}

/** Milissegundos por frame do clipe. */
export function clipFrameDelayMs(clip: number): number {
  return DEFAULT_FRAME_DELAY * (CLIP_DELAY_MULTIPLIER[clip] ?? 1);
}

/** Tempo, em segundos, do keyframe na trilha única do Collada. */
export const frameTimeSeconds = (frame: number): number => frame * ANIMATION_SPF;

export interface ResolvedDirection {
  /** Direção que precisa existir assada (0..4). */
  source: number;
  /** `true` quando o desenho sai espelhado em x. */
  mirrored: boolean;
}

/** Resolve as direções 5..7 por espelhamento de 8 - direction; apenas 0..4 precisam ser renderizadas. */

export function resolveDirection(direction: number): ResolvedDirection {
  const dir = ((direction % CACHE_DIRECTIONS) + CACHE_DIRECTIONS) % CACHE_DIRECTIONS;
  return dir >= 5 ? { source: 8 - dir, mirrored: true } : { source: dir, mirrored: false };
}

/** Direções que precisam ser assadas para um clipe (sem as espelhadas). */
export function bakedDirections(clip: number): number[] {
  const pedidas = CLIP_DIRECTIONS[clip] ?? DIRECTIONS_ALL;
  const fontes = new Set(pedidas.map((direction) => resolveDirection(direction).source));
  return [...fontes].sort((a, b) => a - b);
}
