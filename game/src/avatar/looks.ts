import type { Look, Wardrobe, WardrobeItem } from './wardrobe';

/** Looks determinísticos do catálogo para sondas e prévias isoladas. Não substituem a aparência autenticada do jogador. */

/** Grupos que a variação troca, e o passo de cada um no catálogo. */
const VARIED_GROUPS: readonly { group: string; stride: number }[] = [
  { group: 'Shirt', stride: 7 },
  { group: 'Pants', stride: 3 },
  { group: 'Hair', stride: 5 },
  { group: 'Hat', stride: 4 },
];

/** Passos nas duas paletas de 16 cores, primos com 16 para não repetir cedo. */
const SKIN_STRIDE = 3;
const HAIR_STRIDE = 5;

/** Itens vestíveis de um grupo: os que acendem alguma malha. */
function wearable(wardrobe: Wardrobe, group: string): WardrobeItem[] {
  return wardrobe.inGroup(group).filter((item) => !item.invisible && item.objects.length > 0);
}

/** Cores de uma paleta, na ordem do catálogo. */
function palette(wardrobe: Wardrobe, group: string): number[] {
  return wardrobe
    .inGroup(group)
    .map((item) => item.colour)
    .filter((colour): colour is string => colour !== undefined)
    .map((colour) => Number.parseInt(colour.replace('#', ''), 16))
    .filter((valor) => !Number.isNaN(valor));
}

/** Gera count looks; o primeiro usa os padrões do catálogo. */

export function variedLooks(wardrobe: Wardrobe, count: number): Look[] {
  const padrao = wardrobe.defaultLook();
  if (count <= 1) return [padrao];

  const peles = palette(wardrobe, 'SkinColour');
  const cabelos = palette(wardrobe, 'HairColour');

  const looks: Look[] = [padrao];

  for (let i = 1; i < count; i++) {
    // Slot -> id, para a troca respeitar quem divide slot (saia e calça).
    const porSlot = new Map<string, number>();
    for (const id of padrao.itemIds) {
      const item = wardrobe.byId(id);
      if (item) porSlot.set(wardrobe.slotOf(item), id);
    }

    for (const { group, stride } of VARIED_GROUPS) {
      const pool = wearable(wardrobe, group);
      if (pool.length === 0) continue;
      const escolhido = pool[(i * stride) % pool.length];
      porSlot.set(wardrobe.slotOf(escolhido), escolhido.id);
    }

    looks.push({
      itemIds: [...porSlot.values()],
      skinColour: peles.length > 0 ? peles[(i * SKIN_STRIDE) % peles.length] : padrao.skinColour,
      hairColour: cabelos.length > 0 ? cabelos[(i * HAIR_STRIDE) % cabelos.length] : padrao.hairColour,
    });
  }

  return looks;
}
