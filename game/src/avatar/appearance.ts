import type { Look, Wardrobe } from './wardrobe';

/** Small, versioned wardrobe snapshot; geometry and textures stay in the catalogue. */
export function serializeAppearance(look: Look): string {
  return JSON.stringify({ version: 1, itemIds: [...look.itemIds], skinColour: look.skinColour, hairColour: look.hairColour });
}

export function restoreAppearance(wardrobe: Wardrobe, appearance?: string): Look {
  const fallback = wardrobe.defaultLook();
  if (!appearance) return fallback;
  try {
    const value = JSON.parse(appearance) as Record<string, unknown>;
    if (!value || value.version !== 1 || !Array.isArray(value.itemIds)) return fallback;
    const validColour = (colour: unknown): colour is number =>
      typeof colour === 'number' && Number.isInteger(colour) && colour >= 0 && colour <= 0xffffff;
    if (!validColour(value.skinColour) || !validColour(value.hairColour)) return fallback;
    const expectedSlots = new Set(wardrobe.groups.filter((group) => group.kind === 'item').map((group) => group.parent ?? group.name));
    const slots = new Set<string>();
    for (const id of value.itemIds) {
      if (!Number.isInteger(id)) return fallback;
      const item = wardrobe.byId(id);
      if (!item || wardrobe.group(item.group)?.kind !== 'item') return fallback;
      const slot = wardrobe.slotOf(item);
      if (slots.has(slot)) return fallback;
      slots.add(slot);
    }
    if (slots.size !== expectedSlots.size) return fallback;
    return { itemIds: [...value.itemIds], skinColour: value.skinColour, hairColour: value.hairColour };
  } catch {
    return fallback;
  }
}
