// Zustandsänderungen als serialisierbare Operationen.
// Server und Clients wenden dieselben Operationen mit demselben Reducer an.

import { EFFECT_MAP, defaultParams } from './effects.js';
import { apply, quadToQuad } from './homography.js';
import { MESH_MAX, meshCornerIndices } from './mesh.js';
import type {
  AppState,
  AudioSource,
  BlendMode,
  Content,
  CornerIndex,
  EffectParams,
  FadeKind,
  FitMode,
  GridSettings,
  Layer,
  Look,
  Mask,
  MaskLayer,
  MaskMode,
  MaskScope,
  Mesh,
  Modulation,
  Point,
  Project,
  Quad,
  Scene,
  Shape,
  ShowSettings,
  ShowState,
  Surface,
  TestPattern,
  Tool,
  VideoContent,
  ViewState,
} from './types.js';

export type VideoPatch = Partial<Pick<VideoContent, 'loop' | 'speed' | 'playing'>>;
export type SurfacePatch = Partial<
  Pick<Surface, 'name' | 'visible' | 'locked' | 'opacity' | 'blend' | 'fit' | 'shape' | 'opacityMod'>
>;
export type ScenePatch = Partial<Pick<Scene, 'name' | 'duration' | 'looks'>>;
export type ShowPatch = Partial<Pick<ShowState, 'blackout' | 'master' | 'playing'>>;
export type MaskPatch = Partial<Pick<MaskLayer, 'name' | 'mode' | 'feather' | 'enabled' | 'locked'>>;

export type Op =
  | { kind: 'setCorner'; surfaceId: string; index: CornerIndex; point: Point }
  | { kind: 'setCorners'; surfaceId: string; corners: Quad }
  | { kind: 'setContent'; surfaceId: string; content: Content }
  | { kind: 'patchVideo'; surfaceId: string; patch: VideoPatch }
  /** Einzelne Effekt-Parameter ändern (Regler), ohne andere zu überschreiben */
  | { kind: 'patchEffect'; surfaceId: string; effect: string; params: EffectParams }
  | { kind: 'updateSurface'; surfaceId: string; patch: SurfacePatch }
  | { kind: 'addLayer'; layer: Layer; index: number }
  | { kind: 'removeLayer'; layerId: string }
  | { kind: 'moveLayer'; layerId: string; index: number }
  /** Maske in den Masken-Stapel einer Fläche einfügen */
  | { kind: 'addMask'; surfaceId: string; mask: Mask; index?: number }
  /** Maske innerhalb ihres Stapels verschieben */
  | { kind: 'moveMask'; maskId: string; index: number }
  /** Flächenmaske oder Masken-Ebene entfernen */
  | { kind: 'removeMask'; maskId: string }
  | { kind: 'updateMask'; maskId: string; patch: MaskPatch }
  | { kind: 'setMaskPoints'; maskId: string; points: Point[] }
  | { kind: 'setView'; patch: Partial<ViewState> }
  /** Verzerrungsgitter setzen/entfernen (Form 'mesh') */
  | { kind: 'setMesh'; surfaceId: string; mesh: Mesh | null }
  | { kind: 'setMeshPoint'; surfaceId: string; index: number; point: Point }
  /** Audio-Kopplung eines Effekt-Reglers (null = entfernen) */
  | { kind: 'setModulation'; surfaceId: string; param: string; mod: Modulation | null }
  | { kind: 'addScene'; scene: Scene; index: number }
  | { kind: 'updateScene'; sceneId: string; patch: ScenePatch }
  | { kind: 'removeScene'; sceneId: string }
  | { kind: 'moveScene'; sceneId: string; index: number }
  /** Szene auslösen. at (Server-Uhr) setzt der Server, damit alle Fenster synchron überblenden. */
  | { kind: 'goScene'; sceneId: string; at: number; fade?: FadeKind }
  | { kind: 'setShow'; patch: ShowPatch; at: number }
  | { kind: 'setShowSettings'; patch: Partial<ShowSettings> };

/** Eckpunkte dürfen etwas außerhalb des Bildes liegen (Fläche ragt aus dem Bild). */
export const POINT_MIN = -1;
export const POINT_MAX = 2;
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;
export const FEATHER_MAX = 200;
export const MAX_MASK_POINTS = 2000;
export const MAX_LAYERS = 300;
export const MAX_SCENES = 200;
export const AUDIO_SOURCES: readonly AudioSource[] = ['level', 'bass', 'mid', 'high', 'beat'];
export const SHAPES: readonly Shape[] = ['quad', 'circle', 'triangle', 'mesh'];
export const FADE_KINDS: readonly FadeKind[] = ['cross', 'black', 'cut'];

export const BLEND_MODES: readonly BlendMode[] = ['normal', 'add', 'multiply', 'screen'];
export const FIT_MODES: readonly FitMode[] = ['stretch', 'fill', 'fit'];
export const MASK_MODES: readonly MaskMode[] = ['add', 'subtract', 'intersect'];

export function defaultCorners(): Quad {
  return [
    { x: 0.3, y: 0.25 },
    { x: 0.7, y: 0.25 },
    { x: 0.7, y: 0.75 },
    { x: 0.3, y: 0.75 },
  ];
}

export function createSurface(id: string, name: string, corners: Quad = defaultCorners()): Surface {
  return {
    kind: 'surface',
    id,
    name,
    visible: true,
    locked: false,
    shape: 'quad',
    corners,
    mesh: null,
    content: { type: 'testgrid' },
    opacity: 1,
    blend: 'normal',
    fit: 'stretch',
    masks: [],
    opacityMod: null,
  };
}

export function createModulation(source: AudioSource = 'bass'): Modulation {
  return { source, amount: 0.5, smoothing: 0.3, threshold: 0 };
}

export function defaultShowSettings(): ShowSettings {
  return { fadeDuration: 1.5, fadeKind: 'cross', loop: true, advance: 'time', beatsPerScene: 16 };
}

export function defaultShow(): ShowState {
  return { activeSceneId: null, transition: null, blackout: false, master: 1, playing: false, sceneStartedAt: 0 };
}

/** Aktuelles Aussehen aller Flächen (für „Szene speichern“ und Überblendungen) */
export function looksOf(project: Project): Record<string, Look> {
  const out: Record<string, Look> = {};
  for (const s of surfacesOf(project)) {
    out[s.id] = {
      content: s.content,
      visible: s.visible,
      opacity: s.opacity,
      blend: s.blend,
      fit: s.fit,
      opacityMod: s.opacityMod,
    };
  }
  return out;
}

export function createMask(id: string, name: string, points: Point[] = [], mode: MaskMode = 'add'): Mask {
  return { id, name, points, mode, feather: 0, enabled: true };
}

export function createMaskLayer(id: string, name: string, points: Point[] = []): MaskLayer {
  return { kind: 'mask', id, name, points, mode: 'subtract', feather: 0, enabled: true, locked: false };
}

export function createProject(name: string, surfaceId: string): Project {
  return { format: 4, name, layers: [createSurface(surfaceId, 'Fläche 1')], scenes: [], show: defaultShowSettings() };
}

export function defaultGrid(): GridSettings {
  return { enabled: false, cols: 8, rows: 8, thickness: 3, color: '#ffffff', diagonals: false, onlySelected: false };
}

export function defaultView(): ViewState {
  return {
    editMode: true,
    testPattern: 'none',
    tool: 'surface',
    maskScope: 'surface',
    selectedSurfaceId: null,
    selectedCorner: null,
    selectedMaskId: null,
    selectedPoint: null,
    snap: true,
    grid: defaultGrid(),
  };
}

/** Ändert die Operation das (speicherbare) Projekt? */
export function touchesProject(op: Op): boolean {
  return op.kind !== 'setView' && op.kind !== 'setShow';
}

/** Landet die Operation im Rückgängig-Verlauf? (Szenen auslösen ist Show, nicht Bearbeitung) */
export function undoable(op: Op): boolean {
  return touchesProject(op) && op.kind !== 'goScene';
}

// --- Zugriffshelfer

export function surfacesOf(project: Project): Surface[] {
  return project.layers.filter((l): l is Surface => l.kind === 'surface');
}

export function maskLayersOf(project: Project): MaskLayer[] {
  return project.layers.filter((l): l is MaskLayer => l.kind === 'mask');
}

export function findSurface(project: Project, id: string | null): Surface | null {
  if (!id) return null;
  const l = project.layers.find((x) => x.id === id);
  return l?.kind === 'surface' ? l : null;
}

/** Findet eine Maske: Masken-Ebene (surface = null) oder Flächenmaske. */
export function findMask(project: Project, maskId: string): { mask: Mask; surface: Surface | null; layer: MaskLayer | null } | null {
  for (const l of project.layers) {
    if (l.kind === 'mask') {
      if (l.id === maskId) return { mask: l, surface: null, layer: l };
    } else {
      const m = l.masks.find((x) => x.id === maskId);
      if (m) return { mask: m, surface: l, layer: null };
    }
  }
  return null;
}

function mapLayers(state: AppState, fn: (l: Layer) => Layer): AppState {
  let changed = false;
  const layers = state.project.layers.map((l) => {
    const n = fn(l);
    if (n !== l) changed = true;
    return n;
  });
  return changed ? { ...state, project: { ...state.project, layers } } : state;
}

function mapSurface(state: AppState, id: string, fn: (s: Surface) => Surface): AppState {
  return mapLayers(state, (l) => (l.kind === 'surface' && l.id === id ? fn(l) : l));
}

/** Wendet fn auf die Maske mit maskId an – egal ob Masken-Ebene oder Flächenmaske. */
function mapMask(state: AppState, maskId: string, fn: <M extends Mask>(m: M) => M): AppState {
  return mapLayers(state, (l) => {
    if (l.kind === 'mask') return l.id === maskId ? fn(l) : l;
    if (!l.masks.some((m) => m.id === maskId)) return l;
    return { ...l, masks: l.masks.map((m) => (m.id === maskId ? fn(m) : m)) };
  });
}

/** Alle IDs im Projekt (Ebenen + Flächenmasken), um Duplikate abzuweisen */
function idExists(p: Project, id: string): boolean {
  return p.layers.some((l) => l.id === id || (l.kind === 'surface' && l.masks.some((m) => m.id === id)));
}

function moveIn<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x!);
  return out;
}

/** Neue Ecken setzen; ein vorhandenes Mesh wird perspektivisch mitgeführt */
function withCorners(s: Surface, corners: Quad): Surface {
  if (s.shape !== 'mesh' || !s.mesh) return { ...s, corners };
  const h = quadToQuad(s.corners, corners);
  if (!h) return { ...s, corners };
  const points = s.mesh.points.map((p) => clampPoint(apply(h, p)));
  const mesh = { ...s.mesh, points };
  return { ...s, mesh, corners: cornersOfMesh(mesh) };
}

function cornersOfMesh(m: Mesh): Quad {
  return meshCornerIndices(m).map((i) => m.points[i]!) as Quad;
}

function clampPoint(p: Point): Point {
  return { x: clamp(p.x, POINT_MIN, POINT_MAX), y: clamp(p.y, POINT_MIN, POINT_MAX) };
}

export function applyOp(state: AppState, op: Op): AppState {
  switch (op.kind) {
    case 'setCorner':
      return mapSurface(state, op.surfaceId, (s) => {
        const corners = [...s.corners] as Quad;
        corners[op.index] = op.point;
        return withCorners(s, corners);
      });
    case 'setCorners':
      return mapSurface(state, op.surfaceId, (s) => withCorners(s, op.corners));
    case 'setMesh':
      return mapSurface(state, op.surfaceId, (s) =>
        op.mesh ? { ...s, mesh: op.mesh, corners: cornersOfMesh(op.mesh) } : { ...s, mesh: null },
      );
    case 'setMeshPoint':
      return mapSurface(state, op.surfaceId, (s) => {
        if (!s.mesh || !s.mesh.points[op.index]) return s;
        const points = [...s.mesh.points];
        points[op.index] = op.point;
        const mesh = { ...s.mesh, points };
        return { ...s, mesh, corners: cornersOfMesh(mesh) };
      });
    case 'setModulation':
      return mapSurface(state, op.surfaceId, (s) => {
        if (s.content.type !== 'effect') return s;
        const mod = { ...(s.content.mod ?? {}) };
        if (op.mod) mod[op.param] = op.mod;
        else delete mod[op.param];
        return { ...s, content: { ...s.content, mod } };
      });
    case 'addScene': {
      const p = state.project;
      if (p.scenes.length >= MAX_SCENES || p.scenes.some((x) => x.id === op.scene.id)) return state;
      const scenes = [...p.scenes];
      scenes.splice(Math.max(0, Math.min(scenes.length, op.index)), 0, op.scene);
      return { ...state, project: { ...p, scenes } };
    }
    case 'updateScene': {
      const p = state.project;
      if (!p.scenes.some((x) => x.id === op.sceneId)) return state;
      return {
        ...state,
        project: { ...p, scenes: p.scenes.map((x) => (x.id === op.sceneId ? { ...x, ...op.patch } : x)) },
      };
    }
    case 'removeScene': {
      const p = state.project;
      if (!p.scenes.some((x) => x.id === op.sceneId)) return state;
      const show = state.show.activeSceneId === op.sceneId ? { ...state.show, activeSceneId: null } : state.show;
      return { ...state, show, project: { ...p, scenes: p.scenes.filter((x) => x.id !== op.sceneId) } };
    }
    case 'moveScene': {
      const p = state.project;
      const from = p.scenes.findIndex((x) => x.id === op.sceneId);
      if (from < 0 || from === op.index) return state;
      return { ...state, project: { ...p, scenes: moveIn(p.scenes, from, op.index) } };
    }
    case 'goScene': {
      const p = state.project;
      const scene = p.scenes.find((x) => x.id === op.sceneId);
      if (!scene) return state;
      const from = looksOf(p);
      const layers = p.layers.map((l) => {
        const look = l.kind === 'surface' ? scene.looks[l.id] : undefined;
        return look && l.kind === 'surface' ? { ...l, ...look } : l;
      });
      const kind = op.fade ?? p.show.fadeKind;
      const duration = Math.round(p.show.fadeDuration * 1000);
      return {
        ...state,
        project: { ...p, layers },
        show: {
          ...state.show,
          activeSceneId: scene.id,
          sceneStartedAt: op.at,
          transition: kind === 'cut' || duration <= 0 ? null : { from, start: op.at, duration, kind },
        },
      };
    }
    case 'setShow': {
      const show = { ...state.show, ...op.patch };
      // Playlist startet: Uhr der aktuellen Szene neu stellen
      if (op.patch.playing && !state.show.playing) show.sceneStartedAt = op.at;
      return { ...state, show };
    }
    case 'setShowSettings':
      return { ...state, project: { ...state.project, show: { ...state.project.show, ...op.patch } } };
    case 'setContent':
      return mapSurface(state, op.surfaceId, (s) => ({ ...s, content: op.content }));
    case 'patchVideo':
      return mapSurface(state, op.surfaceId, (s) =>
        s.content.type === 'video' ? { ...s, content: { ...s.content, ...op.patch } } : s,
      );
    case 'patchEffect':
      return mapSurface(state, op.surfaceId, (s) =>
        s.content.type === 'effect' && s.content.effect === op.effect
          ? { ...s, content: { ...s.content, params: { ...s.content.params, ...op.params } } }
          : s,
      );
    case 'updateSurface':
      return mapSurface(state, op.surfaceId, (s) => ({ ...s, ...op.patch }));
    case 'addLayer': {
      const p = state.project;
      if (p.layers.length >= MAX_LAYERS || idExists(p, op.layer.id)) return state;
      if (op.layer.kind === 'surface' && op.layer.masks.some((m) => idExists(p, m.id))) return state;
      const layers = [...p.layers];
      layers.splice(Math.max(0, Math.min(layers.length, op.index)), 0, op.layer);
      return { ...state, project: { ...p, layers } };
    }
    case 'removeLayer': {
      const p = state.project;
      if (!p.layers.some((l) => l.id === op.layerId)) return state;
      return { ...state, project: { ...p, layers: p.layers.filter((l) => l.id !== op.layerId) } };
    }
    case 'moveLayer': {
      const p = state.project;
      const from = p.layers.findIndex((l) => l.id === op.layerId);
      if (from < 0 || from === op.index) return state;
      return { ...state, project: { ...p, layers: moveIn(p.layers, from, op.index) } };
    }
    case 'addMask': {
      if (idExists(state.project, op.mask.id)) return state;
      return mapSurface(state, op.surfaceId, (s) => {
        const masks = [...s.masks];
        masks.splice(op.index ?? masks.length, 0, op.mask);
        return { ...s, masks };
      });
    }
    case 'moveMask':
      return mapLayers(state, (l) => {
        if (l.kind !== 'surface') return l;
        const from = l.masks.findIndex((m) => m.id === op.maskId);
        if (from < 0 || from === op.index) return l;
        return { ...l, masks: moveIn(l.masks, from, op.index) };
      });
    case 'removeMask': {
      const p = state.project;
      if (!findMask(p, op.maskId)) return state;
      const layers = p.layers
        .filter((l) => l.id !== op.maskId)
        .map((l) =>
          l.kind === 'surface' && l.masks.some((m) => m.id === op.maskId)
            ? { ...l, masks: l.masks.filter((m) => m.id !== op.maskId) }
            : l,
        );
      return { ...state, project: { ...p, layers } };
    }
    case 'updateMask':
      return mapMask(state, op.maskId, (m) => {
        const patch = { ...op.patch };
        // Flächenmasken haben kein „gesperrt“
        if (!('kind' in m)) delete patch.locked;
        return { ...m, ...patch };
      });
    case 'setMaskPoints':
      return mapMask(state, op.maskId, (m) => ({ ...m, points: op.points }));
    case 'setView':
      return { ...state, view: { ...state.view, ...op.patch } };
  }
}

// ---------------------------------------------------------------------------
// Validierung eingehender Daten (alles, was über das Netz kommt, ist unbekannt).

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function parseId(v: unknown): string | null {
  return typeof v === 'string' && /^[a-z0-9_-]{1,64}$/i.test(v) ? v : null;
}

function parseName(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : fallback;
}

function parseEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function parsePoint(v: unknown): Point | null {
  if (!isObj(v) || !finite(v.x) || !finite(v.y)) return null;
  return { x: clamp(v.x, POINT_MIN, POINT_MAX), y: clamp(v.y, POINT_MIN, POINT_MAX) };
}

function parsePoints(v: unknown): Point[] | null {
  if (!Array.isArray(v) || v.length > MAX_MASK_POINTS) return null;
  const pts = v.map(parsePoint);
  return pts.some((p) => p === null) ? null : (pts as Point[]);
}

export function parseQuad(v: unknown): Quad | null {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const pts = v.map(parsePoint);
  if (pts.some((p) => p === null)) return null;
  return pts as Quad;
}

function parseCornerIndex(v: unknown): CornerIndex | null {
  return v === 0 || v === 1 || v === 2 || v === 3 ? v : null;
}

export function parseColor(v: unknown): string | null {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
}

function parseVideoPatch(v: unknown): VideoPatch | null {
  if (!isObj(v)) return null;
  const patch: VideoPatch = {};
  if (typeof v.loop === 'boolean') patch.loop = v.loop;
  if (typeof v.playing === 'boolean') patch.playing = v.playing;
  if (finite(v.speed)) patch.speed = clamp(v.speed, SPEED_MIN, SPEED_MAX);
  return patch;
}

/** Prüft Effekt-Parameter gegen die Definition; partial = nur vorhandene übernehmen */
function parseEffectParams(effectId: string, v: unknown, partial: boolean): EffectParams | null {
  const def = EFFECT_MAP.get(effectId);
  if (!def) return null;
  const src = isObj(v) ? v : {};
  const out: EffectParams = partial ? {} : defaultParams(def);
  for (const p of def.params) {
    const raw = src[p.id];
    if (raw === undefined) continue;
    if (p.type === 'color') {
      const c = parseColor(raw);
      if (c) out[p.id] = c;
    } else if (finite(raw)) {
      out[p.id] = p.type === 'select' ? clamp(Math.round(raw), 0, p.options.length - 1) : clamp(raw, p.min, p.max);
    }
  }
  return out;
}

function parseSurfacePatch(v: unknown): SurfacePatch | null {
  if (!isObj(v)) return null;
  const patch: SurfacePatch = {};
  if (typeof v.name === 'string' && v.name.trim()) patch.name = v.name.trim().slice(0, 100);
  if (typeof v.visible === 'boolean') patch.visible = v.visible;
  if (typeof v.locked === 'boolean') patch.locked = v.locked;
  if (finite(v.opacity)) patch.opacity = clamp(v.opacity, 0, 1);
  const blend = parseEnum(v.blend, BLEND_MODES);
  if (blend) patch.blend = blend;
  const fit = parseEnum(v.fit, FIT_MODES);
  if (fit) patch.fit = fit;
  const shape = parseEnum(v.shape, SHAPES);
  if (shape) patch.shape = shape;
  if (v.opacityMod === null) patch.opacityMod = null;
  else if (v.opacityMod !== undefined) {
    const m = parseModulation(v.opacityMod);
    if (m) patch.opacityMod = m;
  }
  return patch;
}

function parseMaskPatch(v: unknown): MaskPatch | null {
  if (!isObj(v)) return null;
  const patch: MaskPatch = {};
  if (typeof v.name === 'string' && v.name.trim()) patch.name = v.name.trim().slice(0, 100);
  const mode = parseEnum(v.mode, MASK_MODES);
  if (mode) patch.mode = mode;
  if (typeof v.enabled === 'boolean') patch.enabled = v.enabled;
  if (typeof v.locked === 'boolean') patch.locked = v.locked;
  if (finite(v.feather)) patch.feather = clamp(v.feather, 0, FEATHER_MAX);
  return patch;
}

export function parseContent(v: unknown): Content | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case 'none':
      return { type: 'none' };
    case 'testgrid':
      return { type: 'testgrid' };
    case 'color': {
      const color = parseColor(v.color);
      return color ? { type: 'color', color } : null;
    }
    case 'image': {
      const mediaId = parseId(v.mediaId);
      return mediaId ? { type: 'image', mediaId } : null;
    }
    case 'video': {
      const mediaId = parseId(v.mediaId);
      if (!mediaId) return null;
      const p = parseVideoPatch(v) ?? {};
      return { type: 'video', mediaId, loop: p.loop ?? true, speed: p.speed ?? 1, playing: p.playing ?? true };
    }
    case 'effect': {
      const effect = typeof v.effect === 'string' ? v.effect : '';
      const params = parseEffectParams(effect, v.params, false);
      if (!params) return null;
      const mod: Record<string, Modulation> = {};
      const def = EFFECT_MAP.get(effect)!;
      if (isObj(v.mod)) {
        for (const p of def.params) {
          const m = p.type === 'float' ? parseModulation(v.mod[p.id]) : null;
          if (m) mod[p.id] = m;
        }
      }
      return Object.keys(mod).length ? { type: 'effect', effect, params, mod } : { type: 'effect', effect, params };
    }
    case 'milkdrop':
      return typeof v.preset === 'string' && v.preset.length > 0
        ? {
            type: 'milkdrop',
            preset: v.preset.slice(0, 300),
            blend: finite(v.blend) ? clamp(v.blend, 0, 20) : 2,
            cycle: finite(v.cycle) ? clamp(v.cycle, 0, 600) : 0,
            random: v.random === true,
          }
        : null;
    case 'camera':
      return {
        type: 'camera',
        deviceId: typeof v.deviceId === 'string' ? v.deviceId.slice(0, 200) : '',
        mirror: v.mirror === true,
      };
    default:
      return null;
  }
}

export function parseModulation(v: unknown): Modulation | null {
  if (!isObj(v)) return null;
  const source = parseEnum(v.source, AUDIO_SOURCES);
  if (!source) return null;
  return {
    source,
    amount: finite(v.amount) ? clamp(v.amount, -1, 1) : 0.5,
    smoothing: finite(v.smoothing) ? clamp(v.smoothing, 0, 0.99) : 0.3,
    threshold: finite(v.threshold) ? clamp(v.threshold, 0, 0.95) : 0,
  };
}

function parseMesh(v: unknown): Mesh | null {
  if (!isObj(v) || !finite(v.cols) || !finite(v.rows)) return null;
  const cols = Math.round(v.cols);
  const rows = Math.round(v.rows);
  if (cols < 1 || rows < 1 || cols > MESH_MAX || rows > MESH_MAX) return null;
  const points = parsePoints(v.points);
  if (!points || points.length !== (cols + 1) * (rows + 1)) return null;
  return { cols, rows, points };
}

function parseLook(v: unknown): Look | null {
  if (!isObj(v)) return null;
  const content = parseContent(v.content);
  if (!content) return null;
  return {
    content,
    visible: v.visible !== false,
    opacity: finite(v.opacity) ? clamp(v.opacity, 0, 1) : 1,
    blend: parseEnum(v.blend, BLEND_MODES) ?? 'normal',
    fit: parseEnum(v.fit, FIT_MODES) ?? 'stretch',
    opacityMod: parseModulation(v.opacityMod),
  };
}

function parseLooks(v: unknown): Record<string, Look> | null {
  if (!isObj(v)) return null;
  const out: Record<string, Look> = {};
  for (const [id, raw] of Object.entries(v).slice(0, MAX_LAYERS)) {
    const look = parseId(id) ? parseLook(raw) : null;
    if (look) out[id] = look;
  }
  return out;
}

function parseScene(v: unknown): Scene | null {
  if (!isObj(v)) return null;
  const id = parseId(v.id);
  const looks = parseLooks(v.looks);
  if (!id || !looks) return null;
  return {
    id,
    name: parseName(v.name, 'Szene'),
    looks,
    duration: finite(v.duration) ? clamp(v.duration, 0.5, 3600) : 10,
  };
}

function parseShowSettings(v: unknown, partial: boolean): Partial<ShowSettings> {
  const d = defaultShowSettings();
  const src = isObj(v) ? v : {};
  const out: Partial<ShowSettings> = partial ? {} : d;
  if (finite(src.fadeDuration)) out.fadeDuration = clamp(src.fadeDuration, 0, 30);
  const fk = parseEnum(src.fadeKind, FADE_KINDS);
  if (fk) out.fadeKind = fk;
  if (typeof src.loop === 'boolean') out.loop = src.loop;
  const adv = parseEnum(src.advance, ['time', 'beats'] as const);
  if (adv) out.advance = adv;
  if (finite(src.beatsPerScene)) out.beatsPerScene = clamp(Math.round(src.beatsPerScene), 1, 512);
  return out;
}

/** Liest eine Maske. Ältere Dateien kennen statt mode nur invert. */
export function parseMask(v: unknown): Mask | null {
  if (!isObj(v)) return null;
  const id = parseId(v.id);
  const points = parsePoints(v.points ?? []);
  if (!id || !points) return null;
  return {
    id,
    name: parseName(v.name, 'Maske'),
    points,
    mode: parseEnum(v.mode, MASK_MODES) ?? (v.invert === true ? 'subtract' : 'add'),
    feather: finite(v.feather) ? clamp(v.feather, 0, FEATHER_MAX) : 0,
    enabled: v.enabled !== false,
  };
}

function parseMasks(v: unknown): Mask[] {
  if (!Array.isArray(v)) return [];
  return v.map(parseMask).filter((m): m is Mask => m !== null);
}

function parseMaskLayer(v: unknown): MaskLayer | null {
  const m = parseMask(v);
  if (!m || !isObj(v)) return null;
  return { ...m, kind: 'mask', mode: m.mode === 'add' ? 'intersect' : m.mode, locked: v.locked === true };
}

export function parseSurface(v: unknown): Surface | null {
  if (!isObj(v)) return null;
  const id = parseId(v.id);
  const corners = parseQuad(v.corners);
  if (!id || !corners) return null;
  return {
    kind: 'surface',
    id,
    name: parseName(v.name, 'Fläche'),
    visible: v.visible !== false,
    locked: v.locked === true,
    ...shapeAndMesh(v, corners),
    content: parseContent(v.content) ?? { type: 'none' },
    opacity: finite(v.opacity) ? clamp(v.opacity, 0, 1) : 1,
    blend: parseEnum(v.blend, BLEND_MODES) ?? 'normal',
    fit: parseEnum(v.fit, FIT_MODES) ?? 'stretch',
    masks: parseMasks(v.masks),
    opacityMod: parseModulation(v.opacityMod),
  };
}

/** Form + Mesh; ein Mesh ohne gültige Punkte fällt auf ein Viereck zurück */
function shapeAndMesh(v: Obj, corners: Quad): { shape: Shape; corners: Quad; mesh: Mesh | null } {
  const shape = parseEnum(v.shape, SHAPES) ?? 'quad';
  if (shape !== 'mesh') return { shape, corners, mesh: null };
  const mesh = parseMesh(v.mesh);
  return mesh ? { shape, corners: cornersOfMesh(mesh), mesh } : { shape: 'quad', corners, mesh: null };
}

export function parseLayer(v: unknown): Layer | null {
  if (!isObj(v)) return null;
  return v.kind === 'mask' ? parseMaskLayer(v) : parseSurface(v);
}

const TEST_PATTERNS: readonly TestPattern[] = ['none', 'grid', 'white'];
const TOOLS: readonly Tool[] = ['surface', 'mask'];
const MASK_SCOPES: readonly MaskScope[] = ['surface', 'layer'];

function parseGrid(v: unknown): GridSettings | null {
  if (!isObj(v)) return null;
  const d = defaultGrid();
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : d.enabled,
    cols: finite(v.cols) ? clamp(Math.round(v.cols), 1, 64) : d.cols,
    rows: finite(v.rows) ? clamp(Math.round(v.rows), 1, 64) : d.rows,
    thickness: finite(v.thickness) ? clamp(v.thickness, 1, 30) : d.thickness,
    color: parseColor(v.color) ?? d.color,
    diagonals: typeof v.diagonals === 'boolean' ? v.diagonals : d.diagonals,
    onlySelected: typeof v.onlySelected === 'boolean' ? v.onlySelected : d.onlySelected,
  };
}

function parseViewPatch(v: unknown): Partial<ViewState> | null {
  if (!isObj(v)) return null;
  const patch: Partial<ViewState> = {};
  if (typeof v.editMode === 'boolean') patch.editMode = v.editMode;
  if (typeof v.snap === 'boolean') patch.snap = v.snap;
  const tp = parseEnum(v.testPattern, TEST_PATTERNS);
  if (tp) patch.testPattern = tp;
  const tool = parseEnum(v.tool, TOOLS);
  if (tool) patch.tool = tool;
  const scope = parseEnum(v.maskScope, MASK_SCOPES);
  if (scope) patch.maskScope = scope;
  const grid = parseGrid(v.grid);
  if (grid) patch.grid = grid;
  if (v.selectedSurfaceId === null || parseId(v.selectedSurfaceId)) {
    patch.selectedSurfaceId = v.selectedSurfaceId as string | null;
  }
  if (v.selectedCorner === null || parseCornerIndex(v.selectedCorner) !== null) {
    patch.selectedCorner = v.selectedCorner as CornerIndex | null;
  }
  if (v.selectedMaskId === null || parseId(v.selectedMaskId)) {
    patch.selectedMaskId = v.selectedMaskId as string | null;
  }
  if (v.selectedPoint === null || (Number.isInteger(v.selectedPoint) && (v.selectedPoint as number) >= 0)) {
    patch.selectedPoint = v.selectedPoint as number | null;
  }
  return patch;
}

export function parseOp(v: unknown): Op | null {
  if (!isObj(v)) return null;
  switch (v.kind) {
    case 'setCorner': {
      const surfaceId = parseId(v.surfaceId);
      const index = parseCornerIndex(v.index);
      const point = parsePoint(v.point);
      return surfaceId && index !== null && point ? { kind: 'setCorner', surfaceId, index, point } : null;
    }
    case 'setCorners': {
      const surfaceId = parseId(v.surfaceId);
      const corners = parseQuad(v.corners);
      return surfaceId && corners ? { kind: 'setCorners', surfaceId, corners } : null;
    }
    case 'setContent': {
      const surfaceId = parseId(v.surfaceId);
      const content = parseContent(v.content);
      return surfaceId && content ? { kind: 'setContent', surfaceId, content } : null;
    }
    case 'patchVideo': {
      const surfaceId = parseId(v.surfaceId);
      const patch = parseVideoPatch(v.patch);
      return surfaceId && patch ? { kind: 'patchVideo', surfaceId, patch } : null;
    }
    case 'patchEffect': {
      const surfaceId = parseId(v.surfaceId);
      const effect = typeof v.effect === 'string' ? v.effect : '';
      const params = parseEffectParams(effect, v.params, true);
      return surfaceId && params ? { kind: 'patchEffect', surfaceId, effect, params } : null;
    }
    case 'updateSurface': {
      const surfaceId = parseId(v.surfaceId);
      const patch = parseSurfacePatch(v.patch);
      return surfaceId && patch ? { kind: 'updateSurface', surfaceId, patch } : null;
    }
    case 'addLayer': {
      const layer = parseLayer(v.layer);
      return layer && finite(v.index) ? { kind: 'addLayer', layer, index: Math.round(v.index) } : null;
    }
    case 'removeLayer': {
      const layerId = parseId(v.layerId);
      return layerId ? { kind: 'removeLayer', layerId } : null;
    }
    case 'moveLayer': {
      const layerId = parseId(v.layerId);
      return layerId && finite(v.index) ? { kind: 'moveLayer', layerId, index: Math.round(v.index) } : null;
    }
    case 'addMask': {
      const surfaceId = parseId(v.surfaceId);
      const mask = parseMask(v.mask);
      if (!surfaceId || !mask) return null;
      return finite(v.index)
        ? { kind: 'addMask', surfaceId, mask, index: Math.max(0, Math.round(v.index)) }
        : { kind: 'addMask', surfaceId, mask };
    }
    case 'moveMask': {
      const maskId = parseId(v.maskId);
      return maskId && finite(v.index) ? { kind: 'moveMask', maskId, index: Math.round(v.index) } : null;
    }
    case 'removeMask': {
      const maskId = parseId(v.maskId);
      return maskId ? { kind: 'removeMask', maskId } : null;
    }
    case 'updateMask': {
      const maskId = parseId(v.maskId);
      const patch = parseMaskPatch(v.patch);
      return maskId && patch ? { kind: 'updateMask', maskId, patch } : null;
    }
    case 'setMaskPoints': {
      const maskId = parseId(v.maskId);
      const points = parsePoints(v.points);
      return maskId && points ? { kind: 'setMaskPoints', maskId, points } : null;
    }
    case 'setView': {
      const patch = parseViewPatch(v.patch);
      return patch ? { kind: 'setView', patch } : null;
    }
    case 'setMesh': {
      const surfaceId = parseId(v.surfaceId);
      const mesh = v.mesh === null ? null : parseMesh(v.mesh);
      return surfaceId && (mesh || v.mesh === null) ? { kind: 'setMesh', surfaceId, mesh } : null;
    }
    case 'setMeshPoint': {
      const surfaceId = parseId(v.surfaceId);
      const point = parsePoint(v.point);
      return surfaceId && point && Number.isInteger(v.index) && (v.index as number) >= 0
        ? { kind: 'setMeshPoint', surfaceId, index: v.index as number, point }
        : null;
    }
    case 'setModulation': {
      const surfaceId = parseId(v.surfaceId);
      const param = typeof v.param === 'string' && /^[a-z0-9_]{1,32}$/i.test(v.param) ? v.param : null;
      const mod = v.mod === null ? null : parseModulation(v.mod);
      return surfaceId && param && (mod || v.mod === null) ? { kind: 'setModulation', surfaceId, param, mod } : null;
    }
    case 'addScene': {
      const scene = parseScene(v.scene);
      return scene && finite(v.index) ? { kind: 'addScene', scene, index: Math.round(v.index) } : null;
    }
    case 'updateScene': {
      const sceneId = parseId(v.sceneId);
      if (!sceneId || !isObj(v.patch)) return null;
      const patch: ScenePatch = {};
      if (typeof v.patch.name === 'string' && v.patch.name.trim()) patch.name = v.patch.name.trim().slice(0, 100);
      if (finite(v.patch.duration)) patch.duration = clamp(v.patch.duration, 0.5, 3600);
      if (v.patch.looks !== undefined) {
        const looks = parseLooks(v.patch.looks);
        if (looks) patch.looks = looks;
      }
      return { kind: 'updateScene', sceneId, patch };
    }
    case 'removeScene': {
      const sceneId = parseId(v.sceneId);
      return sceneId ? { kind: 'removeScene', sceneId } : null;
    }
    case 'moveScene': {
      const sceneId = parseId(v.sceneId);
      return sceneId && finite(v.index) ? { kind: 'moveScene', sceneId, index: Math.round(v.index) } : null;
    }
    case 'goScene': {
      const sceneId = parseId(v.sceneId);
      const fade = parseEnum(v.fade, FADE_KINDS);
      if (!sceneId) return null;
      const at = finite(v.at) ? v.at : 0;
      return fade ? { kind: 'goScene', sceneId, at, fade } : { kind: 'goScene', sceneId, at };
    }
    case 'setShow': {
      if (!isObj(v.patch)) return null;
      const patch: ShowPatch = {};
      if (typeof v.patch.blackout === 'boolean') patch.blackout = v.patch.blackout;
      if (typeof v.patch.playing === 'boolean') patch.playing = v.patch.playing;
      if (finite(v.patch.master)) patch.master = clamp(v.patch.master, 0, 1);
      return { kind: 'setShow', patch, at: finite(v.at) ? v.at : 0 };
    }
    case 'setShowSettings':
      return { kind: 'setShowSettings', patch: parseShowSettings(v.patch, true) };
    default:
      return null;
  }
}

/**
 * Liest eine Projektdatei ein und repariert fehlende Felder.
 * Format 1/2 (surfaces + globale masks) wird in den Ebenenstapel (Format 3) überführt:
 * globale Masken werden zu Masken-Ebenen ganz oben.
 */
export function parseProject(v: unknown): Project | null {
  if (!isObj(v)) return null;
  let layers: Layer[];
  if (Array.isArray(v.layers)) {
    layers = v.layers.map(parseLayer).filter((l): l is Layer => l !== null);
  } else if (Array.isArray(v.surfaces)) {
    layers = v.surfaces.map(parseSurface).filter((s): s is Surface => s !== null);
    if (Array.isArray(v.masks)) {
      layers.push(...v.masks.map(parseMaskLayer).filter((m): m is MaskLayer => m !== null));
    }
  } else {
    return null;
  }
  const scenes = Array.isArray(v.scenes)
    ? v.scenes.map(parseScene).filter((x): x is Scene => x !== null).slice(0, MAX_SCENES)
    : [];
  return {
    format: 4,
    name: parseName(v.name, 'Unbenannt'),
    layers,
    scenes,
    show: parseShowSettings(v.show, false) as ShowSettings,
  };
}
