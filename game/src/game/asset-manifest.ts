import { Assets, Rectangle, Texture } from 'pixi.js';

import { LOADING_ASSET_URLS } from '../screens/loading/assets';
import { Wardrobe } from '../avatar/wardrobe';
import { IndoorArt } from './indoor-art';
import { ItemCatalog } from './item-catalog';
import { RECIPE_CATALOG_URL, loadRecipeArt, type RecipeArt } from './recipes';

const base = import.meta.env.BASE_URL ?? '/';
const dataUrl = (file: string) =>
  new URL(`assets/data/${file}`, new URL(base, document.baseURI)).href;

/** Catálogo de itens de interior disponível nos assets do cliente. */
export const ITEM_CATALOG_URL = dataUrl('interior-items.json');

const avatarUrl = (file: string) =>
  new URL(`assets/avatar/${file}`, new URL(base, document.baseURI)).href;

/** Malha, atlas de texturas e guarda-roupa do avatar. */
export const AVATAR_URLS = {
  model: avatarUrl('model.dae'),
  atlas: avatarUrl('atlas.json'),
  sheet: avatarUrl('atlas.png'),
  wardrobe: avatarUrl('wardrobe.json'),
} as const;

/** Shared white loading silhouette, baked once during asset generation. */
export const AVATAR_PLACEHOLDER_URLS = {
  sheet: avatarUrl('placeholder/atlas.png'),
  metadata: avatarUrl('placeholder/atlas.json'),
} as const;

/** Barra de ações da UI do jogo. */
export const UI_ACTION_BAR_URL = new URL('assets/ui/cafe_action_bar.png', new URL(base, document.baseURI)).href;
export const UI_STORE_ACTION_BAR_URL = new URL('assets/store/store_action_bar.png', new URL(base, document.baseURI)).href;
export const UI_STORE_TOP_BUTTON_URL = new URL('assets/ui/top_button.png', new URL(base, document.baseURI)).href;
export const UI_STORE_TOOLBAR_BUNDLE_URL = new URL('assets/ui/icon_bundle_8.png', new URL(base, document.baseURI)).href;
export const UI_STORE_CURRENCY_BUNDLE_URL = new URL('assets/ui/icon_bundle_6m.png', new URL(base, document.baseURI)).href;
export const STORE_CATEGORY_ICON_NAMES = [
  'flower', 'stove', 'stove-fire', 'counter', 'table', 'chair', 'door', 'flower-window', 'floor', 'wallpaper',
] as const;
const UI_STORE_CATEGORY_ICON_URLS = STORE_CATEGORY_ICON_NAMES.map((name) =>
  new URL(`assets/ui/store-icons/${name}.png`, new URL(base, document.baseURI)).href);

/** Fundo e moldura das cinco barras de progresso no topo da sala. */
export const UI_TOP_BARS_URLS = {
  back: new URL('assets/ui/top_bars_back.png', new URL(base, document.baseURI)).href,
  front: new URL('assets/ui/top_bars_front.png', new URL(base, document.baseURI)).href,
  icons: new URL('assets/ui/icon_bundle_1.png', new URL(base, document.baseURI)).href,
} as const;

/**
 * Livro de Receitas: arte do livro original (folha 1448 × 1086), card de prato, abas, relógio e seta.
 * O botão Cozinhar, o + e os ícones do card são desenhados em CookScreenModal.
 */
const recipeBookUrl = (file: string) => new URL(`assets/ui/recipe-book/${file}`, new URL(base, document.baseURI)).href;
export const UI_RECIPE_BOOK_URLS = {
  book: recipeBookUrl('book.png'),
  card: new URL('assets/ui/inside_food_card.png', new URL(base, document.baseURI)).href,
  tab: recipeBookUrl('tab.png'),
  tabHover: recipeBookUrl('tab-hover.png'),
  tabActive: recipeBookUrl('tab-active.png'),
  clock: recipeBookUrl('clock.png'),
  pageArrow: recipeBookUrl('page-arrow.png'),
} as const;
export const UI_COOK_PROGRESS_URLS = {
  back: new URL('assets/ui/cook_prog_bar_1.png', new URL(base, document.baseURI)).href,
  front: new URL('assets/ui/cook_prog_bar_2.png', new URL(base, document.baseURI)).href,
} as const;
export const UI_COOK_CALLOUT_URL = new URL('assets/ui/cook_progress_callout.png', new URL(base, document.baseURI)).href;
export const UI_RESOURCE_ICON_URLS = {
  energyRed: new URL('assets/ui/resource-icons/energy-red.png', new URL(base, document.baseURI)).href,
  energyBlue: new URL('assets/ui/resource-icons/energy-blue.png', new URL(base, document.baseURI)).href,
  clock: new URL('assets/ui/resource-icons/clock.png', new URL(base, document.baseURI)).href,
} as const;

async function loadResourceIcon(url: string): Promise<Texture> {
  const texture = await Assets.load<Texture>(url);
  texture.source.scaleMode = 'linear';
  texture.source.autoGenerateMipmaps = true;
  texture.source.mipLevelCount = Math.floor(Math.log2(Math.max(texture.source.pixelWidth, texture.source.pixelHeight))) + 1;
  return texture;
}

export const UI_WARDROBE_URLS = {
  light1: new URL('assets/wardrobe/wardrobe_light_1.png', new URL(base, document.baseURI)).href,
  wardrobe: new URL('assets/wardrobe/wardrobe_1.png', new URL(base, document.baseURI)).href,
  light2: new URL('assets/wardrobe/wardrobre_light_2.png', new URL(base, document.baseURI)).href,
  bar: new URL('assets/ui/wardrobe_bar.png', new URL(base, document.baseURI)).href,
} as const;
const WARDROBE_ICON_NAMES = [
  'eye', 'eyebrow', 'mouth', 'hair', 'moustache', 'hat', 'glasses', 'pants', 'shirt', 'sneaker',
] as const;
const UI_WARDROBE_ICON_URLS = WARDROBE_ICON_NAMES.map((name) =>
  new URL(`assets/ui/wardrobe-icons/${name}.png`, new URL(base, document.baseURI)).href);

/** Coleção de botões da UI e posições de corte JSON. */
export const UI_BUTTONS_COLLECTION_URL = new URL('assets/ui/buttons_collection_1.png', new URL(base, document.baseURI)).href;
export const UI_BUTTONS_COLLECTION_2_URL = new URL('assets/ui/buttons_collection_2.png', new URL(base, document.baseURI)).href;
/** Recorte do botão de confirmação com margem para antialiasing. */
export const UI_STORE_CONFIRM_FRAME = { x: 1308, y: 301, width: 209, height: 216 } as const;
export const UI_BUTTONS_POSITIONS_URL = new URL('assets/jsons/buttons_positions_1.json', new URL(base, document.baseURI)).href;
const ACTION_BAR_ICON_NAMES = [
  'trophy', 'waiter', 'house', 'gift', 'yellow-box',
  'shirt', 'map', 'mortar', 'striped-chicken', 'mail',
] as const;
export const UI_ACTION_BAR_ICONS_URLS = ACTION_BAR_ICON_NAMES.map((name) =>
  new URL(`assets/ui/action-icons/${name}.png`, new URL(base, document.baseURI)).href);
export const UI_EMOTION_BUNDLE_URL = new URL('assets/ui/emotion_bundle_1.png', new URL(base, document.baseURI)).href;

/** Música de fundo padrão (BGM). */
export const BGM_URL = new URL('assets/songs/music_1.opus', new URL(base, document.baseURI)).href;

/** Efeitos sonoros ao abrir o livro de receitas (book_1 e book_2). */
export const SFX_BOOK_URLS = [
  new URL('assets/sfx/book_1.opus', new URL(base, document.baseURI)).href,
  new URL('assets/sfx/book_2.opus', new URL(base, document.baseURI)).href,
] as const;

/** Efeito reproduzido ao iniciar o preparo de uma receita. */
export const SFX_START_COOKING_URL = new URL('assets/sfx/start_cooking.opus', new URL(base, document.baseURI)).href;

export interface AvatarAssets {
  wardrobe: Wardrobe;
  atlas: unknown;
  atlasImage: HTMLImageElement;
}

let avatarCache: AvatarAssets | null = null;

/**
 * Assets do avatar. O `.dae` não passa por aqui: quem carrega é o ColladaLoader
 * do three, que precisa da URL para resolver as dependências do arquivo.
 */
export async function loadAvatarAssets(): Promise<AvatarAssets> {
  if (avatarCache) return avatarCache;

  const [wardrobeRaw, atlas, atlasImage] = await Promise.all([
    Assets.load<unknown>(AVATAR_URLS.wardrobe),
    Assets.load<unknown>(AVATAR_URLS.atlas),
    loadImage(AVATAR_URLS.sheet),
  ]);

  avatarCache = { wardrobe: Wardrobe.from(wardrobeRaw), atlas, atlasImage };
  return avatarCache;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`falha ao carregar ${url}`));
    image.src = url;
  });
}

/** Manifesto de texturas e geometria do interior. */
export const INDOOR_ART_URL = new URL(
  'assets/indoor/indoor-art.json',
  new URL(base, document.baseURI),
).href;

const indoorFileUrl = (file: string) =>
  new URL(`assets/indoor/${file}`, new URL(base, document.baseURI)).href;

/**
 * Índice do jogo: os dois manifestos de dados. As texturas que eles apontam são
 * carregadas na sequência, dentro da mesma barra de progresso.
 */
export const GAME_ASSET_URLS: readonly string[] = [
  ...Object.values(AVATAR_PLACEHOLDER_URLS),
  LOADING_ASSET_URLS.frame,
  ...LOADING_ASSET_URLS.banners,
  ITEM_CATALOG_URL,
  INDOOR_ART_URL,
  UI_ACTION_BAR_URL,
  UI_STORE_ACTION_BAR_URL,
  UI_STORE_TOP_BUTTON_URL,
  UI_STORE_TOOLBAR_BUNDLE_URL,
  UI_STORE_CURRENCY_BUNDLE_URL,
  UI_TOP_BARS_URLS.back,
  UI_TOP_BARS_URLS.front,
  UI_TOP_BARS_URLS.icons,
  ...Object.values(UI_RECIPE_BOOK_URLS),
  ...Object.values(UI_COOK_PROGRESS_URLS),
  ...Object.values(UI_WARDROBE_URLS),
  ...UI_WARDROBE_ICON_URLS,
  UI_BUTTONS_COLLECTION_URL,
  UI_BUTTONS_COLLECTION_2_URL,
  UI_BUTTONS_POSITIONS_URL,
  ...UI_ACTION_BAR_ICONS_URLS,
  UI_EMOTION_BUNDLE_URL,
  RECIPE_CATALOG_URL,
];

let catalogCache: ItemCatalog | null = null;
let artCache: IndoorArt | null = null;

/** Passa pelo Assets do Pixi, então aproveita o que a barra já baixou. */
export async function loadItemCatalog(): Promise<ItemCatalog> {
  if (catalogCache) return catalogCache;
  catalogCache = ItemCatalog.from(await Assets.load<unknown>(ITEM_CATALOG_URL));
  return catalogCache;
}

export async function loadIndoorArt(): Promise<IndoorArt> {
  if (artCache) return artCache;
  artCache = IndoorArt.from(await Assets.load<unknown>(INDOOR_ART_URL));
  const textures = await Assets.load<Texture>(artCache.files().map(indoorFileUrl));
  for (const texture of Object.values(textures)) {
    texture.source.scaleMode = 'nearest';
    texture.source.autoGenerateMipmaps = true;
    texture.source.minFilter = 'linear';
    texture.source.mipmapFilter = 'linear';
  }
  return artCache;
}

/** Textura de um arquivo do manifesto de arte, já carregada. */
export function indoorTexture(file: string): Texture | undefined {
  return Assets.get<Texture>(indoorFileUrl(file));
}

/** Carrega a textura da barra de ações da interface. */
export async function loadActionBarTexture(): Promise<Texture> {
  return Assets.load<Texture>(UI_ACTION_BAR_URL);
}

export async function loadStoreActionBarTexture(): Promise<Texture> {
  return Assets.load<Texture>(UI_STORE_ACTION_BAR_URL);
}

export async function loadStoreTopButtonTexture(): Promise<Texture> {
  return loadResourceIcon(UI_STORE_TOP_BUTTON_URL);
}

export interface StoreToolbarTextures {
  news: Texture;
  inventory: Texture;
  cashRegister: Texture;
  gold: Texture;
}

export async function loadStoreToolbarTextures(): Promise<StoreToolbarTextures> {
  const [sheet, currencySheet] = await Promise.all([
    loadResourceIcon(UI_STORE_TOOLBAR_BUNDLE_URL), loadResourceIcon(UI_STORE_CURRENCY_BUNDLE_URL),
  ]);
  const crop = (x: number, y: number, width: number, height: number) =>
    new Texture({ source: sheet.source, frame: new Rectangle(x, y, width, height) });
  return {
    news: crop(153, 82, 303, 295),
    inventory: crop(849, 99, 265, 253),
    cashRegister: crop(660, 397, 278, 293),
    gold: new Texture({ source: currencySheet.source, frame: new Rectangle(208, 40, 161, 154) }),
  };
}

export interface ActionBarButtonTextures {
  leftArrow: Texture;
  leftEdgeArrow: Texture;
  rightArrow: Texture;
  rightEdgeArrow: Texture;
  settings: Texture;
  confirm?: Texture;
}

export interface ActionBarIconTexture {
  name: string;
  texture: Texture;
}

export async function loadActionBarIcons(): Promise<ActionBarIconTexture[]> {
  const textures = await Promise.all(UI_ACTION_BAR_ICONS_URLS.map((url) => Assets.load<Texture>(url)));
  return textures.map((texture, index) => {
    texture.source.scaleMode = 'linear';
    texture.source.autoGenerateMipmaps = true;
    texture.source.mipLevelCount = Math.floor(Math.log2(Math.max(texture.source.pixelWidth, texture.source.pixelHeight))) + 1;
    return { name: ACTION_BAR_ICON_NAMES[index], texture };
  });
}

export async function loadStoreActionBarIcons(): Promise<ActionBarIconTexture[]> {
  const textures = await Promise.all(UI_STORE_CATEGORY_ICON_URLS.map(loadResourceIcon));
  return textures.map((texture, index) => ({ name: STORE_CATEGORY_ICON_NAMES[index], texture }));
}

export interface NpcEmotionTextures {
  dissatisfied: readonly Texture[];
  satisfied: readonly Texture[];
}

/** Cinco expressões por linha, recortadas com uma margem mínima sem incluir a vizinha. */
const EMOTION_FRAMES = {
  dissatisfied: [
    [41, 115, 325, 321], [380, 115, 324, 321], [724, 115, 327, 321],
    [1065, 115, 328, 321], [1409, 115, 334, 321],
  ],
  satisfied: [
    [35, 479, 331, 321], [373, 479, 332, 321], [712, 479, 341, 322],
    [1054, 473, 347, 330], [1405, 475, 341, 326],
  ],
} as const;

export async function loadNpcEmotionTextures(): Promise<NpcEmotionTextures> {
  const sheet = await Assets.load<Texture>(UI_EMOTION_BUNDLE_URL);
  sheet.source.scaleMode = 'linear';
  sheet.source.autoGenerateMipmaps = true;
  sheet.source.mipLevelCount = Math.floor(Math.log2(Math.max(sheet.source.pixelWidth, sheet.source.pixelHeight))) + 1;
  const crop = (frames: readonly (readonly [number, number, number, number])[]): Texture[] =>
    frames.map(([x, y, width, height]) => new Texture({
      source: sheet.source,
      frame: new Rectangle(x, y, width, height),
    }));
  return {
    dissatisfied: crop(EMOTION_FRAMES.dissatisfied),
    satisfied: crop(EMOTION_FRAMES.satisfied),
  };
}

/** Recorta os controles da barra usando as caixas inclusivas do JSON. */
export async function loadActionBarButtons(): Promise<ActionBarButtonTextures> {
  const [sheet, data, confirmSheet] = await Promise.all([
    Assets.load<Texture>(UI_BUTTONS_COLLECTION_URL),
    Assets.load<ButtonsCollectionJson>(UI_BUTTONS_POSITIONS_URL),
    Assets.load<Texture>(UI_BUTTONS_COLLECTION_2_URL),
  ]);
  const crop = (name: string): Texture => {
    const button = data.buttons.find((entry) => entry.name === name);
    if (!button) throw new Error(`Botão da barra de tarefas ausente: ${name}`);
    return new Texture({
      source: sheet.source,
      frame: new Rectangle(button.bbox.x1, button.bbox.y1, button.size.width, button.size.height),
    });
  };

  sheet.source.autoGenerateMipmaps = true;
  confirmSheet.source.autoGenerateMipmaps = true;
  const confirmFrame = UI_STORE_CONFIRM_FRAME;
  return {
    leftArrow: crop('voltar'),
    leftEdgeArrow: crop('anterior'),
    rightArrow: crop('play'),
    rightEdgeArrow: crop('proximo'),
    settings: crop('configuracao'),
    confirm: new Texture({
      source: confirmSheet.source,
      frame: new Rectangle(confirmFrame.x, confirmFrame.y, confirmFrame.width, confirmFrame.height),
    }),
  };
}

export async function loadTopBarsTextures(): Promise<{ back: Texture; front: Texture; icons: Texture; energyIcons: { normal: Texture; bonus: Texture } }> {
  const [back, front, icons, normal, bonus] = await Promise.all([
    Assets.load<Texture>(UI_TOP_BARS_URLS.back),
    Assets.load<Texture>(UI_TOP_BARS_URLS.front),
    Assets.load<Texture>(UI_TOP_BARS_URLS.icons),
    loadResourceIcon(UI_RESOURCE_ICON_URLS.energyRed),
    loadResourceIcon(UI_RESOURCE_ICON_URLS.energyBlue),
  ]);
  return { back, front, icons, energyIcons: { normal, bonus } };
}

export async function loadWardrobeScreenTextures(): Promise<{
  light1: Texture; wardrobe: Texture; light2: Texture; bar: Texture; icons: Texture[];
}> {
  const [light1, wardrobe, light2, bar, icons] = await Promise.all([
    Assets.load<Texture>(UI_WARDROBE_URLS.light1),
    Assets.load<Texture>(UI_WARDROBE_URLS.wardrobe),
    Assets.load<Texture>(UI_WARDROBE_URLS.light2),
    Assets.load<Texture>(UI_WARDROBE_URLS.bar),
    Promise.all(UI_WARDROBE_ICON_URLS.map((url) => Assets.load<Texture>(url))),
  ]);
  // Ignora a grande área transparente do asset sem mudar suas coordenadas de layout.
  const trimmedBar = new Texture({
    source: bar.source,
    frame: new Rectangle(224, 590, 1150, 310),
    orig: new Rectangle(0, 0, bar.width, bar.height),
    trim: new Rectangle(224, 590, 1150, 310),
  });
  return { light1, wardrobe, light2, bar: trimmedBar, icons };
}

export interface ButtonsCollectionJson {
  buttons: Array<{
    id: number;
    name: string;
    bbox: { x1: number; y1: number; x2: number; y2: number };
    size: { width: number; height: number };
  }>;
}

export interface RecipeBookTextures {
  book: Texture;
  card: Texture;
  tab: { idle: Texture; hover: Texture; active: Texture };
  clock: Texture;
  pageArrow: Texture;
  /** Atlas dos ícones do HUD (caféGrana, caféOuro, XP, energia, suprimentos), recortado com TOP_BAR_ICON_FRAMES. */
  hudIcons: Texture;
}

/** Carrega as texturas do Livro de Receitas e do preparo no fogão. */
export async function loadCookScreenTextures(): Promise<{
  book: RecipeBookTextures;
  closeButton: Texture;
  recipes: RecipeArt[];
  progressBack: Texture;
  progressFront: Texture;
  progressCallout: Texture;
  calloutClock: Texture;
}> {
  const urls = UI_RECIPE_BOOK_URLS;
  const [bookTextures, hudIcons] = await Promise.all([
    Promise.all([urls.book, urls.card, urls.tab, urls.tabHover, urls.tabActive, urls.clock, urls.pageArrow].map(loadResourceIcon)),
    loadResourceIcon(UI_TOP_BARS_URLS.icons),
  ]);
  const [bookArt, card, tab, tabHover, tabActive, clock, pageArrow] = bookTextures;
  const book: RecipeBookTextures = {
    book: bookArt, card, clock, pageArrow, hudIcons,
    tab: { idle: tab, hover: tabHover, active: tabActive },
  };
  const [buttonsSheet, buttonsData, recipes, progressBack, progressFront, progressCallout, calloutClock] = await Promise.all([
    Assets.load<Texture>(UI_BUTTONS_COLLECTION_URL),
    Assets.load<ButtonsCollectionJson>(UI_BUTTONS_POSITIONS_URL).catch(() => null),
    loadRecipeArt(),
    Assets.load<Texture>(UI_COOK_PROGRESS_URLS.back),
    Assets.load<Texture>(UI_COOK_PROGRESS_URLS.front),
    Assets.load<Texture>(UI_COOK_CALLOUT_URL),
    loadResourceIcon(UI_RESOURCE_ICON_URLS.clock),
  ]);

  const fecharBtn = buttonsData?.buttons?.find((b) => b.name === 'fechar');
  const frame = fecharBtn
    ? new Rectangle(fecharBtn.bbox.x1, fecharBtn.bbox.y1, fecharBtn.size.width, fecharBtn.size.height)
    : new Rectangle(1206, 297, 227, 234);

  const closeButton = new Texture({
    source: buttonsSheet.source,
    frame,
  });

  buttonsSheet.source.autoGenerateMipmaps = true;
  progressBack.source.autoGenerateMipmaps = true;
  progressFront.source.autoGenerateMipmaps = true;
  progressCallout.source.autoGenerateMipmaps = true;

  return { book, closeButton, recipes, progressBack, progressFront, progressCallout, calloutClock };
}

/**
 * `onProgress` recebe 0..1, como o callback do Assets.load do Pixi.
 *
 * Duas fases: primeiro o índice (manifestos), depois as texturas que ele aponta.
 * A barra cobre as duas, senão a arte apareceria carregando depois de 100%.
 */
export async function loadGameAssets(onProgress: (progress: number) => void): Promise<void> {
  const PESO_INDICE = 0.25;

  await Assets.load([...GAME_ASSET_URLS], (progress) => onProgress(progress * PESO_INDICE));

  artCache ??= IndoorArt.from(Assets.get(INDOOR_ART_URL) as unknown);
  const arquivos = artCache.files().map(indoorFileUrl);
  if (arquivos.length > 0) {
    await Assets.load(arquivos, (progress) => onProgress(PESO_INDICE + progress * (1 - PESO_INDICE)));
  }

  onProgress(1);
}
