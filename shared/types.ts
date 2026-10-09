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

/** Effekt-Parameter: Zahl (Regler) oder Farbe (#rrggbb) */
export type EffectParams = Record<string, number | string>;

/** Audio-Größen, an die sich Regler koppeln lassen */
export type AudioSource = 'level' | 'bass' | 'mid' | 'high' | 'beat';

/** Kopplung eines Reglers an die Musik */
export interface Modulation {
  source: AudioSource;
  /** −1 … 1: Anteil des Reglerbereichs, um den der Wert verschoben wird */
  amount: number;
  /** 0 … 1: Glättung (0 = sofort, 1 = sehr träge) */
  smoothing: number;
  /** 0 … 1: Werte unterhalb der Schwelle zählen nicht */
  threshold: number;
}

export interface EffectContent {
  type: 'effect';
  /** ID aus der Effekt-Bibliothek (shared/effects.ts) */
  effect: string;
  params: EffectParams;
  /** Audio-Kopplung je Parameter-ID (nur Zahlen-Regler) */
  mod?: Record<string, Modulation>;
}

export interface CameraContent {
  type: 'camera';
  /** Geräte-ID der Kamera ('' = Standardkamera) */
  deviceId: string;
  /** spiegeln (wie im Selfie-Modus) */
  mirror: boolean;
}

export type Content =
  | { type: 'none' }
  | { type: 'testgrid' }
  | { type: 'color'; color: string }
  | { type: 'image'; mediaId: string }
  | VideoContent
  | EffectContent
  | CameraContent;

export type ContentType = Content['type'];

export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen';

/** strecken / füllen (beschneiden) / einpassen (Ränder bleiben frei) */
export type FitMode = 'stretch' | 'fill' | 'fit';

/**
 * Wie eine Maske mit den Masken davor im Stapel verrechnet wird:
 * add = Inneres hinzufügen (sichtbar machen) · subtract = Inneres ausschneiden ·
 * intersect = nur die Überschneidung behalten.
 */
export type MaskMode = 'add' | 'subtract' | 'intersect';

/**
 * Freiform-Maske. Bei Flächenmasken liegen die Punkte im Inhaltsraum der Fläche
 * (0…1, bewegt sich also mit dem Corner Pin), bei Masken-Ebenen im Ausgaberaum.
 */
export interface Mask {
  id: string;
  name: string;
  points: Point[];
  mode: MaskMode;
  /** weiche Kante in Ausgabepixeln */
  feather: number;
  enabled: boolean;
}

/**
 * Masken-Ebene im Ebenenstapel: wirkt auf alle Ebenen DARUNTER.
 * subtract = Inneres ausschneiden, intersect = nur das Innere übrig lassen.
 */
export interface MaskLayer extends Mask {
  kind: 'mask';
  locked: boolean;
}

/** Form einer Fläche. Dreieck nutzt die Ecken 0–2 (0 = Spitze). */
export type Shape = 'quad' | 'circle' | 'triangle' | 'mesh';

/**
 * Verzerrungsgitter für gewölbte Objekte: (cols+1)×(rows+1) Kontrollpunkte im
 * Ausgaberaum, zeilenweise von oben links. Dazwischen wird weich (Catmull-Rom) interpoliert.
 */
export interface Mesh {
  cols: number;
  rows: number;
  points: Point[];
}

export interface Surface {
  kind: 'surface';
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  shape: Shape;
  corners: Quad;
  /** nur bei shape = 'mesh' */
  mesh: Mesh | null;
  content: Content;
  opacity: number;
  blend: BlendMode;
  fit: FitMode;
  masks: Mask[];
  /** Deckkraft an die Musik koppeln */
  opacityMod: Modulation | null;
}

export type Layer = Surface | MaskLayer;

/** Das „Aussehen“ einer Fläche – das, was Szenen umschalten (Geometrie bleibt gleich). */
export interface Look {
  content: Content;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  fit: FitMode;
  opacityMod: Modulation | null;
}

export interface Scene {
  id: string;
  name: string;
  /** Aussehen je Flächen-ID; Flächen ohne Eintrag bleiben unverändert */
  looks: Record<string, Look>;
  /** Dauer in der Playlist (Sekunden) */
  duration: number;
}

export type FadeKind = 'cross' | 'black' | 'cut';

export interface ShowSettings {
  /** Überblendzeit in Sekunden */
  fadeDuration: number;
  fadeKind: FadeKind;
  loop: boolean;
  /** Playlist wechselt nach Zeit oder nach Anzahl Beats */
  advance: 'time' | 'beats';
  beatsPerScene: number;
}

export interface Project {
  /** Version des Dateiformats, für spätere Migrationen. */
  format: 4;
  name: string;
  /** Ebenenstapel (Flächen und Masken-Ebenen): Index 0 liegt ganz unten. */
  layers: Layer[];
  scenes: Scene[];
  show: ShowSettings;
}

/** Laufende Überblendung: altes Aussehen wird ausgeblendet, das aktuelle eingeblendet */
export interface Transition {
  from: Record<string, Look>;
  /** Startzeit (Server-Uhr, ms) */
  start: number;
  /** Dauer in ms */
  duration: number;
  kind: FadeKind;
}

/** Laufzeitzustand der Show (nicht im Projekt gespeichert) */
export interface ShowState {
  activeSceneId: string | null;
  transition: Transition | null;
  blackout: boolean;
  /** Gesamthelligkeit 0…1 */
  master: number;
  playing: boolean;
  /** Server-Uhr (ms), seit der die aktive Szene läuft */
  sceneStartedAt: number;
}

/** Raster, das zur Kalibrierung über Flächen gelegt wird */
export interface GridSettings {
  enabled: boolean;
  cols: number;
  rows: number;
  /** Linienstärke in Ausgabepixeln */
  thickness: number;
  color: string;
  diagonals: boolean;
  /** nur auf der gewählten Fläche statt auf allen */
  onlySelected: boolean;
}

export type TestPattern = 'none' | 'grid' | 'white';
export type Tool = 'surface' | 'mask';
export type MaskScope = 'surface' | 'layer';

/** Nicht gespeicherter Bearbeitungszustand, den alle Fenster teilen. */
export interface ViewState {
  /** Bearbeitungsmodus: Umrisse, Griffe und Mauszeiger auf der Ausgabe */
  editMode: boolean;
  testPattern: TestPattern;
  tool: Tool;
  /** Wohin neue Masken gehören: in die gewählte Fläche oder als Masken-Ebene */
  maskScope: MaskScope;
  selectedSurfaceId: string | null;
  selectedCorner: CornerIndex | null;
  selectedMaskId: string | null;
  selectedPoint: number | null;
  /** Punkte rasten an Ecken/Punkten anderer Flächen und Masken ein */
  snap: boolean;
  grid: GridSettings;
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
  show: ShowState;
}

/**
 * Ein Analyse-Bild der Musik (ca. 60× pro Sekunde, von der Audio-Quelle an alle Fenster).
 * Alle Werte 0…1; wave −1…1.
 */
export interface AudioFrame {
  level: number;
  bass: number;
  mid: number;
  high: number;
  /** Puls: springt beim Beat auf 1 und fällt dann ab */
  beat: number;
  /** fortlaufende Beat-Nummer */
  beatCount: number;
  bpm: number;
  /** 64 Frequenzbänder (logarithmisch) */
  spectrum: number[];
  /** fallende Spitzenwerte je Band (Winamp-Peaks) */
  peaks: number[];
  /** 128 Werte der Wellenform */
  wave: number[];
}
