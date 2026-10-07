import { Container, Graphics, Rectangle, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js';

import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';
import { prefersReducedMotion } from '../../core/flags';
import type { ActionBarButtonTextures, ActionBarIconTexture, StoreToolbarTextures } from '../../game/asset-manifest';
import { CATEGORY_PULSE_DURATION_MS, drawCategorySelectionPulse } from './CategorySelectionPulse';
import { FONT_FAMILY } from '../../core/fonts';
import type { RoomCatalogItem, RoomUnit } from '../../game/room-inventory';

export interface StoreEntry { item: RoomCatalogItem; unit?: RoomUnit; texture?: Texture; quantity?: number }
export interface StoreActions {
  onSelect(entry: StoreEntry): void;
  onCategory(category: string | undefined): void;
  onInventoryToggle(): void;
  onDragStart?(entry: StoreEntry, event: FederatedPointerEvent): void;
  onDragEnd?(event: FederatedPointerEvent): void;
}

/** Visible silhouette of cafe_action_bar.png, excluding its transparent canvas. */
export const MAIN_ACTION_BAR_FRAME = { left: 246, top: 686, width: 1189, height: 255 } as const;
export const MAIN_ACTION_BAR_SCALE = 0.75 * 1.15;
/** Includes the antialiased outline, but none of the large transparent header. */
export const STORE_ACTION_BAR_FRAME = { left: 224, top: 572, width: 1150, height: 328 } as const;

const SLOT_SIZE = 96 * 1.15;
const SLOT_GAP = 18;
const SLOT_COLUMNS = 8;
const SETTINGS_BUTTON_SIZE = 48 * 1.3;
const CLOSE_BUTTON_SIZE = SETTINGS_BUTTON_SIZE * 1.5;
const PAGE_BUTTON_SIZE = 58 * 0.9;
const PAGE_BUTTON_ROW_GAP = 12;
const HEADER_BUTTON_GAP = 24;
const SLOT_STROKE_WIDTH = 2;
const ITEM_PREVIEW_PADDING = 5 / MAIN_ACTION_BAR_SCALE;
const CATEGORY_ICON_GAP = 15;
const CATEGORY_ICON_VERTICAL_INSET = 4;
/** Center of the visible header interior, between its top outline and divider. */
const CATEGORY_HEADER_CENTER_Y = (578 + 635) / 2;
const CATEGORY_PULSE_SCALE = 0.62;
const CATEGORY_PULSE_STYLE = { centerAlpha: 0.64, ringWidth: 8, fadeExponent: 0.4 };
const TOP_TAB_SCALE = 0.69;
const TOP_TAB_LEFT = 60;
const TOP_TAB_OVERLAP = 10;
const TOP_TAB_LIFT = 6;
const TOP_TAB_ACTIVE_OVERLAP = 2;
const TOP_TAB_GAP = 12;
const TOP_TAB_CORNER_RADIUS = 12;
const TOP_TAB_BOTTOM_CUT = 1;
const TOP_TAB_ACTIVE_ICON_SCALE = 1.358;
const TOP_TAB_EXPANDED_ICON_SIZE_MULTIPLIER = 1.1025;
const TOP_TAB_ICON_PADDING = 1 / MAIN_ACTION_BAR_SCALE;
const TOP_TABS = ['news', 'shop', 'inventory'] as const;

/** Store category toolbar: room stays visible, only the bottom toolbar swaps. */
export class StoreActionBar {
  readonly view = new Container();
  private readonly croppedTexture: Texture;
  private readonly categoryHolders: Container[] = [];
  private readonly categoryNames: string[] = [];
  private readonly selectionEffect = new Graphics();
  private readonly reducedMotion = prefersReducedMotion();
  private categoryIndex = 0;
  private categoryPulseMs = 0;
  private categoryPulseDrawMs = 0;
  private readonly slots: Container[] = [];
  private readonly slotFaces: Container[] = [];
  private readonly itemPreviewTextures = new Map<Texture, Texture>();
  private readonly pageButtons: Container[] = [];
  private entries: StoreEntry[] = [];
  private page = 0;
  private inventory = false;
  private activeTopTab: (typeof TOP_TABS)[number] = 'shop';
  private message?: Text;
  private topTabTexture?: Texture;
  private readonly syncTopTabs: (() => void)[] = [];

  constructor(
    texture: Texture,
    mainTexture: Texture,
    buttons?: ActionBarButtonTextures,
    closeTexture?: Texture,
    private readonly onVisibilityChange?: (open: boolean) => void,
    private readonly onOpenSettings?: () => void,
    icons: readonly ActionBarIconTexture[] = [],
    private readonly actions?: StoreActions,
    topButtonTexture?: Texture,
    shopIconTexture?: Texture,
    private readonly storeToolbarTextures?: StoreToolbarTextures,
  ) {
    this.view.label = 'room-store-bar-layer';
    this.view.visible = false;
    this.view.pivot.set(STAGE_WIDTH / 2, STAGE_HEIGHT);
    this.view.position.set(STAGE_WIDTH / 2, STAGE_HEIGHT);

    const content = new Container();
    const frame = STORE_ACTION_BAR_FRAME;
    const barWidth = MAIN_ACTION_BAR_FRAME.width;
    const barHeight = frame.height * barWidth / frame.width;
    const headerHeight = 64 * barWidth / frame.width;
    const topTabWidth = (topButtonTexture?.width ?? 119) * TOP_TAB_SCALE;
    const topTabHeight = Math.max(1, (topButtonTexture?.height ?? 113) - 8) * TOP_TAB_SCALE;
    content.label = 'store-action-bar';
    content.scale.set(MAIN_ACTION_BAR_SCALE);
    content.position.set(
      (STAGE_WIDTH - mainTexture.width * MAIN_ACTION_BAR_SCALE) / 2 + MAIN_ACTION_BAR_FRAME.left * MAIN_ACTION_BAR_SCALE,
      STAGE_HEIGHT - barHeight * MAIN_ACTION_BAR_SCALE,
    );
    // The confirm button protrudes above the border; its full face must remain clickable.
    const settingsX = barWidth - 62;
    const confirmX = settingsX - SETTINGS_BUTTON_SIZE / 2 - CLOSE_BUTTON_SIZE / 2 - HEADER_BUTTON_GAP;
    const topExtent = Math.max(CLOSE_BUTTON_SIZE * 0.55, topTabHeight + TOP_TAB_LIFT);
    content.hitArea = new Rectangle(0, -topExtent, barWidth, barHeight + topExtent);
    content.eventMode = 'static';
    for (const name of ['pointerdown', 'pointerup', 'pointertap', 'wheel'] as const) {
      content.on(name, (event) => event.stopPropagation());
    }

    this.croppedTexture = new Texture({
      source: texture.source,
      frame: new Rectangle(frame.left, frame.top, frame.width, frame.height),
    });
    const back = new Sprite(this.croppedTexture);
    back.label = 'store-action-bar-back';
    // Ancoragem pela base mantém a proporção natural da arte durante a expansão vertical.

    back.width = barWidth;
    back.height = barHeight;
    back.eventMode = 'none';
    content.addChild(back);

    // Size by header height; pack real icon widths instead of fixed center spacing.
    const categoryHeight = (headerHeight - CATEGORY_ICON_VERTICAL_INSET * 2) * 0.95;
    const categoryCenterY = (CATEGORY_HEADER_CENTER_Y - frame.top) * barWidth / frame.width;
    let iconLeft = 20;
    this.selectionEffect.label = 'store-category-selection';
    this.selectionEffect.eventMode = 'none';
    const categories = new Container();
    categories.label = 'store-category-icons';
    icons.forEach(({ name, texture }, index) => {
      const iconHeight = categoryHeight * (name === 'floor' ? 0.9 : 1);
      const baseScale = iconHeight / texture.height;
      const iconWidth = texture.width * baseScale;
      const holder = new Container();
      holder.label = `store-category-${name}`;
      holder.position.set(iconLeft + iconWidth / 2, categoryCenterY);
      iconLeft += iconWidth + CATEGORY_ICON_GAP;
      holder.eventMode = 'static';
      holder.cursor = 'pointer';
      holder.hitArea = new Rectangle(
        -iconWidth / 2 - CATEGORY_ICON_GAP / 2, -iconHeight * 0.55,
        iconWidth + CATEGORY_ICON_GAP, iconHeight * 1.1,
      );
      const icon = new Sprite(texture);
      icon.anchor.set(0.5);
      icon.scale.set(baseScale);
      icon.eventMode = 'none';
      holder.addChild(icon);
      let hovered = false;
      let pressed = false;
      const sync = () => icon.scale.set(baseScale * (pressed ? 0.9 : hovered ? 1.1 : 1));
      holder.on('pointerover', () => { hovered = true; sync(); });
      holder.on('pointerout', () => { hovered = false; pressed = false; sync(); });
      holder.on('pointerdown', (event) => { event.stopPropagation(); pressed = true; sync(); });
      holder.on('pointerup', () => { pressed = false; sync(); });
      holder.on('pointerupoutside', () => { pressed = false; sync(); });
      holder.on('pointertap', (event) => {
        event.stopPropagation();
        this.categoryIndex = index;
        this.syncCategorySelection();
        this.actions?.onCategory(this.selectedCategory);
      });
      this.categoryHolders.push(holder);
      this.categoryNames.push(name);
      categories.addChild(holder);
    });
    content.addChild(categories);
    this.syncCategorySelection();

    // Equal horizontal/vertical gaps inside a centered grid. Center the arrows
    // in the remaining side lanes, keeping equal clearance on either side.
    const gridWidth = SLOT_COLUMNS * SLOT_SIZE + (SLOT_COLUMNS - 1) * SLOT_GAP;
    const gridX = (barWidth - gridWidth) / 2;
    const pageLeftX = (gridX - SLOT_STROKE_WIDTH / 2) / 2;
    const gridHeight = 2 * SLOT_SIZE + SLOT_GAP;
    const gridY = headerHeight + (barHeight - headerHeight - gridHeight) / 2;
    for (let index = 0; index < SLOT_COLUMNS * 2; index++) {
      const slot = new Graphics()
        .roundRect(0, 0, SLOT_SIZE, SLOT_SIZE, 8)
        .fill(0xffffff)
        .stroke({ color: 0xa5a5a5, width: SLOT_STROKE_WIDTH });
      slot.label = `store-empty-slot-${index + 1}`;
      const holder = new Container();
      holder.label = `store-slot-content-${index + 1}`;
      holder.position.set(
        gridX + index % SLOT_COLUMNS * (SLOT_SIZE + SLOT_GAP),
        gridY + Math.floor(index / SLOT_COLUMNS) * (SLOT_SIZE + SLOT_GAP),
      );
      slot.eventMode = 'none';
      holder.hitArea = new Rectangle(0, 0, SLOT_SIZE, SLOT_SIZE);
      holder.eventMode = 'none';
      const face = new Container();
      face.label = `store-slot-face-${index + 1}`;
      face.pivot.set(SLOT_SIZE / 2); face.position.set(SLOT_SIZE / 2);
      face.eventMode = 'none'; face.addChild(slot); holder.addChild(face);
      this.slotFaces.push(face);
      content.addChild(holder); this.slots.push(holder);
    }

    if (buttons) {
      // Pagination has its own compact vertical group, centered beside the grid.
      const pageHeight = PAGE_BUTTON_SIZE * Math.max(
        ...[buttons.leftArrow, buttons.leftEdgeArrow, buttons.rightArrow, buttons.rightEdgeArrow]
          .map((texture) => texture.height / texture.width),
      );
      const pageRowOffset = (pageHeight + PAGE_BUTTON_ROW_GAP) / 2;
      const pageCenterY = gridY + gridHeight / 2;
      const rowCenters = [pageCenterY - pageRowOffset, pageCenterY + pageRowOffset];
      for (const placement of [
        { name: 'previous', texture: buttons.leftArrow, x: pageLeftX, y: rowCenters[0] },
        { name: 'first', texture: buttons.leftEdgeArrow, x: pageLeftX, y: rowCenters[1] },
        { name: 'next', texture: buttons.rightArrow, x: barWidth - pageLeftX, y: rowCenters[0] },
        { name: 'last', texture: buttons.rightEdgeArrow, x: barWidth - pageLeftX, y: rowCenters[1] },
      ]) {
        // Different source aspect ratios must not change the side margins.
        const button = this.createButton(placement.texture, PAGE_BUTTON_SIZE, () => {
          const last = Math.max(0, Math.ceil(this.entries.length / this.slots.length) - 1);
          this.page = placement.name === 'first' ? 0 : placement.name === 'last' ? last
            : Math.max(0, Math.min(last, this.page + (placement.name === 'previous' ? -1 : 1)));
          this.renderEntries();
        }, true);
        button.label = `store-page-${placement.name}`;
        button.position.set(placement.x, placement.y);
        // Abas sem conteúdo desativam a paginação.
        button.alpha = 0.4;
        button.eventMode = 'none';
        button.cursor = 'default';
        content.addChild(button);
        this.pageButtons.push(button);
      }
      const settings = this.createButton(buttons.settings, SETTINGS_BUTTON_SIZE, () => {
        this.onOpenSettings?.();
      });
      settings.label = 'store-settings-button';
      settings.position.set(settingsX, 8);
      content.addChild(settings);
    }

    const close = this.createButton(closeTexture, CLOSE_BUTTON_SIZE, () => this.close());
    close.label = 'store-close-button';
    close.position.set(confirmX, 8);
    content.addChild(close);
    if (storeToolbarTextures) {
      const register = this.createButton(storeToolbarTextures.cashRegister, CLOSE_BUTTON_SIZE * 0.81, () => {});
      register.label = 'store-cash-register-icon';
      register.position.set(confirmX - close.width / 2 - register.width / 2 - 8, 8);
      content.addChild(register);
    }
    if (actions) {
      if (topButtonTexture) {
        const sourceFrame = topButtonTexture.frame;
        // Remove only the bottom edge of the artwork so the tabs meet the bar.
        this.topTabTexture = new Texture({ source: topButtonTexture.source,
          frame: new Rectangle(sourceFrame.x, sourceFrame.y, sourceFrame.width, Math.max(1, sourceFrame.height - 8)) });
      }
      for (const [index, tab] of TOP_TABS.entries()) {
        const holder = new Container();
        holder.label = `store-tab-${tab}`;
        holder.position.set(TOP_TAB_LEFT + index * (topTabWidth + TOP_TAB_GAP), -topTabHeight + TOP_TAB_OVERLAP);
        holder.eventMode = 'static'; holder.cursor = 'pointer';
        holder.hitArea = new Rectangle(0, 0, topTabWidth, topTabHeight - TOP_TAB_BOTTOM_CUT);
        // Match the bar's gray outline and white inner bevel with vector edges.
        // Extend the rounded shape below the cut so its base stays open at the bar.
        const face = new Graphics()
          .roundRect(1.5, 1.5, topTabWidth - 3, topTabHeight + TOP_TAB_CORNER_RADIUS - 3, TOP_TAB_CORNER_RADIUS)
          .fill(0xf4f4f4).stroke({ color: 0x717171, width: 3 });
        if (this.topTabTexture) {
          const interior = new Sprite(this.topTabTexture);
          interior.scale.set(TOP_TAB_SCALE); interior.eventMode = 'none';
          // Hide the image's baked border and let the vector define the corners.
          const interiorMask = new Graphics()
            .roundRect(3, 3, topTabWidth - 6, topTabHeight + TOP_TAB_CORNER_RADIUS - 6, TOP_TAB_CORNER_RADIUS - 2)
            .fill(0xffffff);
          interiorMask.eventMode = 'none';
          face.addChild(interior, interiorMask); interior.mask = interiorMask;
        }
        const bevel = new Graphics()
          .roundRect(3.5, 3.5, topTabWidth - 7, topTabHeight + TOP_TAB_CORNER_RADIUS - 7, TOP_TAB_CORNER_RADIUS - 2)
          .stroke({ color: 0xffffff, width: 1.5, alpha: 0.9 });
        bevel.eventMode = 'none';
        const baseCut = new Graphics().rect(0, 0, topTabWidth, topTabHeight - TOP_TAB_BOTTOM_CUT).fill(0xffffff);
        baseCut.eventMode = 'none'; face.addChild(bevel, baseCut); face.mask = baseCut;
        face.eventMode = 'none'; holder.addChild(face);
        // Cover the bar's baked top outline without extending the tab's side borders.
        const seamCover = new Graphics()
          .rect(3, topTabHeight - TOP_TAB_BOTTOM_CUT - 1, topTabWidth - 6, 4)
          .fill(0xf8f8f8);
        seamCover.eventMode = 'none'; holder.addChild(seamCover);
        const tabTexture = { news: storeToolbarTextures?.news, shop: shopIconTexture, inventory: storeToolbarTextures?.inventory }[tab];
        const tabIcon = tabTexture ? new Sprite(tabTexture) : undefined;
        const tabIconScale = tabIcon
          ? Math.min(
            (topTabWidth - (tab === 'news' ? 8 : 16)) / tabIcon.texture.width,
            (topTabHeight - TOP_TAB_OVERLAP - (tab === 'news' ? 4 : 12)) / tabIcon.texture.height,
          ) * (tab === 'inventory' ? 1.1 : tab === 'news' ? 1.05 : 1)
          : 1;
        const expandedIconScale = tabIcon
          ? Math.min(
            tabIconScale * TOP_TAB_ACTIVE_ICON_SCALE,
            (topTabWidth - 2 * (3 + TOP_TAB_ICON_PADDING)) / tabIcon.texture.width,
            (topTabHeight - TOP_TAB_BOTTOM_CUT - 3 - 2 * TOP_TAB_ICON_PADDING) / tabIcon.texture.height,
          )
          : 1;
        if (tabIcon) {
          tabIcon.label = `store-tab-${tab}-icon`;
          tabIcon.anchor.set(0.5);
          const verticalOffset = tab === 'shop' ? 5 : 3;
          tabIcon.position.set(topTabWidth / 2 - (tab === 'shop' ? 3 : 0), (topTabHeight - TOP_TAB_OVERLAP) / 2 + verticalOffset);
          tabIcon.eventMode = 'none';
          // Size the icon to fit; keep it separate from the face's bottom cut.
          holder.addChild(tabIcon);
        }
        content.addChildAt(holder, 0);
        const sync = () => {
          const interacting = this.activeTopTab === tab;
          seamCover.visible = interacting;
          if (tabIcon) {
            tabIcon.scale.set(interacting ? expandedIconScale * TOP_TAB_EXPANDED_ICON_SIZE_MULTIPLIER : tabIconScale);
            if (interacting) {
              // Balance the visible badge rather than its faint transparent fringe.
              tabIcon.position.set(
                topTabWidth / 2 + (tab === 'news' ? 3.5 * expandedIconScale * TOP_TAB_EXPANDED_ICON_SIZE_MULTIPLIER : 0),
                (3 + topTabHeight - TOP_TAB_BOTTOM_CUT) / 2 + (tab === 'news' ? 4 * expandedIconScale * TOP_TAB_EXPANDED_ICON_SIZE_MULTIPLIER : 0),
              );
            } else {
              tabIcon.position.set(topTabWidth / 2 - (tab === 'shop' ? 3 : 0), (topTabHeight - TOP_TAB_OVERLAP) / 2 + (tab === 'shop' ? 5 : 3));
            }
          }
          holder.y = -topTabHeight + TOP_TAB_OVERLAP - (interacting ? TOP_TAB_LIFT - TOP_TAB_ACTIVE_OVERLAP : 0);
          // Active tabs cover the bar, while categories and their radar stay above tabs.
          content.setChildIndex(holder, interacting ? content.getChildIndex(categories) - 1 : 0);
        };
        this.syncTopTabs.push(sync);
        holder.on('pointerdown', (event) => event.stopPropagation());
        holder.on('pointertap', (event) => {
          event.stopPropagation();
          if (this.activeTopTab === tab) return;
          this.activeTopTab = tab;
          if (this.inventory !== (tab === 'inventory')) actions.onInventoryToggle();
          else actions.onCategory(this.selectedCategory);
          this.syncTopTabs.forEach((sync) => sync());
          this.renderEntries();
        });
      }
      const messageX = TOP_TAB_LEFT + TOP_TABS.length * (topTabWidth + TOP_TAB_GAP) + 12;
      this.message = new Text({ text: 'Selecione um item. Alt + arraste para mover.', style: { fontFamily: FONT_FAMILY, fontSize: 16, fill: 0xffffff, stroke: { color: 0x38210e, width: 3 }, wordWrap: true, wordWrapWidth: barWidth - messageX - 12 } });
      this.message.position.set(messageX, -30); this.message.eventMode = 'none'; this.message.label = 'store-status'; content.addChild(this.message);
      this.syncTopTabs.forEach((sync) => sync());
    }
    this.view.addChild(content);
  }

  get isOpen(): boolean { return this.view.visible; }
  get selectedCategory(): string | undefined { return this.categoryNames[this.categoryIndex]; }

  containsGlobalPoint(global: { x: number; y: number }): boolean {
    if (!this.isOpen) return false;
    const content = this.view.getChildByLabel('store-action-bar') as Container;
    const point = content.toLocal(global);
    return Boolean(content.hitArea?.contains(point.x, point.y));
  }

  selectCategory(name: string): void {
    const index = this.categoryNames.indexOf(name);
    if (index >= 0) { this.categoryIndex = index; this.syncCategorySelection(); }
  }

  setEntries(entries: StoreEntry[], inventory = false): void {
    this.entries = entries; this.page = 0; this.inventory = inventory;
    if (inventory) this.activeTopTab = 'inventory';
    else if (this.activeTopTab !== 'news') this.activeTopTab = 'shop';
    this.syncTopTabs.forEach((sync) => sync());
    this.renderEntries();
  }

  setMessage(message: string): void { if (this.message) this.message.text = message; }

  private renderEntries(): void {
    const entries = this.activeTopTab === 'news' ? [] : this.entries;
    this.slots.forEach((slot, index) => {
      const face = this.slotFaces[index];
      // Keep the card's background; all its contents share the same centered scale.
      if (face.children.length > 1) {
        face.removeChildren(1).forEach((child) => child.destroy({ children: true }));
      }
      face.scale.set(1); face.tint = 0xffffff;
      slot.removeAllListeners();
      const entry = entries[this.page * this.slots.length + index];
      slot.eventMode = entry ? 'static' : 'none'; slot.cursor = entry ? 'pointer' : 'default';
      slot.label = `store-slot-content-${index + 1}`;
      if (!entry) return;
      slot.label = `store-item-${this.inventory ? entry.item.classname : entry.unit?.unitId ?? entry.item.classname}`;
      this.bindButtonFeedback(slot, face);
      let preview: Sprite | undefined;
      if (entry.texture) {
        preview = new Sprite(this.itemPreviewTexture(entry.texture));
        preview.label = 'store-item-preview'; preview.anchor.set(0.5);
        preview.eventMode = 'none'; face.addChild(preview);
      }
      if (this.inventory) {
        const text = String(entry.quantity ?? 1), width = Math.max(28, 12 + text.length * 8);
        const badge = new Container(); badge.label = `store-item-quantity-${entry.item.classname}`;
        badge.position.set(SLOT_SIZE - width / 2 - 4, 62); badge.eventMode = 'none';
        badge.addChild(new Graphics().roundRect(-width / 2, -14, width, 28, 14)
          .fill(0x2f78b7).stroke({ color: 0x144a7d, width: 2 }));
        const count = new Text({ text, style: { fontFamily: FONT_FAMILY, fontSize: 14, fontWeight: 'bold', fill: 0xffffff } });
        count.label = 'store-item-quantity-value'; count.anchor.set(.5); count.eventMode = 'none'; badge.addChild(count);
        face.addChild(badge);
      }
      if (!entry.unit) {
        const price = new Container(); price.label = 'store-item-price'; price.eventMode = 'none';
        let coinWidth = 0;
        if (this.storeToolbarTextures?.gold) {
          const coin = new Sprite(this.storeToolbarTextures.gold);
          coin.label = 'store-item-gold-icon'; coin.anchor.set(0, 0.5);
          coin.scale.set(22.1 / coin.texture.height); coin.eventMode = 'none';
          coinWidth = coin.width + 4; price.addChild(coin);
        }
        const value = new Text({ text: String(entry.item.priceGold), style: {
          fontFamily: FONT_FAMILY, fontSize: 18, fontWeight: 'bold', fill: 0xffffff,
          stroke: { color: 0x633513, width: 8.748, join: 'round' },
        } });
        value.label = 'store-item-price-value'; value.anchor.set(0, 0.5);
        value.position.set(coinWidth, 0); value.eventMode = 'none'; price.addChild(value);
        const priceBounds = price.getLocalBounds();
        price.position.set(
          (SLOT_SIZE - priceBounds.width) / 2 - priceBounds.x,
          SLOT_SIZE + 6.5 / MAIN_ACTION_BAR_SCALE - priceBounds.y - priceBounds.height,
        );
        face.addChild(price);
      }
      if (preview) {
        const imageSize = SLOT_SIZE - 2 * ITEM_PREVIEW_PADDING;
        preview.scale.set(Math.min(
          imageSize / preview.texture.width,
          imageSize / preview.texture.height,
        ));
        preview.position.set(SLOT_SIZE / 2, SLOT_SIZE / 2);
      }
      slot.on('pointerdown', (event) => {
        event.stopPropagation(); this.actions?.onDragStart?.(entry, event);
      });
      for (const name of ['pointerup', 'pointerupoutside'] as const) slot.on(name, (event) => {
        if (this.actions?.onDragEnd) { event.stopPropagation(); this.actions.onDragEnd(event); }
      });
      slot.on('pointertap', (event) => {
        event.stopPropagation();
        if (!this.actions?.onDragStart) this.actions?.onSelect(entry);
      });
    });
    const last = Math.max(0, Math.ceil(entries.length / this.slots.length) - 1);
    this.pageButtons.forEach((button, index) => {
      const enabled = index < 2 ? this.page > 0 : this.page < last;
      button.alpha = enabled ? 1 : .4; button.eventMode = enabled ? 'static' : 'none'; button.cursor = enabled ? 'pointer' : 'default';
    });
  }

  open(): void {
    if (this.isOpen) return;
    this.view.visible = true;
    this.syncCategorySelection();
    this.onVisibilityChange?.(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.view.visible = false;
    this.onVisibilityChange?.(false);
  }

  setHudScale(scale: number): void { this.view.scale.set(scale); }

  update(deltaMs: number): void {
    if (!this.isOpen || !this.categoryHolders.length || this.reducedMotion) return;
    const elapsed = Math.max(0, deltaMs);
    this.categoryPulseMs = (this.categoryPulseMs + elapsed) % CATEGORY_PULSE_DURATION_MS;
    this.categoryPulseDrawMs += elapsed;
    if (this.categoryPulseDrawMs < 50) return;
    this.categoryPulseDrawMs %= 50;
    drawCategorySelectionPulse(this.selectionEffect, this.categoryPulseMs, CATEGORY_PULSE_SCALE, false, CATEGORY_PULSE_STYLE);
  }

  private syncCategorySelection(): void {
    const holder = this.categoryHolders[this.categoryIndex];
    if (!holder) return;
    holder.addChildAt(this.selectionEffect, 0);
    this.categoryPulseMs = 0;
    this.categoryPulseDrawMs = 0;
    drawCategorySelectionPulse(this.selectionEffect, 0, CATEGORY_PULSE_SCALE, this.reducedMotion, CATEGORY_PULSE_STYLE);
  }

  private createButton(texture: Texture | undefined, size: number, onTap: () => void, fitWidth = false): Container {
    const holder = new Container();
    holder.eventMode = 'static';
    holder.cursor = 'pointer';
    holder.hitArea = new Rectangle(-size / 2, -size / 2, size, size);
    let icon: Sprite | Graphics;
    if (texture) {
      icon = new Sprite(texture);
      icon.anchor.set(0.5);
      icon.scale.set(size / (fitWidth ? texture.width : Math.max(texture.width, texture.height)));
      holder.hitArea = new Rectangle(-icon.width / 2, -icon.height / 2, icon.width, icon.height);
    } else {
      icon = new Graphics().roundRect(-size / 2, -size / 2, size, size, 12)
        .fill(0x06bc00).stroke({ color: 0x075e09, width: 3 })
        .moveTo(-14, 0).lineTo(-4, 10).lineTo(15, -12)
        .stroke({ color: 0xffffff, width: 6, cap: 'round', join: 'round' });
    }
    icon.eventMode = 'none';
    holder.addChild(icon);
    this.bindButtonFeedback(holder, icon);
    holder.on('pointertap', (event) => { event.stopPropagation(); onTap(); });
    return holder;
  }

  private bindButtonFeedback(holder: Container, face: Container): void {
    const baseScale = face.scale.x;
    let hovered = false;
    let pressed = false;
    const sync = () => {
      face.scale.set(baseScale * (pressed ? 0.9 : hovered ? 1.1 : 1));
      face.tint = pressed ? 0xd7ebff : 0xffffff;
    };
    holder.on('pointerover', () => { hovered = true; sync(); });
    holder.on('pointerout', () => { hovered = false; pressed = false; sync(); });
    holder.on('pointerdown', (event) => { event.stopPropagation(); pressed = true; sync(); });
    holder.on('pointerup', () => { pressed = false; sync(); });
    holder.on('pointerupoutside', () => { pressed = false; sync(); });
  }

  private itemPreviewTexture(texture: Texture): Texture {
    const cached = this.itemPreviewTextures.get(texture);
    if (cached) return cached;
    let preview = texture;
    try {
      // Measure the visible pixels once; world sprites keep their original framing.
      const frame = texture.frame;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(frame.width); canvas.height = Math.ceil(frame.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        const resolution = texture.source.resolution;
        context.drawImage(texture.source.resource as CanvasImageSource,
          frame.x * resolution, frame.y * resolution, frame.width * resolution, frame.height * resolution,
          0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          if (pixels[(y * canvas.width + x) * 4 + 3] <= 4) continue;
          left = Math.min(left, x); top = Math.min(top, y);
          right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
        if (right >= left && bottom >= top) {
          left = Math.max(0, left - 1); top = Math.max(0, top - 1);
          right = Math.min(canvas.width - 1, right + 1); bottom = Math.min(canvas.height - 1, bottom + 1);
          const sx = frame.width / canvas.width, sy = frame.height / canvas.height;
          if (left || top || right < canvas.width - 1 || bottom < canvas.height - 1) {
            preview = new Texture({ source: texture.source,
              frame: new Rectangle(frame.x + left * sx, frame.y + top * sy, (right - left + 1) * sx, (bottom - top + 1) * sy) });
          }
        }
      }
    } catch { /* Textures without a readable image retain their original frame. */ }
    this.itemPreviewTextures.set(texture, preview);
    return preview;
  }

  destroy(): void {
    this.close();
    if (!this.selectionEffect.parent) this.selectionEffect.destroy();
    this.view.destroy({ children: true });
    for (const [source, preview] of this.itemPreviewTextures) if (preview !== source) preview.destroy();
    this.itemPreviewTextures.clear();
    this.croppedTexture.destroy();
    this.topTabTexture?.destroy();
  }
}
