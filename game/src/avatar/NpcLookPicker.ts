/** Reuse baked atlases without consecutive twins or twins already in the room. */
export class NpcLookPicker {
  private readonly entries: { index: number; key: string }[];
  private unused = new Set<number>();
  private previousKey: string | undefined;

  constructor(private readonly keys: readonly string[], private readonly random = Math.random) {
    const seen = new Set<string>();
    this.entries = keys.flatMap((key, offset) => {
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ index: offset + 1, key }]; // Atlas zero belongs only to the player.
    });
  }

  pick(activeIndices: Iterable<number> = []): number {
    if (!this.entries.length) return -1;
    const active = new Set([...activeIndices].map((index) => this.keys[index - 1]));
    let candidates = this.entries.filter((entry) => entry.key !== this.previousKey && !active.has(entry.key));
    if (!candidates.length) candidates = this.entries.filter((entry) => entry.key !== this.previousKey);
    if (!candidates.length) candidates = this.entries;
    let remaining = candidates.filter((entry) => this.unused.has(entry.index));
    if (!remaining.length) {
      this.unused = new Set(this.entries.map((entry) => entry.index));
      remaining = candidates;
    }
    const draw = this.random();
    const offset = Math.min(remaining.length - 1, Math.max(0, Math.floor((Number.isFinite(draw) ? draw : 0) * remaining.length)));
    const chosen = remaining[offset];
    this.unused.delete(chosen.index);
    this.previousKey = chosen.key;
    return chosen.index;
  }
}
