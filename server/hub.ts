// WebSocket-Verteiler: nimmt Operationen entgegen, wendet sie an und verteilt sie an alle.

import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { newId } from '../shared/ids.js';
import type { ClientMessage, Role, ServerMessage } from '../shared/protocol.js';
import { parseOp } from '../shared/state.js';
import type { OutputInfo, Presence, SessionMeta } from '../shared/types.js';
import type { MediaLibrary } from './media.js';
import { StoreError, type Store } from './store.js';

interface Client {
  id: string;
  ws: WebSocket;
  role: Role | null;
  alive: boolean;
  userAgent: string;
  output?: OutputInfo;
}

export class Hub {
  private clients = new Set<Client>();
  private wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  constructor(
    private store: Store,
    private media: MediaLibrary,
  ) {
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req.headers['user-agent'] ?? ''));
    // Tote Verbindungen (z. B. iPhone gesperrt) regelmäßig aufräumen
    setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        c.ws.ping();
      }
    }, 10_000).unref();
  }

  attach(server: HttpServer): void {
    server.on('upgrade', (req, socket, head) => {
      if (!req.url?.startsWith('/ws')) return; // z. B. Vite-HMR
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
    });
  }

  broadcast(msg: ServerMessage, filter?: (c: Client) => boolean): void {
    const data = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.role && c.ws.readyState === WebSocket.OPEN && (!filter || filter(c))) c.ws.send(data);
    }
  }

  broadcastMedia(): void {
    this.broadcast({ t: 'media', media: this.media.list() });
  }

  broadcastState(): void {
    this.broadcast({ t: 'state', state: this.store.state });
    this.broadcast({ t: 'session', session: this.store.session });
  }

  private presence(): Presence {
    const outputs: OutputInfo[] = [];
    let controls = 0;
    for (const c of this.clients) {
      if (c.role === 'control') controls++;
      if (c.role === 'output') {
        outputs.push(
          c.output ?? { clientId: c.id, fps: 0, width: 0, height: 0, videoBlocked: false, userAgent: c.userAgent },
        );
      }
    }
    return { outputs, controls };
  }

  private broadcastPresence(): void {
    this.broadcast({ t: 'presence', presence: this.presence() }, (c) => c.role === 'control');
  }

  private send(c: Client, msg: ServerMessage): void {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
  }

  private onConnection(ws: WebSocket, userAgent: string): void {
    const client: Client = { id: newId(8), ws, role: null, alive: true, userAgent };
    this.clients.add(client);
    ws.on('pong', () => (client.alive = true));
    ws.on('message', (data) => {
      client.alive = true;
      this.onMessage(client, data).catch((err) => {
        console.error('Fehler bei Nachricht:', err);
        this.send(client, { t: 'toast', level: 'error', message: 'Interner Fehler auf dem Server' });
      });
    });
    ws.on('close', () => {
      this.clients.delete(client);
      if (client.role) this.broadcastPresence();
    });
    ws.on('error', () => ws.terminate());
  }

  private async onMessage(c: Client, data: RawData): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;

    if (msg.t === 'hello') {
      c.role = msg.role === 'output' ? 'output' : 'control';
      this.send(c, {
        t: 'snapshot',
        clientId: c.id,
        state: this.store.state,
        media: this.media.list(),
        session: this.store.session,
        presence: this.presence(),
      });
      this.broadcastPresence();
      return;
    }
    if (!c.role) return;

    switch (msg.t) {
      case 'op': {
        const op = parseOp(msg.op);
        const seq = typeof msg.seq === 'number' && Number.isInteger(msg.seq) ? msg.seq : undefined;
        const gesture = typeof msg.gesture === 'string' ? msg.gesture.slice(0, 64) : undefined;
        const before = sessionKey(this.store.session);
        if (!op || !this.store.apply(op, gesture)) {
          if (seq !== undefined) this.send(c, { t: 'ack', seq });
          return;
        }
        this.broadcast({ t: 'op', op, from: c.id, seq });
        if (sessionKey(this.store.session) !== before) this.broadcast({ t: 'session', session: this.store.session });
        return;
      }
      case 'undo':
      case 'redo': {
        const ok = msg.t === 'undo' ? this.store.undo() : this.store.redo();
        if (ok) this.broadcastState();
        return;
      }
      case 'outputStatus': {
        if (c.role !== 'output') return;
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);
        c.output = {
          clientId: c.id,
          fps: num(msg.fps),
          width: num(msg.width),
          height: num(msg.height),
          videoBlocked: msg.videoBlocked === true,
          userAgent: c.userAgent,
        };
        this.broadcastPresence();
        return;
      }
      case 'project':
        await this.onProject(c, msg);
        return;
      case 'ping':
        this.send(c, { t: 'pong', at: msg.at });
        return;
    }
  }

  private async onProject(c: Client, msg: Extract<ClientMessage, { t: 'project' }>): Promise<void> {
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    try {
      let message: string;
      switch (msg.action) {
        case 'save':
          await this.store.save();
          message = `„${this.store.state.project.name}“ gespeichert`;
          break;
        case 'saveAs':
          await this.store.saveAs(str(msg.name));
          message = `Als „${this.store.state.project.name}“ gespeichert`;
          break;
        case 'load':
          await this.store.load(str(msg.id));
          message = `„${this.store.state.project.name}“ geladen`;
          break;
        case 'new':
          await this.store.newProject(str(msg.name));
          message = 'Neues Projekt angelegt';
          break;
        case 'rename':
          await this.store.rename(str(msg.id), str(msg.name));
          message = 'Projekt umbenannt';
          break;
        case 'delete':
          await this.store.delete(str(msg.id));
          message = 'Projekt gelöscht';
          break;
        default:
          return;
      }
      this.broadcastState();
      this.send(c, { t: 'toast', level: 'info', message });
    } catch (err) {
      const message = err instanceof StoreError ? err.message : 'Speichern/Laden fehlgeschlagen';
      if (!(err instanceof StoreError)) console.error(err);
      this.send(c, { t: 'toast', level: 'error', message });
    }
  }
}

/** Nur die Felder, die sich durch eine Operation ändern können */
function sessionKey(s: SessionMeta): string {
  return `${s.dirty}|${s.canUndo}|${s.canRedo}`;
}
