/** Zoom preference is local to each player in this browser, like audio settings. */
const keyFor = (playerId: string): string => `coffe-mania.zoom.v1.${encodeURIComponent(playerId)}`;

export function loadBitterMode(storage: Pick<Storage, 'getItem'> | undefined, playerId: string): boolean {
  try { return storage?.getItem(keyFor(playerId)) === 'true'; }
  catch { return false; }
}

export function saveBitterMode(storage: Pick<Storage, 'setItem'> | undefined, playerId: string, enabled: boolean): void {
  try { storage?.setItem(keyFor(playerId), String(enabled)); }
  catch { /* The selected limits remain active when storage is unavailable. */ }
}
