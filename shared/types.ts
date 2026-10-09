// Gemeinsame Datentypen für Server, Steuerung und Output.

/** Punkt im normierten Ausgaberaum: (0,0) oben links, (1,1) unten rechts. */
export interface Point {
  x: number;
  y: number;
}

/** Vier Ecken: oben links, oben rechts, unten rechts, unten links. */
export type Quad = [Point, Point, Point, Point];

export type CornerIndex = 0 | 1 | 2 | 3;

export type Content =
  | { type: 'none' }
  | { type: 'testgrid' }
  | VideoContent;

export interface VideoContent {
  type: 'video';
  mediaId: string;
  loop: boolean;
  /** Wiedergabegeschwindigkeit, 0.25 … 4 */
  speed: number;
  playing: boolean;
}

export type ContentType = Content['type'];

export interface Surface {
  id: string;
  name: string;
  visible: boolean;
  corners: Quad;
  content: Content;
}

export interface Project {
  /** Version des Dateiformats, für spätere Migrationen. */
  format: 1;
  name: string;
  surfaces: Surface[];
}

export type TestPattern = 'none' | 'grid' | 'white';

/** Nicht gespeicherter Bearbeitungszustand, der trotzdem auf dem Output sichtbar ist. */
export interface ViewState {
  /** Umrisse, Nummern und Fadenkreuz auf dem Output einblenden. */
  showOutlines: boolean;
  testPattern: TestPattern;
  selectedSurfaceId: string | null;
  selectedCorner: CornerIndex | null;
}

export interface MediaItem {
  id: string;
  /** Originaler Dateiname */
  name: string;
  kind: 'video';
  status: 'processing' | 'ready' | 'error';
  /** 0 … 1 während der Transkodierung */
  progress: number;
  error?: string;
  width?: number;
  height?: number;
  /** Sekunden */
  duration?: number;
  createdAt: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
}

export interface SessionMeta {
  /** Gespeichertes Projekt, auf dem der aktuelle Stand basiert (null = noch nie gespeichert). */
  currentProjectId: string | null;
  /** Ungespeicherte Änderungen vorhanden */
  dirty: boolean;
  projects: ProjectMeta[];
}

export interface OutputInfo {
  clientId: string;
  fps: number;
  width: number;
  height: number;
  /** Hat der Benutzer auf dem Output schon „Tippen zum Starten“ ausgelöst? */
  started: boolean;
  userAgent: string;
}

export interface Presence {
  outputs: OutputInfo[];
  controls: number;
}

/** Zustand, den der Server hält und an alle Clients verteilt. */
export interface AppState {
  project: Project;
  view: ViewState;
}

export const DEFAULT_OUTPUT_SIZE = { width: 1280, height: 720 } as const;
