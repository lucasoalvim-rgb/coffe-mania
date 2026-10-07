import {
  ROOM_ASSET_SCALE,
  TILE_HEIGHT,
  TILE_HEIGHT_HALF,
  TILE_WIDTH,
  TILE_WIDTH_HALF,
  actorDepth,
  directionFromDelta,
  screenToMovementTile,
  screenToTile,
  tileToScreenX,
  tileToScreenY,
  type Tile,
} from './iso';

/** Movimento independente do renderer. Passos entre tiles vizinhos têm duração fixa; a velocidade projetada depende da direção. */

export const DEFAULT_MOVE_SPEED_X = 0.06 * ROOM_ASSET_SCALE;
export const DEFAULT_MOVE_SPEED_Y = 0.03 * ROOM_ASSET_SCALE;

/** Duração de um passo de tile, em ms. */
export const TILE_STEP_MS = TILE_WIDTH_HALF / DEFAULT_MOVE_SPEED_X;

export class Actor {
  x = 0;
  y = 0;
  /** Nearest interpolated tile, like Nitro: full steps switch at their midpoint. */
  tileX = 0;
  tileY = 0;

  speedX = 0;
  speedY = 0;

  moveSpeedX = DEFAULT_MOVE_SPEED_X;
  moveSpeedY = DEFAULT_MOVE_SPEED_Y;

  /** 0 a 7, na convenção do Avatar3D. */
  direction = 0;

  private destX = 0;
  private destY = 0;
  private segmentTargetTile: Tile = { tx: 0, ty: 0 };
  private segmentDurationMs = 0;
  private path: Tile[] = [];

  /** Estado da caminhada externa, independente da ordem visual por tile. */
  outside = false;

  constructor(readonly label: string = 'actor') {}

  /**
   * `y` dos pés. A posição do ator é o canto de cima do tile,
   * e o apoio fica meio losango abaixo.
   */
  get footY(): number {
    return this.y + TILE_HEIGHT_HALF;
  }

  /** Estado de navegação; não decide a profundidade de renderização. */
  get insideWalls(): boolean {
    return !this.outside && this.tileX >= 1 && this.tileY >= 1;
  }

  /**
   * Todos os atores usam o centro do hitbox lógico, dentro e fora da sala.
   * A imagem continua interpolada; faces e volumes são comparados pelo
   * RoomDepthSorter, sem deslocamentos dependentes do estado de navegação.
   */
  get drawPriority(): number {
    return actorDepth(tileToScreenY(this.tileX, this.tileY) + TILE_HEIGHT_HALF);
  }

  get moving(): boolean {
    return this.speedX !== 0 || this.speedY !== 0;
  }

  get remainingPath(): readonly Tile[] {
    return this.path;
  }

  /** Próximo tile de destino, inclusive o passo que já saiu de `remainingPath`. */
  get currentDestination(): Tile | null {
    return this.moving ? this.segmentTargetTile : null;
  }

  reachedPathEnd(): boolean {
    return this.path.length === 0 && !this.moving;
  }

  setTilePosition(tx: number, ty: number): void {
    this.tileX = tx;
    this.tileY = ty;
    this.x = tileToScreenX(tx, ty);
    this.y = tileToScreenY(tx, ty);
    this.destX = this.x;
    this.destY = this.y;
    this.segmentTargetTile = { tx, ty };
    this.segmentDurationMs = 0;
    this.speedX = 0;
    this.speedY = 0;
    this.path = [];
  }

  private setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  setMovePath(path: readonly Tile[]): void {
    const current = this.currentDestination;
    const logicalAlreadyAtCurrent = current && this.tileX === current.tx && this.tileY === current.ty;
    this.path = path.map((tile) => ({ ...tile }));
    // Cancelar a fila não congela o sprite entre dois tiles: termina apenas
    // o trecho atual, mantendo o tile lógico e o visual sincronizados ao fim.
    if (this.path.length === 0) return;
    if (logicalAlreadyAtCurrent) {
      // O tile B já é lógico, mas a arte ainda está entre A e B. Um novo A*
      // parte de B; complete o movimento visual até B antes de seguir para C.
      if (this.path[0].tx !== current.tx || this.path[0].ty !== current.ty) this.path.unshift(current);
    }
    this.destX = this.x;
    this.destY = this.y;
    this.speedX = 0;
    this.speedY = 0;
    this.popPath();
  }

  clearPath(): void {
    this.path = [];
  }

  /** Render a server-owned step. The local renderer never advances the route. */
  syncAuthoritative(tx: number, ty: number, direction: number, outside: boolean,
    move: { from: Tile; to: Tile; startedAt: number; duration: number } | undefined, now: number): void {
    this.path = []; this.direction = direction; this.outside = outside;
    if (!move) { this.setTilePosition(tx, ty); return; }
    const progress = Math.max(0, Math.min(1, (now - move.startedAt) / Math.max(1, move.duration)));
    const fromX = tileToScreenX(move.from.tx, move.from.ty), fromY = tileToScreenY(move.from.tx, move.from.ty);
    const toX = tileToScreenX(move.to.tx, move.to.ty), toY = tileToScreenY(move.to.tx, move.to.ty);
    this.x = fromX + (toX - fromX) * progress; this.y = fromY + (toY - fromY) * progress;
    const tile = screenToMovementTile(this.x, this.y, toX - fromX, toY - fromY);
    this.tileX = tile.tx; this.tileY = tile.ty;
    this.segmentTargetTile = move.to;
    this.speedX = (toX - fromX) / Math.max(1, move.duration); this.speedY = (toY - fromY) / Math.max(1, move.duration);
    this.destX = toX; this.destY = toY;
  }

  /** Atualiza o destino e calcula a direção pelo sinal do deslocamento projetado. */
  moveTo(destX: number, destY: number): void {
    this.destX = destX;
    this.destY = destY;
    this.segmentTargetTile = screenToTile(destX, destY);
    const dx = destX - this.x;
    const dy = destY - this.y;
    // Inverso contínuo da projeção isométrica: também cobre um passo
    // parcialmente percorrido quando o caminho muda no meio da animação.
    const deltaTileX = (dx + 2 * dy) / TILE_WIDTH;
    const deltaTileY = (2 * dy - dx) / (2 * TILE_HEIGHT);
    const tileDistance = Math.max(Math.abs(deltaTileX), Math.abs(deltaTileY));
    const tileDuration = Math.max(TILE_WIDTH_HALF / this.moveSpeedX, TILE_HEIGHT_HALF / this.moveSpeedY);
    this.segmentDurationMs = tileDistance * tileDuration;
    this.speedX = this.segmentDurationMs > 0 ? dx / this.segmentDurationMs : 0;
    this.speedY = this.segmentDurationMs > 0 ? dy / this.segmentDurationMs : 0;

    if (this.moving) this.direction = directionFromDelta(this.speedX, this.speedY);
    else {
      this.tileX = this.segmentTargetTile.tx;
      this.tileY = this.segmentTargetTile.ty;
    }
  }

  private popPath(): void {
    const next = this.path.shift();
    if (!next) return;
    this.moveTo(tileToScreenX(next.tx, next.ty), tileToScreenY(next.tx, next.ty));
  }

  private static reached(value: number, target: number, speed: number): boolean {
    if (speed > 0) return value >= target;
    if (speed < 0) return value <= target;
    return value === target;
  }

  tick(deltaMs: number): void {
    let moved = false;
    const stepSpeedX = this.speedX, stepSpeedY = this.speedY;
    let x = this.x + this.speedX * deltaMs;
    let y = this.y + this.speedY * deltaMs;

    if (this.speedX !== 0) {
      moved = true;
      if (Actor.reached(x, this.destX, this.speedX)) {
        this.speedX = 0;
        x = this.destX;
      }
    }

    if (this.speedY !== 0) {
      moved = true;
      if (Actor.reached(y, this.destY, this.speedY)) {
        this.speedY = 0;
        y = this.destY;
      }
    }

    if (moved) {
      this.setPosition(x, y);
      // Round the actual position, not half of the remaining duration: a
      // redirected partial step must keep the same physical tile boundary.
      const logicalTile = screenToMovementTile(x, y, stepSpeedX, stepSpeedY);
      this.tileX = logicalTile.tx;
      this.tileY = logicalTile.ty;
      if (!this.moving) {
        this.tileX = this.segmentTargetTile.tx;
        this.tileY = this.segmentTargetTile.ty;
      }
    }

    if (this.path.length > 0 && !this.moving) this.popPath();
  }
}
