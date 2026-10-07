import type { RoomItem, RoomItemKind } from '../world/RoomModel';
import { rotatedArt, type IndoorArt } from './indoor-art';

/** Catálogo de itens de interior. Valida a estrutura e resolve nomes, pegadas e bloqueios. */

export interface CatalogGroup {
  name: string;
  buttonName: string | null;
  types: string[];
}

export interface CatalogItem {
  id: number;
  name: string;
  /** Classe da arte; ausente em itens sem sprite. */
  className?: string;
  group: string;
  types: string[];
  /** Override de pegada do catálogo. Ausente = pegada vem da arte. */
  sizeX?: number;
  sizeY?: number;
  cost?: number;
  cash?: number;
  unlockLevel?: number;
  /** Identificador do comportamento associado ao item. */
  functions?: string;
  coverName?: string;
  invisible?: boolean;
  standalone?: boolean;
  breakCount?: number;
  operateTimePercentage?: number;
  infoText?: boolean;
  arcadeGame?: boolean;
}

export interface CatalogFile {
  source: string;
  generatedAt: string;
  groups: CatalogGroup[];
  items: CatalogItem[];
}

/** Tipos que não são móvel de grade: são pintura de piso ou de parede. */
const PAINT_TYPES = ['floorTileItem', 'wallpaperItem'];

/** Grupos que não são móvel nenhum: são compras e opções da conta. */
const VIRTUAL_GROUPS = ['Music', 'CoinsToPfCash', 'Visit', 'OutsideAreaSize', 'DeliveryBike'];

export class ItemCatalog {
  constructor(
    readonly groups: readonly CatalogGroup[],
    readonly items: readonly CatalogItem[],
  ) {}

  /** Valida a estrutura mínima sem alterar os dados nem eliminar IDs repetidos. */

  static from(raw: unknown): ItemCatalog {
    if (typeof raw !== 'object' || raw === null) throw new Error('catálogo inválido: não é objeto');
    const file = raw as Partial<CatalogFile>;
    if (!Array.isArray(file.groups) || !Array.isArray(file.items)) {
      throw new Error('catálogo inválido: faltam groups ou items');
    }
    for (const item of file.items) {
      if (!Number.isInteger(item.id) || typeof item.name !== 'string' || !Array.isArray(item.types)) {
        throw new Error(`catálogo inválido: item malformado ${JSON.stringify(item)}`);
      }
    }
    return new ItemCatalog(file.groups, file.items);
  }

  get size(): number {
    return this.items.length;
  }

  /** Resolve o primeiro item com esse ID, na ordem dos grupos, tornando colisões de catálogo determinísticas. */

  byId(id: number): CatalogItem | undefined {
    return this.items.find((item) => item.id === id);
  }

  /** Primeiro item cujo nome corresponde ao solicitado. */
  byName(name: string): CatalogItem | undefined {
    return this.items.find((item) => item.name === name);
  }

  byClassName(className: string): CatalogItem | undefined {
    return this.items.find((item) => item.className === className);
  }

  inGroup(group: string): CatalogItem[] {
    return this.items.filter((item) => item.group === group);
  }

  withType(type: string): CatalogItem[] {
    return this.items.filter((item) => item.types.includes(type));
  }

  /** IDs presentes em mais de uma entrada do catálogo. */
  duplicateIds(): number[] {
    const vistos = new Set<number>();
    const repetidos = new Set<number>();
    for (const item of this.items) {
      if (vistos.has(item.id)) repetidos.add(item.id);
      vistos.add(item.id);
    }
    return [...repetidos];
  }
}

/** Móvel que ocupa tile na grade (exclui pintura e item virtual). */
export function isGridItem(item: CatalogItem): boolean {
  if (VIRTUAL_GROUPS.includes(item.group)) return false;
  return !item.types.some((type) => PAINT_TYPES.includes(type));
}

/** Itens colocados bloqueiam a passagem, exceto portas, que liberam seu vão. */

export function blocksWalking(item: CatalogItem): boolean {
  return !item.types.includes('doorItem');
}

export interface Footprint {
  sizeX: number;
  sizeY: number;
  /** `true` quando o catálogo diz; `false` quando é o padrão 1x1. */
  fromCatalog: boolean;
}

/** Pegada em tiles: usa sizeX/sizeY do catálogo quando disponíveis; caso contrário, assume 1×1. A arte pode fornecer dimensões mais precisas. */

export function footprint(item: CatalogItem): Footprint {
  const sizeX = item.sizeX;
  const sizeY = item.sizeY;
  if (typeof sizeX === 'number' && typeof sizeY === 'number') {
    return { sizeX: Math.max(1, sizeX), sizeY: Math.max(1, sizeY), fromCatalog: true };
  }
  return { sizeX: 1, sizeY: 1, fromCatalog: false };
}

/** Classes de plantas usadas pelo desenho procedural de fallback. */
const PLANT_HINTS = ['bush', 'tree', 'plant', 'flower', 'palm', 'cact', 'garden'];

/** Classifica o volume procedural de fallback pelo nome do item. */

export function itemKind(item: CatalogItem): RoomItemKind {
  const types = item.types;
  if (types.includes('doorItem')) return 'door';
  if (types.includes('wallItem')) return 'wall';
  if (types.includes('wallDecorationItem')) {
    return (item.className ?? '').toLowerCase().includes('window') ? 'window' : 'panel';
  }
  if (types.includes('tableItem')) return 'table';
  if (types.includes('chairItem')) return 'chair';
  if (types.includes('kitchen') || item.group === 'Kitchen Appliance') return 'stove';
  if (types.includes('mailItem')) return 'letterbox';

  const nome = `${item.className ?? ''} ${item.name}`.toLowerCase();
  if (PLANT_HINTS.some((hint) => nome.includes(hint))) return 'bush';

  return 'decor';
}

/** Enriquece colocações com tipo, pegada e bloqueio sem acoplar RoomModel ao catálogo ou ao Pixi. */

export function enrichRoomItems(
  items: readonly RoomItem[],
  catalog?: ItemCatalog | null,
  art?: IndoorArt | null,
): RoomItem[] {
  return items.map((item) => {
    const entry = catalog?.byId(item.id);
    if (!entry) return { ...item };

    // Prioridade da pegada: colocação, arte rotacionada, catálogo e padrão 1×1.

    // Itens de parede ocupam um tile: a caixa do sprite pode se estender sobre o piso sem bloqueá-lo.

    const naParede = entry.types.includes('wallDecorationItem') || entry.types.includes('wallItem');
    const artEntry = art?.get(entry.className);
    const rotated = artEntry ? rotatedArt(artEntry, item.rotation) : null;
    const fp = footprint(entry);
    const isDoor = entry.types.includes('doorItem');

    return {
      ...item,
      className: entry.className,
      kind: itemKind(entry),
      sizeX: naParede || isDoor ? 1 : (item.sizeX ?? rotated?.sizeX ?? fp.sizeX),
      sizeY: naParede || isDoor ? 1 : (item.sizeY ?? rotated?.sizeY ?? fp.sizeY),
      blocks: isDoor ? false : item.blocks ?? blocksWalking(entry),
    };
  });
}
