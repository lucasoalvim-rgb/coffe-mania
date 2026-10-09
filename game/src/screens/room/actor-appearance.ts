import { Graphics } from 'pixi.js';

/** Redução visual sem mover o ponto de apoio dos pés nem mudar a profundidade. */
export const ACTOR_VISUAL_SCALE = 0.9;

export function createActorShadow(radiusX: number, radiusY: number): Graphics {
  const shadow = new Graphics();
  shadow.label = 'actor:ground-shadow';
  // Acessórios atrás do corpo ainda devem cobrir a sombra no chão.
  shadow.zIndex = -2;
  shadow.eventMode = 'none';
  shadow.ellipse(0, 2, radiusX, radiusY).fill({ color: 0x0a0c09, alpha: 0.43 });
  return shadow;
}
