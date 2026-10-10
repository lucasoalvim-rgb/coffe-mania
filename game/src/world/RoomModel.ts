import { ROOM_ASSET_SCALE, tileIndex, type OcclusionAnchor } from './iso';
import { WALL_HEIGHT } from './wallGeometry';
import { doorOpeningTile } from './doorGeometry';

/** Modelo da sala, das paredes e das colocações, sem dependência de renderização. Mantém o mapa de ocupação usado pela navegação. */

export type RoomItemKind =
  | 'wall'
  | 'window'
  | 'door'
  | 'table'
  | 'chair'
  | 'stove'
  | 'counter'
  | 'bush'
  | 'panel'
  | 'letterbox'
  | 'decor';

export interface RoomItem {
  name: string;
  /** ID do item no catálogo. */
  id: number;
  /** Identificador único e persistente da instância, quando fornecido pelo servidor. */
  instanceId?: string;
  inventoryUnitId?: string;
  wallpaperUnitId?: string;
  kind: RoomItemKind;
  tx: number;
  ty: number;
  /** Rotação 0..3, na convenção ITEM_ROTATION_TO_DIRECTION. */
  rotation: number;
  /** Pegada em tiles, fornecida pela colocação ou pelo catálogo; padrão 1×1. */

  sizeX?: number;
  sizeY?: number;
  /** Bloqueio de passagem: fornecido pelo catálogo ou derivado do tipo do item. */

  blocks?: boolean;
  /** Classe da arte, quando disponível. */
  className?: string;
  /** Revestimento associado a este segmento de parede. */

  wallpaperClassName?: string;
  /** Altura vertical da face da parede procedural, em pixels nativos. */
  wallHeight?: number;
  /** Âncora visual de oclusão para itens altos; não desloca sprite nem colisão. */
  occlusionAnchor?: OcclusionAnchor;
  /** Lado da dobradiça na textura da porta; se omitido, segue a rotação. */
  doorHinge?: 'left' | 'right';
  /** Override da dobradiça no PNG, de 0 a 1; normalmente vem dos intrínsecos da arte. */
  doorHingeRatio?: number;
  /** Fração superior da parede preservada acima do vão da porta. */
  doorLintelRatio?: number;
}

/** Tiles cobertos pela pegada de um móvel. */
export function footprintTiles(item: RoomItem): { tx: number; ty: number }[] {
  const tiles: { tx: number; ty: number }[] = [];
  for (let dy = 0; dy < (item.kind === 'door' ? 1 : item.sizeY ?? 1); dy++) {
    for (let dx = 0; dx < (item.kind === 'door' ? 1 : item.sizeX ?? 1); dx++) {
      tiles.push({ tx: item.tx + dx, ty: item.ty + dy });
    }
  }
  return tiles;
}

export interface RoomItemStyle {
  /** Altura do volume em px de tela. */
  height: number;
  topColor: number;
  leftColor: number;
  rightColor: number;
  blocks: boolean;
  /** Fração da largura do tile ocupada pelo volume. */
  inset: number;
}

export const ITEM_STYLES: Record<RoomItemKind, RoomItemStyle> = {
  wall: { height: WALL_HEIGHT, topColor: 0xe7e8e9, leftColor: 0xaaacae, rightColor: 0xf1f2f2, blocks: true, inset: 0.98 },
  window: { height: 150 * ROOM_ASSET_SCALE, topColor: 0xa8d8e8, leftColor: 0x86bcd0, rightColor: 0x6fa4b8, blocks: true, inset: 0.98 },
  door: { height: 150 * ROOM_ASSET_SCALE, topColor: 0x8b5a2b, leftColor: 0x734a24, rightColor: 0x5d3b1d, blocks: false, inset: 0.98 },
  table: { height: 46 * ROOM_ASSET_SCALE, topColor: 0xf6f1e4, leftColor: 0xd8cfb8, rightColor: 0xc2b79c, blocks: true, inset: 0.86 },
  chair: { height: 34 * ROOM_ASSET_SCALE, topColor: 0xb9754a, leftColor: 0x9c5f3a, rightColor: 0x82502f, blocks: true, inset: 0.6 },
  stove: { height: 58 * ROOM_ASSET_SCALE, topColor: 0x9aa3ad, leftColor: 0x7c848d, rightColor: 0x656c74, blocks: true, inset: 0.9 },
  counter: { height: 46 * ROOM_ASSET_SCALE, topColor: 0xd4d4c9, leftColor: 0xb0b0a6, rightColor: 0x96968c, blocks: true, inset: 0.9 },
  bush: { height: 40 * ROOM_ASSET_SCALE, topColor: 0x5fae3f, leftColor: 0x4a8c31, rightColor: 0x3d7428, blocks: true, inset: 0.7 },
  panel: { height: 90 * ROOM_ASSET_SCALE, topColor: 0xefc84a, leftColor: 0xd0aa36, rightColor: 0xb0902c, blocks: true, inset: 0.7 },
  letterbox: { height: 52 * ROOM_ASSET_SCALE, topColor: 0xc9503f, leftColor: 0xa93f31, rightColor: 0x8c3326, blocks: true, inset: 0.5 },
  decor: { height: 44 * ROOM_ASSET_SCALE, topColor: 0xd9c9a8, leftColor: 0xbaa985, rightColor: 0xa2916f, blocks: true, inset: 0.72 },
};

/** Colocações iniciais da sala. */
export const DEFAULT_ROOM_ITEMS: readonly RoomItem[] = [
  { name: 'Stove', id: 3070000, kind: 'stove', tx: 6, ty: 2, rotation: 1 },
  { name: 'Counter', id: 3020069, kind: 'counter', tx: 7, ty: 3, rotation: 1 },
  { name: 'Mafia Door', id: 3010000, className: 'Door', kind: 'door', tx: 4, ty: 1, rotation: 1, sizeX: 1, sizeY: 1 },
  { name: 'Basic Window', id: 3000011, kind: 'window', tx: 0, ty: 2, rotation: 0 },
  { name: 'Basic Window', id: 3000011, kind: 'window', tx: 0, ty: 6, rotation: 0 },
  { name: 'Classic Chair', id: 3040001, kind: 'chair', tx: 2, ty: 3, rotation: 0 },
  { name: 'Classic Chair', id: 3040001, kind: 'chair', tx: 2, ty: 5, rotation: 0 },
  { name: 'Classic Chair', id: 3040001, kind: 'chair', tx: 5, ty: 5, rotation: 0 },
  { name: 'White Cloth Table', id: 3030010, kind: 'table', tx: 3, ty: 3, rotation: 0 },
  { name: 'White Cloth Table', id: 3030010, kind: 'table', tx: 3, ty: 5, rotation: 0 },
  { name: 'White Cloth Table', id: 3030010, kind: 'table', tx: 6, ty: 5, rotation: 0 },
  { name: 'Achievement Panel', id: 3200000, kind: 'panel', tx: 2, ty: 0, rotation: 1 },
  { name: 'Letter Box', id: 3300000, kind: 'letterbox', tx: 1, ty: 7, rotation: 0 },
  { name: 'Menu Holder', id: 3100000, kind: 'panel', tx: 5, ty: 0, rotation: 1 },
  { name: 'DelicateBush', id: 3020003, kind: 'bush', tx: 1, ty: 1, rotation: 0 },
  { name: 'DelicateBush', id: 3020003, kind: 'bush', tx: 7, ty: 1, rotation: 0 },
  { name: 'DelicateBush', id: 3020003, kind: 'bush', tx: 7, ty: 7, rotation: 0 },
];

/** Paredes por tile das bordas, com um canto em (0,0). Rotação 0 corresponde a tx=0; rotação 1, a ty=0. */

export interface WallSpec {
  segmentId: number;
  cornerId: number;
  segmentClassName?: string;
  cornerClassName?: string;
  wallpaperClassName?: string;
  /** Altura comum dos segmentos e do canto; o padrão acompanha os revestimentos mais baixos. */
  height?: number;
}

/** Estrutura e revestimento iniciais da sala. */
export const DEFAULT_WALLS: WallSpec = {
  segmentId: 3090000,
  cornerId: 3090001,
  segmentClassName: 'Wall2',
  cornerClassName: 'WallCorner',
  wallpaperClassName: 'Wall17',
};

export interface RoomModelOptions {
  tilesX?: number;
  tilesY?: number;
  items?: readonly RoomItem[];
  /** Paredes fechando as linhas tx=0 e ty=0. `false` deixa a sala aberta. */
  walls?: boolean | WallSpec;
}

export class RoomModel {
  readonly tilesX: number;
  readonly tilesY: number;
  readonly items: RoomItem[];

  /** índice do tile -> item que ocupa o tile. */
  private readonly itemMap = new Map<number, RoomItem>();
  private readonly blocked = new Set<number>();
  private readonly doors = new Set<number>();
  /** Coordenadas teóricas que sustentam paredes, sem piso físico. */
  private readonly wallTiles = new Set<number>();

  constructor(options: RoomModelOptions = {}) {
    this.tilesX = options.tilesX ?? 8;
    this.tilesY = options.tilesY ?? 8;
    this.items = [...(options.items ?? DEFAULT_ROOM_ITEMS)].map((item) => {
      if (item.kind === 'door') {
        // Aceita portas antigas ancoradas na parede; portas de chão usam a aresta traseira do piso.

        const legacyLeft = item.tx === 0 && item.ty > 0;
        const legacyRight = item.ty === 0 && item.tx > 0;
        return { ...item, tx: legacyLeft ? 1 : item.tx, ty: legacyRight ? 1 : item.ty,
          rotation: legacyLeft ? 0 : legacyRight ? 1 : item.rotation,
          sizeX: 1, sizeY: 1, blocks: false };
      }
      return { ...item, sizeX: item.sizeX ?? 1, sizeY: item.sizeY ?? 1 };
    });

    const walls = options.walls ?? true;
    if (walls !== false) this.addWalls(walls === true ? DEFAULT_WALLS : walls);
    for (const item of this.items) this.register(item);
  }

  private addWalls(spec: WallSpec): void {
    // Decorações ficam no segmento da parede; portas de chão definem o vão pela aresta traseira.

    const jaTemParede = new Set(
      this.items
        .filter((item) => item.kind === 'wall')
        .flatMap((item) => footprintTiles(item).map((tile) => tileIndex(tile.tx, tile.ty))),
    );

    const paredes: RoomItem[] = [];

    const wall = (tx: number, ty: number): void => {
      if (jaTemParede.has(tileIndex(tx, ty))) return;

      const canto = tx === 0 && ty === 0;
      // Rotação 0 na coluna tx=0, rotação 1 na linha ty=0.
      const rotation = tx === 0 ? 0 : 1;

      paredes.push({
        name: canto ? 'Wall Corner' : 'White Walls',
        id: canto ? spec.cornerId : spec.segmentId,
        kind: 'wall',
        tx,
        ty,
        rotation: canto ? 0 : rotation,
        sizeX: 1,
        sizeY: 1,
        wallHeight: spec.height ?? WALL_HEIGHT,
        ...(canto
          ? { ...(spec.cornerClassName ? { className: spec.cornerClassName } : {}) }
          : {
              ...(spec.segmentClassName ? { className: spec.segmentClassName } : {}),
              ...(spec.wallpaperClassName ? { wallpaperClassName: spec.wallpaperClassName } : {}),
            }),
      });
    };

    for (let ty = 0; ty < this.tilesY; ty++) wall(0, ty);
    for (let tx = 1; tx < this.tilesX; tx++) wall(tx, 0);

    // Parede entra na frente da lista: registra primeiro, e assim a decoração
    // que está no mesmo tile é quem responde por ele no itemAt.
    this.items.unshift(...paredes);
  }

  private register(item: RoomItem): void {
    // Registra todos os tiles da pegada para bloquear o volume inteiro.

    const blocks = item.blocks ?? ITEM_STYLES[item.kind].blocks;
    for (const tile of footprintTiles(item)) {
      const index = tileIndex(tile.tx, tile.ty);
      // O último a registrar manda no mapa: a decoração entra depois da parede.
      this.itemMap.set(index, item);
      if (item.kind === 'wall') this.wallTiles.add(index);
      if (blocks) this.blocked.add(index);
      if (item.kind === 'door') {
        this.doors.add(index);
        const opening = doorOpeningTile(item);
        // Libera a soleira sem inventar piso nela nem consumir outro tile de móvel.
        if (this.isWallTile(opening.tx, opening.ty)) this.doors.add(tileIndex(opening.tx, opening.ty));
      }
    }
  }

  itemAt(tx: number, ty: number): RoomItem | undefined {
    return this.itemMap.get(tileIndex(tx, ty));
  }

  /** Rebuild occupancy while preserving the model used by navigation and NPCs. */
  replaceItems(items: readonly RoomItem[]): void {
    this.items.splice(0, this.items.length, ...items);
    this.itemMap.clear(); this.blocked.clear(); this.doors.clear(); this.wallTiles.clear();
    for (const item of this.items) this.register(item);
  }

  inside(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.tilesX && ty < this.tilesY;
  }

  /** A coordenada existe apenas para ancorar uma parede. */
  isWallTile(tx: number, ty: number): boolean {
    return this.inside(tx, ty) && this.wallTiles.has(tileIndex(tx, ty));
  }

  /** Piso visível/interativo; a abertura da porta continua sem piso. */
  hasFloor(tx: number, ty: number): boolean {
    if (!this.inside(tx, ty)) return false;
    return !this.wallTiles.has(tileIndex(tx, ty));
  }

  /** Dentro da sala, a passagem exige ausência de bloqueios. Portas liberam seu vão na parede. */

  isWalkable = (tx: number, ty: number): boolean => {
    if (!this.inside(tx, ty)) return false;
    const index = tileIndex(tx, ty);
    return this.doors.has(index) || (this.hasFloor(tx, ty) && !this.blocked.has(index));
  };

  /** Todos os tiles livres, em ordem de índice. Útil para sortear destino. */
  walkableTiles(): { tx: number; ty: number }[] {
    const tiles: { tx: number; ty: number }[] = [];
    for (let ty = 0; ty < this.tilesY; ty++) {
      for (let tx = 0; tx < this.tilesX; tx++) {
        if (this.isWalkable(tx, ty)) tiles.push({ tx, ty });
      }
    }
    return tiles;
  }
}
