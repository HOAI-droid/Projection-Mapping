// WebSocket-Nachrichten zwischen Server und Clients.

import type { Op } from './state.js';
import type { AppState, AudioFrame, MediaItem, Presence, SessionMeta } from './types.js';

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
  /**
   * gesture: Operationen mit derselben Gesten-ID (z. B. ein Ziehvorgang)
   * werden als ein einziger Rückgängig-Schritt zusammengefasst.
   */
  | { t: 'op'; op: Op; gesture?: string; seq?: number }
  | { t: 'undo' }
  | { t: 'redo' }
  | { t: 'outputStatus'; fps: number; width: number; height: number; videoBlocked: boolean }
  | ({ t: 'project' } & ProjectAction)
  /** Analysewerte der Audio-Quelle – werden an alle anderen Fenster weitergereicht */
  | { t: 'audio'; frame: AudioFrame }
  | { t: 'ping'; at: number };

export type ServerMessage =
  | { t: 'snapshot'; clientId: string; state: AppState; media: MediaItem[]; session: SessionMeta; presence: Presence }
  /** from/seq: Absender und dessen laufende Nummer – damit der Absender seine ausstehende Op bestätigt sieht */
  | { t: 'op'; op: Op; from?: string; seq?: number }
  /** Op des Absenders hat nichts geändert (z. B. ungültig) → trotzdem als erledigt markieren */
  | { t: 'ack'; seq: number }
  /** Ganzer Zustand ersetzt (z. B. nach „Projekt laden“ oder Rückgängig). */
  | { t: 'state'; state: AppState }
  | { t: 'media'; media: MediaItem[] }
  | { t: 'session'; session: SessionMeta }
  | { t: 'presence'; presence: Presence }
  | { t: 'toast'; level: 'info' | 'error'; message: string }
  | { t: 'audio'; frame: AudioFrame }
  /** server: Uhrzeit des Servers (für synchrone Überblendungen) */
  | { t: 'pong'; at: number; server: number };
