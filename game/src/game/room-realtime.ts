import type { CookingSnapshot } from './cooking';
import type { RoomUnit } from './room-inventory';
import type { Tile } from '../world/iso';

export interface SharedFood { id: string; recipeId: string }
export interface SharedAction { kind: 'cooking' | 'serving' | 'seated' | 'eating'; stoveId?: string; startedAt: number; duration: number }
export interface SharedEmotion { id: string; kind: 'satisfied' | 'dissatisfied'; startedAt: number; duration: number }
export interface SharedActor {
  id: string; kind?: 'human' | 'npc'; name?: string; appearance?: string;
  tx: number; ty: number; direction: number; outside: boolean; state: string;
  move?: { from: Tile; to: Tile; startedAt: number; duration: number };
  chairId?: string; tableId?: string; food?: SharedFood; actionRemaining?: number;
  action?: SharedAction; emotion?: SharedEmotion;
}
export interface SharedWorld {
  roomId: string; revision: number; tilesX: number; tilesY: number;
  units: RoomUnit[]; foods: SharedFood[]; cooking?: CookingSnapshot;
}
export interface RoomEvent {
  type: 'welcome' | 'actors' | 'world' | 'food' | 'ack' | 'error'; epoch: string; seq: number; serverNow: number;
  selfId?: string; world?: SharedWorld; actors?: SharedActor[]; removed?: string[];
  units?: RoomUnit[]; revision?: number; foods?: SharedFood[]; cooking?: CookingSnapshot;
  requestId?: string; message?: string;
}

export interface RoomLatency { type: 'latency'; rttMs: number }

/** One connection for live room changes; PocketBase SSE remains for private player state. */
export class RoomRealtime {
  connected = false;
  pingMs: number | null = null;
  selfId = '';
  readonly actors = new Map<string, SharedActor>();
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private generation = 0;
  private epoch = '';
  private seq = 0;
  private retries = 0;
  private serverAnchor = 0;
  private localAnchor = 0;
  private listeners = new Set<(event: RoomEvent) => void>();
  private statuses = new Set<(connected: boolean) => void>();
  private pending = new Map<string, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(readonly roomId: string) {}
  onEvent(listener: (event: RoomEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onStatus(listener: (connected: boolean) => void): () => void { this.statuses.add(listener); return () => this.statuses.delete(listener); }
  serverNowMs(): number { return this.serverAnchor + performance.now() - this.localAnchor; }
  async connect(): Promise<void> {
    if (this.stopped) return;
    const generation = ++this.generation;
    try {
      const response = await fetch('/api/coffe/game-ticket', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId: this.roomId }), signal: AbortSignal.timeout(10000) });
      if (response.status === 401) { this.destroy(); window.location.replace('/'); return; }
      if (!response.ok) throw new Error('Quarto indisponível.');
      const { ticket } = await response.json() as { ticket: string };
      if (this.stopped || generation !== this.generation) return;
      const address = new URL('/game/ws', window.location.href); address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(address.href); this.socket = socket;
      let joined = false;
      const timeout = setTimeout(() => { if (!joined) socket.close(); }, 15000);
      socket.onopen = () => socket.send(JSON.stringify({ type: 'join', ticket }));
      socket.onmessage = (message) => {
        if (this.stopped || generation !== this.generation) return;
        try {
          const event = JSON.parse(String(message.data)) as RoomEvent | RoomLatency;
          // Heartbeat measurements never advance the room sequence or its animation clock.
          if (event?.type === 'latency') {
            if (joined && Number.isFinite(event.rttMs) && event.rttMs >= 0) this.pingMs = Math.round(event.rttMs);
            return;
          }
          if (!event || !Number.isSafeInteger(event.seq) || !Number.isFinite(event.serverNow) || typeof event.epoch !== 'string') throw new Error('Evento inválido.');
          if (event.type === 'welcome') {
            if (!event.world || !event.selfId || !Array.isArray(event.actors)) throw new Error('Entrada incompleta.');
            joined = true; clearTimeout(timeout); this.epoch = event.epoch; this.seq = event.seq; this.selfId = event.selfId;
            this.pingMs = null;
            this.actors.clear(); this.retries = 0; this.setConnected(true);
          } else if (event.type !== 'ack' && event.type !== 'error') {
            if (!joined || event.epoch !== this.epoch || event.seq !== this.seq + 1) { socket.close(); return; }
            this.seq = event.seq;
          }
          this.serverAnchor = event.serverNow; this.localAnchor = performance.now();
          for (const state of event.actors ?? []) {
            const old = this.actors.get(state.id);
            this.actors.set(state.id, { ...old, ...state, move: state.move, chairId: state.chairId, tableId: state.tableId, food: state.food, action: state.action, emotion: state.emotion });
          }
          for (const id of event.removed ?? []) this.actors.delete(id);
          if (event.requestId) {
            const pending = this.pending.get(event.requestId);
            if (pending) { clearTimeout(pending.timer); this.pending.delete(event.requestId); event.type === 'error' ? pending.reject(new Error(event.message ?? 'Ação recusada.')) : pending.resolve(); }
          }
          for (const listener of this.listeners) listener(event);
        } catch (error) { console.warn('[room] Falha ao sincronizar o quarto.', error); socket.close(); }
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        if (generation !== this.generation) return;
        this.setConnected(false); this.rejectPending('Conexão interrompida.'); this.retry();
      };
      socket.onerror = () => socket.close();
    } catch { if (generation === this.generation && !this.stopped) { this.setConnected(false); this.retry(); } }
  }
  private setConnected(value: boolean): void { this.connected = value; if (!value) this.pingMs = null; for (const listener of this.statuses) listener(value); }
  private retry(): void { if (this.stopped) return; clearTimeout(this.timer); this.timer = setTimeout(() => { void this.connect(); }, Math.min(10000, 500 * 2 ** Math.min(5, this.retries++))); }
  command(type: 'walk' | 'sit' | 'stand' | 'serve_prepare', data: { tx?: number; ty?: number; chairId?: string; stoveId?: string } = {}): Promise<void> {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Aguarde a conexão com o quarto.'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('A ação não foi confirmada.')); this.socket?.close(); }, 12000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ type, requestId, ...data }));
    });
  }
  private rejectPending(message: string): void { for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); } this.pending.clear(); }
  destroy(): void { this.stopped = true; this.generation++; clearTimeout(this.timer); this.socket?.close(); this.rejectPending('Quarto encerrado.'); this.listeners.clear(); this.statuses.clear(); this.connected = false; this.pingMs = null; }
}
