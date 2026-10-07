/** Catálogo e composição do look. As peças controlam nós da malha; a textura 256×256 recebe camadas em ordem de priority. */

export interface WardrobeGroup {
  name: string;
  buttonName: string | null;
  /** Grupo que compartilha o slot deste (Skirt usa o slot de Pants). */
  parent: string | null;
  /** Ordem de composição da textura: menor desenha primeiro. */
  priority: number;
  /** `color`: o item é uma cor plana da paleta. `item`: é peça de roupa. */
  kind: 'color' | 'item';
  /** Item inicial do grupo; null em grupos que compartilham outro slot, como Skirt e Pants. */

  default: number | null;
}

export interface WardrobeItem {
  id: number;
  name: string;
  group: string;
  /** Nós da malha que o item acende. */
  objects: string[];
  /** Grupos que o item esconde por inteiro. */
  hideGroups: string[];
  /** Símbolo no atlas, desenhado na textura 256x256. */
  texture?: string;
  iconName?: string;
  cost?: number;
  priority: number;
  invisible?: boolean;
  standalone?: boolean;
  noHat?: boolean;
  /** `#rrggbb`, só nos grupos de cor. O `name` do item é o valor: `0xFFECE9`. */
  colour?: string;
}

export interface WardrobeFile {
  groups: WardrobeGroup[];
  items: WardrobeItem[];
  /** Malhas que nenhum item pede e que ficam sempre acesas (`face0`). */
  alwaysVisible?: string[];
}

/** CUSTOMISABLE_OBJECT_PREFIX: os nós que o look liga e desliga. */
export const CUSTOMISABLE_OBJECT_PREFIX: readonly string[] = [
  'pants',
  'dress',
  'shirt',
  'hat',
  'hair',
  'armleft',
  'armright',
];

/** Props que só as animações acendem (ANIMATION_OBJECT_NAMES). */
export const ANIMATION_OBJECT_NAMES: readonly string[] = ['tray', 'bucket', 'brush', 'repair'];

export class Wardrobe {
  constructor(
    readonly groups: readonly WardrobeGroup[],
    readonly items: readonly WardrobeItem[],
    readonly alwaysVisible: readonly string[] = [],
  ) {}

  static from(raw: unknown): Wardrobe {
    if (typeof raw !== 'object' || raw === null) throw new Error('guarda-roupa inválido');
    const file = raw as Partial<WardrobeFile>;
    if (!Array.isArray(file.groups) || !Array.isArray(file.items)) {
      throw new Error('guarda-roupa inválido: faltam groups ou items');
    }
    for (const item of file.items) {
      if (!Number.isInteger(item.id) || typeof item.name !== 'string' || !Array.isArray(item.objects)) {
        throw new Error(`guarda-roupa inválido: item malformado ${JSON.stringify(item)}`);
      }
    }
    return new Wardrobe(file.groups, file.items, file.alwaysVisible ?? []);
  }

  get size(): number {
    return this.items.length;
  }

  byId(id: number): WardrobeItem | undefined {
    return this.items.find((item) => item.id === id);
  }

  byName(name: string): WardrobeItem | undefined {
    return this.items.find((item) => item.name === name);
  }

  inGroup(group: string): WardrobeItem[] {
    return this.items.filter((item) => item.group === group);
  }

  group(name: string): WardrobeGroup | undefined {
    return this.groups.find((group) => group.name === name);
  }

  /** Grupos com parent compartilham o slot do pai, impedindo combinações como saia e calça simultâneas. */

  slotOf(item: WardrobeItem): string {
    return this.group(item.group)?.parent ?? item.group;
  }

  /** Item padrão de um grupo, quando ele tem um. */
  defaultOf(group: string): WardrobeItem | undefined {
    const id = this.group(group)?.default;
    return id === null || id === undefined ? undefined : this.byId(id);
  }

  /** Cor do item padrão de um grupo de cor, como número 0xrrggbb. */
  private defaultColour(group: string, fallback: number): number {
    const colour = this.defaultOf(group)?.colour;
    if (!colour) return fallback;
    const valor = Number.parseInt(colour.replace('#', ''), 16);
    return Number.isNaN(valor) ? fallback : valor;
  }

  /** Look inicial composto pelos itens padrão e pelas cores do catálogo. Grupos opcionais usam seu padrão explícito. */

  defaultLook(): Look {
    const itemIds: number[] = [];
    for (const group of this.groups) {
      if (group.kind !== 'item') continue;
      const item = this.defaultOf(group.name);
      if (item) itemIds.push(item.id);
    }

    return {
      itemIds,
      skinColour: this.defaultColour('SkinColour', 0xffece9),
      hairColour: this.defaultColour('HairColour', 0xf0ece3),
    };
  }
}

export interface Look {
  /** Ids do guarda-roupa que compõem o avatar. */
  itemIds: number[];
  /** Cor plana da pele, usada como fundo da textura. */
  skinColour: number;
  /** Cor plana do cabelo: material próprio, não vai na textura. */
  hairColour: number;
}

export interface ResolvedLook {
  /** Nós da malha que ficam visíveis. */
  objects: string[];
  /** Símbolos a desenhar na textura, já na ordem de composição. */
  textureLayers: string[];
  /** Grupos escondidos por algum item. */
  hiddenGroups: string[];
  skinColour: number;
  hairColour: number;
}

/** Compõe camadas em ordem crescente de priority. Empates preservam a ordem dos itens recebidos. */

export function resolveLook(wardrobe: Wardrobe, look: Look): ResolvedLook {
  const itens = look.itemIds
    .map((id) => wardrobe.byId(id))
    .filter((item): item is WardrobeItem => item !== undefined);

  const escondidos = new Set(itens.flatMap((item) => item.hideGroups));

  const visiveis = itens.filter((item) => !escondidos.has(item.group) && !item.invisible);

  const objetos: string[] = [];
  for (const item of visiveis) {
    for (const objeto of item.objects) {
      if (!objetos.includes(objeto)) objetos.push(objeto);
    }
  }

  // face0 permanece visível como superfície para as texturas de olhos e boca.

  for (const objeto of wardrobe.alwaysVisible) {
    if (!objetos.includes(objeto)) objetos.push(objeto);
  }

  const camadas = visiveis
    .map((item, ordem) => ({ item, ordem }))
    .sort((a, b) => a.item.priority - b.item.priority || a.ordem - b.ordem)
    .map(({ item }) => item.texture)
    .filter((texture): texture is string => texture !== undefined);

  return {
    objects: objetos,
    textureLayers: camadas,
    hiddenGroups: [...escondidos],
    skinColour: look.skinColour,
    hairColour: look.hairColour,
  };
}

/** `true` se o nó da malha é um dos que o look controla. */
export function isCustomisableObject(nodeName: string): boolean {
  const nome = nodeName.replace(/-node$/, '');
  return CUSTOMISABLE_OBJECT_PREFIX.some((prefix) => nome.startsWith(prefix));
}
