import { Container, Graphics, Sprite, type FederatedPointerEvent } from 'pixi.js';
import type { ArtProvider } from '../../game/indoor-art';
import { rotatedArt } from '../../game/indoor-art';
import { RoomInventoryClient, type RoomCatalogItem, type RoomSnapshot } from '../../game/room-inventory';
import type { RoomModel, RoomItem } from '../../world/RoomModel';
import { DEPTH_BIAS_WALLPAPER, FLOOR_DRAW_PRIORITY, screenToTile, tileToScreen, wallDepth, type Tile } from '../../world/iso';
import { wallGeometry } from '../../world/wallGeometry';
import { StoreActionBar, type StoreEntry } from './StoreActionBar';
import { createArtView, rotateFloorSprite, tileDiamond } from './iso-art';
import { createProceduralWallView } from './ProceduralWallView';
import { DoorView } from './DoorView';
import { clearRoomDepth, inheritRoomDepth, setItemRoomDepth } from './RoomDepthSorter';

function contains(points: readonly { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function validStorePlacement(item: RoomCatalogItem, tile: Tile, rotation: number, model: RoomModel, snapshot: RoomSnapshot, unitId?: string): boolean {
  const { tx: x, ty: y } = tile;
  if (!model.inside(x, y) || rotation < 0 || rotation > 3) return false;
  const wallPosition = (x === 0 && y > 0 && rotation % 2 === 0) || (y === 0 && x > 0 && rotation % 2 === 1);
  if (item.type === 1) return wallPosition;
  const wallDecoration = item.kind === 'window' || item.kind === 'panel';
  if (wallDecoration && !wallPosition) return false;
  if (item.kind === 'wall') return false;
  if (item.kind === 'door' && !((x === 1 && y > 0 && rotation % 2 === 0) || (y === 1 && x > 0 && rotation % 2 === 1))) return false;
  const sx = rotation % 2 ? item.sizeY : item.sizeX, sy = rotation % 2 ? item.sizeX : item.sizeY;
  if (!wallDecoration && (x < 1 || y < 1 || x + sx > model.tilesX || y + sy > model.tilesY)) return false;
  if (item.type === 0) return true;
  return !snapshot.inventory.some((other) => {
    const entry = snapshot.catalog.find((entry) => entry.id === other.itemId);
    if (!other.placed || other.unitId === unitId || !entry || entry.type < 2 || entry.kind === 'wall') return false;
    const ox = other.rotation % 2 ? entry.sizeY : entry.sizeX, oy = other.rotation % 2 ? entry.sizeX : entry.sizeY;
    return x < other.tx + ox && x + sx > other.tx && y < other.ty + oy && y + sy > other.ty;
  });
}

export class RoomStoreController {
  readonly cursorView = new Container();
  private snapshot: RoomSnapshot;
  private selection?: StoreEntry;
  private tile?: Tile;
  private rotation = 0;
  private dragging?: number;
  private cardDragStart?: { x: number; y: number };
  private cardDragMoved = false;
  private pointer?: { x: number; y: number };
  private overUI = false;
  private cursorImage?: Sprite;
  private busy = false;
  private inventory = false;
  private destroyed = false;
  private preview = new Container();
  private indicator = new Container();
  private previewDoor?: DoorView;
  private store?: StoreActionBar;

  constructor(private readonly options: {
    snapshot: RoomSnapshot; client: RoomInventoryClient; model: RoomModel; world: Container; art: ArtProvider;
    apply(snapshot: RoomSnapshot): void; alpha(unitId: string, alpha: number): void;
    canPlace?(item: RoomCatalogItem, tile: Tile, rotation: number, unitId?: string): boolean;
    isOverUI?(event: FederatedPointerEvent): boolean;
  }) {
    this.snapshot = options.snapshot;
    this.preview.label = 'store-placement-preview'; this.preview.eventMode = 'none';
    this.indicator.label = 'store-placement-indicator-layer'; this.indicator.eventMode = 'none';
    this.indicator.zIndex = FLOOR_DRAW_PRIORITY + 4;
    this.cursorView.label = 'store-cursor-preview'; this.cursorView.eventMode = 'none'; this.cursorView.visible = false;
    options.world.addChild(this.preview, this.indicator);
  }
  attach(store: StoreActionBar): void { this.store = store; this.refreshEntries(); }
  acceptShared(snapshot: RoomSnapshot): void {
    if (snapshot.revision < this.snapshot.revision) return;
    this.snapshot = snapshot; this.refreshEntries();
    if (!this.busy && this.selection) this.drawPreview();
  }
  onOpen(): void {
    this.store?.selectCategory('floor'); this.refreshEntries();
    this.message('Alt + arraste: mover. Shift + clique: girar. Ctrl + clique: guardar.');
  }
  onClose(): void {
    this.clearPreview();
    if (this.selection?.unit) this.options.alpha(this.selection.unit.unitId, 1);
    this.cancel();
  }
  onCategory(): void { this.cancel(); this.refreshEntries(); }
  toggleInventory(): void { this.cancel(); this.inventory = !this.inventory; this.refreshEntries(); }
  private message(text: string): void { this.store?.setMessage(text); }
  private refreshEntries(): void {
    const category = this.store?.selectedCategory;
    const categoryFor = (item: RoomCatalogItem): string => item.type === 0 ? 'floor' : item.type === 1 ? 'wallpaper' : item.type === 2 ? 'door'
      : ({ stove: 'stove', counter: 'counter', table: 'table', chair: 'chair', window: 'flower-window', panel: 'flower-window', bush: 'flower', letterbox: 'flower', decor: 'flower', wall: 'wallpaper', door: 'door' } as const)[item.kind];
    const texture = (item: RoomCatalogItem) => {
      const frame = this.options.art.art.get(item.classname)?.frames[0]; return frame ? this.options.art.textureFor(frame.file) : undefined;
    };
    const available = this.snapshot.catalog.filter((item) => item.kind !== 'wall' || item.type === 1);
    const matches = (item: RoomCatalogItem) => !category || categoryFor(item) === category;
    const stored = new Map<number, StoreEntry>();
    if (this.inventory) for (const unit of this.snapshot.inventory) {
        if (unit.placed) continue;
        const item = available.find((item) => item.id === unit.itemId);
        if (!item || !matches(item)) continue;
        const existing = stored.get(item.id);
        if (existing) existing.quantity = (existing.quantity ?? 1) + 1;
        else stored.set(item.id, { item, unit, quantity: 1, texture: texture(item) });
    }
    const entries: StoreEntry[] = this.inventory ? [...stored.values()]
      : available.filter((item) => item.purchasable && matches(item)).map((item) => ({ item, texture: texture(item) }));
    this.store?.setEntries(entries, this.inventory);
  }
  select(entry: StoreEntry): void {
    if (this.busy) return;
    this.cancel(); this.selection = entry; this.rotation = entry.unit?.rotation ?? 0;
    this.message(`${entry.item.name}: mova a prévia e clique para ${entry.unit ? 'colocar' : `comprar por ${entry.item.priceGold} ouro`}. R: girar. Esc: cancelar.${entry.unit ? ' Delete: guardar.' : ''}`);
    if (entry.unit?.placed) this.options.alpha(entry.unit.unitId, 0);
  }
  cancel(): boolean {
    if (this.busy) return Boolean(this.selection);
    const selected = Boolean(this.selection);
    if (this.selection?.unit) this.options.alpha(this.selection.unit.unitId, 1);
    this.selection = undefined; this.tile = undefined; this.dragging = undefined;
    this.cardDragStart = undefined; this.cardDragMoved = false; this.pointer = undefined; this.overUI = false;
    this.clearPreview(); this.cursorImage?.destroy(); this.cursorImage = undefined;
    return selected;
  }
  private clearPreview(): void {
    clearRoomDepth(this.preview);
    this.cursorView.visible = false;
    this.previewDoor?.destroy(); this.previewDoor = undefined;
    this.preview.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.indicator.removeChildren().forEach((child) => child.destroy({ children: true }));
  }
  private pickTile(event: FederatedPointerEvent): Tile {
    const point = this.options.world.toLocal(event.global);
    const item = this.selection!.item;
    if (item.type === 1 || item.kind === 'door' || item.kind === 'window' || item.kind === 'panel') {
      for (const wall of [...this.options.model.items].reverse()) {
        if (wall.kind !== 'wall' || (wall.tx === 0 && wall.ty === 0)) continue;
        const origin = tileToScreen(wall.tx, wall.ty);
        if (!contains(wallGeometry(wall.rotation, wall.wallHeight).face, point.x - origin.x, point.y - origin.y)) continue;
        this.rotation = wall.rotation;
        return item.kind === 'door' ? { tx: wall.tx + (wall.rotation % 2 === 0 ? 1 : 0), ty: wall.ty + (wall.rotation % 2 === 1 ? 1 : 0) }
          : { tx: wall.tx, ty: wall.ty };
      }
    }
    const tile = screenToTile(point.x, point.y);
    if (item.type === 1 || item.kind === 'window' || item.kind === 'panel') {
      if (tile.tx === 0) this.rotation = 0; else if (tile.ty === 0) this.rotation = 1;
    } else if (item.kind === 'door') {
      if (tile.tx === 1) this.rotation = 0; else if (tile.ty === 1) this.rotation = 1;
    }
    return tile;
  }
  hover(event: FederatedPointerEvent): void {
    if (!this.store?.isOpen || !this.selection || this.busy) return;
    if (this.dragging !== undefined && this.dragging !== event.pointerId) return;
    this.pointer = { x: event.global.x, y: event.global.y };
    if (this.cardDragStart && Math.hypot(this.pointer.x - this.cardDragStart.x, this.pointer.y - this.cardDragStart.y) >= 6) this.cardDragMoved = true;
    this.overUI = this.options.isOverUI?.(event) ?? this.store.containsGlobalPoint(event.global);
    this.tile = this.overUI ? undefined : this.pickTile(event);
    this.drawPreview();
  }
  private drawPreview(): void {
    this.clearPreview();
    if (!this.selection) return;
    const { item, unit } = this.selection, tile = this.tile;
    if (unit?.placed) this.options.alpha(unit.unitId, 0);
    if (this.overUI || !tile || !this.validPlacement(item, tile, this.rotation, unit?.unitId)) {
      if (!this.overUI && tile && this.options.model.inside(tile.tx, tile.ty)) {
        this.indicator.addChild(new Graphics().poly(tileDiamond(tile.tx, tile.ty))
          .fill({ color: 0xef4444, alpha: 0.35 }).stroke({ color: 0xdc2626, width: 3 }));
      }
      this.showCursorImage(); return;
    }
    const origin = tileToScreen(tile.tx, tile.ty);
    const indicator = new Graphics().poly(tileDiamond(tile.tx, tile.ty)).fill({ color: 0x4ade80, alpha: .35 }).stroke({ color: 0x16a34a, width: 3 });
    indicator.label = 'store-placement-indicator'; this.indicator.addChild(indicator);
    const entry = this.options.art.art.get(item.classname);
    if (!entry) return;
    const rotated = rotatedArt(entry, this.rotation), texture = this.options.art.textureFor(rotated.frame.file);
    if (!texture) return;
    const placement: RoomItem = {
      id: item.id, name: item.name, kind: item.kind, className: item.classname, ...tile, rotation: this.rotation,
      sizeX: this.rotation % 2 ? item.sizeY : item.sizeX, sizeY: this.rotation % 2 ? item.sizeX : item.sizeY,
      occlusionAnchor: this.options.model.items.find((existing) => unit && existing.inventoryUnitId === unit.unitId)?.occlusionAnchor
        ?? 'center',
    };
    let ghost: Container;
    if (item.type === 0) {
      const sprite = new Sprite(texture); sprite.position.set(origin.x + rotated.frame.left, origin.y + rotated.frame.top);
      rotateFloorSprite(sprite, rotated.frame, this.rotation);
      sprite.zIndex = FLOOR_DRAW_PRIORITY + 1.5; ghost = sprite;
    } else if (item.type === 1) {
      ghost = createProceduralWallView(placement, { frame: entry.frames[0], texture, sourceRotation: entry.wallpaperRotation });
      // Avoid a depth tie with the wall: stable sorting otherwise depends on drag direction.
      ghost.zIndex = wallDepth(tile.tx, tile.ty, DEPTH_BIAS_WALLPAPER);
      setItemRoomDepth(ghost, placement, ghost.zIndex);
    } else if (item.kind === 'door') {
      this.previewDoor = new DoorView(placement, rotated.frame, texture, entry.door); ghost = this.previewDoor.view;
    } else ghost = createArtView(placement, rotated.frame, texture);
    ghost.alpha = .45; ghost.eventMode = 'none'; ghost.label = 'store-placement-ghost'; this.preview.addChild(ghost);
    // The world sorts its direct children: the wrapper must share the item's depth.
    this.preview.zIndex = ghost.zIndex;
    inheritRoomDepth(this.preview, ghost);
  }
  private showCursorImage(): void {
    if (!this.selection || !this.pointer || !this.cursorView.parent) return;
    const entry = this.options.art.art.get(this.selection.item.classname);
    const frame = entry ? rotatedArt(entry, this.rotation).frame : undefined;
    const texture = this.selection.texture ?? (frame ? this.options.art.textureFor(frame.file) : undefined);
    if (!texture) return;
    if (!this.cursorImage) {
      this.cursorImage = new Sprite(texture); this.cursorImage.anchor.set(0.5);
      this.cursorImage.eventMode = 'none'; this.cursorImage.alpha = 0.85;
      this.cursorImage.label = 'store-cursor-image'; this.cursorView.addChild(this.cursorImage);
    } else this.cursorImage.texture = texture;
    this.cursorImage.scale.set(Math.min(1, 96 / texture.width, 96 / texture.height));
    const parent = this.cursorView.parent;
    parent.addChild(this.cursorView);
    this.cursorView.position.copyFrom(parent.toLocal(this.pointer)); this.cursorView.visible = true;
  }
  beginEntryDrag(entry: StoreEntry, event: FederatedPointerEvent): boolean {
    if (!this.store?.isOpen || this.busy || event.button !== 0) return false;
    this.select(entry); this.dragging = event.pointerId;
    this.cardDragStart = { x: event.global.x, y: event.global.y }; this.cardDragMoved = false;
    this.hover(event); event.stopPropagation(); return true;
  }
  beginDrag(event: FederatedPointerEvent, unitId?: string): boolean {
    if (!this.store?.isOpen || !event.altKey || this.busy || event.button !== 0) return false;
    const point = this.options.world.toLocal(event.global), tile = screenToTile(point.x, point.y);
    const unit = unitId ? this.snapshot.inventory.find((u) => u.unitId === unitId)
      : this.snapshot.inventory.find((u) => u.placed && u.tx === tile.tx && u.ty === tile.ty && this.snapshot.catalog.find((i) => i.id === u.itemId)?.type === 0);
    const item = this.snapshot.catalog.find((i) => i.id === unit?.itemId);
    if (!unit || !item || (item.kind === 'wall' && item.type !== 1)) return false;
    this.select({ item, unit }); this.dragging = event.pointerId; this.hover(event); event.stopPropagation(); return true;
  }
  endDrag(event: FederatedPointerEvent): boolean {
    if (this.dragging !== event.pointerId) return false;
    this.hover(event);
    const clickOnly = this.cardDragStart && !this.cardDragMoved;
    this.dragging = undefined; this.cardDragStart = undefined; this.cardDragMoved = false;
    if (!clickOnly) void this.commit();
    return true;
  }
  tap(event: FederatedPointerEvent): void {
    if (!this.store?.isOpen || this.busy || this.dragging !== undefined || !this.selection || event.altKey) return;
    this.hover(event); void this.commit();
  }
  interact(event: FederatedPointerEvent, unitId?: string): boolean {
    if (!this.store?.isOpen || (!event.ctrlKey && !event.shiftKey) || event.altKey) return false;
    event.stopPropagation();
    if (this.busy || this.dragging !== undefined) return true;
    const unit = this.snapshot.inventory.find((unit) => unit.unitId === unitId && unit.placed);
    const item = this.snapshot.catalog.find((item) => item.id === unit?.itemId);
    if (!unit || !item || (item.kind === 'wall' && item.type !== 1)) return true;
    this.select({ item, unit }); this.tile = { tx: unit.tx, ty: unit.ty };
    this.rotation = event.ctrlKey ? unit.rotation : (unit.rotation + 1) % 4;
    void this.commit(Boolean(event.ctrlKey)); return true;
  }
  key(event: KeyboardEvent): boolean {
    if (!this.store?.isOpen || !this.selection) return false;
    if (event.key === 'Escape') { this.cancel(); return true; }
    if (event.key.toLowerCase() === 'r') { this.rotation = (this.rotation + 1) % 4; this.drawPreview(); return true; }
    if (event.key === 'Delete' && this.selection.unit) { void this.commit(true); return true; }
    return false;
  }
  private async commit(store = false): Promise<void> {
    const selection = this.selection;
    if (!selection || this.busy) return;
    if (!store && (this.overUI || !this.tile || !this.validPlacement(selection.item, this.tile, this.rotation, selection.unit?.unitId))) {
      this.cancel();
      this.message(selection.unit ? 'Movimento cancelado: posição inválida.' : 'Colocação cancelada: posição inválida.'); return;
    }
    this.busy = true;
    const action = store ? 'store' : selection.unit ? 'move' : 'purchase';
    this.message('Salvando…');
    try {
      const snapshot = await this.options.client.mutate(action, this.snapshot.revision, {
        ...(selection.unit ? { unitId: selection.unit.unitId } : { itemId: selection.item.id }),
        ...(!store ? { ...this.tile!, rotation: this.rotation } : {}),
      });
      if (this.destroyed) return;
      this.snapshot = snapshot; this.options.apply(snapshot); this.busy = false; this.cancel(); this.refreshEntries();
      this.message(action === 'purchase' ? `${selection.item.name} comprado por ${selection.item.priceGold} ouro.` : store ? 'Item guardado no inventário.' : 'Posição salva.');
    } catch (error) {
      if (this.destroyed) return;
      const message = error instanceof Error ? error.message : 'Não foi possível salvar.';
      // Revisions and balances come from the server, including after a conflicting tab.
      try { const snapshot = await this.options.client.refresh(); if (this.destroyed) return; this.snapshot = snapshot; this.options.apply(snapshot); this.refreshEntries(); } catch { /* Keep the pending placement available for retry. */ }
      this.busy = false; this.cancel(); this.message(message);
    }
  }
  private validPlacement(item: RoomCatalogItem, tile: Tile, rotation: number, unitId?: string): boolean {
    return validStorePlacement(item, tile, rotation, this.options.model, this.snapshot, unitId) && (this.options.canPlace?.(item, tile, rotation, unitId) ?? true);
  }
  destroy(): void {
    this.destroyed = true; this.busy = false; this.cancel();
    this.preview.destroy({ children: true }); this.indicator.destroy({ children: true });
    this.cursorView.destroy({ children: true });
  }
}
