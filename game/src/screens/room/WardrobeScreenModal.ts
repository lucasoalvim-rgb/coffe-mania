import { Assets, Container, Graphics, Rectangle, Sprite, Text, TextStyle, Texture } from 'pixi.js';

import type { AvatarRenderer } from '../../avatar/AvatarRenderer';
import { parseAtlas, type AtlasFile } from '../../avatar/AvatarTexture';
import { CLIP, CLIP_DELAY_MULTIPLIER, CLIP_FRAME_RANGE, DEFAULT_FRAME_DELAY } from '../../avatar/clips';
import { resolveLook, type Look, type Wardrobe, type WardrobeItem } from '../../avatar/wardrobe';
import { restoreAppearance, serializeAppearance } from '../../avatar/appearance';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';
import { FONT_FAMILY } from '../../core/font-tokens';
import { AVATAR_URLS, loadAvatarAssets, type ActionBarButtonTextures } from '../../game/asset-manifest';
import { CATEGORY_PULSE_DURATION_MS, drawCategorySelectionPulse } from './CategorySelectionPulse';
import './wardrobe-colour-editor.css';

export interface WardrobeScreenTextures {
  light1: Texture;
  wardrobe: Texture;
  light2: Texture;
  bar: Texture;
  icons: readonly Texture[];
  pageButtons?: ActionBarButtonTextures;
  closeButton?: Texture;
}

export interface WardrobePersistenceOptions {
  appearance?: string;
  onConfirm?: (look: Look) => Promise<string>;
}

const AVATAR_DISPLAY_SIZE = 705 * 1.15;
const AVATAR_CAMERA_PITCH = 18;
const [IDLE_FIRST_FRAME, IDLE_LAST_FRAME] = CLIP_FRAME_RANGE[CLIP.IDLE];
const IDLE_FRAME_COUNT = IDLE_LAST_FRAME - IDLE_FIRST_FRAME + 1;
const IDLE_FRAME_MS = DEFAULT_FRAME_DELAY * CLIP_DELAY_MULTIPLIER[CLIP.IDLE];
const WARDROBE_ICON_NAMES = [
  'eye', 'eyebrow', 'mouth', 'hair', 'moustache', 'hat', 'glasses', 'pants', 'shirt', 'sneaker',
] as const;
const ITEM_GROUPS = [
  ['Eyes'], ['Eyebrows'], ['Mouth'], ['Hair'], ['Facial Hair'],
  ['Hat'], ['Miscellaneous'], ['Pants', 'Skirt'], ['Shirt'], [],
] as const;
const ITEMS_PER_PAGE = 14;
/** Só estes grupos podem usar a textura pintada como ícone; roupas têm UVs abertos. */
const PAINTED_ICON_BOUNDS: Record<string, { width: number; height: number; maxScale: number }> = {
  Eyes: { width: 76, height: 36, maxScale: 2 },
  Eyebrows: { width: 76, height: 28, maxScale: 2 },
  Mouth: { width: 54, height: 40, maxScale: 3 },
  'Facial Hair': { width: 64, height: 44, maxScale: 2 },
  Miscellaneous: { width: 64, height: 60, maxScale: 2 },
  Glasses: { width: 76, height: 44, maxScale: 2 },
};
const ITEM_SIZE = 96;
const GRID_X = 422;
const GRID_Y = 666;
const GRID_STEP = 110;
const COLOUR_PANEL_WIDTH = 390;
const COLOUR_PANEL_HEIGHT = 318;
const COLOUR_PANEL_GAP = 16;
const COLOUR_SWATCH_SIZE = 50;
const CUSTOM_COLOURS_PER_GROUP = 4;
const CONFIRM_BUTTON_WIDTH = 226;
const CONFIRM_BUTTON_HEIGHT = 68;
const CONFIRM_BUTTON_SCALE = 0.575;
type PageAction = 'previous' | 'first' | 'next' | 'last';
type ColourGroup = 'SkinColour' | 'HairColour';

/** Guarda-roupa sobre toda a janela, independente do zoom do mapa. */
export class WardrobeScreenModal {
  readonly view = new Container();

  private readonly background = new Container();
  private readonly upperBackground = new Graphics();
  private readonly lowerBackground = new Graphics();
  private readonly upperLight: Sprite;
  private readonly wardrobe: Sprite;
  private readonly avatar = new Sprite(Texture.EMPTY);
  private readonly lowerLight: Sprite;
  private readonly bar: Sprite;
  private readonly barIcons = new Container();
  private readonly categoryIconHolders: Container[] = [];
  private readonly categorySelectionEffect = new Graphics();
  private readonly itemPanel = new Container();
  private readonly colourPanels = new Container();
  private readonly colourGrids = new Map<ColourGroup, Container>();
  private readonly customColourGrids = new Map<ColourGroup, Container>();
  private readonly customColours: Record<ColourGroup, Array<number | null>> = {
    SkinColour: Array<number | null>(CUSTOM_COLOURS_PER_GROUP).fill(null),
    HairColour: Array<number | null>(CUSTOM_COLOURS_PER_GROUP).fill(null),
  };
  private colourEditor: HTMLDivElement | null = null;
  private readonly itemCells: Array<{ frame: Graphics; contents: Container; holder: Container }> = [];
  private readonly pageControls: Array<{ holder: Container; action: PageAction }> = [];
  private readonly itemIconCache = new Map<string, Texture>();
  private readonly closeButton = new Container();
  private readonly confirmButton = new Container();
  private readonly confirmFrame = new Graphics();
  private confirmEdited = false;
  private confirmDesaturated: boolean | null = null;
  private readonly confirmStatus = new Text({ text: '', style: new TextStyle({
    fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 18, fill: 0x603a1e,
  }) });
  private confirmSaving = false;
  private savedAppearance = '';
  private lookDirty = false;
  private confirmHovered = false;
  private confirmPressed = false;
  private closeBaseScale = 1;
  private closeHovered = false;
  private closePressed = false;
  private avatarRenderer: AvatarRenderer | null = null;
  private avatarTexture: Texture | null = null;
  private avatarLoad: Promise<void> | null = null;
  private wardrobeData: Wardrobe | null = null;
  private look: Look | null = null;
  private itemAtlas: AtlasFile | null = null;
  private itemAtlasTexture: Texture | null = null;
  private categoryIndex = 8;
  private categoryPulseMs = 0;
  private categoryPulseDrawMs = 0;
  private pageIndex = 0;
  private avatarDirection = 0;
  private avatarDirty = false;
  private idleElapsedMs = 0;
  private idleFrameOffset = 0;
  private avatarDrag: { pointerId: number; x: number; direction: number } | null = null;
  private disposed = false;
  private stageScale = 1;

  constructor(
    textures: WardrobeScreenTextures,
    private readonly onVisibilityChange?: (open: boolean) => void,
    private readonly persistence: WardrobePersistenceOptions = {},
  ) {
    this.savedAppearance = persistence.appearance ?? '';
    this.view.label = 'wardrobe-screen-modal';
    this.view.visible = false;
    this.view.eventMode = 'static';
    this.view.on('pointerdown', (event) => event.stopPropagation());
    this.view.on('pointerup', (event) => event.stopPropagation());
    this.view.on('pointertap', (event) => event.stopPropagation());
    this.view.on('wheel', (event) => event.stopPropagation());

    this.upperLight = new Sprite(textures.light1);
    this.wardrobe = new Sprite(textures.wardrobe);
    this.lowerLight = new Sprite(textures.light2);
    this.bar = new Sprite(textures.bar);
    this.bar.label = 'wardrobe-bottom-bar';
    this.bar.eventMode = 'none';
    this.barIcons.label = 'wardrobe-bottom-bar-icons';
    this.categorySelectionEffect.eventMode = 'none';
    textures.icons.forEach((texture, index) => {
      const holder = new Container();
      holder.label = `wardrobe-icon-${WARDROBE_ICON_NAMES[index] ?? index}`;
      // A borda superior da faixa estreita fica em y≈592 no asset.
      holder.position.set(496 + index * 86, 594);
      holder.eventMode = 'static';
      holder.cursor = 'pointer';
      holder.hitArea = new Rectangle(-38, -38, 76, 76);
      const icon = new Sprite(texture);
      icon.anchor.set(0.5);
      const isGlasses = WARDROBE_ICON_NAMES[index] === 'glasses';
      const baseScale = Math.min((isGlasses ? 74 : 64) / texture.width, (isGlasses ? 71 : 62) / texture.height);
      icon.scale.set(baseScale);
      icon.eventMode = 'none';
      const shadow = new Graphics();
      const shadowY = 29;
      const shadowRadius = Math.max(23, icon.width * 0.45);
      shadow.ellipse(0, shadowY, shadowRadius + 7, 6)
        .fill({ color: 0x202026, alpha: 0.11 });
      shadow.ellipse(0, shadowY, shadowRadius, 4)
        .fill({ color: 0x202026, alpha: 0.19 });
      shadow.eventMode = 'none';
      holder.addChild(shadow, icon);
      let hovered = false;
      let pressed = false;
      const syncFeedback = () => icon.scale.set(baseScale * (pressed ? 0.9 : hovered ? 1.1 : 1));
      holder.on('pointerover', () => { hovered = true; syncFeedback(); });
      holder.on('pointerout', () => { hovered = false; pressed = false; syncFeedback(); });
      holder.on('pointerdown', (event) => { event.stopPropagation(); pressed = true; syncFeedback(); });
      holder.on('pointerup', () => { pressed = false; syncFeedback(); });
      holder.on('pointerupoutside', () => { pressed = false; syncFeedback(); });
      holder.on('pointertap', (event) => {
        event.stopPropagation();
        this.categoryIndex = index;
        this.pageIndex = 0;
        this.syncCategorySelection();
        this.renderItemGrid();
      });
      this.categoryIconHolders.push(holder);
      this.barIcons.addChild(holder);
    });
    this.syncCategorySelection();
    this.buildItemPanel(textures.pageButtons);
    this.buildColourPanels();
    this.buildConfirmButton();
    this.upperBackground.label = 'wardrobe-upper-background';
    this.upperLight.label = 'wardrobe-light-1';
    this.lowerBackground.label = 'wardrobe-lower-background';
    this.wardrobe.label = 'wardrobe-art';
    this.avatar.label = 'wardrobe-live-avatar';
    this.avatar.visible = false;
    this.avatar.anchor.set(0.5, 0.88);
    this.avatar.eventMode = 'static';
    this.avatar.cursor = 'grab';
    this.avatar.on('pointerdown', (event) => {
      event.stopPropagation();
      this.avatarDrag = { pointerId: event.pointerId, x: event.global.x, direction: this.avatarDirection };
      this.avatar.cursor = 'grabbing';
    });
    this.view.on('globalpointermove', (event) => {
      const drag = this.avatarDrag;
      if (!drag || drag.pointerId !== event.pointerId || !this.isOpen) return;
      this.avatarDirection = drag.direction + (event.global.x - drag.x) / 80;
      this.avatarDirty = true;
    });
    this.avatar.on('pointerup', this.endAvatarDrag);
    this.avatar.on('pointerupoutside', this.endAvatarDrag);
    this.lowerLight.label = 'wardrobe-light-2';
    for (const layer of [this.upperBackground, this.upperLight, this.lowerBackground, this.wardrobe, this.lowerLight]) {
      layer.eventMode = 'none';
    }
    this.wardrobe.anchor.set(0.5);
    this.background.label = 'wardrobe-static-background';
    this.background.eventMode = 'none';
    this.background.addChild(
      this.upperBackground, this.upperLight, this.lowerBackground, this.wardrobe,
      this.lowerLight,
    );
    this.view.addChild(
      this.background, this.colourPanels, this.avatar, this.bar, this.itemPanel, this.barIcons,
    );

    this.closeButton.label = 'wardrobe-close-button';
    this.closeButton.eventMode = 'static';
    this.closeButton.cursor = 'pointer';
    this.closeButton.hitArea = new Rectangle(-32, -32, 64, 64);
    if (textures.closeButton) {
      const icon = new Sprite(textures.closeButton);
      icon.anchor.set(0.5);
      icon.scale.set(56 / Math.max(textures.closeButton.width, textures.closeButton.height));
      this.closeButton.addChild(icon);
    } else {
      const icon = new Graphics();
      icon.circle(0, 0, 26).fill(0xcc3333).stroke({ color: 0xffffff, width: 3 });
      icon.moveTo(-9, -9).lineTo(9, 9).moveTo(9, -9).lineTo(-9, 9)
        .stroke({ color: 0xffffff, width: 4, cap: 'round' });
      this.closeButton.addChild(icon);
    }
    this.closeButton.on('pointerover', () => { this.closeHovered = true; this.syncCloseFeedback(); });
    this.closeButton.on('pointerout', () => {
      this.closeHovered = false;
      this.closePressed = false;
      this.syncCloseFeedback();
    });
    this.closeButton.on('pointerdown', (event) => {
      event.stopPropagation();
      this.closePressed = true;
      this.syncCloseFeedback();
    });
    this.closeButton.on('pointerup', () => { this.closePressed = false; this.syncCloseFeedback(); });
    this.closeButton.on('pointerupoutside', () => { this.closePressed = false; this.syncCloseFeedback(); });
    this.closeButton.on('pointertap', (event) => { event.stopPropagation(); this.close(); });
    this.view.addChild(this.closeButton);

    this.setStageScale(1);
    if (typeof window !== 'undefined') window.addEventListener('keydown', this.onKeyDown);
  }

  get isOpen(): boolean {
    return this.view.visible;
  }

  open(): void {
    if (this.isOpen) return;
    this.categoryPulseMs = 0;
    this.drawCategorySelection();
    this.idleElapsedMs = 0;
    this.idleFrameOffset = 0;
    if (this.avatarRenderer) {
      this.avatarRenderer.setFrame(IDLE_FIRST_FRAME);
      this.renderAvatar();
    }
    this.closeHovered = false;
    this.closePressed = false;
    this.syncCloseFeedback();
    this.confirmHovered = false;
    this.confirmPressed = false;
    this.confirmEdited = false;
    if (!this.confirmSaving) this.confirmStatus.text = '';
    this.syncConfirmFeedback();
    this.view.visible = true;
    this.onVisibilityChange?.(true);
    void this.ensureAvatar().catch((error) => {
      console.warn('[wardrobe-avatar] modelo 3D indisponível', error);
      this.avatarLoad = null;
    });
  }

  close(): void {
    if (!this.isOpen) return;
    this.closeColourEditor();
    this.view.visible = false;
    this.endAvatarDrag();
    this.onVisibilityChange?.(false);
  }

  update(deltaMs: number): void {
    if (!this.isOpen) return;
    const elapsedMs = Math.max(0, deltaMs);
    this.categoryPulseMs = (this.categoryPulseMs + elapsedMs) % CATEGORY_PULSE_DURATION_MS;
    this.categoryPulseDrawMs += elapsedMs;
    if (this.categoryPulseDrawMs >= 50) {
      this.categoryPulseDrawMs %= 50;
      this.drawCategorySelection();
    }
    if (!this.avatarRenderer) return;
    this.idleElapsedMs += elapsedMs;
    if (this.idleElapsedMs >= IDLE_FRAME_MS) {
      const steps = Math.floor(this.idleElapsedMs / IDLE_FRAME_MS);
      this.idleElapsedMs %= IDLE_FRAME_MS;
      this.idleFrameOffset = (this.idleFrameOffset + steps) % IDLE_FRAME_COUNT;
      this.avatarRenderer.setFrame(IDLE_FIRST_FRAME + this.idleFrameOffset);
      this.avatarDirty = true;
    }
    // Coalesce rotação e animação em um único render/upload por frame da aplicação.
    if (this.avatarDirty) this.renderAvatar();
  }

  setStageScale(scale: number): void {
    if (scale <= 0) return;
    this.stageScale = scale;
    const width = typeof window === 'undefined' ? STAGE_WIDTH : window.innerWidth / scale;
    const height = typeof window === 'undefined' ? STAGE_HEIGHT : window.innerHeight / scale;
    // Compensa o letterbox da stage para cobrir inclusive suas sobras laterais.
    this.view.position.set((STAGE_WIDTH - width) / 2, (STAGE_HEIGHT - height) / 2);
    this.view.hitArea = new Rectangle(0, 0, width, height);
    const artScale = Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
    const floorSplit = height / 2 + 20 * artScale;
    this.upperBackground.clear().rect(0, 0, width, floorSplit).fill(0xf0c88a);
    this.lowerBackground.clear().rect(0, floorSplit, width, height - floorSplit).fill(0xb7863b);
    for (const light of [this.upperLight, this.lowerLight]) {
      light.width = width;
      light.height = height;
    }
    // As luzes cobrem a janela; os móveis mantêm sua proporção original.
    this.wardrobe.scale.set(artScale);
    this.wardrobe.position.set(width / 2, height / 2);
    this.avatar.width = AVATAR_DISPLAY_SIZE * artScale;
    this.avatar.height = AVATAR_DISPLAY_SIZE * artScale;
    this.avatar.position.set(width / 2 + 38 * artScale, height / 2 + 115 * artScale);
    const barScale = artScale * STAGE_WIDTH / this.bar.texture.width;
    this.bar.scale.set(barScale);
    this.bar.position.set((width - this.bar.width) / 2, height - this.bar.height);
    this.barIcons.scale.set(barScale);
    this.barIcons.position.copyFrom(this.bar.position);
    this.itemPanel.scale.set(barScale);
    this.itemPanel.position.copyFrom(this.bar.position);
    this.colourPanels.scale.set(artScale);
    const colourPanelsHeight = COLOUR_PANEL_HEIGHT * 2 + COLOUR_PANEL_GAP;
    this.colourPanels.position.set(
      48 * artScale,
      Math.max(12 * artScale, (this.bar.y - colourPanelsHeight * artScale) / 2),
    );

    // Fundo imutável entre resizes: compõe as cinco camadas uma vez, na resolução da tela.
    // O avatar 3D e os controles ficam fora do cache.
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    this.background.cacheAsTexture({ resolution: scale * dpr, antialias: true });

    const buttonPixels = Math.max(44, Math.min(64, 56 * scale));
    this.closeBaseScale = buttonPixels / (56 * scale);
    const inset = (20 + buttonPixels / 2) / scale;
    this.closeButton.position.set(width - inset, inset);
    this.syncCloseFeedback();
  }

  private syncCloseFeedback(): void {
    this.closeButton.scale.set(this.closeBaseScale * (this.closePressed ? 0.9 : this.closeHovered ? 1.1 : 1));
  }

  private buildConfirmButton(): void {
    const button = this.confirmButton;
    const shirt = this.categoryIconHolders[WARDROBE_ICON_NAMES.indexOf('shirt')];
    const width = CONFIRM_BUTTON_WIDTH;
    const height = CONFIRM_BUTTON_HEIGHT;
    button.label = 'wardrobe-confirm-button';
    button.position.set((shirt?.x ?? 1184) + 24, (shirt?.y ?? 594) - 84);
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.hitArea = new Rectangle(-width / 2, -height / 2, width, height);

    // As mesmas três faces arredondadas dos botões azuis, desenhadas em vetor.
    const frame = this.confirmFrame;
    frame.eventMode = 'none';
    const label = new Text({ text: 'Confirmar', style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 38, fontWeight: '600', fill: 0xffffff,
    }) });
    label.anchor.set(0.5);
    label.eventMode = 'none';
    button.addChild(frame, label);
    button.on('pointerover', () => { this.confirmHovered = true; this.syncConfirmFeedback(); });
    button.on('pointerout', () => {
      this.confirmHovered = false;
      this.confirmPressed = false;
      this.syncConfirmFeedback();
    });
    button.on('pointerdown', (event) => {
      event.stopPropagation();
      this.confirmPressed = true;
      this.syncConfirmFeedback();
    });
    button.on('pointerup', () => { this.confirmPressed = false; this.syncConfirmFeedback(); });
    button.on('pointerupoutside', () => { this.confirmPressed = false; this.syncConfirmFeedback(); });
    button.on('pointertap', (event) => { event.stopPropagation(); void this.confirmAppearance(); });
    this.barIcons.addChild(button);
    this.confirmStatus.anchor.set(0.5, 0);
    this.confirmStatus.eventMode = 'none';
    this.confirmStatus.position.set(button.x, button.y + CONFIRM_BUTTON_HEIGHT * CONFIRM_BUTTON_SCALE / 2 + 6);
    this.barIcons.addChild(this.confirmStatus);
    this.syncConfirmFeedback();
  }

  private syncConfirmFeedback(): void {
    const desaturated = !this.confirmEdited || this.confirmSaving;
    if (desaturated !== this.confirmDesaturated) {
      this.confirmDesaturated = desaturated;
      // Lighter neutral palette, without a GPU filter.
      const [outer, middle, inner] = desaturated
        ? [0x858585, 0xa3a3a3, 0xbfbfbf] : [0x223e00, 0x116c05, 0x00990a];
      const width = CONFIRM_BUTTON_WIDTH;
      const height = CONFIRM_BUTTON_HEIGHT;
      this.confirmFrame.clear()
        .roundRect(-width / 2, -height / 2, width, height, 17).fill(outer)
        .roundRect(-width / 2 + 4, -height / 2 + 4, width - 8, height - 8, 14).fill(middle)
        .roundRect(-width / 2 + 9, -height / 2 + 9, width - 18, height - 18, 11).fill(inner);
    }
    if (desaturated) {
      this.confirmHovered = false;
      this.confirmPressed = false;
    }
    this.confirmButton.scale.set(CONFIRM_BUTTON_SCALE * (this.confirmPressed ? 0.9 : this.confirmHovered ? 1.1 : 1));
    this.confirmButton.cursor = desaturated ? 'default' : 'pointer';
    this.confirmButton.alpha = this.confirmSaving ? 0.65 : 1;
    this.confirmButton.eventMode = desaturated ? 'none' : 'static';
  }

  private markLookEdited(): void {
    this.lookDirty = true;
    this.confirmEdited = true;
    if (!this.confirmSaving) this.confirmStatus.text = '';
    this.syncConfirmFeedback();
  }

  /** Realtime updates never overwrite unconfirmed wardrobe edits. */
  setSavedAppearance(appearance: string): void {
    if (appearance === this.savedAppearance) return;
    this.savedAppearance = appearance;
    if (this.lookDirty || !this.wardrobeData) return;
    this.look = restoreAppearance(this.wardrobeData, appearance);
    this.confirmEdited = false;
    this.confirmStatus.text = '';
    this.syncConfirmFeedback();
    this.avatarRenderer?.setLook(resolveLook(this.wardrobeData, this.look));
    this.avatarDirty = true;
    this.renderItemGrid();
    this.renderColourSwatches();
  }

  private async confirmAppearance(): Promise<void> {
    if (!this.confirmEdited || this.confirmSaving || this.disposed) return;
    if (!this.look || !this.persistence.onConfirm) {
      this.confirmStatus.text = 'Visual indisponível. Tente novamente.';
      return;
    }
    // Snapshot the draft so choosing another item during the request cannot change the payload.
    const look = { ...this.look, itemIds: [...this.look.itemIds] };
    this.confirmSaving = true;
    this.confirmPressed = false;
    this.confirmStatus.text = 'Salvando…';
    this.syncConfirmFeedback();
    try {
      const appearance = await this.persistence.onConfirm(look);
      if (this.disposed) return;
      this.savedAppearance = appearance;
      this.lookDirty = serializeAppearance(this.look!) !== appearance;
      this.confirmEdited = this.lookDirty;
      this.confirmStatus.text = '';
    } catch (error) {
      if (!this.disposed) this.confirmStatus.text = error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.';
    } finally {
      this.confirmSaving = false;
      if (!this.disposed) this.syncConfirmFeedback();
    }
  }

  private syncCategorySelection(): void {
    const holder = this.categoryIconHolders[this.categoryIndex];
    if (!holder) return;
    holder.addChildAt(this.categorySelectionEffect, 0);
    this.categoryPulseMs = 0;
    this.drawCategorySelection();
  }

  private drawCategorySelection(): void {
    drawCategorySelectionPulse(this.categorySelectionEffect, this.categoryPulseMs);
  }

  private buildColourPanels(): void {
    this.colourPanels.label = 'wardrobe-colour-panels';
    for (const [index, group, title] of [
      [0, 'SkinColour', 'Cor de Pele'],
      [1, 'HairColour', 'Cor do Cabelo'],
    ] as const) {
      const panel = new Container();
      panel.label = `wardrobe-${group}-panel`;
      panel.y = index * (COLOUR_PANEL_HEIGHT + COLOUR_PANEL_GAP);
      const frame = new Graphics();
      frame.roundRect(0, 0, COLOUR_PANEL_WIDTH, COLOUR_PANEL_HEIGHT, 12).fill(0xe5e2cf);
      frame.roundRect(3, 3, COLOUR_PANEL_WIDTH - 6, COLOUR_PANEL_HEIGHT - 6, 9).fill(0xd6d4bf);
      frame.roundRect(6, 6, COLOUR_PANEL_WIDTH - 12, COLOUR_PANEL_HEIGHT - 12, 7).fill(0xffffff);
      frame.eventMode = 'none';
      const heading = new Text({
        text: title,
        style: new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 28, fontWeight: '700', fill: 0x704721 }),
      });
      heading.anchor.set(0.5, 0);
      heading.position.set(COLOUR_PANEL_WIDTH / 2, 16);
      heading.eventMode = 'none';
      const grid = new Container();
      grid.label = `wardrobe-${group}-colours`;
      grid.position.set((COLOUR_PANEL_WIDTH - (COLOUR_SWATCH_SIZE * 4 + 12 * 3)) / 2, 56);
      const divider = new Graphics();
      divider.roundRect(28, 237, COLOUR_PANEL_WIDTH - 56, 5, 2.5).fill(0xd6d4bf);
      divider.eventMode = 'none';
      const customGrid = new Container();
      customGrid.label = `wardrobe-${group}-custom-colours`;
      customGrid.position.set(grid.x, 253);
      panel.addChild(frame, heading, grid, divider, customGrid);
      this.colourPanels.addChild(panel);
      this.colourGrids.set(group, grid);
      this.customColourGrids.set(group, customGrid);
    }
  }

  private renderColourSwatches(): void {
    if (!this.wardrobeData) return;
    for (const [group, grid] of this.colourGrids) {
      grid.removeChildren().forEach((child) => child.destroy());
      const colours = this.wardrobeData.inGroup(group)
        .filter((item) => !item.invisible && item.colour)
        .slice(0, 12);
      colours.forEach((item, index) => {
        const colour = Number.parseInt(item.colour!.replace(/^#/, ''), 16);
        if (!Number.isFinite(colour)) return;
        const swatch = new Graphics();
        const selected = this.look?.[group === 'SkinColour' ? 'skinColour' : 'hairColour'] === colour;
        const expansion = selected ? 3 : 0;
        swatch.label = `wardrobe-${group}-colour-${item.id}`;
        swatch.position.set((index % 4) * 62 - expansion, Math.floor(index / 4) * 60 - expansion);
        swatch.roundRect(0, 0, COLOUR_SWATCH_SIZE + expansion * 2, COLOUR_SWATCH_SIZE + expansion * 2, 5)
          .fill(colour)
          .stroke({ color: 0x704721, width: 4 });
        swatch.eventMode = 'static';
        swatch.cursor = 'pointer';
        swatch.on('pointertap', (event) => {
          event.stopPropagation();
          this.applyColour(group, colour);
          this.renderColourSwatches();
        });
        grid.addChild(swatch);
      });
      const customGrid = this.customColourGrids.get(group);
      if (!customGrid) continue;
      customGrid.removeChildren().forEach((child) => child.destroy());
      this.customColours[group].forEach((colour, index) => {
        const selected = colour !== null && this.look?.[group === 'SkinColour' ? 'skinColour' : 'hairColour'] === colour;
        const expansion = selected ? 3 : 0;
        const size = COLOUR_SWATCH_SIZE + expansion * 2;
        const swatch = new Graphics();
        swatch.label = `wardrobe-${group}-custom-${index}`;
        swatch.position.set(index * 62 - expansion, -expansion);
        swatch.roundRect(0, 0, size, size, 5)
          .fill(colour ?? 0xffffff)
          .stroke({ color: 0x704721, width: 4 });
        if (colour === null) {
          swatch.moveTo(8, size - 8).lineTo(size - 8, 8)
            .stroke({ color: 0xc93636, width: 4, cap: 'round' });
        }
        swatch.eventMode = 'static';
        swatch.cursor = 'pointer';
        swatch.on('pointertap', (event) => {
          event.stopPropagation();
          this.openColourEditor(group, index);
        });
        customGrid.addChild(swatch);
      });
    }
  }

  private applyColour(group: ColourGroup, colour: number): void {
    if (!this.look || !this.wardrobeData) return;
    this.markLookEdited();
    if (group === 'SkinColour') this.look.skinColour = colour;
    else this.look.hairColour = colour;
    if (this.avatarRenderer) {
      this.avatarRenderer.setLook(resolveLook(this.wardrobeData, this.look));
      this.avatarDirty = true;
    }
  }

  private openColourEditor(group: ColourGroup, index: number): void {
    this.closeColourEditor();
    const current = this.customColours[group][index]
      ?? this.look?.[group === 'SkinColour' ? 'skinColour' : 'hairColour']
      ?? 0xffffff;
    const initialHex = `#${current.toString(16).padStart(6, '0').toUpperCase()}`;
    const backdrop = document.createElement('div');
    backdrop.className = 'wardrobe-colour-editor-backdrop';
    const dialog = document.createElement('form');
    dialog.className = 'wardrobe-colour-editor';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'wardrobe-colour-editor-title');

    const title = document.createElement('h2');
    title.id = 'wardrobe-colour-editor-title';
    title.textContent = group === 'SkinColour' ? 'Cor de Pele' : 'Cor do Cabelo';
    const pickerLabel = document.createElement('label');
    pickerLabel.textContent = 'Escolher cor';
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = initialHex;
    pickerLabel.appendChild(picker);
    const hexLabel = document.createElement('label');
    hexLabel.textContent = 'Código hexadecimal';
    const hex = document.createElement('input');
    hex.type = 'text';
    hex.inputMode = 'text';
    hex.maxLength = 7;
    hex.autocomplete = 'off';
    hex.spellcheck = false;
    hex.value = initialHex;
    hex.placeholder = '#RRGGBB';
    hexLabel.appendChild(hex);
    const error = document.createElement('p');
    error.className = 'wardrobe-colour-editor-error';
    error.setAttribute('role', 'alert');
    const actions = document.createElement('div');
    actions.className = 'wardrobe-colour-editor-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', () => this.closeColourEditor());
    const apply = document.createElement('button');
    apply.type = 'submit';
    apply.textContent = 'Aplicar';
    actions.append(cancel, apply);
    dialog.append(title, pickerLabel, hexLabel, error, actions);
    backdrop.appendChild(dialog);

    const parseHex = (value: string): number | null => {
      const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
      return match ? Number.parseInt(match[1], 16) : null;
    };
    picker.addEventListener('input', () => {
      hex.value = picker.value.toUpperCase();
      error.textContent = '';
    });
    hex.addEventListener('input', () => {
      const colour = parseHex(hex.value);
      if (colour !== null) picker.value = `#${colour.toString(16).padStart(6, '0')}`;
      error.textContent = '';
    });
    dialog.addEventListener('submit', (event) => {
      event.preventDefault();
      const colour = parseHex(hex.value);
      if (colour === null) {
        error.textContent = 'Use 6 dígitos hexadecimais, como #FFAA33.';
        hex.focus();
        return;
      }
      this.customColours[group][index] = colour;
      this.applyColour(group, colour);
      this.renderColourSwatches();
      this.closeColourEditor();
    });
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) this.closeColourEditor();
    });
    document.body.appendChild(backdrop);
    this.colourEditor = backdrop;
    hex.focus();
    hex.select();
  }

  private closeColourEditor(): void {
    this.colourEditor?.remove();
    this.colourEditor = null;
  }

  private buildItemPanel(buttons?: ActionBarButtonTextures): void {
    this.itemPanel.label = 'wardrobe-item-panel';
    for (let index = 0; index < ITEMS_PER_PAGE; index++) {
      const holder = new Container();
      holder.position.set(GRID_X + (index % 7) * GRID_STEP, GRID_Y + Math.floor(index / 7) * GRID_STEP);
      holder.hitArea = new Rectangle(0, 0, ITEM_SIZE, ITEM_SIZE);
      const frame = new Graphics();
      frame.eventMode = 'none';
      const contents = new Container();
      contents.eventMode = 'none';
      holder.addChild(frame, contents);
      holder.on('pointertap', (event) => {
        event.stopPropagation();
        const item = this.visibleItems[index];
        if (item) this.selectItem(item);
      });
      this.itemCells.push({ frame, contents, holder });
      this.itemPanel.addChild(holder);
    }
    if (buttons) {
      const controls: Array<{ action: PageAction; texture: Texture; x: number; y: number }> = [
        { action: 'previous', texture: buttons.leftArrow, x: 340, y: 714 },
        { action: 'first', texture: buttons.leftEdgeArrow, x: 340, y: 824 },
        { action: 'next', texture: buttons.rightArrow, x: 1260, y: 714 },
        { action: 'last', texture: buttons.rightEdgeArrow, x: 1260, y: 824 },
      ];
      for (const { action, texture, x, y } of controls) {
        const holder = new Container();
        holder.label = `wardrobe-page-${action}`;
        holder.position.set(x, y);
        holder.eventMode = 'static';
        holder.hitArea = new Rectangle(-34, -34, 68, 68);
        const icon = new Sprite(texture);
        icon.anchor.set(0.5);
        icon.eventMode = 'none';
        const baseScale = 58 / Math.max(texture.width, texture.height);
        icon.scale.set(baseScale);
        holder.addChild(icon);
        let hovered = false;
        let pressed = false;
        const syncFeedback = () => icon.scale.set(baseScale * (pressed ? 0.9 : hovered ? 1.1 : 1));
        holder.on('pointerover', () => { hovered = true; syncFeedback(); });
        holder.on('pointerout', () => { hovered = false; pressed = false; syncFeedback(); });
        holder.on('pointerdown', (event) => { event.stopPropagation(); pressed = true; syncFeedback(); });
        holder.on('pointerup', () => { pressed = false; syncFeedback(); });
        holder.on('pointerupoutside', () => { pressed = false; syncFeedback(); });
        holder.on('pointertap', (event) => { event.stopPropagation(); this.changePage(action); });
        this.pageControls.push({ holder, action });
        this.itemPanel.addChild(holder);
      }
    }
    this.renderItemGrid();
  }

  private visibleItems: WardrobeItem[] = [];

  private categoryItems(): WardrobeItem[] {
    const groups = ITEM_GROUPS[this.categoryIndex] ?? [];
    return groups.flatMap((group) => this.wardrobeData?.inGroup(group).filter((item) => !item.invisible) ?? []);
  }

  private changePage(action: PageAction): void {
    const lastPage = Math.max(0, Math.ceil(this.categoryItems().length / ITEMS_PER_PAGE) - 1);
    const target = action === 'first' ? 0 : action === 'last' ? lastPage
      : this.pageIndex + (action === 'previous' ? -1 : 1);
    const next = Math.max(0, Math.min(lastPage, target));
    if (next === this.pageIndex) return;
    this.pageIndex = next;
    this.renderItemGrid();
  }

  private renderItemGrid(): void {
    const items = this.categoryItems();
    const lastPage = Math.max(0, Math.ceil(items.length / ITEMS_PER_PAGE) - 1);
    this.pageIndex = Math.min(this.pageIndex, lastPage);
    this.visibleItems = items.slice(this.pageIndex * ITEMS_PER_PAGE, (this.pageIndex + 1) * ITEMS_PER_PAGE);
    this.itemCells.forEach(({ frame, contents, holder }, index) => {
      const item = this.visibleItems[index];
      contents.removeChildren().forEach((child) => child.destroy());
      holder.visible = Boolean(item);
      holder.label = item ? `wardrobe-item-${item.id}-${item.name}` : `wardrobe-empty-${index}`;
      holder.eventMode = item ? 'static' : 'none';
      holder.cursor = item ? 'pointer' : 'default';
      if (!item) {
        frame.clear();
        return;
      }
      const selected = this.look?.itemIds.includes(item.id) ?? false;
      frame.clear().roundRect(0, 0, ITEM_SIZE, ITEM_SIZE, 8)
        .fill(0xffffff)
        .stroke({ color: selected ? 0x666666 : 0xa5a5a5, width: selected ? 3 : 2 });
      const dedicatedIcon = item.iconName && this.itemAtlas?.symbols[item.iconName];
      const paintedBounds = PAINTED_ICON_BOUNDS[item.group];
      const symbolName = dedicatedIcon ? item.iconName : paintedBounds ? item.texture : undefined;
      const symbol = symbolName && this.itemAtlas?.symbols[symbolName];
      if (symbol && this.itemAtlasTexture) {
        let texture = this.itemIconCache.get(symbolName!);
        if (!texture) {
          texture = new Texture({
            source: this.itemAtlasTexture.source,
            frame: new Rectangle(symbol.sx, symbol.sy, symbol.w, symbol.h),
          });
          this.itemIconCache.set(symbolName!, texture);
        }
        const image = new Sprite(texture);
        image.anchor.set(0.5);
        image.position.set(ITEM_SIZE / 2);
        const bounds = !dedicatedIcon && paintedBounds
          ? paintedBounds
          : { width: 76, height: 76, maxScale: 2 };
        image.scale.set(Math.min(bounds.width / texture.width, bounds.height / texture.height, bounds.maxScale));
        contents.addChild(image);
      } else {
        const empty = new Text({
          text: '⊘',
          style: new TextStyle({ fontSize: 42, fill: 0x999999 }),
        });
        empty.anchor.set(0.5);
        empty.position.set(ITEM_SIZE / 2);
        contents.addChild(empty);
      }
    });
    for (const { holder, action } of this.pageControls) {
      const enabled = action === 'previous' || action === 'first' ? this.pageIndex > 0 : this.pageIndex < lastPage;
      holder.alpha = enabled ? 1 : 0.4;
      holder.cursor = enabled ? 'pointer' : 'default';
    }
  }

  private selectItem(item: WardrobeItem): void {
    if (!this.wardrobeData || !this.look) return;
    this.markLookEdited();
    const slot = this.wardrobeData.slotOf(item);
    this.look.itemIds = this.look.itemIds.filter((id) => {
      const current = this.wardrobeData?.byId(id);
      return !current || this.wardrobeData?.slotOf(current) !== slot;
    });
    this.look.itemIds.push(item.id);
    if (this.avatarRenderer) {
      this.avatarRenderer.setLook(resolveLook(this.wardrobeData, this.look));
      this.avatarDirty = true;
    }
    this.renderItemGrid();
  }

  private ensureAvatar(): Promise<void> {
    if (this.avatarRenderer) return Promise.resolve();
    if (this.avatarLoad) return this.avatarLoad;
    this.avatarLoad = this.loadAvatar();
    return this.avatarLoad;
  }

  private async loadAvatar(): Promise<void> {
    const [{ AvatarRenderer }, { wardrobe, atlas, atlasImage }, itemAtlasTexture] = await Promise.all([
      import('../../avatar/AvatarRenderer'),
      loadAvatarAssets(),
      Assets.load<Texture>(AVATAR_URLS.sheet),
    ]);
    if (this.disposed) return;
    this.wardrobeData = wardrobe;
    this.look ??= restoreAppearance(wardrobe, this.savedAppearance);
    this.itemAtlas = parseAtlas(atlas);
    this.itemAtlasTexture = itemAtlasTexture;
    this.renderItemGrid();
    this.renderColourSwatches();
    const renderer = await AvatarRenderer.create({
      modelUrl: AVATAR_URLS.model,
      atlas,
      atlasImage,
      size: 768,
      unlit: true,
      pitch: AVATAR_CAMERA_PITCH,
      preserveDrawingBuffer: true,
    });
    if (this.disposed) {
      renderer.destroy();
      return;
    }
    const missing = renderer.setLook(resolveLook(wardrobe, this.look));
    if (missing.length) console.warn('[wardrobe-avatar] partes sem textura', missing);
    renderer.setFrame(IDLE_FIRST_FRAME + this.idleFrameOffset);
    renderer.setDirection(this.avatarDirection); // direção 0: rosto voltado para a câmera
    renderer.render();
    const texture = Texture.from(renderer.canvas);
    texture.source.scaleMode = 'linear';
    texture.source.update();
    this.avatarRenderer = renderer;
    this.avatarTexture = texture;
    this.avatar.texture = texture;
    this.avatar.visible = true;
    this.setStageScale(this.stageScale);
  }

  private renderAvatar(): void {
    if (!this.avatarRenderer || !this.avatarTexture) return;
    this.avatarRenderer.setDirection(this.avatarDirection);
    this.avatarRenderer.render();
    this.avatarTexture.source.update();
    this.avatarDirty = false;
  }

  private endAvatarDrag = (): void => {
    this.avatarDrag = null;
    this.avatar.cursor = 'grab';
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    if (this.colourEditor) this.closeColourEditor();
    else if (this.isOpen) this.close();
  };

  destroy(): void {
    this.disposed = true;
    this.close();
    if (typeof window !== 'undefined') window.removeEventListener('keydown', this.onKeyDown);
    this.avatar.texture = Texture.EMPTY;
    this.avatarTexture?.destroy(true);
    this.avatarRenderer?.destroy();
    this.view.destroy({ children: true });
    for (const texture of this.itemIconCache.values()) texture.destroy();
    this.itemIconCache.clear();
  }
}
