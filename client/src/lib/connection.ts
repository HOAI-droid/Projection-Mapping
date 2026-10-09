// WebSocket-Verbindung mit automatischem Reconnect und lokalem Zustandsspiegel.

import type { ClientMessage, Role, ServerMessage } from '../../../shared/protocol.js';
import { applyOp, type Op } from '../../../shared/state.js';
import type { AppState, MediaItem, Presence, SessionMeta } from '../../../shared/types.js';

export type ConnStatus = 'connecting' | 'online' | 'offline';

export interface Snapshot {
  status: ConnStatus;
  state: AppState | null;
  media: MediaItem[];
  session: SessionMeta | null;
  presence: Presence;
  /** Gemessene Rundlaufzeit zum Server in ms */
  rtt: number | null;
}

export interface Toast {
  level: 'info' | 'error';
  message: string;
}

export class Connection {
  private ws: WebSocket | null = null;
  private retry = 0;
  private listeners = new Set<() => void>();
  private toastListeners = new Set<(t: Toast) => void>();
  private pingTimer: number | undefined;
  // Optimistische Anwendung: eigene Ops wirken sofort; bestätigt ist nur, was der Server zurückschickt.
  private clientId = '';
  private confirmed: AppState | null = null;
  private pending: { seq: number; op: Op }[] = [];
  private seq = 0;

  snapshot: Snapshot = {
    status: 'connecting',
    state: null,
    media: [],
    session: null,
    presence: { outputs: [], controls: 0 },
    rtt: null,
  };

  constructor(private role: Role) {
    this.connect();
    // Nach dem Aufwachen (iOS sperrt/pausiert Tabs) sofort neu verbinden
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.ws?.readyState !== WebSocket.OPEN) {
        this.retry = 0;
        this.connect();
      }
    });
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  onToast(fn: (t: Toast) => void): () => void {
    this.toastListeners.add(fn);
    return () => this.toastListeners.delete(fn);
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /**
   * Operation an den Server. Sie wirkt sofort lokal (optimistisch), damit schnelle
   * Klicks/Tasten immer auf dem neuesten Stand aufbauen; die Reihenfolge legt der Server fest.
   * Ops mit gleicher gesture = ein Rückgängig-Schritt.
   */
  op(op: Op, gesture?: string): boolean {
    const seq = ++this.seq;
    if (!this.send(gesture ? { t: 'op', op, gesture, seq } : { t: 'op', op, seq })) return false;
    this.pending.push({ seq, op });
    if (this.snapshot.state) this.update({ state: applyOp(this.snapshot.state, op) });
    return true;
  }

  /** Bestätigten Stand + noch ausstehende eigene Ops = angezeigter Stand */
  private recompute(): void {
    if (!this.confirmed) return;
    this.update({ state: this.pending.reduce((st, p) => applyOp(st, p.op), this.confirmed) });
  }

  private acknowledge(seq: number): void {
    this.pending = this.pending.filter((p) => p.seq > seq);
  }

  undo(): void {
    this.send({ t: 'undo' });
  }

  redo(): void {
    this.send({ t: 'redo' });
  }

  private update(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const fn of this.listeners) fn();
  }

  private connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;
    if (this.snapshot.status !== 'connecting' && this.snapshot.status !== 'offline') this.update({ status: 'connecting' });

    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ t: 'hello', role: this.role } satisfies ClientMessage));
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', at: performance.now() }), 3000);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handle(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      window.clearInterval(this.pingTimer);
      this.update({ status: 'offline', rtt: null });
      // Exponentielles Backoff, max. 5 s
      const delay = Math.min(5000, 250 * 2 ** this.retry++);
      window.setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'snapshot':
        this.clientId = msg.clientId;
        this.confirmed = msg.state;
        this.pending = [];
        this.update({
          status: 'online',
          state: msg.state,
          media: msg.media,
          session: msg.session,
          presence: msg.presence,
        });
        break;
      case 'op':
        if (!this.confirmed) break;
        this.confirmed = applyOp(this.confirmed, msg.op);
        if (msg.from === this.clientId && msg.seq !== undefined) this.acknowledge(msg.seq);
        this.recompute();
        break;
      case 'ack':
        this.acknowledge(msg.seq);
        this.recompute();
        break;
      case 'state':
        this.confirmed = msg.state;
        this.pending = [];
        this.update({ state: msg.state });
        break;
      case 'media':
        this.update({ media: msg.media });
        break;
      case 'session':
        this.update({ session: msg.session });
        break;
      case 'presence':
        this.update({ presence: msg.presence });
        break;
      case 'toast':
        for (const fn of this.toastListeners) fn({ level: msg.level, message: msg.message });
        break;
      case 'pong':
        this.update({ rtt: Math.round(performance.now() - msg.at) });
        break;
    }
  }
}

export const mediaUrl = (id: string, file: string) => `/media/${encodeURIComponent(id)}/${encodeURIComponent(file)}`;
