import { Container, Graphics, NineSliceSprite, Rectangle, Sprite, Text, TextStyle, Texture } from 'pixi.js';

import { playRandomSfx } from '../../audio/sfx';
import { FONT_FAMILY } from '../../core/fonts';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';
import { SFX_BOOK_URLS, type RecipeBookTextures } from '../../game/asset-manifest';
import type { PlayerState } from '../../game/player-state';
import { recipeBookTime, recipeBookTimeLabel, type RecipeArt } from '../../game/recipes';
import { TOP_BAR_ICON_FRAMES } from './TopBars';
import { modalAnimationFrame, MODAL_OVERLAY_ALPHA, type ModalPhase } from './ModalAnimation';

export interface CookScreenTextures {
  book: RecipeBookTextures;
  closeButton?: Texture;
  /** Todas as receitas conhecidas; o livro mostra só as marcadas com inBook. */
  recipes?: RecipeArt[];
  progressBack?: Texture;
  progressFront?: Texture;
  progressCallout?: Texture;
  calloutClock?: Texture;
}

export type CookRecipeEvent = RecipeArt;
export type RecipeBookResource = 'cash' | 'gold' | 'energy';

export interface CookScreenModalOptions {
  textures: CookScreenTextures;
  playerState?: PlayerState;
  onClose?: () => void;
  onCookRecipe?: (recipe: CookRecipeEvent) => void;
  /** Botões Grana, Ouro e comprar da faixa de recursos; sem handler, ficam só como no original. */
  onResourceAction?: (resource: RecipeBookResource) => void;
  sfxUrls?: readonly string[];
}

type TabId = 'basic' | 'advanced' | 'specials' | 'favorites' | 'deluxe';

interface CardItem {
  inner: Container;
  highlight: Graphics;
  currentScale: number;
  targetScale: number;
}

/** Tempo antes de o painel da direita voltar à dica, para não piscar ao passar de um card a outro. */
const TIP_DELAY_MS = 160;
const FAVORITES_KEY = 'coffe-recipe-book-favorites';

/*
 * Medidas na folha do livro (book.png, 1448 × 1086), a mesma do clone e do original. A folha é
 * desenhada a 90%, com o tamanho visível do livro anterior: faixa de recursos e abas em cima,
 * página com 6 cards (2 × 3), lingueta das setas embaixo e o painel da direita, claro em cima
 * (nome, foto, tempo e custo) e escuro embaixo (ganhos).
 */
const SHEET = { width: 1448, height: 1086 };
const BOOK_SCALE = 0.9;
const BAND = { x: 53, y: 88, width: 895, height: 171 };
const PAGE = { x: 71, y: 279, width: 859, height: 714 };
const CARD = { width: 396, height: 199, columns: [86, 520], rows: [327, 550, 773] };
const ARROWS = { x: 500, y: 1040, size: 56, gap: 38 };
const DETAIL_CENTER_X = 1192;
const GAINS = { x: 1005, y: 692, width: 375, height: 303 };
const CLOSE = { x: 1388, y: 40, size: 56 };
const PER_PAGE = CARD.columns.length * CARD.rows.length;
/** Posições dentro do card (396 × 199), medidas no card do original a 53% da sua escala. */
const CARD_LAYOUT = {
  radius: 8,
  titleY: 28,
  photo: { x: 98, y: 126, width: 168, height: 128 },
  iconX: 219,
  clockRadius: 17,
  numberRight: 376,
  timeY: 88,
  xpY: 121,
  favorite: { x: 13, y: 146, size: 37 },
  cook: { x: 201, y: 144, width: 177, height: 42 },
} as const;
const COOK_BUTTON = {
  normal: { border: 0x0a2a0c, edge: 0x046b11, face: 0x029113 },
  hover: { border: 0x0a2a0c, edge: 0x05761a, face: 0x13a524 },
  press: { border: 0x0a2a0c, edge: 0x035c0e, face: 0x027d11 },
  disabled: { border: 0x4a4a4a, edge: 0x777777, face: 0x8f8f8f },
} as const;

const TABS: { id: TabId; label: string; minLevel?: number; locked?: boolean }[] = [
  { id: 'basic', label: 'Básico' },
  { id: 'advanced', label: 'Avançado', minLevel: 30 },
  { id: 'specials', label: 'Especiais', locked: true },
  { id: 'favorites', label: '★ Favoritos!' },
  { id: 'deluxe', label: 'Deluxe' },
];

const TIPS = [
  'Passe o mouse sobre um prato para ver o tempo, o custo e os ganhos.',
  'Use o + de um prato para guardá-lo na aba Favoritos!',
  'Pratos rápidos rendem pouco; os demorados dão mais XP e lucro por porção.',
];

/** Índices de TOP_BAR_ICON_FRAMES no atlas do HUD. */
const HUD_ICON = { cash: 0, gold: 1, xp: 2, energy: 3, crates: 4 } as const;

const COLORS = {
  cardTitleShadow: 0x6b4a1e,
  cardNumber: 0x573316,
  xpFill: 0xfaf69c,
  xpStroke: 0x48371c,
  xpHalo: 0xf3e3b9,
  favoriteBorder: 0x533a20,
  detailName: 0x5e4b3c,
  detailText: 0x5a4a3a,
  muted: 0x8b7a66,
  pill: 0xf3e6cc,
  pillShadow: 0xd9c4a0,
  green: 0x22931a,
  greenDark: 0x166b0f,
  tabText: 0xf3e6cf,
  tabTextShadow: 0x5a3e1e,
  warning: 0xb3261e,
} as const;

function style(options: ConstructorParameters<typeof TextStyle>[0]): TextStyle {
  return new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontWeight: '600', padding: 4, ...options });
}

/** Ajusta a textura dentro da caixa, sem distorcer, centralizada em (x, y). */
function containSprite(texture: Texture, x: number, y: number, maxWidth: number, maxHeight: number): Sprite {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.scale.set(Math.min(maxWidth / texture.width, maxHeight / texture.height));
  sprite.position.set(x, y);
  return sprite;
}

function readFavorites(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeFavorites(ids: readonly string[]): void {
  try { window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids)); } catch { /* Preferência local opcional. */ }
}

/**
 * Livro de Receitas aberto ao clicar no fogão, como no Café Mania original: recursos e abas em cima,
 * seis pratos por página com o botão Cozinhar e o painel da direita, que mostra o prato sob o mouse
 * (ou uma dica, quando nenhum está em foco). O servidor continua validando custo e preparo.
 */
export class CookScreenModal {
  readonly view = new Container();

  private readonly backdrop = new Graphics();
  private readonly window = new Container();
  private readonly closeButton = new Container();
  private readonly resources = new Container();
  private readonly tabs = new Container();
  private readonly page = new Container();
  private readonly arrows = new Container();
  private readonly detail = new Container();
  private readonly cardItems: CardItem[] = [];

  private readonly textures: RecipeBookTextures;
  private readonly recipes: RecipeArt[];
  private readonly hudIcons: Texture[];
  private readonly onCookRecipe?: (recipe: CookRecipeEvent) => void;
  private readonly onResourceAction?: (resource: RecipeBookResource) => void;
  private readonly onCloseCallback?: () => void;
  private readonly sfxUrls?: readonly string[];

  private playerState?: PlayerState;
  private favorites = readFavorites();
  private tab: TabId = 'basic';
  private pageIndex = 0;
  private shown: RecipeArt | null = null;
  private tipTimer = 0;
  private tip = TIPS[0];

  private state: ModalPhase = 'closed';
  private animTimer = 0;

  constructor(options: CookScreenModalOptions) {
    this.textures = options.textures.book;
    this.recipes = (options.textures.recipes ?? []).filter((recipe) => recipe.inBook);
    this.hudIcons = TOP_BAR_ICON_FRAMES.map((frame) => new Texture({
      source: this.textures.hudIcons.source,
      frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
    }));
    this.playerState = options.playerState;
    this.onCookRecipe = options.onCookRecipe;
    this.onResourceAction = options.onResourceAction;
    this.onCloseCallback = options.onClose;
    this.sfxUrls = options.sfxUrls ?? SFX_BOOK_URLS;
    this.view.label = 'cook-screen-modal';
    this.view.visible = false;

    this.backdrop.label = 'cook-modal-backdrop';
    this.backdrop.rect(-12000, -12000, 24000, 24000).fill({ color: 0x000000, alpha: 1 });
    this.backdrop.alpha = 0;
    this.backdrop.eventMode = 'static';
    this.backdrop.cursor = 'pointer';
    this.backdrop.hitArea = new Rectangle(-12000, -12000, 24000, 24000);
    this.backdrop.on('pointertap', () => this.close());
    this.view.addChild(this.backdrop);

    this.window.label = 'cook-modal-window';
    this.window.position.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2);
    this.window.pivot.set(SHEET.width / 2, SHEET.height / 2);

    const book = new Sprite(this.textures.book);
    book.label = 'cook-modal-book';
    // O livro absorve os cliques: só o fundo escurecido fecha.
    book.eventMode = 'static';
    this.window.addChild(book);

    this.resources.label = 'cook-modal-resources';
    this.tabs.label = 'cook-modal-tabs';
    this.page.label = 'cook-modal-page';
    this.arrows.label = 'cook-modal-arrows';
    this.detail.label = 'cook-modal-detail';
    this.window.addChild(this.resources, this.tabs, this.page, this.arrows, this.detail);

    this.setupCloseButton(options.textures.closeButton);
    this.window.addChild(this.closeButton);
    this.view.addChild(this.window);
    this.render();

    if (typeof window !== 'undefined') window.addEventListener('keydown', this.onKeyDown);
  }

  /** Recursos, nível e ouro disponível vêm do snapshot do servidor. */
  setPlayerState(state: PlayerState): void {
    this.playerState = state;
    this.renderResources();
    this.renderTabs();
    this.renderPage();
  }

  // ------------------------------------------------------------------ montagem

  private render(): void {
    this.renderResources();
    this.renderTabs();
    this.renderPage();
  }

  private renderResources(): void {
    this.resources.removeChildren().forEach((child) => child.destroy({ children: true }));
    const state = this.playerState;
    const columns: { icon: number; value: string; button?: [string, RecipeBookResource] }[] = [
      { icon: HUD_ICON.cash, value: String(state?.cash ?? 0), button: ['Grana', 'cash'] },
      { icon: HUD_ICON.gold, value: String(state?.gold ?? 0), button: ['Ouro', 'gold'] },
      { icon: HUD_ICON.crates, value: String(state?.crates.current ?? 0) },
      { icon: HUD_ICON.energy, value: String(state?.energy.current ?? 0), button: ['comprar', 'energy'] },
    ];
    const inner = { x: BAND.x + 20, width: BAND.width - 40 };
    const columnWidth = inner.width / columns.length;
    const valueStyle = style({ fontSize: 26, fill: 0x4a3320 });
    const buttonStyle = style({ fontSize: 22, fontWeight: '700', fill: 0xffffff, stroke: { color: COLORS.greenDark, width: 3, join: 'round' } });

    columns.forEach((column, index) => {
      const left = inner.x + index * columnWidth;
      if (index > 0) {
        this.resources.addChild(new Graphics().rect(left - 1, BAND.y + 14, 2, 104).fill({ color: 0xfff0d2, alpha: 0.3 }));
      }
      const pill = { x: left + 34, y: BAND.y + 18, width: columnWidth - 52, height: 40 };
      this.resources.addChild(new Graphics()
        .roundRect(pill.x, pill.y, pill.width, pill.height, 20).fill(0xfff8ec)
        .roundRect(pill.x, pill.y, pill.width, 5, 3).fill({ color: 0x000000, alpha: 0.08 }));
      this.resources.addChild(containSprite(this.hudIcons[column.icon], pill.x + 4, pill.y + pill.height / 2, 58, 52));
      const value = new Text({ text: column.value, style: valueStyle });
      value.anchor.set(0, 0.5);
      value.position.set(pill.x + 40, pill.y + pill.height / 2);
      this.resources.addChild(value);

      if (!column.button) return;
      const [label, resource] = column.button;
      const width = Math.min(pill.width, 170);
      const button = new Container();
      button.label = `cook-modal-buy-${resource}`;
      button.position.set(pill.x + (pill.width - width) / 2, BAND.y + 66);
      button.addChild(new Graphics()
        .roundRect(0, 0, width, 34, 7).fill(COLORS.greenDark)
        .roundRect(2, 2, width - 4, 30, 6).fill(COLORS.green)
        .roundRect(4, 3, width - 8, 12, 5).fill({ color: 0xffffff, alpha: 0.22 }));
      const text = new Text({ text: label, style: buttonStyle });
      text.anchor.set(0.5);
      text.position.set(width / 2, 17);
      button.addChild(text);
      if (this.onResourceAction) {
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointerover', () => { button.alpha = 0.9; });
        button.on('pointerout', () => { button.alpha = 1; });
        button.on('pointertap', (event) => { event.stopPropagation(); this.onResourceAction?.(resource); });
      }
      this.resources.addChild(button);
    });
  }

  private tabUnlocked(tab: (typeof TABS)[number]): boolean {
    if (tab.locked) return false;
    return !tab.minLevel || (this.playerState?.level ?? 1) >= tab.minLevel;
  }

  private renderTabs(): void {
    this.tabs.removeChildren().forEach((child) => child.destroy({ children: true }));
    const gap = 6;
    const width = (BAND.width - 40 - gap * (TABS.length - 1)) / TABS.length;
    const labelStyle = style({ fontSize: 23, fill: COLORS.tabText, stroke: { color: COLORS.tabTextShadow, width: 3, join: 'round' } });
    const activeStyle = style({ fontSize: 24, fill: 0xffffff, stroke: { color: 0xa4520c, width: 4, join: 'round' } });

    TABS.forEach((tab, index) => {
      const active = tab.id === this.tab;
      const unlocked = this.tabUnlocked(tab);
      const height = active ? 58 : 52;
      const button = new Container();
      button.label = `cook-modal-tab-${tab.id}`;
      button.position.set(BAND.x + 20 + index * (width + gap), BAND.y + BAND.height - height);
      const background = new NineSliceSprite({
        texture: active ? this.textures.tab.active : this.textures.tab.idle,
        leftWidth: 24, rightWidth: 24, topHeight: 24, bottomHeight: 12,
      });
      background.width = width;
      background.height = height;
      const label = new Text({ text: tab.label, style: active ? activeStyle : labelStyle });
      label.anchor.set(0.5);
      label.position.set(width / 2, height / 2 + 1);
      button.addChild(background, label);
      if (tab.locked) {
        label.x -= 14;
        button.addChild(this.padlock(label.x + label.width / 2 + 18, height / 2));
      }
      if (!unlocked) button.alpha = 0.6;
      else if (!active) {
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointerover', () => { background.texture = this.textures.tab.hover; });
        button.on('pointerout', () => { background.texture = this.textures.tab.idle; });
        button.on('pointertap', (event) => {
          event.stopPropagation();
          this.tab = tab.id;
          this.pageIndex = 0;
          this.renderTabs();
          this.renderPage();
        });
      }
      this.tabs.addChild(button);
    });
  }

  /** Cadeado desenhado: a arte do cadeado da aba Especiais ainda não foi recortada. */
  private padlock(x: number, y: number): Graphics {
    return new Graphics()
      .arc(x, y - 4, 7, Math.PI, 0).stroke({ color: 0x5a4632, width: 3 })
      .roundRect(x - 10, y - 4, 20, 15, 3).fill(0x8c7a64).stroke({ color: 0x5a4632, width: 2 });
  }

  private recipesOfTab(): RecipeArt[] {
    if (this.tab === 'favorites') {
      return this.favorites.map((id) => this.recipes.find((recipe) => recipe.id === id)).filter((recipe): recipe is RecipeArt => Boolean(recipe));
    }
    // O catálogo ainda não separa cardápios: todos os pratos do livro são do Básico.
    return this.tab === 'basic' ? this.recipes : [];
  }

  private renderPage(): void {
    this.page.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.cardItems.length = 0;
    const recipes = this.recipesOfTab();
    const pages = Math.max(1, Math.ceil(recipes.length / PER_PAGE));
    this.pageIndex = Math.min(this.pageIndex, pages - 1);
    const visible = recipes.slice(this.pageIndex * PER_PAGE, (this.pageIndex + 1) * PER_PAGE);
    if (this.shown && !visible.includes(this.shown)) this.shown = null;

    if (!visible.length) {
      const empty = new Text({
        text: this.tab === 'favorites'
          ? 'Nenhum prato favorito ainda.\nUse o + de um prato para guardá-lo aqui.'
          : 'Nenhum prato nesta aba ainda.',
        style: style({ fontSize: 28, fill: COLORS.muted, align: 'center', lineHeight: 40 }),
      });
      empty.anchor.set(0.5);
      empty.position.set(PAGE.x + PAGE.width / 2, PAGE.y + PAGE.height / 2);
      this.page.addChild(empty);
    }
    visible.forEach((recipe, index) => {
      const card = this.card(recipe);
      card.position.set(CARD.columns[index % CARD.columns.length], CARD.rows[Math.floor(index / CARD.columns.length)]);
      this.page.addChild(card);
    });
    this.renderArrows(pages);
    this.renderDetail();
  }

  private card(recipe: RecipeArt): Container {
    const { width, height } = CARD;
    const card = new Container();
    card.label = `cook-card-${recipe.id}`;
    card.eventMode = 'static';
    card.cursor = 'pointer';

    const inner = new Container();
    inner.pivot.set(width / 2, height / 2);
    inner.position.set(width / 2, height / 2);
    card.addChild(inner);

    // Card original (faixa caramelo com arabescos e painel claro), com os cantos arredondados do jogo.
    const background = new Sprite(this.textures.card);
    background.width = width;
    background.height = height;
    const corners = new Graphics().roundRect(0, 0, width, height, CARD_LAYOUT.radius).fill(0xffffff);
    background.mask = corners;
    const highlight = new Graphics().roundRect(0, 0, width, height, CARD_LAYOUT.radius).fill({ color: 0xffffff, alpha: 0.22 });
    highlight.visible = recipe === this.shown;
    inner.addChild(corners, background, highlight);

    const title = new Text({
      text: recipe.name,
      style: style({ fontSize: 26, fontWeight: '700', fill: 0xffffff,
        dropShadow: { color: COLORS.cardTitleShadow, alpha: 0.55, blur: 1, distance: 2, angle: Math.PI / 2 } }),
    });
    title.anchor.set(0.5);
    title.position.set(width / 2, CARD_LAYOUT.titleY);
    if (title.width > width - 120) title.scale.set((width - 120) / title.width);
    inner.addChild(title);

    inner.addChild(containSprite(recipe.stage2, CARD_LAYOUT.photo.x, CARD_LAYOUT.photo.y, CARD_LAYOUT.photo.width, CARD_LAYOUT.photo.height));

    const { iconX, numberRight, timeY, xpY } = CARD_LAYOUT;
    const numberStyle = style({ fontSize: 31, fontWeight: '700', fill: COLORS.cardNumber });
    // Mesmo relógio do painel da direita.
    const clockSize = CARD_LAYOUT.clockRadius * 2;
    inner.addChild(containSprite(this.textures.clock, iconX, timeY, clockSize, clockSize));
    const time = new Text({ text: recipeBookTimeLabel(recipe.durationSeconds), style: numberStyle });
    time.anchor.set(1, 0.5);
    time.position.set(numberRight, timeY);
    // "XP" amarelo com contorno marrom e um halo claro por fora: dois textos sobrepostos.
    const xpHalo = new Text({ text: 'XP', style: style({ fontSize: 25, fontWeight: '700', fill: COLORS.xpHalo, stroke: { color: COLORS.xpHalo, width: 10, join: 'round' } }) });
    const xpLabel = new Text({ text: 'XP', style: style({ fontSize: 25, fontWeight: '700', fill: COLORS.xpFill, stroke: { color: COLORS.xpStroke, width: 5, join: 'round' } }) });
    for (const label of [xpHalo, xpLabel]) {
      label.anchor.set(0.5);
      label.position.set(iconX, xpY);
    }
    const xp = new Text({ text: String(recipe.xp), style: numberStyle });
    xp.anchor.set(1, 0.5);
    xp.position.set(numberRight, xpY);
    inner.addChild(time, xpHalo, xpLabel, xp);

    inner.addChild(this.favoriteButton(recipe));
    inner.addChild(this.cookButton(recipe));

    const item: CardItem = { inner, highlight, currentScale: 1, targetScale: 1 };
    this.cardItems.push(item);
    const show = () => {
      this.tipTimer = 0;
      item.targetScale = 1.03;
      if (this.shown === recipe) return;
      this.shown = recipe;
      this.cardItems.forEach((other) => { other.highlight.visible = other === item; });
      this.renderDetail();
    };
    card.on('pointerover', show);
    // Toque mostra o prato; cozinhar fica só no botão, como no original.
    card.on('pointertap', (event) => { event.stopPropagation(); show(); });
    card.on('pointerout', () => {
      item.targetScale = 1;
      this.tipTimer = TIP_DELAY_MS;
    });
    return card;
  }

  private favoriteButton(recipe: RecipeArt): Container {
    const favorite = this.favorites.includes(recipe.id);
    const size = CARD_LAYOUT.favorite.size;
    const button = new Container();
    button.label = `cook-card-favorite-${recipe.id}`;
    button.position.set(CARD_LAYOUT.favorite.x, CARD_LAYOUT.favorite.y);
    // Caixa marrom do original: borda escura e preenchimento mais claro em cima, escurecendo para baixo.
    const [top, bottom] = favorite ? [0xf2b63a, 0xc98714] : [0x8e6f4f, 0x5c4128];
    const box = new Graphics()
      .roundRect(0, 0, size, size, 6).fill(COLORS.favoriteBorder)
      .roundRect(2, 2, size - 4, size - 4, 5).fill(bottom)
      .roundRect(2, 2, size - 4, (size - 4) * 0.62, 5).fill(top);
    // Marcas desenhadas, não glifos: as métricas da fonte deslocavam o + e a ★ do centro da caixa.
    // A estrela desce ~1 px porque as pontas de baixo (0,81·r) são mais curtas que a de cima.
    const c = size / 2, arm = 11, thick = 3.6;
    const mark = favorite
      ? new Graphics().star(c, c + 0.9, 5, 11, 4.8).fill(0xffffff)
      : new Graphics()
        .roundRect(c - arm, c - thick, arm * 2, thick * 2, 2).fill(0xffffff)
        .roundRect(c - thick, c - arm, thick * 2, arm * 2, 2).fill(0xffffff);
    button.addChild(box, mark);
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.on('pointertap', (event) => {
      event.stopPropagation();
      this.favorites = favorite ? this.favorites.filter((id) => id !== recipe.id) : [...this.favorites, recipe.id];
      writeFavorites(this.favorites);
      this.renderPage();
    });
    return button;
  }

  /** Por que o prato não pode ser cozido agora ('' se pode). O servidor confere o mesmo ouro. */
  private blockReason(recipe: RecipeArt): string {
    const gold = this.playerState?.gold;
    return gold !== undefined && gold < recipe.costGold ? 'caféOuros insuficientes' : '';
  }

  /**
   * Botão Cozinhar do card original, desenhado: verde chapado com borda escura chanfrada, faixas
   * mais escuras no alto e embaixo e o texto branco um pouco acima do meio.
   */
  private cookButton(recipe: RecipeArt): Container {
    const { x, y, width, height } = CARD_LAYOUT.cook;
    const button = new Container();
    button.label = `cook-card-cook-${recipe.id}`;
    button.position.set(x, y);
    const face = new Graphics();
    const draw = (palette: (typeof COOK_BUTTON)[keyof typeof COOK_BUTTON]) => {
      face.clear()
        .roundRect(0, 0, width, height, 7).fill(palette.border)
        .roundRect(2.5, 2.5, width - 5, height - 5, 5).fill(palette.edge)
        .roundRect(3.5, 3.5, width - 7, height - 7, 4.5).fill(palette.face)
        .rect(5, 3.5, width - 10, 3).fill({ color: palette.edge, alpha: 0.55 })
        .rect(5, height - 7.5, width - 10, 4).fill({ color: palette.edge, alpha: 0.7 });
    };
    const label = new Text({
      text: 'Cozinhar',
      style: style({ fontSize: 26, fontWeight: '700', fill: 0xffffff,
        dropShadow: { color: 0x053a08, alpha: 0.45, blur: 1, distance: 1.5, angle: Math.PI / 2 } }),
    });
    label.anchor.set(0.5);
    label.position.set(width / 2, height / 2 - 1);
    button.addChild(face, label);
    if (this.blockReason(recipe)) {
      draw(COOK_BUTTON.disabled);
      label.alpha = 0.75;
      return button;
    }
    draw(COOK_BUTTON.normal);
    button.eventMode = 'static';
    button.cursor = 'pointer';
    const press = (down: boolean) => { label.y = height / 2 - 1 + (down ? 1 : 0); };
    button.on('pointerover', () => draw(COOK_BUTTON.hover));
    button.on('pointerout', () => { draw(COOK_BUTTON.normal); press(false); });
    button.on('pointerdown', () => { draw(COOK_BUTTON.press); press(true); });
    button.on('pointerup', () => { draw(COOK_BUTTON.hover); press(false); });
    button.on('pointertap', (event) => {
      event.stopPropagation();
      this.close();
      this.onCookRecipe?.(recipe);
    });
    return button;
  }

  private renderArrows(pages: number): void {
    this.arrows.removeChildren().forEach((child) => child.destroy({ children: true }));
    for (const direction of [-1, 1]) {
      const arrow = new Sprite(this.textures.pageArrow);
      arrow.anchor.set(0.5);
      const scale = ARROWS.size / this.textures.pageArrow.height;
      // A arte aponta para a esquerda; a próxima página usa a mesma seta espelhada.
      arrow.scale.set(scale * -direction, scale);
      arrow.position.set(ARROWS.x + direction * ARROWS.gap, ARROWS.y);
      arrow.label = direction < 0 ? 'cook-modal-previous' : 'cook-modal-next';
      const enabled = this.pageIndex + direction >= 0 && this.pageIndex + direction < pages;
      arrow.alpha = enabled ? 1 : 0.4;
      if (enabled) {
        arrow.eventMode = 'static';
        arrow.cursor = 'pointer';
        arrow.on('pointertap', (event) => {
          event.stopPropagation();
          this.pageIndex += direction;
          this.renderPage();
        });
      }
      this.arrows.addChild(arrow);
    }
  }

  // ------------------------------------------------------------------ painel da direita

  private renderDetail(): void {
    this.detail.removeChildren().forEach((child) => child.destroy({ children: true }));
    const recipe = this.shown;
    if (!recipe) {
      this.renderTip();
      return;
    }
    const name = new Text({
      text: recipe.name,
      style: style({ fontSize: 40, fontWeight: '700', fill: COLORS.detailName, align: 'center', wordWrap: true, wordWrapWidth: 340, lineHeight: 44 }),
    });
    name.anchor.set(0.5, 0);
    name.position.set(DETAIL_CENTER_X, 282);
    this.detail.addChild(name);

    const photoY = name.y + name.height + 112;
    this.detail.addChild(containSprite(recipe.stage2, 1126, photoY, 230, 190));

    // Balão com o tempo, apontando para o relógio.
    const { value, unit } = recipeBookTime(recipe.durationSeconds);
    const balloon = { x: 1262, y: photoY - 96, width: 118, height: 86 };
    this.detail.addChild(new Graphics()
      .roundRect(balloon.x, balloon.y, balloon.width, balloon.height, 14).fill(0xffffff).stroke({ color: 0xb9b4ad, width: 4 })
      .poly([balloon.x + 50, balloon.y + balloon.height, balloon.x + 68, balloon.y + balloon.height, balloon.x + 59, balloon.y + balloon.height + 14])
      .fill(0xb9b4ad));
    const balloonValue = new Text({ text: value, style: style({ fontSize: 44, fontWeight: '700', fill: 0x4a4440 }) });
    balloonValue.anchor.set(0.5);
    balloonValue.position.set(balloon.x + balloon.width / 2, balloon.y + 34);
    const balloonUnit = new Text({ text: unit, style: style({ fontSize: 20, fontWeight: '700', fill: 0x4a4440 }) });
    balloonUnit.anchor.set(0.5);
    balloonUnit.position.set(balloon.x + balloon.width / 2, balloon.y + 68);
    this.detail.addChild(balloonValue, balloonUnit, containSprite(this.textures.clock, balloon.x + 59, balloon.y + balloon.height + 58, 84, 84));

    const buyY = 640;
    this.detail.addChild(new Graphics().roundRect(1028, buyY - 24, 343, 48, 12).fill({ color: 0x785a32, alpha: 0.12 }));
    this.detail.addChild(containSprite(this.hudIcons[HUD_ICON.gold], 1056, buyY, 34, 34));
    const buy = new Text({ text: `Compra por ${recipe.costGold} ouros`, style: style({ fontSize: 24, fontWeight: '700', fill: COLORS.detailText }) });
    buy.anchor.set(0, 0.5);
    buy.position.set(1082, buyY);
    if (buy.width > 280) buy.scale.set(280 / buy.width);
    this.detail.addChild(buy);

    // Parte escura: XP em destaque e os outros ganhos.
    this.detail.addChild(containSprite(this.hudIcons[HUD_ICON.xp], 1078, 758, 72, 72));
    const total = new Text({ text: 'Ganha no total', style: style({ fontSize: 24, fontWeight: '700', fill: COLORS.detailText }) });
    total.position.set(1124, 726);
    const xp = new Text({ text: `${recipe.xp} XP`, style: style({ fontSize: 36, fontWeight: '700', fill: COLORS.detailText }) });
    xp.position.set(1124, 754);
    const others = new Text({ text: 'Outros ganhos', style: style({ fontSize: 22, fill: COLORS.muted }) });
    others.position.set(1040, 822);
    this.detail.addChild(total, xp, others);

    const rows: [Container, string][] = [
      [this.portionsIcon(), `${recipe.portions} porções`],
      [containSprite(this.hudIcons[HUD_ICON.gold], 0, 0, 30, 30), `${recipe.profitGold} c/un.`],
    ];
    rows.forEach(([icon, text], index) => {
      const y = 884 + index * 56;
      this.detail.addChild(new Graphics().roundRect(1028, y - 23, 330, 46, 10).fill(0xf6ecd8));
      icon.position.set(1054, y);
      const label = new Text({ text, style: style({ fontSize: 24, fill: COLORS.detailText }) });
      label.anchor.set(0, 0.5);
      label.position.set(1080, y);
      this.detail.addChild(icon, label);
    });

    const reason = this.blockReason(recipe);
    if (reason) {
      const warning = new Text({ text: reason, style: style({ fontSize: 22, fontWeight: '700', fill: COLORS.warning }) });
      warning.anchor.set(0.5, 1);
      warning.position.set(GAINS.x + GAINS.width / 2, GAINS.y + GAINS.height - 2);
      this.detail.addChild(warning);
    }
  }

  /** Fatia de bolo das porções, desenhada: o ícone original ainda não foi recortado. */
  private portionsIcon(): Graphics {
    return new Graphics()
      .poly([-13, 8, 13, 8, 13, -2, -13, -8]).fill(0xf7e2b5).stroke({ color: 0x8a5a2b, width: 2 })
      .poly([-13, -8, 13, -2, 13, -7, -13, -13]).fill(0xe2574c).stroke({ color: 0x8a5a2b, width: 2 })
      .rect(-13, 1, 26, 3).fill(0xe2574c);
  }

  /** Sem prato em foco, o painel mostra uma dica, como o "Sabia que...?" do original. */
  private renderTip(): void {
    const title = new Text({ text: 'Sabia que...?', style: style({ fontSize: 40, fontWeight: '700', fill: COLORS.detailName }) });
    title.anchor.set(0.5, 0);
    title.position.set(DETAIL_CENTER_X, 290);
    const tip = new Text({
      text: this.tip,
      style: style({ fontSize: 28, fill: COLORS.detailText, align: 'center', wordWrap: true, wordWrapWidth: 330, lineHeight: 38 }),
    });
    tip.anchor.set(0.5, 0);
    tip.position.set(DETAIL_CENTER_X, 370);
    const photo = this.recipes[0] ? containSprite(this.recipes[0].stage2, DETAIL_CENTER_X, 600, 210, 150) : null;
    if (photo) photo.alpha = 0.9;
    this.detail.addChild(title, tip, ...(photo ? [photo] : []));
  }

  // ------------------------------------------------------------------ janela

  private setupCloseButton(closeButtonTexture?: Texture): void {
    this.closeButton.label = 'cook-close-button';
    this.closeButton.position.set(CLOSE.x, CLOSE.y);
    this.closeButton.eventMode = 'static';
    this.closeButton.cursor = 'pointer';

    if (closeButtonTexture) {
      const sprite = new Sprite(closeButtonTexture);
      sprite.label = 'cook-close-sprite';
      sprite.anchor.set(0.5, 0.5);
      sprite.width = CLOSE.size;
      sprite.height = CLOSE.size * closeButtonTexture.height / closeButtonTexture.width;
      this.closeButton.addChild(sprite);
    } else {
      this.closeButton.addChild(new Graphics()
        .circle(0, 0, 22).fill({ color: 0xcc3333 }).stroke({ color: 0xffffff, width: 3 })
        .moveTo(-8, -8).lineTo(8, 8).stroke({ color: 0xffffff, width: 3, cap: 'round' })
        .moveTo(8, -8).lineTo(-8, 8).stroke({ color: 0xffffff, width: 3, cap: 'round' }));
    }
    this.closeButton.on('pointerover', () => this.closeButton.scale.set(1.1));
    this.closeButton.on('pointerout', () => this.closeButton.scale.set(1));
    this.closeButton.on('pointertap', (e) => {
      e.stopPropagation();
      this.close();
    });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isOpen) this.close();
  };

  get isOpen(): boolean {
    return this.state !== 'closed';
  }

  open(): void {
    if (this.state === 'open' || this.state === 'opening') return;
    if (this.sfxUrls && this.sfxUrls.length > 0) playRandomSfx(this.sfxUrls);

    this.tab = 'basic';
    this.pageIndex = 0;
    this.shown = null;
    this.tipTimer = 0;
    this.tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    this.favorites = readFavorites();
    this.render();

    this.state = 'opening';
    this.animTimer = 0;
    this.view.visible = true;
    this.backdrop.alpha = 0;
    this.window.alpha = 0;
    this.window.scale.set(0.7 * BOOK_SCALE);
  }

  close(): void {
    if (this.state === 'closed' || this.state === 'closing') return;
    this.state = 'closing';
    this.animTimer = 0;
    this.onCloseCallback?.();
  }

  update(deltaMs: number): void {
    for (const item of this.cardItems) {
      if (Math.abs(item.currentScale - item.targetScale) > 0.0005) {
        item.currentScale += (item.targetScale - item.currentScale) * (1 - Math.exp(-deltaMs / 70));
        item.inner.scale.set(item.currentScale);
      } else if (item.currentScale !== item.targetScale) {
        item.currentScale = item.targetScale;
        item.inner.scale.set(item.targetScale);
      }
    }
    if (this.tipTimer > 0) {
      this.tipTimer -= deltaMs;
      if (this.tipTimer <= 0 && this.shown) {
        this.shown = null;
        this.cardItems.forEach((item) => { item.highlight.visible = false; });
        this.renderDetail();
      }
    }

    if (this.state === 'closed') return;
    this.animTimer += deltaMs;

    if (this.state === 'opening') {
      const frame = modalAnimationFrame('opening', this.animTimer);
      this.window.scale.set(frame.scale * BOOK_SCALE);
      this.window.alpha = frame.alpha;
      this.backdrop.alpha = frame.backdropAlpha;
      if (frame.finished) {
        this.state = 'open';
        this.window.scale.set(BOOK_SCALE);
        this.window.alpha = 1;
        this.backdrop.alpha = MODAL_OVERLAY_ALPHA;
      }
    } else if (this.state === 'closing') {
      const frame = modalAnimationFrame('closing', this.animTimer);
      this.window.scale.set(frame.scale * BOOK_SCALE);
      this.window.alpha = frame.alpha;
      this.backdrop.alpha = frame.backdropAlpha;
      if (frame.finished) {
        this.state = 'closed';
        this.view.visible = false;
        this.window.scale.set(0.7 * BOOK_SCALE);
        this.window.alpha = 0;
        this.backdrop.alpha = 0;
      }
    }
  }

  destroy(): void {
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKeyDown);
    this.hudIcons.forEach((texture) => texture.destroy(false));
    this.view.destroy({ children: true });
  }
}
