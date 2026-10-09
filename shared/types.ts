// Gemeinsame Datentypen für Server, Steuerung und Ausgabe.

/** Punkt im normierten Raum: (0,0) oben links, (1,1) unten rechts. */
export interface Point {
  x: number;
  y: number;
}

/** Vier Ecken: oben links, oben rechts, unten rechts, unten links. */
export type Quad = [Point, Point, Point, Point];

export type CornerIndex = 0 | 1 | 2 | 3;

export interface VideoContent {
  type: 'video';
  mediaId: string;
  loop: boolean;
  /** Wiedergabegeschwindigkeit, 0.25 … 4 */
  speed: number;
  playing: boolean;
}

export type Content =
  | { type: 'none' }
  | { type: 'testgrid' }
  | { type: 'color'; color: string }
  | { type: 'image'; mediaId: string }
  | VideoContent;

export type ContentType = Content['type'];

export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen';

/** strecken / füllen (beschneiden) / einpassen (Ränder bleiben frei) */
export type FitMode = 'stretch' | 'fill' | 'fit';

/**
 * Freiform-Maske. Bei Flächenmasken liegen die Punkte im Inhaltsraum der Fläche
 * (0…1, bewegt sich also mit dem Corner Pin), bei globalen Masken im Ausgaberaum.
 */
export interface Mask {
  id: string;
  name: string;
  points: Point[];
  /** false: nur das Innere zeigen · true: das Innere ausblenden */
  invert: boolean;
  /** weiche Kante in Ausgabepixeln */
  feather: number;
  enabled: boolean;
}

export interface Surface {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  corners: Quad;
  content: Content;
  opacity: number;
  blend: BlendMode;
  fit: FitMode;
  masks: Mask[];
}

export interface Project {
  /** Version des Dateiformats, für spätere Migrationen. */
  format: 2;
  name: string;
  /** Zeichenreihenfolge: Index 0 liegt ganz unten. */
  surfaces: Surface[];
  /** Masken im Ausgaberaum, wirken auf alle Flächen. */
  masks: Mask[];
}

export type TestPattern = 'none' | 'grid' | 'white';
export type Tool = 'surface' | 'mask';
export type MaskScope = 'surface' | 'global';

/** Nicht gespeicherter Bearbeitungszustand, den alle Fenster teilen. */
export interface ViewState {
  /** Bearbeitungsmodus: Umrisse, Griffe und Mauszeiger auf der Ausgabe */
  editMode: boolean;
  testPattern: TestPattern;
  tool: Tool;
  /** Wohin neue Masken gehören */
  maskScope: MaskScope;
  selectedSurfaceId: string | null;
  selectedCorner: CornerIndex | null;
  selectedMaskId: string | null;
  selectedPoint: number | null;
}

export interface MediaItem {
  id: string;
  /** Originaler Dateiname */
  name: string;
  kind: 'video' | 'image';
  /** Dateiname der abspielbaren Datei im Medienordner */
  file: string;
  status: 'processing' | 'ready' | 'error';
  /** 0 … 1 während der Umwandlung */
  progress: number;
  error?: string;
  width?: number;
  height?: number;
  /** Sekunden (nur Video) */
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
  canUndo: boolean;
  canRedo: boolean;
}

export interface OutputInfo {
  clientId: string;
  fps: number;
  width: number;
  height: number;
  /** Ein Video konnte nicht automatisch starten → einmal in die Ausgabe klicken */
  videoBlocked: boolean;
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
