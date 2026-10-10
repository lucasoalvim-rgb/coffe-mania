import { Container, FillGradient, Graphics, Rectangle, Sprite, Text, TextStyle, type Texture } from 'pixi.js';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';
import type { CookingSpice, StoveCooking } from '../../game/cooking';
import { emptyPlayerState, type PlayerState } from '../../game/player-state';
import { canUseSpice, spiceDescription, SPICE_IDS, type SpiceId, type SpiceScreenTextures } from '../../game/spices';
import { playRandomSfx } from '../../audio/sfx';
import { SFX_BOOK_URLS } from '../../game/asset-manifest';
import { modalAnimationFrame, type ModalPhase } from './ModalAnimation';

export const SPICE_SCREEN_LAYOUT = {
  width: 1330, height: 600,
  card: { left: 127, top: 78, width: 173, height: 465, gap: 9 },
  icon: { x: 86.5, y: 179, width: 143, height: 96 },
  buy: { x: 9, y: 340, width: 154, height: 48 },
  use: { x: 9, y: 401, width: 154, height: 48 },
  close: { x: 1235, y: 16, size: 44 },
} as const;

const TITLES: Record<SpiceId, string> = {
  salt: 'Sal\nTurbinado', pepper: 'Pimenta\nPoderosa', thyme: 'Tomilho\nAcelerador',
  thyme_ultra: 'Tomilho\nUltrarrápido', instant: 'Condimento\nInstantâneo', sage: 'Sálvia\nSalvadora',
};

function text(value: string, size: number, color: number, extra: ConstructorParameters<typeof TextStyle>[0] = {}): Text {
  const label = new Text({ text: value, style: new TextStyle({
    fontFamily: ['Arial', 'sans-serif'], fontSize: size, fill: color,
    align: 'center', padding: 3, ...extra,
  }) });
  label.eventMode = 'none';
  return label;
}

/** As mesmas texturas servem a todos os cards; o estado desabilitado continua legível. */
class SpiceButton {
  readonly view = new Container();
  private readonly face: Sprite;
  private enabled = false;

  constructor(label: string, private readonly normal: Texture, private readonly disabled: Texture, onTap: () => void) {
    const { width, height } = SPICE_SCREEN_LAYOUT.buy;
    this.face = new Sprite(normal);
    this.face.width = width; this.face.height = height; this.face.eventMode = 'none';
    const title = text(label, 26, 0xffffff, { fontWeight: '700', stroke: { color: label === 'Comprar' ? 0x27802c : 0x266b7a, width: 2.5, join: 'round' } });
    title.anchor.set(0.5); title.position.set(width / 2, height / 2);
    this.view.addChild(this.face, title);
    this.view.hitArea = new Rectangle(0, 0, width, height);
    this.view.eventMode = 'static';
    this.view.on('pointertap', (event) => { event.stopPropagation(); if (this.enabled) onTap(); });
    this.view.on('pointerover', () => { if (this.enabled) this.face.tint = 0xe7ffdd; });
    this.view.on('pointerout', () => { this.face.tint = 0xffffff; });
    this.view.on('pointerdown', () => { if (this.enabled) this.face.tint = 0xc6ddbd; });
    this.view.on('pointerup', () => { this.face.tint = 0xffffff; });
    this.view.on('pointerupoutside', () => { this.face.tint = 0xffffff; });
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled && this.face.texture === (enabled ? this.normal : this.disabled)) return;
    this.enabled = enabled;
    this.face.texture = enabled ? this.normal : this.disabled;
    this.face.width = SPICE_SCREEN_LAYOUT.buy.width; this.face.height = SPICE_SCREEN_LAYOUT.buy.height;
    this.face.tint = 0xffffff;
    this.view.cursor = enabled ? 'pointer' : 'default';
  }
}

/** Card independente: arte restaurada, quantidade e regra dinâmica são camadas distintas. */
class SpiceCard {
  readonly view = new Container();
  private readonly quantity: Text;
  private readonly description: Text;
  private readonly buy: SpiceButton;
  private readonly use: SpiceButton;
  private readonly buyPrice: Text;

  constructor(readonly id: SpiceId, textures: SpiceScreenTextures, onBuy: () => void, onUse: () => void) {
    const { width, height } = SPICE_SCREEN_LAYOUT.card;
    this.view.label = `spice-card-${id}`;
    const gradient = new FillGradient({ colorStops: [
      { offset: 0, color: 0xd4b66b }, { offset: 0.55, color: 0xd6b974 }, { offset: 1, color: 0xd8b973 },
    ] });
    const background = new Graphics().roundRect(0, 0, width, height, 5).fill(gradient)
      .stroke({ color: 0xe1c780, width: 2 })
      .rect(7, 110, width - 14, 191).fill({ color: 0xffedbd, alpha: 0.24 });
    background.eventMode = 'none';
    const title = text(TITLES[id], 25, 0x30230e, { fontWeight: '700', lineHeight: 25 });
    title.anchor.set(0.5, 0); title.position.set(width / 2, 22);
    const art = new Sprite(textures.icons[id]); art.anchor.set(0.5); art.eventMode = 'none';
    const icon = SPICE_SCREEN_LAYOUT.icon;
    art.scale.set(Math.min(icon.width / art.texture.width, icon.height / art.texture.height));
    art.position.set(icon.x, icon.y); art.label = `spice-icon-${id}`;
    this.quantity = text('x0', 36, 0xffffff, { fontWeight: '900', stroke: { color: 0x593b1d, width: 6, join: 'round' } });
    this.quantity.label = `spice-stock-${id}`; this.quantity.anchor.set(0.5);
    this.quantity.position.set(94, 205);
    this.description = text('', 19, 0x94743d, { lineHeight: 22 });
    this.description.anchor.set(0.5, 0); this.description.position.set(width / 2, 234);
    this.buy = new SpiceButton('Comprar', textures.buy, textures.disabled, onBuy);
    this.use = new SpiceButton('Usar', textures.use, textures.disabled, onUse);
    this.buy.view.label = `spice-buy-${id}`; this.use.view.label = `spice-use-${id}`;
    this.buy.view.position.set(SPICE_SCREEN_LAYOUT.buy.x, SPICE_SCREEN_LAYOUT.buy.y);
    this.use.view.position.set(SPICE_SCREEN_LAYOUT.use.x, SPICE_SCREEN_LAYOUT.use.y);
    this.buyPrice = text('', 19, 0xffffff, { fontWeight: '700', stroke: { color: 0x573619, width: 3 } });
    this.buyPrice.anchor.set(0.5, 1); this.buyPrice.position.set(width / 2, SPICE_SCREEN_LAYOUT.buy.y - 4);
    this.buyPrice.visible = false;
    this.buy.view.on('pointerover', () => { this.buyPrice.visible = Boolean(this.buyPrice.text); });
    this.buy.view.on('pointerout', () => { this.buyPrice.visible = false; });
    this.view.addChild(background, title, art, this.quantity, this.description, this.buyPrice, this.buy.view, this.use.view);
  }

  setState(spice: CookingSpice | undefined, state: PlayerState, job: StoveCooking | null, now: number, busy: boolean): void {
    const count = state.spiceInventory?.[this.id] ?? 0;
    this.quantity.text = `x${count}`;
    this.quantity.scale.set(Math.min(1, 115 / this.quantity.getLocalBounds().width));
    this.description.text = spice ? spiceDescription(spice) : '';
    this.buyPrice.text = spice ? `${spice.granas} caféGrana${spice.granas === 1 ? '' : 's'}` : '';
    this.buy.setEnabled(Boolean(spice && !busy && state.cash >= spice.granas));
    this.use.setEnabled(Boolean(spice && !busy && count > 0 && canUseSpice(spice, job, now)));
  }
}

export interface SpiceScreenOptions {
  textures: SpiceScreenTextures;
  state?: PlayerState;
  spices?: readonly CookingSpice[];
  serverNow: () => number;
  onBuy: (id: SpiceId) => Promise<void>;
  onUse: (id: SpiceId) => Promise<void>;
  onClose?: () => void;
  onError?: (message: string) => void;
}

/** Modal fora da câmera: seis colunas na ordem da referência, com estoque privado do servidor. */
export class SpiceScreenModal {
  readonly view = new Container();
  private readonly panel = new Container();
  private readonly cards: SpiceCard[];
  private state: PlayerState;
  private spices: readonly CookingSpice[];
  private job: StoveCooking | null = null;
  private busy = false;
  private generation = 0;
  private readonly backdrop = new Graphics();
  private phase: ModalPhase = 'closed';
  private animTimer = 0;

  constructor(private readonly options: SpiceScreenOptions) {
    this.state = options.state ?? emptyPlayerState(); this.spices = options.spices ?? [];
    this.view.label = 'spice-screen-modal'; this.view.visible = false;
    this.backdrop.rect(-12000, -12000, 24000, 24000).fill(0x000000);
    this.backdrop.alpha = 0;
    this.backdrop.eventMode = 'static';
    this.backdrop.on('pointertap', (event) => { event.stopPropagation(); this.close(); });
    this.panel.label = 'spice-modal-window';
    this.panel.pivot.set(SPICE_SCREEN_LAYOUT.width / 2, SPICE_SCREEN_LAYOUT.height / 2);
    this.panel.position.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2);
    this.panel.eventMode = 'static'; this.panel.hitArea = new Rectangle(0, 0, SPICE_SCREEN_LAYOUT.width, SPICE_SCREEN_LAYOUT.height);
    this.panel.on('pointertap', (event) => event.stopPropagation());
    const background = new Sprite(options.textures.panel);
    background.width = SPICE_SCREEN_LAYOUT.width; background.height = SPICE_SCREEN_LAYOUT.height;
    background.eventMode = 'none'; this.panel.addChild(background);
    this.cards = SPICE_IDS.map((id, index) => {
      const card = new SpiceCard(id, options.textures, () => { void this.action('buy', id); }, () => { void this.action('use', id); });
      const layout = SPICE_SCREEN_LAYOUT.card;
      card.view.position.set(layout.left + index * (layout.width + layout.gap), layout.top);
      this.panel.addChild(card.view); return card;
    });
    const close = new Container(); close.label = 'spice-close';
    close.position.set(SPICE_SCREEN_LAYOUT.close.x, SPICE_SCREEN_LAYOUT.close.y);
    close.eventMode = 'static'; close.cursor = 'pointer';
    close.hitArea = new Rectangle(0, 0, SPICE_SCREEN_LAYOUT.close.size, SPICE_SCREEN_LAYOUT.close.size);
    const closeFace = new Sprite(options.textures.close);
    closeFace.width = SPICE_SCREEN_LAYOUT.close.size; closeFace.height = SPICE_SCREEN_LAYOUT.close.size;
    closeFace.eventMode = 'none'; close.addChild(closeFace);
    close.on('pointertap', (event) => { event.stopPropagation(); this.close(); });
    this.panel.addChild(close); this.view.addChild(this.backdrop, this.panel);
    window.addEventListener('keydown', this.onKeyDown);
    this.refresh();
  }

  get isOpen(): boolean { return this.phase !== 'closed'; }
  open(job: StoveCooking | null): void {
    this.job = job; this.refresh();
    if (this.phase === 'open' || this.phase === 'opening') return;
    playRandomSfx(SFX_BOOK_URLS);
    this.phase = 'opening'; this.animTimer = 0; this.view.visible = true;
    this.backdrop.alpha = 0; this.panel.alpha = 0; this.panel.scale.set(0.7);
  }
  close(): void {
    if (this.phase === 'closed' || this.phase === 'closing') return;
    this.phase = 'closing'; this.animTimer = 0; this.refresh(); this.options.onClose?.();
  }
  setPlayerState(state: PlayerState): void { this.state = state; this.refresh(); }
  setCooking(spices: readonly CookingSpice[], job: StoveCooking | null): void { this.spices = spices; this.job = job; this.refresh(); }
  update(deltaMs: number): void {
    if (!this.isOpen) return;
    this.refresh();
    if (this.phase !== 'opening' && this.phase !== 'closing') return;
    this.animTimer += Math.max(0, deltaMs);
    const frame = modalAnimationFrame(this.phase, this.animTimer);
    this.panel.scale.set(frame.scale); this.panel.alpha = frame.alpha; this.backdrop.alpha = frame.backdropAlpha;
    if (frame.finished) {
      if (this.phase === 'opening') this.phase = 'open';
      else { this.phase = 'closed'; this.view.visible = false; this.panel.scale.set(0.7); }
    }
  }

  private refresh(): void {
    const now = this.options.serverNow();
    this.cards.forEach((card) => card.setState(this.spices.find((spice) => spice.id === card.id), this.state, this.job, now, this.busy || this.phase === 'closing'));
  }

  private async action(kind: 'buy' | 'use', id: SpiceId): Promise<void> {
    const spice = this.spices.find((candidate) => candidate.id === id);
    if (this.busy || !spice || !this.isOpen || this.phase === 'closing') return;
    if (kind === 'buy' ? this.state.cash < spice.granas : !(this.state.spiceInventory?.[id] && canUseSpice(spice, this.job, this.options.serverNow()))) return;
    this.busy = true; this.refresh();
    const generation = this.generation;
    try { await (kind === 'buy' ? this.options.onBuy(id) : this.options.onUse(id)); }
    catch (error) { if (generation === this.generation) this.options.onError?.(error instanceof Error ? error.message : 'Não foi possível aplicar a ação.'); }
    finally { if (generation === this.generation) { this.busy = false; this.refresh(); } }
  }

  private onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape' && this.isOpen) { event.preventDefault(); this.close(); } };

  destroy(): void { this.generation++; window.removeEventListener('keydown', this.onKeyDown); this.view.destroy({ children: true }); }
}
