import { Container, Graphics } from 'pixi.js';

import type { Actor } from '../../world/Actor';
import { ROOM_ASSET_SCALE, TILE_HEIGHT_HALF } from '../../world/iso';
import { ACTOR_VISUAL_SCALE, createActorShadow } from './actor-appearance';
import { setActorRoomDepth } from './RoomDepthSorter';

/** Ator procedural para diagnóstico e fallback sem atlas. */

/** Vetor de tela de cada uma das 8 direções (ver iso.directionFromDelta). */
export const DIRECTION_VECTORS: readonly [number, number][] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
];

export interface ActorViewOptions {
  bodyColor?: number;
  outlineColor?: number;
  height?: number;
}

export class ActorView {
  readonly view = new Container();

  private readonly nose = new Graphics();
  private readonly noseColor: number;
  private lastDirection = -1;

  constructor(
    private readonly actor: Actor,
    options: ActorViewOptions = {},
  ) {
    const bodyColor = options.bodyColor ?? 0x4f7fd0;
    const outline = options.outlineColor ?? 0x24304a;
    const height = options.height ?? 54;

    this.noseColor = outline;
    this.view.label = `actor:${actor.label}`;
    this.view.scale.set(ROOM_ASSET_SCALE * ACTOR_VISUAL_SCALE);

    const shadow = createActorShadow(18, 6);

    const body = new Graphics();
    body
      .roundRect(-11, -height, 22, height, 11)
      .fill(bodyColor)
      .stroke({ color: outline, width: 2 });
    body
      .circle(0, -height - 9, 12)
      .fill(0xf2d3ae)
      .stroke({ color: outline, width: 2 });

    // O bico fica no chão, à frente dos pés: assim a direção aparece nas oito
    // orientações, sem ficar escondido atrás do corpo.
    this.nose.position.set(0, -3);

    this.view.addChild(shadow, body, this.nose);
    setActorRoomDepth(this.view, this.actor);
    this.sync();
  }

  /** Copia posição, profundidade e direção do modelo para a cena. */
  sync(): void {
    // O modelo ocupa o canto superior do tile; o desenho usa o centro do losango.

    this.view.position.set(this.actor.x, this.actor.y + TILE_HEIGHT_HALF);
    this.view.zIndex = this.actor.drawPriority;

    if (this.actor.direction !== this.lastDirection) {
      this.lastDirection = this.actor.direction;
      this.redrawNose();
    }
  }

  private redrawNose(): void {
    const [dx, dy] = DIRECTION_VECTORS[this.actor.direction] ?? [0, 1];
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;

    this.nose.clear();
    this.nose
      .poly([
        { x: ux * 26, y: uy * 13 },
        { x: -uy * 11, y: ux * 5.5 },
        { x: uy * 11, y: -ux * 5.5 },
      ])
      .fill({ color: this.noseColor, alpha: 0.85 })
      .stroke({ color: 0xffffff, width: 1, alpha: 0.5 });
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
