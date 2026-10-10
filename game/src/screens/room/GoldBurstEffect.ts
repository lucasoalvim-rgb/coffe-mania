import { Container, FillGradient, Graphics, Text, TextStyle } from 'pixi.js';

import { FONT_FAMILY } from '../../core/font-tokens';
import { POPUP_DRAW_PRIORITY } from '../../world/iso';

/** Whole effect, as measured on the original's capture: about four seconds. */
const DURATION_MS = 4000;
const BEAM_HEIGHT = 250;
const BEAM_BASE_RX = 44;
const BEAM_BASE_RY = 17;
const BEAM_TOP_RX = 76;
const BEAM_RISE_MS = 500;
const BEAM_HOLD_UNTIL_MS = 2500;
const BEAM_FADE_MS = 1300;

const COINS = 6;
/** A coin's jump: it peaks after COIN_APEX_S at COIN_APEX above the base, then starts to fall. */
const COIN_APEX = 230;
const COIN_APEX_S = 1.5;
const COIN_LIFE_S = 2;
const COIN_LAUNCH_S = 0.16;
const COIN_SPEED = (2 * COIN_APEX) / COIN_APEX_S;
const COIN_GRAVITY = COIN_SPEED / COIN_APEX_S;

/** Layers stacked behind the face to give the coin its thickness when it turns. */
const COIN_EDGE_LAYERS = 5;
const COIN_THICKNESS = 0.15; // of the coin's size
/** Spinning coins turn smoothly, about 0.7 turn per second. */
const COIN_SPIN = 2 * Math.PI * 0.7;

/** Sparkle: each twinkle shows up at another spot inside the light. */
const SPARKLE_TWINKLE_MS = 620;
const SPARKLE_SPOTS = 8;

interface JumpingCoin {
  holder: Container;
  layers: Graphics[];
  thickness: number;
  vx: number;
  delay: number;
  spin: number;
  phase: number;
}

/**
 * Horizontal bands: yellow where the light leaves the floor, paling to white and
 * transparent at the top.
 */
const beamGradient = new FillGradient({
  type: 'linear', start: { x: 0, y: 1 }, end: { x: 0, y: 0 },
  colorStops: [
    { offset: 0, color: 'rgba(255, 196, 24, 0.9)' },
    { offset: 0.18, color: 'rgba(255, 214, 64, 0.72)' },
    { offset: 0.45, color: 'rgba(255, 238, 168, 0.46)' },
    { offset: 0.75, color: 'rgba(255, 250, 232, 0.24)' },
    { offset: 1, color: 'rgba(255, 255, 255, 0)' },
  ],
  textureSpace: 'local',
});

/**
 * The light as a single shape: the lower half of the floor ellipse continues straight into
 * the widening sides, so no edge separates the glow on the floor from the light above it.
 */
function beamOutline(): number[] {
  const points: number[] = [];
  const steps = 24;
  for (let step = 0; step <= steps; step++) {
    const angle = Math.PI - (step / steps) * Math.PI;
    points.push(BEAM_BASE_RX * Math.cos(angle), BEAM_BASE_RY * Math.sin(angle));
  }
  points.push(BEAM_TOP_RX, -BEAM_HEIGHT, -BEAM_TOP_RX, -BEAM_HEIGHT);
  return points;
}

/**
 * A gold coin drawn in place of the HUD icon, which carries a white sticker outline the
 * original's coins don't have: dark rim, yellow face, orange center and a soft highlight.
 * Edge layers are a plain darker disc. The origin is the bottom of the coin.
 */
function coinLayer(size: number, edge: boolean): Graphics {
  const r = size / 2;
  const coin = new Graphics();
  if (edge) return coin.circle(0, -r, r).fill(0xc27a00);
  return coin.circle(0, -r, r).fill(0xffc21a).stroke({ color: 0xc27a00, width: size * 0.07 })
    .circle(0, -r, r * 0.66).fill(0xf29a08).stroke({ color: 0xd98400, width: size * 0.04 })
    .ellipse(-r * 0.38, -r * 1.42, r * 0.2, r * 0.12).fill({ color: 0xffffff, alpha: 0.65 });
}

/**
 * Spending gold on a piece, after the original: a light that widens upward from
 * the floor, coins that jump out of its base one after another (squashing as they leave,
 * stretching as they climb, settling at the top of the arc) toward both sides, a white
 * sparkle, and the amount beside the piece in yellow with a thick brown outline.
 * Origin: the footprint center on the floor. Plays once and removes itself.
 */
export class GoldBurstEffect {
  readonly view = new Container();
  private readonly beam: Graphics;
  private readonly sparkle: Graphics;
  private readonly sparkleSpots: { x: number; y: number }[] = [];
  private readonly coins: JumpingCoin[] = [];
  private readonly amount: Text;
  private elapsed = 0;
  done = false;

  constructor(position: { x: number; y: number }, gold: number, random: () => number = Math.random) {
    this.view.label = 'gold-burst-effect';
    this.view.eventMode = 'none';
    this.view.position.set(position.x, position.y);
    this.view.zIndex = POPUP_DRAW_PRIORITY + 3;
    // The room is drawn at low zoom: sized so the burst reads next to a 160 px tile.
    this.view.scale.set(1.5);

    this.beam = new Graphics().poly(beamOutline()).fill(beamGradient);
    this.beam.scale.y = 0;
    this.sparkle = new Graphics()
      .poly([0, -12, 2.6, -2.6, 12, 0, 2.6, 2.6, 0, 12, -2.6, 2.6, -12, 0, -2.6, -2.6]).fill(0xffffff);
    for (let spot = 0; spot < SPARKLE_SPOTS; spot++) {
      const y = -BEAM_HEIGHT * (0.25 + random() * 0.5);
      const halfWidth = BEAM_BASE_RX + (BEAM_TOP_RX - BEAM_BASE_RX) * (-y / BEAM_HEIGHT);
      this.sparkleSpots.push({ x: (random() - 0.5) * halfWidth * 1.2, y });
    }
    this.view.addChild(this.beam, this.sparkle);

    for (let index = 0; index < COINS; index++) {
      const size = 38 + random() * 10;
      const holder = new Container();
      holder.visible = false;
      holder.eventMode = 'none';
      const layers: Graphics[] = [];
      // Darker discs behind the face form the rim; the last layer is the face itself.
      for (let layer = 0; layer <= COIN_EDGE_LAYERS; layer++) {
        const piece = coinLayer(size, layer < COIN_EDGE_LAYERS);
        piece.eventMode = 'none';
        holder.addChild(piece);
        layers.push(piece);
      }
      this.view.addChild(holder);
      // Alternate sides so the coins open toward both corners; every other coin spins.
      const side = index % 2 === 0 ? -1 : 1;
      this.coins.push({
        holder, layers, thickness: size * COIN_THICKNESS,
        vx: side * (55 + random() * 55), delay: 0.1 + index * 0.33 + random() * 0.1,
        spin: index % 2 === 1 ? COIN_SPIN * (0.85 + random() * 0.3) : 0,
        phase: (random() < 0.5 ? -1 : 1) * (0.3 + random() * 0.25),
      });
    }

    this.amount = new Text({
      text: `${gold < 0 ? '-' : '+'}${Math.abs(gold)}`,
      style: new TextStyle({
        fontFamily: [FONT_FAMILY, 'sans-serif'], fontSize: 40, fontWeight: '800', fill: 0xffc81e,
        stroke: { color: 0x5b2c0a, width: 13, join: 'round' }, padding: 8,
      }),
    });
    this.amount.anchor.set(0, 0.5);
    this.view.addChild(this.amount);
  }

  update(deltaMs: number): void {
    if (this.done) return;
    this.elapsed += Math.max(0, deltaMs);
    const t = this.elapsed;
    if (t >= DURATION_MS) { this.done = true; this.view.visible = false; return; }

    this.beam.scale.y = Math.min(1, t / BEAM_RISE_MS);
    const fade = t < BEAM_HOLD_UNTIL_MS ? 1 : Math.max(0, 1 - (t - BEAM_HOLD_UNTIL_MS) / BEAM_FADE_MS);
    this.beam.alpha = fade;
    // Each twinkle fades in and out at its own spot, drifting a little while it shows.
    const cycle = Math.floor(t / SPARKLE_TWINKLE_MS);
    const phase = (t % SPARKLE_TWINKLE_MS) / SPARKLE_TWINKLE_MS;
    const spot = this.sparkleSpots[cycle % SPARKLE_SPOTS];
    this.sparkle.position.set(spot.x + Math.sin(t / 240) * 4, spot.y - phase * 10);
    this.sparkle.alpha = fade * Math.sin(phase * Math.PI);
    this.sparkle.scale.set(0.6 + 0.5 * Math.sin(phase * Math.PI));

    for (const coin of this.coins) {
      const age = t / 1000 - coin.delay;
      coin.holder.visible = age >= 0 && age < COIN_LIFE_S;
      if (!coin.holder.visible) continue;
      let squashX: number;
      let squashY: number;
      let air: number;
      if (age < COIN_LAUNCH_S) {
        // Crouch and spring: wide and flat on the floor, then thin and tall as it leaves.
        const k = age / COIN_LAUNCH_S;
        const crouch = Math.sin(k * Math.PI);
        squashX = 1 + 0.45 * crouch - 0.25 * k;
        squashY = 1 - 0.5 * crouch + 0.3 * k;
        air = 0;
      } else {
        air = age - COIN_LAUNCH_S;
        // Stretched along the motion while fast, round again at the top of the arc.
        const speed = Math.abs(COIN_SPEED - COIN_GRAVITY * air) / COIN_SPEED;
        squashY = 1 + 0.3 * speed;
        squashX = 1 / squashY;
      }
      const height = COIN_SPEED * air - 0.5 * COIN_GRAVITY * air * air;
      coin.holder.position.set(coin.vx * air, -2 - height);
      coin.holder.scale.set(squashX, squashY);
      coin.holder.alpha = age < 0.06 ? age / 0.06 : age > COIN_LIFE_S - 0.35 ? Math.max(0, (COIN_LIFE_S - age) / 0.35) : 1;
      this.turnCoin(coin, coin.phase + coin.spin * age);
    }

    // Beside the light, drifting up slowly and staying most of the effect.
    const rise = Math.min(1, t / 2800);
    this.amount.position.set(14, -78 - rise * 40);
    this.amount.alpha = t < 3300 ? 1 : Math.max(0, 1 - (t - 3300) / 700);
  }

  /**
   * Shows the coin turned by an angle around its vertical axis: the face narrows with the
   * cosine while the rim layers spread with the sine, so a coin seen edge-on is a gold band.
   */
  private turnCoin(coin: JumpingCoin, angle: number): void {
    const cos = Math.cos(angle);
    const width = Math.max(0.06, Math.abs(cos));
    // The face on top is the one turned toward the viewer: past edge-on the other face takes
    // its place on the same side, so the coin keeps turning the same way.
    const shift = coin.thickness * Math.sin(angle) * (cos < 0 ? -1 : 1);
    coin.layers.forEach((layer, index) => {
      layer.x = (index / COIN_EDGE_LAYERS - 0.5) * shift;
      layer.scale.x = width;
    });
  }

  destroy(): void { this.view.destroy({ children: true }); }
}
