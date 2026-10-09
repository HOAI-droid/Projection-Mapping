// Zustandsänderungen als serialisierbare Operationen.
// Server und Clients wenden dieselben Operationen mit demselben Reducer an.

import { EFFECT_MAP, defaultParams } from './effects.js';
import type {
  AppState,
  BlendMode,
  Content,
  CornerIndex,
  EffectParams,
  FitMode,
  GridSettings,
  Layer,
  Mask,
  MaskLayer,
  MaskMode,
  MaskScope,
  Point,
  Project,
  Quad,
  Surface,
  TestPattern,
  Tool,
  VideoContent,
  ViewState,
} from './types.js';

export type VideoPatch = Partial<Pick<VideoContent, 'loop' | 'speed' | 'playing'>>;
export type SurfacePatch = Partial<Pick<Surface, 'name' | 'visible' | 'locked' | 'opacity' | 'blend' | 'fit'>>;
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
  | { kind: 'setView'; patch: Partial<ViewState> };

/** Eckpunkte dürfen etwas außerhalb des Bildes liegen (Fläche ragt aus dem Bild). */
export const POINT_MIN = -1;
export const POINT_MAX = 2;
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;
export const FEATHER_MAX = 200;
export const MAX_MASK_POINTS = 2000;
export const MAX_LAYERS = 300;

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
    corners,
    content: { type: 'testgrid' },
    opacity: 1,
    blend: 'normal',
    fit: 'stretch',
    masks: [],
  };
}

export function createMask(id: string, name: string, points: Point[] = [], mode: MaskMode = 'add'): Mask {
  return { id, name, points, mode, feather: 0, enabled: true };
}

export function createMaskLayer(id: string, name: string, points: Point[] = []): MaskLayer {
  return { kind: 'mask', id, name, points, mode: 'subtract', feather: 0, enabled: true, locked: false };
}

export function createProject(name: string, surfaceId: string): Project {
  return { format: 3, name, layers: [createSurface(surfaceId, 'Fläche 1')] };
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
  return op.kind !== 'setView';
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

export function applyOp(state: AppState, op: Op): AppState {
  switch (op.kind) {
    case 'setCorner':
      return mapSurface(state, op.surfaceId, (s) => {
        const corners = [...s.corners] as Quad;
        corners[op.index] = op.point;
        return { ...s, corners };
      });
    case 'setCorners':
      return mapSurface(state, op.surfaceId, (s) => ({ ...s, corners: op.corners }));
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
      return params ? { type: 'effect', effect, params } : null;
    }
    default:
      return null;
  }
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
    corners,
    content: parseContent(v.content) ?? { type: 'none' },
    opacity: finite(v.opacity) ? clamp(v.opacity, 0, 1) : 1,
    blend: parseEnum(v.blend, BLEND_MODES) ?? 'normal',
    fit: parseEnum(v.fit, FIT_MODES) ?? 'stretch',
    masks: parseMasks(v.masks),
  };
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
  return { format: 3, name: parseName(v.name, 'Unbenannt'), layers };
}
