import { Assets, Texture } from 'pixi.js';
import { IndoorArt, type ArtProvider, type IndoorArtFrame, type IndoorArtEntry } from './indoor-art';
import type { PlayerState } from './player-state';
import type { RoomItem, RoomItemKind } from '../world/RoomModel';

export interface RoomCatalogItem {
  id: number; classname: string; name: string; type: number; kind: RoomItemKind;
  priceGold: number; purchasable: boolean; sizeX: number; sizeY: number; wall_cutter_index?: number;
}
export interface RoomUnit {
  unitId: string; itemId: number; placed: boolean; tx: number; ty: number; rotation: number; stoveId?: string;
}
export interface RoomSnapshot {
  roomId?: string; canEdit?: boolean;
  revision: number; tilesX: number; tilesY: number; inventory: RoomUnit[];
  catalog: RoomCatalogItem[]; playerState: PlayerState;
}
export interface ItemManifest extends RoomCatalogItem {
  itemHeight: number; parts: (IndoorArtFrame & { rotation?: number })[];
  wallpaperRotation?: 0 | 1; door?: IndoorArtEntry['door'];
}

/** Parts without a rotation belong to the same assembled pose. */
export function groupItemParts(parts: ItemManifest['parts']): { rotation: number; frame: IndoorArtFrame; parts: ItemManifest['parts'] }[] {
  const groups = new Map<number, ItemManifest['parts']>();
  for (const part of parts) {
    const rotation = part.rotation ?? 0;
    if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3 || ![part.left, part.top].every(Number.isFinite) ||
      ![part.width, part.height].every((n) => Number.isInteger(n) && n > 0)) throw new Error('Parte de item inválida.');
    const group = groups.get(rotation) ?? []; group.push(part); groups.set(rotation, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([rotation, group]) => {
    if (group.length === 1) return { rotation, frame: group[0], parts: group };
    const left = Math.floor(Math.min(...group.map((part) => part.left))), top = Math.floor(Math.min(...group.map((part) => part.top)));
    const width = Math.ceil(Math.max(...group.map((part) => part.left + part.width))) - left;
    const height = Math.ceil(Math.max(...group.map((part) => part.top + part.height))) - top;
    if (width > 8192 || height > 8192 || width * height > 16000000) throw new Error('Item composto excede o limite de imagem.');
    return { rotation, frame: { file: '', left, top, width, height }, parts: group };
  });
}

/** Each folder's manifest describes its own files and registration offsets. */
export async function loadRoomItemArt(snapshot: RoomSnapshot, legacy?: ArtProvider): Promise<ArtProvider> {
  const root = new URL('assets/items/', new URL(import.meta.env.BASE_URL, document.baseURI));
  const manifests = await Promise.all(snapshot.catalog.map(async (item) => {
    const response = await fetch(new URL(`${item.classname}/item.json`, root).href,
      { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Não foi possível carregar o manifesto de ${item.classname}.`);
    const manifest = await response.json() as ItemManifest;
    if (manifest.id !== item.id || manifest.classname !== item.classname ||
      (item.type === 2 && (typeof manifest.wall_cutter_index !== 'number' || !Number.isFinite(manifest.wall_cutter_index) ||
        manifest.wall_cutter_index < 0 || manifest.wall_cutter_index > 1))) {
      throw new Error(`Manifesto inválido: ${item.classname}.`);
    }
    return manifest;
  }));
  const entries: Record<string, IndoorArtEntry> = { ...legacy?.art.entries };
  const textures = new Map<string, Texture>();
  await Promise.all(manifests.map(async (manifest) => {
    const parts = manifest.parts.map((part) => ({ ...part, file: new URL(`${manifest.classname}/${part.file}`, root).href }));
    for (const frame of parts) {
      const texture = await Assets.load<Texture>(frame.file);
      texture.source.scaleMode = 'nearest'; texture.source.autoGenerateMipmaps = true;
      // Smooth reductions and intermediate mip levels; retain sharp magnification.
      texture.source.minFilter = 'linear'; texture.source.mipmapFilter = 'linear';
      textures.set(frame.file, texture);
    }
    const frames = groupItemParts(parts).map((pose) => {
      if (pose.parts.length === 1) return pose.frame;
      const canvas = document.createElement('canvas'); canvas.width = pose.frame.width; canvas.height = pose.frame.height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Não foi possível montar o item.');
      for (const part of pose.parts) context.drawImage(textures.get(part.file)!.source.resource as CanvasImageSource,
        part.left - pose.frame.left, part.top - pose.frame.top, part.width, part.height);
      const file = `assembled:${manifest.classname}:${pose.rotation}`;
      const texture = Texture.from(canvas); texture.source.scaleMode = 'nearest';
      texture.source.autoGenerateMipmaps = true; textures.set(file, texture);
      texture.source.minFilter = 'linear'; texture.source.mipmapFilter = 'linear';
      return { ...pose.frame, file };
    });
    entries[manifest.classname] = {
      characterId: manifest.id, frames, sizeX: manifest.sizeX, sizeY: manifest.sizeY,
      itemHeight: manifest.itemHeight, wallpaperRotation: manifest.wallpaperRotation, door: manifest.door,
      wallCutterIndex: manifest.wall_cutter_index,
    };
  }));
  return { art: new IndoorArt(entries, legacy?.art.sceneBackground), textureFor: (file) => textures.get(file) ?? legacy?.textureFor(file) };
}

export function roomModelItems(snapshot: RoomSnapshot, art?: IndoorArt): RoomItem[] {
  const catalog = new Map(snapshot.catalog.map((item) => [item.id, item]));
  const papers = snapshot.inventory.filter((unit) => unit.placed && catalog.get(unit.itemId)?.type === 1);
  return snapshot.inventory.flatMap((unit): RoomItem[] => {
    const entry = catalog.get(unit.itemId);
    if (!unit.placed || !entry || entry.type < 2) return [];
    const paper = entry.kind === 'wall' ? papers.find((p) => p.tx === unit.tx && p.ty === unit.ty) : undefined;
    const rotated = unit.rotation % 2 === 1;
    return [{
      id: entry.id, name: entry.name, inventoryUnitId: unit.unitId, instanceId: unit.stoveId ?? unit.unitId,
      className: entry.classname, kind: entry.kind, tx: unit.tx, ty: unit.ty, rotation: unit.rotation,
      sizeX: rotated ? entry.sizeY : entry.sizeX, sizeY: rotated ? entry.sizeX : entry.sizeY,
      blocks: entry.kind !== 'door',
      ...(paper ? { wallpaperClassName: catalog.get(paper.itemId)!.classname, wallpaperUnitId: paper.unitId } : {}),
      ...(entry.type === 2 ? { doorLintelRatio: 1 - (art?.get(entry.classname)?.wallCutterIndex ?? entry.wall_cutter_index ?? .9) } : {}),
    }];
  }).sort((a, b) => Number(b.kind === 'wall') - Number(a.kind === 'wall'));
}

export class RoomInventoryClient {
  private pending?: { signature: string; body: string; path: string };
  constructor(readonly roomId?: string) {}
  async refresh(): Promise<RoomSnapshot> {
    return this.read(await fetch('/api/coffe/room' + (this.roomId ? '?room=' + encodeURIComponent(this.roomId) : ''), { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) }));
  }
  private async read(response: Response): Promise<RoomSnapshot> {
    if (response.status === 401) { window.location.replace('/'); throw new Error('Sua sessão expirou.'); }
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as { message?: string };
      throw new Error(problem.message ?? 'Não foi possível salvar o quarto.');
    }
    return response.json() as Promise<RoomSnapshot>;
  }
  async mutate(action: 'purchase' | 'move' | 'store', revision: number, data: { itemId?: number; unitId?: string; tx?: number; ty?: number; rotation?: number }): Promise<RoomSnapshot> {
    const signature = JSON.stringify({ action, ...data });
    if (this.pending && this.pending.signature !== signature) {
      throw new Error('Verifique a última operação repetindo a mesma colocação ou recarregando o quarto.');
    }
    const path = `/api/coffe/room/${action}`;
    this.pending ??= { signature, path, body: JSON.stringify({ ...data, revision, requestId: crypto.randomUUID() }) };
    const command = this.pending;
    // A lost response retries the exact same key; it never creates another paid unit.
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch(command.path, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' }, body: command.body, signal: AbortSignal.timeout(10000) });
        break;
      } catch { if (attempt === 1) throw new Error('Falha de conexão. Repita esta colocação para verificar a compra sem pagar novamente.'); }
    }
    if (!response!.ok && response!.status < 500) this.pending = undefined;
    try {
      const snapshot = await this.read(response!);
      this.pending = undefined;
      return snapshot;
    } catch (error) {
      if (response!.ok) throw new Error('Resposta incompleta. Repita esta colocação para verificar a compra sem pagar novamente.');
      throw error;
    }
  }
}
