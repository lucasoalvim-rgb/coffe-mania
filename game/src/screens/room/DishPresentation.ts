import type { Sprite, Texture } from 'pixi.js';

/** Mesma escala de arte no fogão pronto, balcão, mesa e transporte. */
export const READY_DISH_SIZE = 100;
/** A borda inferior do prato apoia na mão, não o centro do seu PNG. */
export const CARRIED_DISH_ANCHOR_Y = 0.96;
export const CARRIED_DISH_HAND_X = 0;
export const CARRIED_DISH_HAND_Y = -2;
const LEFT_PROFILE_ANCHOR_X = 0.85;
const sideRims = new WeakMap<Texture, number>();

/** Pratos redondos e quadrados têm bordas laterais em alturas diferentes.
 * Mede só a coluna de apoio e guarda o resultado; não lê pixels por quadro.
 */
function sideRim(texture: Texture): number {
  const cached = sideRims.get(texture);
  if (cached !== undefined) return cached;
  let anchorY = 0.90;
  const resource = texture.source.resource as CanvasImageSource | undefined;
  if (resource && typeof document !== 'undefined') {
    const ratio = texture.source.pixelWidth / Math.max(1, texture.source.width);
    const height = Math.max(1, Math.round(texture.frame.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context) {
      try {
        const x = Math.floor((texture.frame.x + texture.frame.width * LEFT_PROFILE_ANCHOR_X) * ratio);
        context.drawImage(resource, x, texture.frame.y * ratio, 1, height, 0, 0, 1, height);
        const pixels = context.getImageData(0, 0, 1, height).data;
        for (let y = height - 1; y >= 0; y--) {
          if (pixels[y * 4 + 3] <= 100) continue;
          anchorY = (y + 0.5) / height;
          break;
        }
      } catch { /* Textura sem pixels legíveis conserva o apoio aproximado. */ }
    }
  }
  sideRims.set(texture, anchorY);
  return anchorY;
}

/** Apoio aproximado em pixels do mundo enquanto o atlas do chef carrega. */
const FALLBACK_HAND_POSITIONS: Readonly<Record<number, { x: number; y: number }>> = {
  0: { x: -50, y: -44 },
  1: { x: -20, y: -30 },
  2: { x: 20, y: -30 },
  3: { x: 46, y: -46 },
  4: { x: 46, y: -65 },
  5: { x: 16, y: -79 },
  6: { x: -24, y: -77 },
  7: { x: -50, y: -64 },
};

export function carriedDishPose(direction: number, grip?: { x: number; y: number }, texture?: Texture): {
  x: number; y: number; zIndex: number; anchorX: number; anchorY: number;
} {
  const hand = grip ?? FALLBACK_HAND_POSITIONS[direction] ?? FALLBACK_HAND_POSITIONS[0];
  // No perfil esquerdo a mão apoia a borda direita do prato. A cabeça e o
  // braço ocultam a porção que cruza a silhueta, sem afastar o apoio da mão.
  const leftProfile = direction === 6;
  return {
    x: hand.x + CARRIED_DISH_HAND_X,
    y: hand.y + CARRIED_DISH_HAND_Y,
    // Camadas locais do avatar: sombra -2, prato atrás -1, corpo 0, prato à frente 1.
    zIndex: direction >= 3 && direction <= 6 ? -1 : 1,
    anchorX: leftProfile ? LEFT_PROFILE_ANCHOR_X : 0.5,
    anchorY: leftProfile ? texture ? sideRim(texture) : 0.90 : CARRIED_DISH_ANCHOR_Y,
  };
}

/** A base do prato fica a 78% do quadro; ingredientes usam o apoio de preparo. */
export function fitDish(view: Sprite, ready = true): void {
  view.anchor.set(0.5, ready ? 0.78 : 0.72);
  view.scale.set((ready ? READY_DISH_SIZE : 92) / Math.max(view.texture.width, view.texture.height));
}
