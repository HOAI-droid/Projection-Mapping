// WebSocket-Nachrichten zwischen Server und Clients.

import type { Op } from './state.js';
import type { AppState, MediaItem, Presence, SessionMeta } from './types.js';

export type Role = 'control' | 'output';

export type ProjectAction =
  | { action: 'save' }
  | { action: 'saveAs'; name: string }
  | { action: 'load'; id: string }
  | { action: 'new'; name: string }
  | { action: 'rename'; id: string; name: string }
  | { action: 'delete'; id: string };

export type ClientMessage =
  | { t: 'hello'; role: Role }
  | { t: 'op'; op: Op }
  | { t: 'outputStatus'; fps: number; width: number; height: number; started: boolean }
  | ({ t: 'project' } & ProjectAction)
  | { t: 'ping'; at: number };

export type ServerMessage =
  | { t: 'snapshot'; clientId: string; state: AppState; media: MediaItem[]; session: SessionMeta; presence: Presence }
  | { t: 'op'; op: Op }
  /** Ganzer Zustand ersetzt (z. B. nach „Projekt laden“). */
  | { t: 'state'; state: AppState }
  | { t: 'media'; media: MediaItem[] }
  | { t: 'session'; session: SessionMeta }
  | { t: 'presence'; presence: Presence }
  | { t: 'toast'; level: 'info' | 'error'; message: string }
  | { t: 'pong'; at: number };
