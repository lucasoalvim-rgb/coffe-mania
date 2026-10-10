import { Assets, Container, FillGradient, Graphics, NineSliceSprite, Rectangle, Sprite, Text, TextStyle, Texture } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../core/stage';
import { cookingTime, type OwnedStove } from '../../game/cooking';
import { DevToolsClient, type DevCommand, type DevSnapshot, type DevStoveCommand } from '../../game/dev-tools';
import { UI_RECIPE_BOOK_URLS, UI_TOP_BARS_URLS } from '../../game/asset-manifest';
import { recipeBookTimeLabel, type RecipeArt } from '../../game/recipes';
import { loadSpiceScreenTextures, SPICE_IDS, type SpiceScreenTextures } from '../../game/spices';
import { modalAnimationFrame, type ModalPhase } from './ModalAnimation';
import { TOP_BAR_ICON_FRAMES } from './TopBars';

const assetBase = new URL('assets/ui/', new URL(import.meta.env.BASE_URL ?? '/', document.baseURI));
const asset = (path: string) => new URL(path, assetBase).href;

/** The panel is the Spices window without its title; see assets/ui/dev/source.json. */
export interface DevToolsTextures {
  panel: Texture;
  swirls: { left: Texture; right: Texture };
  spices: SpiceScreenTextures;
  tabs: { normal: Texture; hover: Texture; active: Texture };
  pageArrow: Texture;
  /** caféGrana, caféOuro, XP, energia e suprimentos, recortados do atlas da HUD. */
  icons: { cash: Texture; gold: Texture; xp: Texture; energy: Texture; crates: Texture };
  stove: Texture;
  counter: Texture;
}

let texturesPromise: Promise<DevToolsTextures> | undefined;

/** Loaded on first use so the developer menu never delays entering the café. */
export function loadDevToolsTextures(): Promise<DevToolsTextures> {
  texturesPromise ??= (async () => {
    const [panel, left, right, normal, hover, active, pageArrow, atlas, stove, counter, spices] = await Promise.all([
      ...['dev/panel.png', 'dev/swirl-left.png', 'dev/swirl-right.png'].map((path) => Assets.load<Texture>(asset(path))),
      Assets.load<Texture>(UI_RECIPE_BOOK_URLS.tab),
      Assets.load<Texture>(UI_RECIPE_BOOK_URLS.tabHover),
      Assets.load<Texture>(UI_RECIPE_BOOK_URLS.tabActive),
      Assets.load<Texture>(UI_RECIPE_BOOK_URLS.pageArrow),
      Assets.load<Texture>(UI_TOP_BARS_URLS.icons),
      Assets.load<Texture>(asset('store-icons/stove.png')),
      Assets.load<Texture>(asset('store-icons/counter.png')),
      loadSpiceScreenTextures(),
    ]) as [Texture, Texture, Texture, Texture, Texture, Texture, Texture, Texture, Texture, Texture, SpiceScreenTextures];
    for (const texture of [panel, left, right, atlas, stove, counter]) {
      texture.source.scaleMode = 'linear';
      texture.source.autoGenerateMipmaps = true;
    }
    const icon = (index: number) => {
      const frame = TOP_BAR_ICON_FRAMES[index];
      return new Texture({ source: atlas.source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
    };
    return {
      panel, swirls: { left, right }, spices, tabs: { normal, hover, active }, pageArrow,
      icons: { cash: icon(0), gold: icon(1), xp: icon(2), energy: icon(3), crates: icon(4) },
      stove, counter,
    };
  })();
  texturesPromise.catch(() => { texturesPromise = undefined; });
  return texturesPromise;
}

const PANEL = { width: 1400, height: 820 } as const;
const CONTENT = { x: 48, y: 128, width: 1304, height: 584 } as const;
const COLORS = {
  ink: 0x30230e, soft: 0x6e5229, cream: 0xf3e6cf, tabShadow: 0x5a3e1e,
  title: 0xf6dcae, titleStroke: 0x5b3311, error: 0xb3261e, ok: 0x2f6b1f,
} as const;

type Tab = 'resources' | 'kitchen' | 'counters' | 'customers';
const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'resources', label: 'Recursos' },
  { id: 'kitchen', label: 'Fogões' },
  { id: 'counters', label: 'Balcões' },
  { id: 'customers', label: 'Clientes' },
];

type ButtonColor = 'green' | 'blue' | 'gray';
const BUTTON_STROKES: Record<ButtonColor, number> = { green: 0x27802c, blue: 0x266b7a, gray: 0x5f5f5f };

function style(size: number, fill: number, extra: ConstructorParameters<typeof TextStyle>[0] = {}): TextStyle {
  return new TextStyle({ fontFamily: [FONT_FAMILY, 'sans-serif'], fontWeight: '600', fontSize: size, fill, padding: 4, ...extra });
}

function label(text: string, size: number, fill: number = COLORS.ink, extra: ConstructorParameters<typeof TextStyle>[0] = {}): Text {
  const value = new Text({ text, style: style(size, fill, extra) });
  value.eventMode = 'none';
  return value;
}

const integer = new Intl.NumberFormat('pt-BR');
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Customers per minute shown to the developer. Mirrors game-server/gameruntime/customers.go,
 * which owns the rule; this copy is only a readout.
 */
export function customersPerMinute(popularity: number, level: number): number {
  const bands = [[5, 5], [15, 7], [25, 10], [35, 13], [45, 15], [55, 16], [65, 17], [75, 19], [85, 22], [95, 25]] as const;
  let perMinute: number = bands[0][1];
  for (const [from, value] of bands) if (popularity >= from) perMinute = value;
  return perMinute + (level >= 30 ? 3 : level >= 10 ? 2 : 0);
}

/** Spice-window buttons stretched by nine-slice; label and colour are layers. */
class DevButton {
  readonly view = new Container();
  private readonly face: NineSliceSprite;
  private enabled = true;

  constructor(private readonly textures: SpiceScreenTextures, text: string, width: number, height: number,
    private readonly color: ButtonColor, onTap: () => void) {
    const source = color === 'green' ? textures.buy : color === 'blue' ? textures.use : textures.disabled;
    const scale = height / source.height;
    this.face = new NineSliceSprite({ texture: source, leftWidth: 80, rightWidth: 80, topHeight: 60, bottomHeight: 60 });
    this.face.width = width / scale;
    this.face.height = source.height;
    this.face.scale.set(scale);
    this.face.eventMode = 'none';
    const caption = label(text, Math.round(height * 0.46), 0xffffff, { fontWeight: '700', stroke: { color: BUTTON_STROKES[color], width: 3, join: 'round' } });
    caption.anchor.set(0.5);
    caption.position.set(width / 2, height / 2);
    if (caption.width > width - 16) caption.scale.set((width - 16) / caption.width);
    this.view.addChild(this.face, caption);
    this.view.hitArea = new Rectangle(0, 0, width, height);
    this.view.eventMode = 'static';
    this.view.cursor = 'pointer';
    this.view.on('pointertap', (event) => { event.stopPropagation(); if (this.enabled) onTap(); });
    this.view.on('pointerover', () => { if (this.enabled) this.face.tint = 0xe7ffdd; });
    this.view.on('pointerout', () => { this.face.tint = 0xffffff; });
    this.view.on('pointerdown', () => { if (this.enabled) this.face.tint = 0xc6ddbd; });
    this.view.on('pointerup', () => { this.face.tint = 0xffffff; });
    this.view.on('pointerupoutside', () => { this.face.tint = 0xffffff; });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.face.texture = enabled
      ? (this.color === 'green' ? this.textures.buy : this.color === 'blue' ? this.textures.use : this.textures.disabled)
      : this.textures.disabled;
    this.face.tint = 0xffffff;
    this.view.cursor = enabled ? 'pointer' : 'default';
    this.view.alpha = enabled ? 1 : 0.4;
  }
}

export interface DevToolsModalOptions {
  textures: DevToolsTextures;
  client?: DevToolsClient;
  recipes: () => readonly RecipeArt[];
  /** Placed counters in the room, in the order the room lists them. */
  counters: () => readonly { id: string; tx: number; ty: number }[];
  customerCount: () => number;
  /** Applies the confirmed player state to the HUD before the realtime echo arrives. */
  onSnapshot?: (snapshot: DevSnapshot) => void;
  onClose?: () => void;
}

/**
 * Developer menu in the game's own art. Every action is a server command with a receipt:
 * the panel shows only confirmed snapshots and never edits values locally.
 */
export class DevToolsModal {
  readonly view = new Container();
  private readonly panel = new Container();
  private readonly backdrop = new Graphics();
  private readonly tabsLayer = new Container();
  private readonly content = new Container();
  private readonly footer = new Container();
  private readonly status: Text;
  private readonly client: DevToolsClient;
  private readonly textures: DevToolsTextures;
  private snapshot?: DevSnapshot;
  private serverOffset = 0;
  private tab: Tab = 'resources';
  private stovePage = 0;
  private recipeIndex = 0;
  private busy = false;
  private phase: ModalPhase = 'closed';
  private animTimer = 0;
  private clockTimer = 0;
  private generation = 0;
  private liveTexts: (() => void)[] = [];

  constructor(private readonly options: DevToolsModalOptions) {
    this.textures = options.textures;
    this.client = options.client ?? new DevToolsClient();
    this.view.label = 'dev-tools-modal';
    this.view.visible = false;
    this.backdrop.rect(-12000, -12000, 24000, 24000).fill(0x000000);
    this.backdrop.alpha = 0;
    this.backdrop.eventMode = 'static';
    this.backdrop.on('pointertap', (event) => { event.stopPropagation(); this.close(); });
    for (const name of ['pointerdown', 'pointerup', 'wheel'] as const) this.backdrop.on(name, (event) => event.stopPropagation());

    this.panel.label = 'dev-tools-window';
    this.panel.pivot.set(PANEL.width / 2, PANEL.height / 2);
    this.panel.position.set(STAGE_WIDTH / 2, STAGE_HEIGHT / 2);
    this.panel.eventMode = 'static';
    this.panel.hitArea = new Rectangle(0, 0, PANEL.width, PANEL.height);
    for (const name of ['pointerdown', 'pointerup', 'pointertap', 'wheel'] as const) this.panel.on(name, (event) => event.stopPropagation());

    const frame = new NineSliceSprite({ texture: this.textures.panel, leftWidth: 60, rightWidth: 60, topHeight: 80, bottomHeight: 60 });
    frame.width = PANEL.width;
    frame.height = PANEL.height;
    frame.eventMode = 'none';
    this.panel.addChild(frame);
    this.buildTitle();

    const card = new FillGradient({ colorStops: [
      { offset: 0, color: 0xd4b66b }, { offset: 0.55, color: 0xd6b974 }, { offset: 1, color: 0xd8b973 },
    ] });
    const sheet = new Graphics().roundRect(CONTENT.x, CONTENT.y, CONTENT.width, CONTENT.height, 10).fill(card)
      .stroke({ color: 0xe1c780, width: 2 });
    sheet.eventMode = 'none';
    this.status = label('', 22, COLORS.cream, { stroke: { color: COLORS.tabShadow, width: 4, join: 'round' } });
    this.status.anchor.set(0, 0.5);
    this.status.position.set(64, 752);
    this.panel.addChild(sheet, this.tabsLayer, this.content, this.footer, this.status);
    this.buildClose();
    this.view.addChild(this.backdrop, this.panel);
    window.addEventListener('keydown', this.onKeyDown);
    this.renderTabs();
    this.render();
  }

  get isOpen(): boolean { return this.phase !== 'closed'; }

  open(): void {
    if (this.phase === 'open' || this.phase === 'opening') return;
    this.phase = 'opening';
    this.animTimer = 0;
    this.view.visible = true;
    this.backdrop.alpha = 0;
    this.panel.alpha = 0;
    this.panel.scale.set(0.7);
    void this.refresh();
  }

  close(): void {
    if (this.phase === 'closed' || this.phase === 'closing') return;
    this.phase = 'closing';
    this.animTimer = 0;
    this.options.onClose?.();
  }

  update(deltaMs: number): void {
    if (!this.isOpen) return;
    this.clockTimer += deltaMs;
    if (this.clockTimer >= 1000) {
      this.clockTimer = 0;
      this.liveTexts.forEach((refresh) => refresh());
    }
    if (this.phase !== 'opening' && this.phase !== 'closing') return;
    this.animTimer += Math.max(0, deltaMs);
    const frame = modalAnimationFrame(this.phase, this.animTimer);
    this.panel.scale.set(frame.scale);
    this.panel.alpha = frame.alpha;
    this.backdrop.alpha = frame.backdropAlpha;
    if (frame.finished) {
      if (this.phase === 'opening') this.phase = 'open';
      else { this.phase = 'closed'; this.view.visible = false; this.panel.scale.set(0.7); }
    }
  }

  private buildTitle(): void {
    const title = label('Modo Dev', 50, COLORS.title, { fontWeight: '700', stroke: { color: COLORS.titleStroke, width: 11, join: 'round' } });
    title.anchor.set(0.5, 0.5);
    title.position.set(PANEL.width / 2, 34);
    const left = new Sprite(this.textures.swirls.left);
    const right = new Sprite(this.textures.swirls.right);
    // The swirls were cut at y = 6 of the original top border, which nine-slice keeps unscaled.
    left.position.set(title.x - title.width / 2 - left.width - 4, 6);
    right.position.set(title.x + title.width / 2 + 4, 6);
    for (const piece of [left, right]) piece.eventMode = 'none';
    this.panel.addChild(left, right, title);
  }

  private buildClose(): void {
    const close = new Container();
    close.label = 'dev-tools-close';
    close.position.set(PANEL.width - 92, 18);
    close.eventMode = 'static';
    close.cursor = 'pointer';
    close.hitArea = new Rectangle(0, 0, 46, 46);
    const face = new Sprite(this.textures.spices.close);
    face.width = 46;
    face.height = 46;
    face.eventMode = 'none';
    close.addChild(face);
    close.on('pointertap', (event) => { event.stopPropagation(); this.close(); });
    this.panel.addChild(close);
  }

  private renderTabs(): void {
    this.tabsLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    const width = 230;
    TABS.forEach((tab, index) => {
      const active = tab.id === this.tab;
      const height = active ? 54 : 48;
      const button = new Container();
      button.label = `dev-tools-tab-${tab.id}`;
      button.position.set(CONTENT.x + 16 + index * (width + 8), CONTENT.y - height + 2);
      const background = new NineSliceSprite({
        texture: active ? this.textures.tabs.active : this.textures.tabs.normal,
        leftWidth: 24, rightWidth: 24, topHeight: 24, bottomHeight: 12,
      });
      background.width = width;
      background.height = height;
      const caption = active
        ? label(tab.label, 25, 0xffffff, { stroke: { color: 0xa4520c, width: 4, join: 'round' } })
        : label(tab.label, 23, COLORS.cream, { stroke: { color: COLORS.tabShadow, width: 3, join: 'round' } });
      caption.anchor.set(0.5);
      caption.position.set(width / 2, height / 2 + 1);
      button.addChild(background, caption);
      if (!active) {
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointerover', () => { background.texture = this.textures.tabs.hover; });
        button.on('pointerout', () => { background.texture = this.textures.tabs.normal; });
        button.on('pointertap', (event) => {
          event.stopPropagation();
          this.tab = tab.id;
          this.renderTabs();
          this.render();
        });
      }
      this.tabsLayer.addChild(button);
    });
  }

  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.setStatus('Carregando…');
    try {
      this.accept(await this.client.refresh());
      if (generation === this.generation) this.setStatus('');
    } catch (error) {
      if (generation === this.generation) this.setStatus(error instanceof Error ? error.message : 'Falha ao carregar.', true);
    }
  }

  private accept(snapshot: DevSnapshot): void {
    this.snapshot = snapshot;
    this.serverOffset = cookingTime(snapshot.cooking.serverNow) - Date.now();
    this.options.onSnapshot?.(snapshot);
    this.render();
  }

  /** Without a command, retries the unconfirmed one with its original receipt. */
  private async run(command: DevCommand | undefined, done: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setStatus('Enviando ao servidor…');
    const generation = this.generation;
    try {
      const snapshot = command ? await this.client.execute(command) : await this.client.retry();
      if (generation !== this.generation) return;
      this.accept(snapshot);
      this.setStatus(done, false, true);
    } catch (error) {
      if (generation === this.generation) this.setStatus(error instanceof Error ? error.message : 'Comando recusado.', true);
    } finally {
      this.busy = false;
      this.renderFooter();
    }
  }

  private setStatus(message: string, error = false, success = false): void {
    this.status.text = message;
    this.status.style.fill = error ? 0xffd2c8 : success ? 0xe3ffd2 : COLORS.cream;
    this.status.scale.set(1);
    if (this.status.width > 500) this.status.scale.set(500 / this.status.width);
    this.renderFooter();
  }

  private renderFooter(): void {
    this.footer.removeChildren().forEach((child) => child.destroy({ children: true }));
    const buttons: DevButton[] = [];
    if (this.client.hasPending) {
      buttons.push(new DevButton(this.textures.spices, 'Tentar novamente', 230, 50, 'blue', () => { void this.run(undefined, 'Comando confirmado.'); }));
      buttons.push(new DevButton(this.textures.spices, 'Descartar', 160, 50, 'gray', () => { this.client.discard(); void this.refresh(); }));
    }
    buttons.push(new DevButton(this.textures.spices, 'Encher tudo', 180, 50, 'green', () => {
      void this.run({ command: 'refill' }, 'Energia, suprimentos e popularidade no máximo.');
    }));
    buttons.push(new DevButton(this.textures.spices, 'Atualizar', 160, 50, 'blue', () => { void this.refresh(); }));
    let x = PANEL.width - 56;
    for (const button of buttons.reverse()) {
      const width = button.view.hitArea instanceof Rectangle ? button.view.hitArea.width : 160;
      x -= width;
      button.view.position.set(x, 728);
      x -= 12;
      this.footer.addChild(button.view);
    }
  }

  private render(): void {
    this.liveTexts = [];
    this.content.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (!this.snapshot) {
      const waiting = label('Aguardando o servidor…', 30, COLORS.soft);
      waiting.anchor.set(0.5);
      waiting.position.set(CONTENT.x + CONTENT.width / 2, CONTENT.y + CONTENT.height / 2);
      this.content.addChild(waiting);
      return;
    }
    if (this.tab === 'resources') this.renderResources(this.snapshot);
    else if (this.tab === 'kitchen') this.renderKitchen(this.snapshot);
    else if (this.tab === 'counters') this.renderCounters(this.snapshot);
    else this.renderCustomers(this.snapshot);
  }

  private button(text: string, x: number, y: number, width: number, color: ButtonColor, command: DevCommand | (() => void), done = 'Feito.', enabled = true): DevButton {
    const button = new DevButton(this.textures.spices, text, width, 44, color, () => {
      if (typeof command === 'function') command();
      else void this.run(command, done);
    });
    button.view.position.set(x, y);
    button.setEnabled(enabled);
    this.content.addChild(button.view);
    return button;
  }

  private icon(texture: Texture, x: number, y: number, size: number): Sprite {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.scale.set(size / Math.max(texture.width, texture.height));
    sprite.position.set(x, y);
    sprite.eventMode = 'none';
    this.content.addChild(sprite);
    return sprite;
  }

  private text(value: string, x: number, y: number, size = 26, fill: number = COLORS.ink, anchorX = 0): Text {
    const text = label(value, size, fill);
    text.anchor.set(anchorX, 0.5);
    text.position.set(x, y);
    this.content.addChild(text);
    return text;
  }

  /** Popularity has no HUD icon in the atlas; a smile in the panel's palette marks the row. */
  private smile(x: number, y: number): void {
    const face = new Graphics().circle(x, y, 22).fill(0xffd34d).stroke({ color: 0xa4520c, width: 3 })
      .circle(x - 8, y - 6, 3.5).fill(0x5a3e1e).circle(x + 8, y - 6, 3.5).fill(0x5a3e1e)
      .moveTo(x + 12 * Math.cos(0.2 * Math.PI), y + 1 + 12 * Math.sin(0.2 * Math.PI))
      .arc(x, y + 1, 12, 0.2 * Math.PI, 0.8 * Math.PI).stroke({ color: 0x5a3e1e, width: 3.5, cap: 'round' });
    face.eventMode = 'none';
    this.content.addChild(face);
  }

  private resourceRow(y: number, name: string, value: string, draw: () => void, steps: readonly (readonly [string, DevCommand, ButtonColor?])[]): void {
    draw();
    this.text(name, 128, y, 26);
    this.text(value, 360, y, 26, COLORS.soft);
    let x = 640;
    for (const [caption, command, color] of steps) {
      const width = Math.max(84, caption.length * 12 + 24);
      this.button(caption, x, y - 22, width, color ?? (command.mode === 'add' && (command.value ?? 0) < 0 ? 'gray' : 'green'), command, `${name}: ${caption}`);
      x += width + 8;
    }
  }

  private renderResources(snapshot: DevSnapshot): void {
    const state = snapshot.playerState;
    const top = CONTENT.y + 40;
    const row = 62;
    const add = (resource: string, value: number): DevCommand => ({ command: 'resource', resource, mode: 'add', value });
    const set = (resource: string, value: number): DevCommand => ({ command: 'resource', resource, mode: 'set', value });
    const icons = this.textures.icons;
    this.resourceRow(top, 'caféGranas', integer.format(state.cash), () => this.icon(icons.cash, 90, top, 46), [
      ['−100', add('cash', -100)], ['+10', add('cash', 10)], ['+100', add('cash', 100)], ['+1.000', add('cash', 1000)], ['Zerar', set('cash', 0), 'gray'],
    ]);
    this.resourceRow(top + row, 'caféOuros', integer.format(state.gold), () => this.icon(icons.gold, 90, top + row, 46), [
      ['−10 mil', add('gold', -10000)], ['+1.000', add('gold', 1000)], ['+10 mil', add('gold', 10000)], ['+100 mil', add('gold', 100000)], ['+1 milhão', add('gold', 1000000)], ['Zerar', set('gold', 0), 'gray'],
    ]);
    this.resourceRow(top + 2 * row, 'Nível', `${state.level} de ${snapshot.maxLevel}`, () => this.icon(icons.xp, 90, top + 2 * row, 50), [
      ['−10', add('level', -10)], ['−1', add('level', -1)], ['+1', add('level', 1)], ['+10', add('level', 10)], ['Máximo', set('level', snapshot.maxLevel), 'blue'],
    ]);
    const missing = Math.max(0, state.experience.maximum - state.experience.current);
    this.resourceRow(top + 3 * row, 'XP', integer.format(state.experience.current), () => this.icon(icons.xp, 90, top + 3 * row, 40), [
      ['+10', add('experience', 10)], ['+100', add('experience', 100)], ['+1.000', add('experience', 1000)], ['+10 mil', add('experience', 10000)],
      ['Subir de nível', add('experience', Math.max(1, missing)), 'blue'],
    ]);
    if (state.level < snapshot.maxLevel) this.text(`faltam ${integer.format(missing)} para o nível ${state.level + 1}`, 360, top + 3 * row + 24, 17, COLORS.soft);
    this.resourceRow(top + 4 * row, 'Energia', `${state.energy.current}/${state.energy.maximum}`, () => this.icon(icons.energy, 90, top + 4 * row, 46), [
      ['−10', add('energy', -10)], ['−1', add('energy', -1)], ['+1', add('energy', 1)], ['+10', add('energy', 10)], ['Encher', set('energy', state.energy.maximum), 'blue'],
    ]);
    this.resourceRow(top + 5 * row, 'Suprimentos', `${state.crates.current}/${state.crates.maximum}`, () => this.icon(icons.crates, 90, top + 5 * row, 46), [
      ['−1', add('crates', -1)], ['+1', add('crates', 1)], ['Zerar', set('crates', 0), 'gray'], ['Encher', set('crates', state.crates.maximum), 'blue'],
      ['Capacidade +4', add('crates_max', 4)],
    ]);
    this.resourceRow(top + 6 * row, 'Popularidade', `${decimal.format(state.satisfaction.current)} / ${integer.format(state.satisfaction.maximum)}`, () => this.smile(90, top + 6 * row), [
      ['−10', add('satisfaction', -10)], ['−1', add('satisfaction', -1)], ['+1', add('satisfaction', 1)], ['+10', add('satisfaction', 10)],
      ['Mínimo', set('satisfaction', 5), 'gray'], ['Máximo', set('satisfaction', 105), 'blue'],
    ]);

    // Spices: one column per spice, in the same order as the Spices window.
    const spiceY = top + 7 * row + 22;
    this.text('Temperos', 128, spiceY, 26);
    SPICE_IDS.forEach((id, index) => {
      const x = 360 + index * 150;
      this.icon(this.textures.spices.icons[id], x + 22, spiceY - 4, 58);
      this.text(`x${state.spiceInventory?.[id] ?? 0}`, x + 58, spiceY - 12, 22, COLORS.ink);
      this.button('+5', x + 58, spiceY + 2, 66, 'green', add(`spice:${id}`, 5), `Tempero +5`);
    });
  }

  private stoveStatus(stove: OwnedStove): string {
    const job = stove.cooking;
    const recipe = job ? this.options.recipes().find((candidate) => candidate.id === job.recipeId) : undefined;
    const name = recipe?.name ?? job?.recipeId ?? '';
    if (!job) return stove.dirty ? 'Sujo' : 'Vazio e limpo';
    const now = Date.now() + this.serverOffset;
    const ready = cookingTime(job.readyAt);
    const spoils = cookingTime(job.spoilsAt);
    if (now < ready) return `${name}: pronto em ${recipeBookTimeLabel(Math.max(1, (ready - now) / 1000))}`;
    if (now < spoils) return `${name}: pronto, estraga em ${recipeBookTimeLabel(Math.max(1, (spoils - now) / 1000))}`;
    return `${name}: estragado`;
  }

  private renderKitchen(snapshot: DevSnapshot): void {
    const top = CONTENT.y + 22;
    const actions: readonly [string, DevStoveCommand, ButtonColor][] = [
      ['Terminar', 'finish', 'green'], ['Estragar', 'spoil', 'gray'], ['Limpar', 'clean', 'blue'], ['Sujar', 'dirty', 'gray'], ['Esvaziar', 'empty', 'gray'],
    ];
    this.icon(this.textures.stove, 92, top + 24, 54);
    this.text('Todos os fogões', 136, top + 24, 26);
    actions.forEach(([caption, command, color], index) => {
      this.button(caption, 640 + index * 136, top + 2, 128, color, { command }, `Todos os fogões: ${caption.toLowerCase()}.`);
    });
    const stoves = snapshot.cooking.stoves;
    const perPage = 6;
    const pages = Math.max(1, Math.ceil(stoves.length / perPage));
    this.stovePage = Math.min(this.stovePage, pages - 1);
    stoves.slice(this.stovePage * perPage, (this.stovePage + 1) * perPage).forEach((stove, index) => {
      const y = top + 74 + index * 72;
      const row = new NineSliceSprite({ texture: this.textures.spices.stove.row, leftWidth: 30, rightWidth: 30, topHeight: 30, bottomHeight: 30 });
      row.position.set(CONTENT.x + 14, y);
      row.width = CONTENT.width - 28;
      row.height = 64;
      row.eventMode = 'none';
      this.content.addChild(row);
      const number = this.stovePage * perPage + index + 1;
      this.icon(this.textures.stove, 92, y + 32, 46);
      this.text(`Fogão ${number}`, 136, y + 20, 23);
      this.text(`tile ${stove.tx},${stove.ty}`, 136, y + 45, 16, COLORS.soft);
      const status = this.text(this.stoveStatus(stove), 270, y + 32, 21, COLORS.soft);
      if (status.width > 350) status.scale.set(350 / status.width);
      this.liveTexts.push(() => { if (!status.destroyed) status.text = this.stoveStatus(stove); });
      const enabled: Record<DevStoveCommand, boolean> = {
        finish: Boolean(stove.cooking), spoil: Boolean(stove.cooking), clean: stove.dirty || Boolean(stove.cooking),
        dirty: !stove.dirty, empty: Boolean(stove.cooking),
      };
      actions.forEach(([caption, command, color], column) => {
        this.button(caption, 640 + column * 136, y + 10, 128, color, { command, stoveId: stove.id }, `Fogão ${number}: ${caption.toLowerCase()}.`, enabled[command]);
      });
    });
    if (stoves.length === 0) this.text('Nenhum fogão colocado no café.', 136, top + 110, 24, COLORS.soft);
    if (pages > 1) this.pager(this.stovePage, pages, (page) => { this.stovePage = page; this.render(); });
  }

  private pager(page: number, pages: number, go: (page: number) => void): void {
    const y = CONTENT.y + CONTENT.height - 34;
    const make = (direction: -1 | 1, x: number) => {
      const arrow = new Sprite(this.textures.pageArrow);
      arrow.anchor.set(0.5);
      // The art points left: the previous-page arrow keeps it, the next one mirrors it.
      arrow.scale.set(-direction * 0.55, 0.55);
      arrow.position.set(x, y);
      const enabled = page + direction >= 0 && page + direction < pages;
      arrow.alpha = enabled ? 1 : 0.4;
      arrow.eventMode = enabled ? 'static' : 'none';
      arrow.cursor = 'pointer';
      arrow.on('pointertap', (event) => { event.stopPropagation(); go(page + direction); });
      this.content.addChild(arrow);
    };
    make(-1, CONTENT.x + CONTENT.width / 2 - 70);
    this.text(`${page + 1}/${pages}`, CONTENT.x + CONTENT.width / 2, y, 22, COLORS.ink, 0.5);
    make(1, CONTENT.x + CONTENT.width / 2 + 70);
  }

  private renderCounters(snapshot: DevSnapshot): void {
    const recipes = this.options.recipes().filter((recipe) => recipe.inBook);
    const top = CONTENT.y + 22;
    // Placing a dish: choose the recipe with the arrows, then the amount.
    this.text('Pôr prato no balcão', 92, top + 22, 26);
    if (recipes.length > 0) {
      this.recipeIndex = (this.recipeIndex + recipes.length) % recipes.length;
      const recipe = recipes[this.recipeIndex];
      const arrow = (direction: -1 | 1, x: number) => {
        const sprite = new Sprite(this.textures.pageArrow);
        sprite.anchor.set(0.5);
        sprite.scale.set(-direction * 0.5, 0.5);
        sprite.position.set(x, top + 92);
        sprite.eventMode = 'static';
        sprite.cursor = 'pointer';
        sprite.on('pointertap', (event) => { event.stopPropagation(); this.recipeIndex += direction; this.render(); });
        this.content.addChild(sprite);
      };
      arrow(-1, 120);
      this.icon(recipe.stage2, 210, top + 92, 96);
      arrow(1, 300);
      this.text(recipe.name, 350, top + 72, 26);
      this.text(`${recipe.portions} porções · lucro ${recipe.profitGold} · ${recipe.xp} XP no total`, 350, top + 106, 19, COLORS.soft);
      const place = (portions: number, caption: string, x: number, width: number, color: ButtonColor = 'green') =>
        this.button(caption, x, top + 136, width, color, { command: 'add_food', recipeId: recipe.id, value: portions }, `${recipe.name}: ${portions} porções no balcão.`);
      place(1, '1 porção', 350, 140);
      place(10, '10 porções', 498, 150);
      place(recipe.portions, `Prato inteiro (${recipe.portions})`, 656, 240, 'blue');
      place(recipe.portions * 10, '10 pratos', 904, 150);
    } else {
      this.text('O catálogo de receitas ainda não carregou.', 350, top + 92, 22, COLORS.soft);
    }

    const listTop = top + 214;
    this.text('Balcões', 92, listTop, 26);
    this.button('Remover todos os pratos', 1000, listTop - 22, 320, 'gray', { command: 'clear_counters' }, 'Balcões esvaziados.');
    const counters = this.options.counters();
    counters.slice(0, 5).forEach((counter, index) => {
      const y = listTop + 34 + index * 62;
      const food = snapshot.world.foods.find((candidate) => candidate.counterId === counter.id);
      const recipe = food ? this.options.recipes().find((candidate) => candidate.id === food.recipeId) : undefined;
      this.icon(this.textures.counter, 110, y + 28, 44);
      this.text(`Balcão ${index + 1}`, 150, y + 18, 23);
      this.text(`tile ${counter.tx},${counter.ty}`, 150, y + 42, 16, COLORS.soft);
      this.text(food ? `${recipe?.name ?? food.recipeId}: ${integer.format(food.portions ?? 1)} porções` : 'Vazio', 360, y + 28, 22, COLORS.soft);
      this.button('Remover pratos', 1000, y + 8, 200, 'gray', { command: 'clear_counters', counterId: counter.id }, `Balcão ${index + 1} esvaziado.`, Boolean(food));
    });
    if (counters.length > 5) this.text(`+${counters.length - 5} balcões (use “Remover todos os pratos”)`, 150, listTop + 34 + 5 * 62 + 8, 18, COLORS.soft);
    if (counters.length === 0) this.text('Nenhum balcão colocado no café.', 150, listTop + 50, 22, COLORS.soft);
  }

  private renderCustomers(snapshot: DevSnapshot): void {
    const state = snapshot.playerState;
    const top = CONTENT.y + 40;
    this.smile(92, top);
    this.text('Popularidade', 136, top, 26);
    this.text(`${decimal.format(state.satisfaction.current)} de ${integer.format(state.satisfaction.maximum)}`, 360, top, 26, COLORS.soft);
    const bar = new Graphics().roundRect(640, top - 14, 560, 28, 14).fill(0x8b6a35)
      .roundRect(644, top - 10, Math.max(20, 552 * Math.min(1, state.satisfaction.current / Math.max(1, state.satisfaction.maximum))), 20, 10).fill(0xffc364);
    bar.eventMode = 'none';
    this.content.addChild(bar);
    const perMinute = customersPerMinute(state.satisfaction.current, state.level);
    this.text(`Chegam cerca de ${perMinute} clientes por minuto (tabela de popularidade do game-config${state.level >= 10 ? ', com bônus do nível' : ''}).`, 136, top + 44, 19, COLORS.soft);
    this.text('Cliente que come: +0,1 de popularidade e a parte do XP do prato. Cliente que sai sem comer: −0,3.', 136, top + 72, 19, COLORS.soft);
    const add = (value: number): DevCommand => ({ command: 'resource', resource: 'satisfaction', mode: 'add', value });
    const set = (value: number): DevCommand => ({ command: 'resource', resource: 'satisfaction', mode: 'set', value });
    [['−10', add(-10), 'gray'], ['+10', add(10), 'green'], ['Mínimo (5)', set(5), 'gray'], ['Máximo (105)', set(105), 'blue']].forEach(([caption, command, color], index) => {
      this.button(caption as string, 136 + index * 190, top + 104, 180, color as ButtonColor, command as DevCommand, `Popularidade: ${caption}.`);
    });

    const crowdY = top + 214;
    this.text('Clientes no café', 136, crowdY, 26);
    const count = this.text(String(this.options.customerCount()), 360, crowdY, 26, COLORS.soft);
    this.liveTexts.push(() => { if (!count.destroyed) count.text = String(this.options.customerCount()); });
    this.button('Chamar 1 cliente', 136, crowdY + 36, 240, 'green', { command: 'spawn_customers', value: 1 }, 'Cliente a caminho.');
    this.button('Chamar 5 clientes', 386, crowdY + 36, 240, 'green', { command: 'spawn_customers', value: 5 }, 'Clientes a caminho.');
    this.button('Dispensar todos', 636, crowdY + 36, 240, 'gray', { command: 'clear_customers' }, 'Clientes dispensados, sem avaliação.');
    this.text('Os clientes chamados respeitam o limite de rostos diferentes; os dispensados saem sem mexer na popularidade.', 136, crowdY + 112, 19, COLORS.soft);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.isOpen) { event.preventDefault(); event.stopImmediatePropagation(); this.close(); }
  };

  destroy(): void {
    this.generation++;
    window.removeEventListener('keydown', this.onKeyDown);
    this.view.destroy({ children: true });
  }
}
