import { Container, Rectangle, Sprite, Text, TextStyle, Texture } from 'pixi.js';

import { FONT_FAMILY, FONT_WEIGHT } from '../../core/font-tokens';
import { STAGE_WIDTH } from '../../core/stage';
import { emptyPlayerState, resourcePercentage, type PlayerState } from '../../game/player-state';
import { ProgressBar } from '../loading/ProgressBar';
import { COLORS, type RoundedRect } from '../loading/layout';
import { CurrencyHud, type HudCurrency } from './CurrencyHud';

/** O front recorta o preenchimento; os limites cobrem todo o vazado sem sair do back. */
export const TOP_BAR_SLOTS: readonly RoundedRect[] = [
  { left: 272, top: 39, width: 156, height: 35, radius: 6 },
  { left: 459, top: 39, width: 193, height: 35, radius: 6 },
  { left: 714, top: 40, width: 148, height: 35, radius: 6 },
  { left: 927, top: 39, width: 156, height: 36, radius: 6 },
  { left: 1168, top: 39, width: 182, height: 36, radius: 6 },
];

/** Limites visíveis dos cinco ícones no atlas, ignorando ruído quase transparente. */
export const TOP_BAR_ICON_FRAMES = [
  { x: 19, y: 339, width: 318, height: 305 },
  { x: 360, y: 342, width: 314, height: 299 },
  { x: 691, y: 273, width: 301, height: 382 },
  { x: 1021, y: 305, width: 288, height: 368 },
  { x: 1336, y: 340, width: 320, height: 321 },
] as const;

const ICON_HEIGHT = 48;
const ICON_BORDER_OFFSET = 2;
/** Visible outlines of the bars, excluding the atlas's 1600 x 900 transparent canvas. */
const TOP_BARS_VISIBLE_FRAME = new Rectangle(265, 33, 1092, 47);

/** As duas primeiras são sólidas; as duas últimas usam os pares do barber pole. */
export const TOP_BAR_PALETTES = [
  { base: COLORS.barBase, stripe: COLORS.barStripe },
  { base: 0xe98223, stripe: 0xffc364 },
  { base: 0x1668a6, stripe: 0x55a9d9 },
  { base: 0xf96e04, stripe: 0xfcae00 },
  { base: 0xe78a1c, stripe: 0xaa702b },
] as const;

const LABEL_STROKES = [0x276c1f, 0x824310, 0x092c65, 0xf96e04, 0x5a3218] as const;

export interface TopBarsTextures {
  back: Texture;
  front: Texture;
  icons: Texture;
  currencyAdd?: Texture;
  energyIcons?: { normal: Texture; bonus: Texture };
}

/** Moedas modulares e três recursos com as molduras do atlas. */
export class TopBars {
  readonly view = new Container();

  private readonly bars: ProgressBar[];
  private readonly currencies: CurrencyHud;
  private readonly resourceTextures: readonly Texture[];
  private readonly labels: Text[];
  private readonly blueLevelLabel: Text;
  private values: number[] = [];
  private blueLevelValue = 1;
  private energyIcon!: Sprite;
  private normalEnergyTexture!: Texture;
  private readonly bonusEnergyTexture?: Texture;

  constructor(textures: TopBarsTextures, state?: PlayerState, onAddCurrency?: (currency: HudCurrency) => void) {
    this.bonusEnergyTexture = textures.energyIcons?.bonus;
    this.view.label = 'room-top-bars';
    this.view.x = (STAGE_WIDTH - textures.back.width) / 2;

    // As duas moedas têm sua própria moldura contínua; só os recursos usam o atlas.
    const resourceFrame = new Rectangle(700, 0, textures.back.width - 700, textures.back.height);
    this.resourceTextures = [
      new Texture({ source: textures.back.source, frame: resourceFrame }),
      new Texture({ source: textures.front.source, frame: resourceFrame }),
    ];
    const back = new Sprite(this.resourceTextures[0]);
    back.x = resourceFrame.x;
    back.label = 'room-top-bars-back';
    back.eventMode = 'none';
    this.view.addChild(back);

    this.bars = TOP_BAR_SLOTS.slice(2).map((rect, resourceIndex) => {
      const index = resourceIndex + 2;
      const bar = new ProgressBar({
        rect,
        palette: TOP_BAR_PALETTES[index],
        glossy: true,
        striped: index >= 2,
        reducedMotion: true,
      });
      bar.view.label = `room-top-bar-progress-${index + 1}`;
      bar.view.eventMode = 'none';
      this.view.addChild(bar.view);
      return bar;
    });

    const front = new Sprite(this.resourceTextures[1]);
    front.x = resourceFrame.x;
    front.label = 'room-top-bars-front';
    front.eventMode = 'none';
    this.view.addChild(front);

    this.currencies = new CurrencyHud(onAddCurrency, textures.currencyAdd);
    this.currencies.view.position.set(265, 35);
    this.view.addChild(this.currencies.view);

    TOP_BAR_ICON_FRAMES.forEach((frame, index) => {
      if (index < 2) return;
      const icon = new Sprite(index === 3 && textures.energyIcons ? textures.energyIcons.normal : new Texture({
        source: textures.icons.source,
        frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
      }));
      const slot = TOP_BAR_SLOTS[index];
      icon.label = `room-top-bar-icon-${index + 1}`;
      icon.anchor.set(0.5);
      icon.height = ICON_HEIGHT * 1.15 * 1.2 * 1.15;
      icon.scale.x = icon.scale.y;
      icon.position.set(slot.left + ICON_BORDER_OFFSET, slot.top + slot.height / 2);
      icon.eventMode = 'none';
      if (index === 3) {
        this.energyIcon = icon;
        this.normalEnergyTexture = icon.texture;
      }
      this.view.addChild(icon);
    });

    this.labels = TOP_BAR_SLOTS.slice(2).map((slot, resourceIndex) => {
      const index = resourceIndex + 2;
      const label = new Text({
        text: '0',
        style: new TextStyle({
          fontFamily: [FONT_FAMILY, 'sans-serif'],
          fontSize: 21,
          fontWeight: String(FONT_WEIGHT) as TextStyle['fontWeight'],
          fill: 0xffffff,
          stroke: { color: LABEL_STROKES[index], width: 6, join: 'round' },
          align: 'center',
          padding: 6,
        }),
      });
      label.label = `room-top-bar-label-${index + 1}`;
      label.anchor.set(0.5, 0.5);
      label.position.set(slot.left + slot.width / 2, slot.top + slot.height);
      label.eventMode = 'none';
      this.view.addChild(label);
      return label;
    });
    const blueSlot = TOP_BAR_SLOTS[2];
    this.blueLevelLabel = new Text({
      text: String(this.blueLevelValue),
      style: new TextStyle({
        fontFamily: [FONT_FAMILY, 'sans-serif'],
        fontSize: 32,
        fontWeight: String(FONT_WEIGHT) as TextStyle['fontWeight'],
        fill: 0x092c65,
        stroke: { color: 0xffffff, width: 6, join: 'round' },
        align: 'center',
        padding: 6,
      }),
    });
    this.blueLevelLabel.label = 'room-top-bar-blue-level';
    this.blueLevelLabel.anchor.set(0, 0.5);
    this.blueLevelLabel.position.set(blueSlot.left + blueSlot.width - 12, blueSlot.top + blueSlot.height / 2);
    this.blueLevelLabel.eventMode = 'none';
    this.view.addChild(this.blueLevelLabel);
    this.setState(state ?? emptyPlayerState(), true);
    this.view.visible = state !== undefined;
  }

  get percentages(): readonly number[] {
    return [...this.values];
  }

  get labelTexts(): readonly string[] {
    return [...this.currencies.labelTexts, ...this.labels.map((label) => label.text)];
  }

  get blueLevel(): number {
    return this.blueLevelValue;
  }

  containsGlobalPoint(global: { x: number; y: number }): boolean {
    if (!this.view.visible || !this.view.renderable) return false;
    if (this.currencies.containsGlobalPoint(global)) return true;
    const point = this.view.toLocal(global);
    if (TOP_BARS_VISIBLE_FRAME.contains(point.x, point.y)) return true;
    return this.view.children.some((child) => {
      if (!(child instanceof Text) && !child.label.startsWith('room-top-bar-icon-')) return false;
      const bounds = child.getBounds();
      return global.x >= bounds.x && global.y >= bounds.y
        && global.x <= bounds.x + bounds.width && global.y <= bounds.y + bounds.height;
    });
  }

  /** Apply a server snapshot without rounding resource counts or their ratios. */
  setState(state: PlayerState, immediate = false): void {
    this.view.visible = true;
    this.values = [100, 100, ...[state.experience, state.energy, state.crates].map(resourcePercentage)];
    this.currencies.setValues(state.cash, state.gold);
    this.bars.forEach((bar, index) => bar.setProgress(this.values[index + 2], immediate));
    const texts = [String(state.experience.current),
      `${state.energy.current}/${state.energy.maximum}`, `${state.crates.current}/${state.crates.maximum}`];
    this.labels.forEach((label, index) => { label.text = texts[index]; });
    this.blueLevelValue = state.level;
    this.blueLevelLabel.text = String(state.level);
    const energyTexture = state.energy.current > state.energy.maximum && this.bonusEnergyTexture
      ? this.bonusEnergyTexture : this.normalEnergyTexture;
    if (this.energyIcon.texture !== energyTexture) {
      this.energyIcon.texture = energyTexture;
      this.energyIcon.height = ICON_HEIGHT * 1.15 * 1.2 * 1.15;
      this.energyIcon.scale.x = this.energyIcon.scale.y;
    }
  }

  update(deltaMs: number): void {
    // Only interpolate a received update; never alter the authoritative values.
    this.bars.forEach((bar) => bar.advance(deltaMs));
  }

  destroy(): void {
    this.bars.forEach((bar) => bar.releaseMask());
    this.currencies.destroy();
    this.view.destroy({ children: true });
    // Os recortes pertencem ao HUD; as fontes dos atlas continuam compartilhadas.
    this.resourceTextures.forEach((texture) => texture.destroy());
  }
}
