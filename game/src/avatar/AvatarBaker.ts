import { CLIP, CLIP_SHOW_OBJECTS, bakedDirections, clipFrames, resolveDirection } from './clips';
import type { AvatarRenderer } from './AvatarRenderer';

/** sids de Bip01_R_Hand e Bip01_L_Hand no Collada. */
const RIGHT_HAND_BONE = 'Bone10';
const LEFT_HAND_BONE = 'Bone13';

/** Renderiza o avatar 3D em atlas 2D. Clipes simétricos espelham 5..7;
 * o transporte preserva as oito vistas para manter a mão direita.
 */

export interface BakedCell {
  clip: number;
  direction: number;
  frame: number;
  /** Posição no atlas, em pixels. */
  x: number;
  y: number;
  /** Apoio da mão direita neste quadro, em pixels da célula. */
  carryingHand?: { x: number; y: number };
  /** Mão oposta usada quando um clipe simétrico, como colocar, é espelhado. */
  carryingLeftHand?: { x: number; y: number };
}

/** Sprite data can come from a saved atlas, without a renderer or canvas. */
export interface AvatarAtlas {
  /** Lado de cada quadro. */
  cell: number;
  /** Apoio no chão dentro do quadro, em pixels. */
  ground: { x: number; y: number };
  cells: BakedCell[];
  /** `clip:direction:frame` -> célula. */
  index: Map<string, BakedCell>;
  /** Escala no mundo para casar com a escala do quarto (2x) preservando o tamanho do corpo. */
  scale?: number;
}

export interface BakedAvatar extends AvatarAtlas {
  canvas: HTMLCanvasElement;
}

export const cellKey = (clip: number, direction: number, frame: number): string =>
  `${clip}:${direction}:${frame}`;

export interface BakeOptions {
  /** Clipes a assar. O resto pode ser assado depois, sob demanda. */
  clips: readonly number[];
  cell?: number;
  createCanvas?: () => HTMLCanvasElement;
  /** Colunas do atlas. */
  columns?: number;
}

export function bakeAvatar(renderer: AvatarRenderer, options: BakeOptions): BakedAvatar {
  const steps = bakeAvatarSteps(renderer, options);
  let result = steps.next();
  while (!result.done) result = steps.next();
  if (!result.value) throw new Error('Bake incompleto.');
  return result.value;
}

export interface IncrementalBakeOptions extends BakeOptions {
  signal?: AbortSignal;
  framesPerBatch?: number;
  yieldFrame?: () => Promise<void>;
}

/** Share the synchronous baker's geometry/indexing, yielding between small GPU batches. */
export async function bakeAvatarIncrementally(renderer: AvatarRenderer, options: IncrementalBakeOptions): Promise<BakedAvatar> {
  const steps = bakeAvatarSteps(renderer, options);
  const batch = Math.max(1, Math.floor(options.framesPerBatch ?? 2));
  const yieldFrame = options.yieldFrame ?? (() => waitForBakeFrame(options.signal));
  try {
    while (true) {
      options.signal?.throwIfAborted();
      await yieldFrame();
      options.signal?.throwIfAborted();
      const start = performance.now();
      for (let i = 0; i < batch; i++) {
        const result = steps.next();
        if (result.done) {
          if (!result.value) throw new Error('Bake incompleto.');
          return result.value;
        }
        if (performance.now() - start >= 4) break;
      }
    }
  } finally { steps.return(undefined); }
}

function waitForBakeFrame(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      cancelAnimationFrame(handle);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason);
    };
    const handle = requestAnimationFrame(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    });
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function* bakeAvatarSteps(renderer: AvatarRenderer, options: BakeOptions): Generator<void, BakedAvatar | undefined> {
  const cell = options.cell ?? 128;
  const make = options.createCanvas ?? (() => document.createElement('canvas'));

  const pedidos: { clip: number; direction: number; frame: number }[] = [];
  for (const clip of options.clips) {
    for (const direction of bakedDirections(clip)) {
      for (const frame of clipFrames(clip)) pedidos.push({ clip, direction, frame });
    }
  }

  const columns = options.columns ?? Math.min(pedidos.length, 16);
  const rows = Math.max(1, Math.ceil(pedidos.length / columns));

  const canvas = make();
  canvas.width = columns * cell;
  canvas.height = rows * cell;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('sem contexto 2d para assar o avatar');
  context.clearRect(0, 0, canvas.width, canvas.height);

  const cells: BakedCell[] = [];
  const index = new Map<string, BakedCell>();

  let complete = false;
  try {
    for (const [i, pedido] of pedidos.entries()) {
      const x = (i % columns) * cell;
      const y = Math.floor(i / columns) * cell;

      renderer.setPropsVisible(CLIP_SHOW_OBJECTS[pedido.clip] ?? []);
      renderer.setDirection(pedido.direction);
      renderer.setFrame(pedido.frame);
      renderer.render();

      context.drawImage(renderer.canvas, 0, 0, renderer.canvas.width, renderer.canvas.height, x, y, cell, cell);

      const celula: BakedCell = { ...pedido, x, y };
      if (pedido.clip === CLIP.WAITOR_WALK || pedido.clip === CLIP.COOKING) {
        const hands = renderer.projectBones([RIGHT_HAND_BONE, LEFT_HAND_BONE], pedido.frame);
        const hand = hands[RIGHT_HAND_BONE];
        if (hand) celula.carryingHand = { x: (hand[0] + 1) * cell / 2, y: (1 - hand[1]) * cell / 2 };
        const leftHand = hands[LEFT_HAND_BONE];
        if (leftHand) celula.carryingLeftHand = { x: (leftHand[0] + 1) * cell / 2, y: (1 - leftHand[1]) * cell / 2 };
      }
      cells.push(celula);
      index.set(cellKey(pedido.clip, pedido.direction, pedido.frame), celula);
      yield;
    }

    // O apoio é medido no mesmo quadro em que tudo é assado, e vale para todas as
    // células: a escala da câmera é fixa por construção.
    const apoio = renderer.measureGround(pedidos[0]?.frame ?? 0);
    const escala = cell / renderer.canvas.width;

    // Preserva o tamanho físico do corpo do personagem no mundo (166.5 px de altura),
    // adaptando-se tanto à resolução do bake (cell) quanto ao enquadramento (half).
    const half = renderer.frame?.half ?? 129.32;
    const targetRatio = 1.244818; 
    const scale = Number(((targetRatio * (2 * half)) / cell).toFixed(4));

    const baked: BakedAvatar = {
      canvas,
      cell,
      ground: { x: apoio.x * escala, y: apoio.y * escala },
      cells,
      index,
      scale,
    };
    complete = true;
    return baked;
  } finally {
    if (!complete) { canvas.width = 0; canvas.height = 0; }
  }
}

export interface FrameLookup {
  cell: BakedCell;
  mirrored: boolean;
}

/**
 * Prefere uma vista própria; usa espelhamento de 5..7 nos clipes simétricos.
 */
export function lookupFrame(
  baked: AvatarAtlas,
  clip: number,
  direction: number,
  frame: number,
): FrameLookup | undefined {
  const direct = baked.index.get(cellKey(clip, direction, frame));
  if (direct) return { cell: direct, mirrored: false };
  const { source, mirrored } = resolveDirection(direction);
  const cell = baked.index.get(cellKey(clip, source, frame));
  return cell ? { cell, mirrored } : undefined;
}
