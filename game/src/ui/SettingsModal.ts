import { Container, Graphics, Rectangle, Text, TextStyle, type FederatedPointerEvent } from 'pixi.js';

import { DEFAULT_AUDIO_PREFERENCES, sanitizeAudioPreferences, type AudioPreferences } from '../audio/preferences';
import { FONT_FAMILY } from '../core/font-tokens';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../core/stage';

export interface SettingsModalOptions {
  playerName?: string;
  getPreferences?: () => AudioPreferences;
  onChange?: (preferences: AudioPreferences) => void;
  getBitterMode?: () => boolean;
  onBitterModeChange?: (enabled: boolean) => void;
  /** Only offered when the server enables developer tools for this session. */
  getDevMode?: () => boolean;
  onDevModeChange?: (enabled: boolean) => void;
}

interface Checkbox {
  control: Container;
  box: Graphics;
  focus: Graphics;
  checked: boolean;
  read: () => boolean | undefined;
  write: (checked: boolean) => void;
}

type VolumeChannel = 'musicPercent' | 'effectsPercent';

interface VolumeSlider {
  channel: VolumeChannel;
  holder: Container;
  track: Graphics;
  thumb: Graphics;
  focus: Graphics;
  output: Text;
}

const PANEL_WIDTH = 920;
const PANEL_HEIGHT = 820;
const PANEL_HEIGHT_WITH_DEV = 970;
const TRACK_WIDTH = 520;
const DARK_BROWN = 0x603a1e;
const LIGHT_BROWN = 0xc69a60;

/** All visuals and pointer controls belong to the game's stage, not the DOM. */
export class SettingsModal {
  readonly view = new Container();
  private readonly panel = new Container();
  private readonly closeButton = new Container();
  private readonly closeFocus = new Graphics();
  private readonly sliders: VolumeSlider[] = [];
  private readonly texts: Text[] = [];
  private readonly checkboxes: Checkbox[] = [];
  private preferences: AudioPreferences = { ...DEFAULT_AUDIO_PREFERENCES };
  private drag: { slider: VolumeSlider; pointerId: number } | null = null;
  private focusedControl = 0;
  private keyboardFocus = false;
  private closeHovered = false;
  private closePressed = false;
  private disposed = false;

  constructor(private readonly options: SettingsModalOptions = {}) {
    this.view.label = 'settings-modal';
    this.view.visible = false;

    // Like the recipe book, cover the full viewport, including stage overhang.
    const backdrop = new Graphics().rect(-12000, -12000, 24000, 24000)
      .fill({ color: 0x000000, alpha: 0.65 });
    backdrop.label = 'settings-modal-backdrop';
    backdrop.eventMode = 'static';
    backdrop.hitArea = new Rectangle(-12000, -12000, 24000, 24000);
    for (const name of ['pointerdown', 'pointerup', 'wheel'] as const) {
      backdrop.on(name, (event) => event.stopPropagation());
    }
    backdrop.on('pointertap', (event) => { event.stopPropagation(); this.close(); });

    const panelHeight = options.onDevModeChange ? PANEL_HEIGHT_WITH_DEV : PANEL_HEIGHT;
    this.panel.label = 'settings-modal-panel';
    this.panel.position.set((STAGE_WIDTH - PANEL_WIDTH) / 2, (STAGE_HEIGHT - panelHeight) / 2);
    this.panel.eventMode = 'static';
    this.panel.hitArea = new Rectangle(0, 0, PANEL_WIDTH, panelHeight);
    for (const name of ['pointerdown', 'pointerup', 'pointertap', 'wheel'] as const) {
      this.panel.on(name, (event) => event.stopPropagation());
    }
    const frame = new Graphics()
      .roundRect(0, 0, PANEL_WIDTH, panelHeight, 40).fill(DARK_BROWN)
      .roundRect(12, 12, PANEL_WIDTH - 24, panelHeight - 24, 28).fill(LIGHT_BROWN)
      .roundRect(22, 22, PANEL_WIDTH - 44, panelHeight - 44, 18).fill(0xffffff);
    frame.eventMode = 'none';
    this.panel.addChild(frame);

    const title = this.addText('Configurações', PANEL_WIDTH / 2, 85, 64, 'settings-modal-title');
    title.anchor.set(0.5);
    const square = new Graphics().roundRect(76, 166, 96, 96, 12)
      .fill(0xffffff).stroke({ color: 0x704721, width: 6 });
    square.eventMode = 'none';
    this.panel.addChild(square);
    const playerName = this.addText(options.playerName ?? '', 204, 214, 46, 'settings-modal-player-name');
    playerName.anchor.set(0, 0.5);
    // Long authenticated names stay inside the panel without changing its size.
    if (playerName.text && playerName.width > 636) playerName.scale.set(636 / playerName.width);

    this.buildCloseButton();
    this.buildSlider('musicPercent', 'Música', 382);
    this.buildSlider('effectsPercent', 'Efeitos sonoros', 522);
    this.buildCheckbox('bitter', 628, 'modo bitter', 'modo bitter permite mais zoom, mas pode causar aberrações visuais',
      () => this.options.getBitterMode?.(), (checked) => this.options.onBitterModeChange?.(checked));
    if (options.onDevModeChange) {
      this.buildCheckbox('dev', 800, 'modo dev', 'mostra o botão DEV na barra: recursos, fogões, balcões e clientes direto no servidor',
        () => this.options.getDevMode?.(), (checked) => this.options.onDevModeChange?.(checked));
    }
    this.view.addChild(backdrop, this.panel);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown, true);
      window.addEventListener('blur', this.cancelDrag);
    }
  }

  get isOpen(): boolean { return this.view.visible; }

  open(): void {
    if (this.disposed || this.isOpen) return;
    this.preferences = sanitizeAudioPreferences(this.options.getPreferences?.() ?? this.preferences);
    this.refreshSliders();
    for (const checkbox of this.checkboxes) {
      checkbox.checked = checkbox.read() ?? checkbox.checked;
      this.refreshCheckbox(checkbox);
    }
    this.focusedControl = 0;
    this.keyboardFocus = false;
    this.closeHovered = false;
    this.closePressed = false;
    this.syncCloseFeedback();
    this.syncFocus();
    this.view.visible = true;
  }

  close(): void {
    this.view.visible = false;
    this.drag = null;
    this.closeHovered = false;
    this.closePressed = false;
    this.syncCloseFeedback();
  }

  setStageScale(scale: number): void {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    const resolution = Math.min(4, Math.max(1, scale * dpr));
    for (const text of this.texts) text.resolution = resolution;
  }

  private addText(text: string, x: number, y: number, fontSize: number, label: string, fontWeight: '400' | '600' = '600'): Text {
    const value = new Text({ text, style: new TextStyle({
      fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize, fontWeight, fill: DARK_BROWN,
    }) });
    value.label = label;
    value.eventMode = 'none';
    value.position.set(x, y);
    this.texts.push(value);
    this.panel.addChild(value);
    return value;
  }

  private buildCloseButton(): void {
    const button = this.closeButton;
    button.label = 'settings-modal-close';
    button.position.set(PANEL_WIDTH - 66, 66);
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.hitArea = new Rectangle(-38, -38, 76, 76);
    const icon = new Graphics()
      .roundRect(-34, -34, 68, 68, 20).fill(0x015495)
      .roundRect(-28, -28, 56, 56, 14).fill(0x0084ed)
      .roundRect(-24, -24, 48, 48, 10).fill(0x01a9fd)
      .moveTo(-10, -10).lineTo(10, 10).moveTo(10, -10).lineTo(-10, 10)
      .stroke({ color: 0xffffff, width: 8, cap: 'round' });
    icon.eventMode = 'none';
    this.closeFocus.roundRect(-42, -42, 84, 84, 24).stroke({ color: 0x01a9fd, width: 4 });
    this.closeFocus.eventMode = 'none';
    button.addChild(this.closeFocus, icon);
    button.on('pointerover', () => { this.closeHovered = true; this.syncCloseFeedback(); });
    button.on('pointerout', () => {
      this.closeHovered = false;
      this.closePressed = false;
      this.syncCloseFeedback();
    });
    button.on('pointerdown', (event) => {
      event.stopPropagation();
      this.closePressed = true;
      this.syncCloseFeedback();
    });
    for (const name of ['pointerup', 'pointerupoutside'] as const) {
      button.on(name, () => { this.closePressed = false; this.syncCloseFeedback(); });
    }
    button.on('pointertap', (event) => { event.stopPropagation(); this.close(); });
    this.panel.addChild(button);
  }

  private syncCloseFeedback(): void {
    this.closeButton.scale.set(this.closePressed ? 0.9 : this.closeHovered ? 1.1 : 1);
  }

  private buildCheckbox(name: string, y: number, title: string, note: string,
    read: () => boolean | undefined, write: (checked: boolean) => void): void {
    const control = new Container();
    const box = new Graphics();
    const focus = new Graphics();
    const checkbox: Checkbox = { control, box, focus, checked: read() ?? false, read, write };
    control.label = `settings-${name}-checkbox`;
    control.position.set(200, y);
    control.eventMode = 'static';
    control.cursor = 'pointer';
    control.hitArea = new Rectangle(-14, -36, 670, 72);
    focus.roundRect(-14, -36, 670, 72, 14).stroke({ color: 0x01a9fd, width: 4 });
    focus.eventMode = 'none'; box.eventMode = 'none';
    control.addChild(focus, box);
    control.on('pointertap', (event) => {
      event.stopPropagation();
      if (!this.isOpen) return;
      this.focusedControl = this.sliders.length + 1 + this.checkboxes.indexOf(checkbox); this.keyboardFocus = false;
      this.toggleCheckbox(checkbox); this.syncFocus();
    });
    this.panel.addChild(control);
    this.checkboxes.push(checkbox);
    const label = this.addText(title, 264, y, 34, `settings-${name}-label`);
    label.anchor.set(0, .5);
    const disclaimer = this.addText(note, 200, y + 48, 26, `settings-${name}-disclaimer`, '400');
    disclaimer.style.wordWrap = true; disclaimer.style.wordWrapWidth = 650; disclaimer.style.lineHeight = 34;
    this.refreshCheckbox(checkbox);
  }

  private toggleCheckbox(checkbox: Checkbox): void {
    checkbox.checked = !checkbox.checked;
    this.refreshCheckbox(checkbox);
    checkbox.write(checkbox.checked);
  }

  private refreshCheckbox(checkbox: Checkbox): void {
    checkbox.box.clear().roundRect(0, -22, 44, 44, 8)
      .fill(0xffffff).stroke({ color: DARK_BROWN, width: 4 });
    if (checkbox.checked) checkbox.box.moveTo(10, -1).lineTo(19, 9).lineTo(35, -12)
      .stroke({ color: DARK_BROWN, width: 6, cap: 'round', join: 'round' });
  }

  private buildSlider(channel: VolumeChannel, label: string, y: number): void {
    const icon = new Graphics();
    const stroke = { color: DARK_BROWN, width: 3.5, cap: 'round' as const, join: 'round' as const };
    if (channel === 'musicPercent') {
      icon.moveTo(17, 32).lineTo(17, 12).lineTo(40, 7).lineTo(40, 27)
        .moveTo(17, 18).lineTo(40, 13).stroke(stroke)
        .ellipse(11, 34, 6, 5).fill(DARK_BROWN)
        .ellipse(34, 29, 6, 5).fill(DARK_BROWN);
    } else {
      icon.moveTo(7, 19).lineTo(15, 19).lineTo(25, 10).lineTo(25, 38)
        .lineTo(15, 29).lineTo(7, 29).closePath().stroke(stroke)
        .moveTo(32, 17).bezierCurveTo(37, 21, 37, 27, 32, 31)
        .moveTo(38, 11).bezierCurveTo(47, 18, 47, 30, 38, 37).stroke(stroke);
    }
    icon.label = `settings-${channel}-icon`;
    icon.scale.set(1.8);
    icon.position.set(72, y - 43);
    icon.eventMode = 'none';
    this.panel.addChild(icon);
    this.addText(label, 200, y - 60, 34, `settings-${channel}-label`);

    const holder = new Container();
    holder.label = `settings-${channel}-slider`;
    holder.position.set(200, y);
    holder.hitArea = new Rectangle(-26, -42, TRACK_WIDTH + 52, 84);
    holder.eventMode = 'static';
    holder.cursor = 'pointer';
    const focus = new Graphics().roundRect(-26, -42, TRACK_WIDTH + 52, 84, 16)
      .stroke({ color: 0x01a9fd, width: 4 });
    const track = new Graphics();
    const thumb = new Graphics().circle(0, 0, 24).fill(DARK_BROWN)
      .circle(0, 0, 18).fill(LIGHT_BROWN).circle(0, 0, 14).fill(0xffffff);
    for (const graphic of [focus, track, thumb]) graphic.eventMode = 'none';
    holder.addChild(focus, track, thumb);
    const output = this.addText('', PANEL_WIDTH - 72, y, 36, `settings-${channel}-value`, '400');
    output.anchor.set(1, 0.5);
    const slider: VolumeSlider = { channel, holder, track, thumb, focus, output };
    this.sliders.push(slider);
    holder.on('pointerdown', (event) => {
      event.stopPropagation();
      if (this.drag) return;
      this.drag = { slider, pointerId: event.pointerId };
      this.focusedControl = this.sliders.indexOf(slider) + 1;
      this.keyboardFocus = false;
      this.syncFocus();
      this.updateFromPointer(slider, event);
    });
    holder.on('globalpointermove', (event) => {
      if (this.drag?.slider === slider && this.drag.pointerId === event.pointerId) this.updateFromPointer(slider, event);
    });
    for (const name of ['pointerup', 'pointerupoutside'] as const) {
      holder.on(name, (event) => {
        event.stopPropagation();
        if (this.drag?.slider === slider && this.drag.pointerId === event.pointerId) {
          this.updateFromPointer(slider, event);
          this.drag = null;
        }
      });
    }
    this.panel.addChild(holder);
  }

  private updateFromPointer(slider: VolumeSlider, event: FederatedPointerEvent): void {
    if (!this.isOpen) return;
    const local = slider.holder.toLocal(event.global);
    this.setVolume(slider.channel, local.x / TRACK_WIDTH * 100);
  }

  private setVolume(channel: VolumeChannel, value: number): void {
    const current = this.preferences;
    // Editing a legacy global mute must not unexpectedly unmute the other channel.
    const next = sanitizeAudioPreferences({
      musicPercent: current.muted ? 0 : current.musicPercent,
      effectsPercent: current.muted ? 0 : current.effectsPercent,
      [channel]: value,
      muted: false,
    });
    if (next.musicPercent === current.musicPercent && next.effectsPercent === current.effectsPercent && next.muted === current.muted) return;
    this.preferences = next;
    this.refreshSliders();
    this.options.onChange?.({ ...this.preferences });
  }

  private refreshSliders(): void {
    for (const slider of this.sliders) {
      const value = this.preferences.muted ? 0 : this.preferences[slider.channel];
      slider.track.clear().roundRect(0, -10, TRACK_WIDTH, 20, 10).fill(0x704721)
        .roundRect(3, -7, TRACK_WIDTH - 6, 14, 7).fill(0xf5eee3);
      const width = (TRACK_WIDTH - 6) * value / 100;
      if (width > 0) slider.track.roundRect(3, -7, width, 14, Math.min(7, width / 2)).fill(LIGHT_BROWN);
      slider.thumb.x = TRACK_WIDTH * value / 100;
      slider.output.text = `${value}%`;
    }
  }

  private syncFocus(): void {
    this.closeFocus.visible = this.keyboardFocus && this.focusedControl === 0;
    this.sliders.forEach((slider, index) => { slider.focus.visible = this.keyboardFocus && this.focusedControl === index + 1; });
    this.checkboxes.forEach((checkbox, index) => {
      checkbox.focus.visible = this.keyboardFocus && this.focusedControl === this.sliders.length + 1 + index;
    });
  }

  private readonly cancelDrag = (): void => { this.drag = null; };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.keyboardFocus = true;
      const count = this.sliders.length + 1 + this.checkboxes.length;
      this.focusedControl = (this.focusedControl + (event.shiftKey ? count - 1 : 1)) % count;
      this.syncFocus();
    } else if (this.focusedControl === 0 && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      this.close();
    } else if (this.focusedControl > this.sliders.length) {
      const checkbox = this.checkboxes[this.focusedControl - this.sliders.length - 1];
      if (checkbox && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        if (!event.repeat) this.toggleCheckbox(checkbox);
      }
    } else {
      const slider = this.sliders[this.focusedControl - 1];
      if (!slider) return;
      const current = this.preferences.muted ? 0 : this.preferences[slider.channel];
      const step = event.shiftKey ? 5 : 1;
      const value = event.key === 'Home' ? 0 : event.key === 'End' ? 100
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? current - step
        : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? current + step
        : event.key === 'PageDown' ? current - 10 : event.key === 'PageUp' ? current + 10 : null;
      if (value === null) return;
      event.preventDefault();
      this.keyboardFocus = true;
      this.syncFocus();
      this.setVolume(slider.channel, value);
    }
  };

  destroy(): void {
    this.close();
    this.disposed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown, true);
      window.removeEventListener('blur', this.cancelDrag);
    }
    this.view.destroy({ children: true });
  }
}
