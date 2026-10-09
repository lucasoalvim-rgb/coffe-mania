import { Container, Graphics, Rectangle, Sprite, Text, TextStyle, type Texture } from 'pixi.js';

import { playRandomSfx } from '../../audio/sfx';
import { FONT_FAMILY } from '../../core/fonts';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';
import { SFX_BOOK_URLS } from '../../game/asset-manifest';
import { recipeTimeLabel, type RecipeArt } from '../../game/recipes';

export interface CookScreenTextures {
  cookScreen: Texture;
  foodCard: Texture;
  closeButton?: Texture;
  /** Todas as receitas conhecidas; o livro mostra só as marcadas com inBook. */
  recipes?: RecipeArt[];
  progressBack?: Texture;
  progressFront?: Texture;
  progressCallout?: Texture;
  calloutClock?: Texture;
}

export type CookRecipeEvent = RecipeArt;

export interface CookScreenModalOptions {
  textures: CookScreenTextures;
  onClose?: () => void;
  onCookRecipe?: (recipe: CookRecipeEvent) => void;
  sfxUrls?: readonly string[];
}

type ModalState = 'closed' | 'opening' | 'open' | 'closing';

interface CardItem {
  container: Container;
  inner: Container;
  sprite: Sprite;
  currentScale: number;
  targetScale: number;
}

const OPEN_DURATION_MS = 260;
const CLOSE_DURATION_MS = 200;
const OVERLAY_MAX_ALPHA = 0.65;

const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number): number => t * t * t;

/**
 * Modal do Livro de Receitas aberto ao clicar no fogão.
 *
 * Exibe o fundo escurecido e a janela cook_screen com 6 cards em 2 colunas x 3 linhas,
 * com animação de zoom in ao abrir e zoom out ao fechar. Cada card segue o do original:
 * porções, lucro por unidade, XP, tempo de preparo e custo.
 */
export class CookScreenModal {
  readonly view = new Container();

  private readonly backdrop = new Graphics();
  private readonly window = new Container();
  private readonly cards: Container[] = [];
  private readonly cardItems: CardItem[] = [];
  private readonly closeButton = new Container();

  private state: ModalState = 'closed';
  private animTimer = 0;
  private readonly onCloseCallback?: () => void;
  private readonly sfxUrls?: readonly string[];

  constructor(options: CookScreenModalOptions) {
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
    this.window.sortableChildren = true;
    this.window.position.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2);
    this.window.pivot.set(836, 470.5);

    const bg = new Sprite(options.textures.cookScreen);
    bg.label = 'cook-modal-bg';
    bg.zIndex = 0;
    this.window.addChild(bg);

    // Área detectada em cook_screen.png: x=[236, 1041], y=[236, 863] (805 x 627)
    // Dimensões de inside_food_card.png: 1440 x 720 (proporção 2:1)
    const cardTexture = options.textures.foodCard;

    const panelX = 236;
    const panelY = 236;
    const padX = 22;
    const padY = 15;
    const gapX = 21;
    const gapY = 21;
    const cardW = 370;
    const cardH = 185;
    const cornerRadius = 14;
    const bookRecipes = (options.textures.recipes ?? []).filter((recipe) => recipe.inBook);
    const infoStyle = new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 16, fontWeight: '600', fill: 0x603a1e, padding: 2 });

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        const cardIndex = row * 2 + col;
        const card = new Container();
        card.label = `cook-card-${cardIndex + 1}`;
        card.position.set(
          panelX + padX + col * (cardW + gapX),
          panelY + padY + row * (cardH + gapY),
        );
        card.eventMode = 'static';
        card.cursor = 'pointer';
        card.zIndex = 1;

        const inner = new Container();
        inner.label = `cook-card-inner-${cardIndex + 1}`;
        inner.position.set(cardW / 2, cardH / 2);
        inner.pivot.set(cardW / 2, cardH / 2);

        const sprite = new Sprite(cardTexture);
        sprite.label = `cook-card-sprite-${cardIndex + 1}`;
        sprite.width = cardW;
        sprite.height = cardH;

        const mask = new Graphics();
        mask.label = `cook-card-mask-${cardIndex + 1}`;
        mask.roundRect(0, 0, cardW, cardH, cornerRadius).fill(0xffffff);

        inner.mask = mask;
        inner.addChild(mask, sprite);

        const recipe = bookRecipes[cardIndex];
        if (recipe) {
          // Título centralizado na barra escura superior (y=23, entre os arabescos laterais)
          const title = new Text({
            text: recipe.name,
            style: new TextStyle({
              fontFamily: [FONT_FAMILY, 'sans-serif'],
              fontSize: 18,
              fontWeight: '600',
              fill: 0xfffcf5,
              stroke: { color: 0x5a3915, width: 3, join: 'round' },
              padding: 4,
            }),
          });
          title.label = `cook-card-title-${cardIndex + 1}`;
          title.anchor.set(0.5, 0.5);
          title.position.set(cardW / 2, 23);
          inner.addChild(title);

          // Card do original: prato numa tábua, preço embaixo; porções, lucro, XP e tempo em faixas.
          const board = new Graphics().roundRect(14, 54, 124, 120, 10).fill(0x8a5a2b);
          board.label = `cook-card-board-${cardIndex + 1}`;
          inner.addChild(board);

          const dish = new Sprite(recipe.stage2);
          dish.label = `cook-card-dish-${recipe.id}`;
          dish.anchor.set(0.5, 0.5);
          dish.width = 104;
          dish.height = 104;
          dish.position.set(76, 104);
          inner.addChild(dish);

          const price = new Container();
          price.label = `cook-card-price-${cardIndex + 1}`;
          price.position.set(40, 146);
          const priceText = new Text({ text: String(recipe.costGold), style: infoStyle });
          priceText.anchor.set(0, 0.5);
          priceText.position.set(30, 12);
          price.addChild(
            new Graphics().roundRect(0, 0, 40 + priceText.width, 24, 12).fill(0xfff8e8).stroke({ color: 0x8a5a2b, width: 2 }),
            new Graphics().circle(15, 12, 8).fill(0xf2c230).stroke({ color: 0xb07c12, width: 2 }),
            priceText,
          );
          inner.addChild(price);

          const lines = [
            `${recipe.portions} porções`,
            `Lucros: ${recipe.profitGold} c/un.`,
            `XP: ${recipe.xp}`,
            `Pronto: ${recipeTimeLabel(recipe.durationSeconds)}`,
          ];
          lines.forEach((line, index) => {
            const row = new Graphics().roundRect(148, 56 + index * 30, 206, 26, 6).fill(0xf3dfae);
            row.label = `cook-card-row-${cardIndex + 1}-${index}`;
            const info = new Text({ text: line, style: infoStyle });
            info.label = `cook-card-info-${cardIndex + 1}-${index}`;
            info.anchor.set(0, 0.5);
            info.position.set(158, 69 + index * 30);
            inner.addChild(row, info);
          });

          card.on('pointertap', (e) => {
            e.stopPropagation();
            this.close();
            options.onCookRecipe?.(recipe);
          });
        }

        card.addChild(inner);

        const cardItem: CardItem = {
          container: card,
          inner,
          sprite,
          currentScale: 1.0,
          targetScale: 1.0,
        };

        card.on('pointerover', () => {
          cardItem.targetScale = 1.04;
          sprite.tint = 0xfff5ea;
          card.zIndex = 10;
        });
        card.on('pointerout', () => {
          cardItem.targetScale = 1.0;
          sprite.tint = 0xffffff;
          card.zIndex = 1;
        });

        this.cards.push(card);
        this.cardItems.push(cardItem);
        this.window.addChild(card);
      }
    }

    this.setupCloseButton(options.textures.closeButton);
    this.window.addChild(this.closeButton);

    this.view.addChild(this.window);

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
    }
  }

  private setupCloseButton(closeButtonTexture?: Texture): void {
    this.closeButton.label = 'cook-close-button';
    // Metade do botão para fora da janela e metade para dentro na borda superior (y=27)
    this.closeButton.position.set(1448, 27);
    this.closeButton.zIndex = 20;
    this.closeButton.eventMode = 'static';
    this.closeButton.cursor = 'pointer';

    if (closeButtonTexture) {
      const sprite = new Sprite(closeButtonTexture);
      sprite.label = 'cook-close-sprite';
      sprite.anchor.set(0.5, 0.5);
      sprite.width = 50;
      sprite.height = 52;
      this.closeButton.addChild(sprite);

      this.closeButton.on('pointerover', () => {
        this.closeButton.scale.set(1.1);
      });
      this.closeButton.on('pointerout', () => {
        this.closeButton.scale.set(1.0);
      });
    } else {
      const bg = new Graphics();
      bg.circle(0, 0, 20).fill({ color: 0xcc3333 }).stroke({ color: 0xffffff, width: 3 });
      bg.moveTo(-7, -7).lineTo(7, 7).stroke({ color: 0xffffff, width: 3, cap: 'round' });
      bg.moveTo(7, -7).lineTo(-7, 7).stroke({ color: 0xffffff, width: 3, cap: 'round' });

      this.closeButton.addChild(bg);

      this.closeButton.on('pointerover', () => {
        this.closeButton.scale.set(1.12);
      });
      this.closeButton.on('pointerout', () => {
        this.closeButton.scale.set(1.0);
      });
    }

    this.closeButton.on('pointertap', (e) => {
      e.stopPropagation();
      this.close();
    });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isOpen) {
      this.close();
    }
  };

  get isOpen(): boolean {
    return this.state !== 'closed';
  }

  open(): void {
    if (this.state === 'open' || this.state === 'opening') return;

    if (this.sfxUrls && this.sfxUrls.length > 0) {
      playRandomSfx(this.sfxUrls);
    }

    this.state = 'opening';
    this.animTimer = 0;
    this.view.visible = true;
    this.backdrop.alpha = 0;
    this.window.alpha = 0;
    this.window.scale.set(0.7);
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
        const factor = 1 - Math.exp(-deltaMs / 70);
        item.currentScale += (item.targetScale - item.currentScale) * factor;
        item.inner.scale.set(item.currentScale);
      } else if (item.currentScale !== item.targetScale) {
        item.currentScale = item.targetScale;
        item.inner.scale.set(item.targetScale);
      }
    }

    if (this.state === 'closed') return;

    this.animTimer += deltaMs;

    if (this.state === 'opening') {
      const progress = Math.min(1, this.animTimer / OPEN_DURATION_MS);
      const scale = 0.7 + 0.3 * easeOutBack(progress);
      const alpha = easeOutCubic(progress);

      this.window.scale.set(scale);
      this.window.alpha = alpha;
      this.backdrop.alpha = OVERLAY_MAX_ALPHA * progress;

      if (progress >= 1) {
        this.state = 'open';
        this.window.scale.set(1);
        this.window.alpha = 1;
        this.backdrop.alpha = OVERLAY_MAX_ALPHA;
      }
    } else if (this.state === 'closing') {
      const progress = Math.min(1, this.animTimer / CLOSE_DURATION_MS);
      const scale = 1 - 0.25 * easeInCubic(progress);
      const alpha = Math.max(0, 1 - progress);

      this.window.scale.set(scale);
      this.window.alpha = alpha;
      this.backdrop.alpha = Math.max(0, OVERLAY_MAX_ALPHA * (1 - progress));

      if (progress >= 1) {
        this.state = 'closed';
        this.view.visible = false;
        this.window.scale.set(0.7);
        this.window.alpha = 0;
        this.backdrop.alpha = 0;
      }
    }
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
    this.view.destroy({ children: true });
  }
}
