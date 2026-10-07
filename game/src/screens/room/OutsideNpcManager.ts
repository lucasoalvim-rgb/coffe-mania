import type { Container } from 'pixi.js';

import { Actor } from '../../world/Actor';
import { findPath } from '../../world/PathFinder';
import type { Tile } from '../../world/iso';
import { DEFAULT_ROOM_ITEMS, type RoomModel } from '../../world/RoomModel';
import { doorOpeningTile } from '../../world/doorGeometry';
import type { NpcEmotionTextures } from '../../game/asset-manifest';
import { NpcEmotion } from './NpcEmotion';
import { NpcAppearanceExhaustedError } from '../../avatar/npc-looks';

export interface ActorRenderer {
  readonly view: Container;
  sync(): void;
  update?(deltaMs: number): void;
  destroy(): void;
}

export const DOOR_TILE: Tile = doorOpeningTile(DEFAULT_ROOM_ITEMS.find((item) => item.kind === 'door')!);
export const SPAWN_TOP_Y = -20;
export const SPAWN_BOTTOM_Y = 26;
export const SPAWN_SIDE_X = 24;

/** Caminho contínuo pelas duas calçadas, até o vão real de qualquer uma das paredes. */
export function createSidewalkPathToDoor(start: Tile, door: Tile = DOOR_TILE): Tile[] {
  const path: Tile[] = [];
  let current = { ...start };
  const lineTo = (dest: Tile): void => {
    while (current.tx !== dest.tx || current.ty !== dest.ty) {
      current = current.tx !== dest.tx
        ? { tx: current.tx + Math.sign(dest.tx - current.tx), ty: current.ty }
        : { tx: current.tx, ty: current.ty + Math.sign(dest.ty - current.ty) };
      path.push(current);
    }
  };
  const fromSide = start.tx > 0;
  if (door.tx === 0) {
    // Porta na coluna esquerda: vire na junção só se vier da rua lateral.
    const lane = fromSide ? start.ty : start.tx;
    if (fromSide) lineTo({ tx: lane, ty: start.ty });
    lineTo({ tx: lane, ty: door.ty });
  } else {
    // Porta na linha direita: a regra é simétrica, sem atravessar o quarto.
    const lane = fromSide ? start.ty : start.tx;
    if (!fromSide) lineTo({ tx: start.tx, ty: lane });
    lineTo({ tx: door.tx, ty: lane });
  }
  lineTo(door);
  return path;
}

/** Saída percorre a mesma calçada ao contrário; não há teleporte na mudança de face. */
export function createSidewalkPathFromDoor(dest: Tile, door: Tile = DOOR_TILE): Tile[] {
  return [dest, ...createSidewalkPathToDoor(dest, door)].reverse().slice(1);
}

export type OutsideNpcPhase =
  | { kind: 'entering' }
  | { kind: 'wandering'; wanderCount: number; maxWanders: number; idleMs: number }
  | { kind: 'leaving'; dest: Tile };

export interface OutsideNpc {
  readonly actor: Actor;
  readonly view: ActorRenderer;
  phase: OutsideNpcPhase;
  emotion?: NpcEmotion;
  emotionShown?: boolean;
}

export interface OutsideNpcManagerOptions {
  model: RoomModel;
  world: Container;
  createView: (actor: Actor, index: number, color: number) => ActorRenderer;
  prepareView?: () => Promise<PreparedNpcView>;
  random?: () => number;
  emotionTextures?: NpcEmotionTextures;
  maxNpcs?: number;
  spawnIntervalMs?: number;
}

export interface PreparedNpcView {
  createView: (actor: Actor, index: number, color: number) => ActorRenderer;
  /** Releases an unused preparation if the room closes before it can spawn. */
  destroy(): void;
}

const OUTSIDE_COLORS = [0x4f7fd0, 0xd8763f, 0x8e5bb5, 0x3f9e8c, 0xc9515f, 0xefc84a];

export class OutsideNpcManager {
  private readonly model: RoomModel;
  private readonly world: Container;
  private readonly createView: (actor: Actor, index: number, color: number) => ActorRenderer;
  private readonly random: () => number;
  private readonly emotionTextures?: NpcEmotionTextures;
  private readonly maxNpcs: number;
  private readonly spawnIntervalMs: number;

  private activeNpcs: OutsideNpc[] = [];
  private nextId = 1;
  private spawnTimerMs = 0;
  private renderingEnabled = true;
  private readonly prepareView?: () => Promise<PreparedNpcView>;
  private pendingSpawn = false;
  private destroyed = false;
  private appearancesExhausted = false;

  constructor(options: OutsideNpcManagerOptions) {
    this.model = options.model;
    this.world = options.world;
    this.createView = options.createView;
    this.prepareView = options.prepareView;
    this.random = options.random ?? Math.random;
    this.emotionTextures = options.emotionTextures;
    this.maxNpcs = options.maxNpcs ?? 3;
    this.spawnIntervalMs = options.spawnIntervalMs ?? 4000;

    this.spawnTimerMs = 500;
  }

  get npcs(): readonly OutsideNpc[] {
    return this.activeNpcs;
  }

  get actors(): Actor[] {
    return this.activeNpcs.map((n) => n.actor);
  }

  private get doorTile(): Tile {
    const item = this.model.items.find((candidate) => candidate.kind === 'door');
    return item ? doorOpeningTile(item) : DOOR_TILE;
  }

  /** Keep simulation running, including spawning, without drawing hidden NPCs. */
  setRenderingEnabled(enabled: boolean): void {
    this.renderingEnabled = enabled;
    for (const npc of this.activeNpcs) {
      npc.view.view.renderable = enabled;
      if (npc.emotion) npc.emotion.view.renderable = enabled;
    }
  }

  private pickSpawnPoint(): Tile {
    const r = this.random();
    if (r < 1 / 3) {
      // 1. Top (ty = -20, tx = 0 ou -1)
      const tx = this.random() < 0.5 ? 0 : -1;
      return { tx, ty: SPAWN_TOP_Y };
    } else if (r < 2 / 3) {
      // 2. Bottom (ty = 26, tx = 0 ou -1)
      const tx = this.random() < 0.5 ? 0 : -1;
      return { tx, ty: SPAWN_BOTTOM_Y };
    } else {
      // 3. Lateral (tx = 24, ty = 0 ou -1)
      const ty = this.random() < 0.5 ? 0 : -1;
      return { tx: SPAWN_SIDE_X, ty };
    }
  }

  private pickExitPoint(): Tile {
    const r = this.random();
    if (r < 1 / 3) {
      // 1. Top (ty = -20, tx = 0 ou -1)
      const tx = this.random() < 0.5 ? 0 : -1;
      return { tx, ty: SPAWN_TOP_Y };
    } else if (r < 2 / 3) {
      // 2. Bottom (ty = 26, tx = 0 ou -1)
      const tx = this.random() < 0.5 ? 0 : -1;
      return { tx, ty: SPAWN_BOTTOM_Y };
    } else {
      // 3. Lateral (tx = 24, ty = 0 ou -1)
      const ty = this.random() < 0.5 ? 0 : -1;
      return { tx: SPAWN_SIDE_X, ty };
    }
  }

  spawnNpc(preparedCreateView?: PreparedNpcView['createView']): OutsideNpc {
    if (this.destroyed) throw new Error('A sala já foi encerrada.');
    if (this.prepareView && !preparedCreateView) throw new Error('O visual do NPC precisa ser preparado antes da entrada.');
    const spawn = this.pickSpawnPoint();
    const id = this.nextId++;
    const color = OUTSIDE_COLORS[(id - 1) % OUTSIDE_COLORS.length];
    const actor = new Actor(`outside-npc-${id}`);
    actor.outside = true;
    actor.setTilePosition(spawn.tx, spawn.ty);

    const pathToDoor = createSidewalkPathToDoor(spawn, this.doorTile);
    actor.setMovePath(pathToDoor);

    const view = (preparedCreateView ?? this.createView)(actor, id, color);
    view.view.renderable = this.renderingEnabled;
    this.world.addChild(view.view);

    const npc: OutsideNpc = {
      actor,
      view,
      phase: { kind: 'entering' },
    };

    this.activeNpcs.push(npc);
    return npc;
  }

  update(deltaMs: number): void {
    if (this.destroyed) return;

    this.spawnTimerMs -= deltaMs;
    if (this.spawnTimerMs <= 0 && this.activeNpcs.length < this.maxNpcs && !this.pendingSpawn && !this.appearancesExhausted) {
      if (this.prepareView) this.prepareAndSpawn();
      else {
        this.spawnNpc();
        this.spawnTimerMs = this.spawnIntervalMs + this.random() * 3000;
      }
    }

    const remaining: OutsideNpc[] = [];

    for (const npc of this.activeNpcs) {
      npc.actor.tick(deltaMs);
      const previousEmotion = npc.emotion;
      const done = this.updatePhase(npc, deltaMs);
      // Atualiza outside e a vista no mesmo frame, inclusive durante a pausa na entrada.
      // inclusive durante a pausa na porta, e não um frame depois da transição.
      if (npc.view.update) npc.view.update(deltaMs);
      else npc.view.sync();

      if (npc.emotion === previousEmotion && npc.emotion?.update(deltaMs, npc.view.view)) this.removeEmotion(npc);

      if (done) {
        this.removeEmotion(npc);
        this.world.removeChild(npc.view.view);
        npc.view.destroy();
      } else {
        remaining.push(npc);
      }
    }

    this.activeNpcs = remaining;
  }

  private prepareAndSpawn(): void {
    this.pendingSpawn = true;
    void Promise.resolve().then(() => this.prepareView!()).then((prepared) => {
      if (this.destroyed || this.activeNpcs.length >= this.maxNpcs) { prepared.destroy(); return; }
      try { this.spawnNpc(prepared.createView); }
      catch (error) { prepared.destroy(); throw error; }
      this.spawnTimerMs = this.spawnIntervalMs + this.random() * 3000;
    }).catch((error: unknown) => {
      if (this.destroyed) return;
      this.appearancesExhausted = error instanceof NpcAppearanceExhaustedError;
      this.spawnTimerMs = 5000;
      console.warn('[npc] Não foi possível preparar um novo visual.', error);
    }).finally(() => { this.pendingSpawn = false; });
  }

  private updatePhase(npc: OutsideNpc, deltaMs: number): boolean {
    const { actor } = npc;

    switch (npc.phase.kind) {
      case 'entering': {
        if (actor.reachedPathEnd()) {

          actor.outside = false;
          npc.phase = {
            kind: 'wandering',
            wanderCount: 0,
            maxWanders: 2 + Math.floor(this.random() * 4),
            idleMs: 400 + this.random() * 1000,
          };
        }
        return false;
      }

      case 'wandering': {
        if (!actor.reachedPathEnd()) return false;

        npc.phase.idleMs -= deltaMs;
        if (npc.phase.idleMs > 0) return false;

        if (npc.phase.wanderCount >= npc.phase.maxWanders) {

          if (actor.tileX === this.doorTile.tx && actor.tileY === this.doorTile.ty) {
            this.startExitEmotion(npc);

            actor.outside = true;
            const exit = this.pickExitPoint();
            const exitPath = createSidewalkPathFromDoor(exit, this.doorTile);
            actor.setMovePath(exitPath);
            npc.phase = { kind: 'leaving', dest: exit };
          } else {
            // Traça caminho até o vão atual, inclusive após mudar a parede da porta.
            const pathToDoor = findPath({
              start: { tx: actor.tileX, ty: actor.tileY },
              dest: this.doorTile,
              isWalkable: this.model.isWalkable,
              maxTilesX: this.model.tilesX,
              maxTilesY: this.model.tilesY,
            });

            if (pathToDoor && pathToDoor.length > 0) {
              actor.setMovePath(pathToDoor);
              this.startExitEmotion(npc);
              npc.phase.wanderCount = npc.phase.maxWanders + 1; 
              npc.phase.idleMs = 0;
            } else {
              npc.phase.idleMs = 1200;
            }
          }
        } else {

          const free = this.model.walkableTiles();
          if (free.length > 0) {
            const dest = free[Math.floor(this.random() * free.length)];
            const path = findPath({
              start: { tx: actor.tileX, ty: actor.tileY },
              dest,
              isWalkable: this.model.isWalkable,
              maxTilesX: this.model.tilesX,
              maxTilesY: this.model.tilesY,
            });

            if (path && path.length > 0) {
              actor.setMovePath(path);
              npc.phase.wanderCount++;
              npc.phase.idleMs = 800 + this.random() * 2500;
            } else {
              npc.phase.idleMs = 500;
            }
          }
        }
        return false;
      }

      case 'leaving': {

        return actor.reachedPathEnd();
      }
    }
  }

  private startExitEmotion(npc: OutsideNpc): void {
    if (npc.emotionShown) return;
    npc.emotionShown = true;
    if (!this.emotionTextures) return;

    const frames = this.random() < 0.5
      ? this.emotionTextures.dissatisfied
      : this.emotionTextures.satisfied;
    if (frames.length === 0) return;

    const emotion = new NpcEmotion(frames);
    emotion.view.renderable = this.renderingEnabled;
    emotion.update(0, npc.view.view);
    npc.emotion = emotion;
    this.world.addChild(emotion.view);
  }

  private removeEmotion(npc: OutsideNpc): void {
    if (!npc.emotion) return;
    this.world.removeChild(npc.emotion.view);
    npc.emotion.destroy();
    npc.emotion = undefined;
  }

  destroy(): void {
    this.destroyed = true;
    for (const npc of this.activeNpcs) {
      this.removeEmotion(npc);
      this.world.removeChild(npc.view.view);
      npc.view.destroy();
    }
    this.activeNpcs = [];
  }
}
