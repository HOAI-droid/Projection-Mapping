// Zustandsänderungen als serialisierbare Operationen.
// Server und Clients wenden dieselben Operationen mit demselben Reducer an.

import type {
  AppState,
  BlendMode,
  Content,
  CornerIndex,
  FitMode,
  Mask,
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
export type MaskPatch = Partial<Pick<Mask, 'name' | 'invert' | 'feather' | 'enabled'>>;

export type Op =
  | { kind: 'setCorner'; surfaceId: string; index: CornerIndex; point: Point }
  | { kind: 'setCorners'; surfaceId: string; corners: Quad }
  | { kind: 'setContent'; surfaceId: string; content: Content }
  | { kind: 'patchVideo'; surfaceId: string; patch: VideoPatch }
  | { kind: 'addSurface'; surface: Surface; index: number }
  | { kind: 'removeSurface'; surfaceId: string }
  | { kind: 'updateSurface'; surfaceId: string; patch: SurfacePatch }
  | { kind: 'moveSurface'; surfaceId: string; index: number }
  /** surfaceId null = globale Maske */
  | { kind: 'addMask'; surfaceId: string | null; mask: Mask }
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
export const MAX_MASK_POINTS = 500;
export const MAX_SURFACES = 200;

export const BLEND_MODES: readonly BlendMode[] = ['normal', 'add', 'multiply', 'screen'];
export const FIT_MODES: readonly FitMode[] = ['stretch', 'fill', 'fit'];

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

export function createMask(id: string, name: string, points: Point[] = []): Mask {
  return { id, name, points, invert: false, feather: 0, enabled: true };
}

export function createProject(name: string, surfaceId: string): Project {
  return { format: 2, name, surfaces: [createSurface(surfaceId, 'Fläche 1')], masks: [] };
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
  };
}

/** Ändert die Operation das (speicherbare) Projekt? */
export function touchesProject(op: Op): boolean {
  return op.kind !== 'setView';
}

/** Findet eine Maske (global oder in einer Fläche). */
export function findMask(project: Project, maskId: string): { mask: Mask; surface: Surface | null } | null {
  const g = project.masks.find((m) => m.id === maskId);
  if (g) return { mask: g, surface: null };
  for (const s of project.surfaces) {
    const m = s.masks.find((x) => x.id === maskId);
    if (m) return { mask: m, surface: s };
  }
  return null;
}

function mapSurface(state: AppState, id: string, fn: (s: Surface) => Surface): AppState {
  let changed = false;
  const surfaces = state.project.surfaces.map((s) => {
    if (s.id !== id) return s;
    changed = true;
    return fn(s);
  });
  if (!changed) return state;
  return { ...state, project: { ...state.project, surfaces } };
}

function mapMask(state: AppState, maskId: string, fn: (m: Mask) => Mask): AppState {
  const p = state.project;
  if (p.masks.some((m) => m.id === maskId)) {
    return { ...state, project: { ...p, masks: p.masks.map((m) => (m.id === maskId ? fn(m) : m)) } };
  }
  const owner = p.surfaces.find((s) => s.masks.some((m) => m.id === maskId));
  if (!owner) return state;
  return mapSurface(state, owner.id, (s) => ({ ...s, masks: s.masks.map((m) => (m.id === maskId ? fn(m) : m)) }));
}

/** Alle IDs im Projekt (Flächen + Masken), um Duplikate abzuweisen */
function idExists(p: Project, id: string): boolean {
  return (
    p.masks.some((m) => m.id === id) ||
    p.surfaces.some((s) => s.id === id || s.masks.some((m) => m.id === id))
  );
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
    case 'addSurface': {
      const p = state.project;
      if (p.surfaces.length >= MAX_SURFACES) return state;
      if (idExists(p, op.surface.id) || op.surface.masks.some((m) => idExists(p, m.id))) return state;
      const surfaces = [...p.surfaces];
      surfaces.splice(Math.max(0, Math.min(surfaces.length, op.index)), 0, op.surface);
      return { ...state, project: { ...p, surfaces } };
    }
    case 'removeSurface': {
      const p = state.project;
      if (!p.surfaces.some((s) => s.id === op.surfaceId)) return state;
      return { ...state, project: { ...p, surfaces: p.surfaces.filter((s) => s.id !== op.surfaceId) } };
    }
    case 'updateSurface':
      return mapSurface(state, op.surfaceId, (s) => ({ ...s, ...op.patch }));
    case 'moveSurface': {
      const p = state.project;
      const from = p.surfaces.findIndex((s) => s.id === op.surfaceId);
      if (from < 0) return state;
      const to = Math.max(0, Math.min(p.surfaces.length - 1, op.index));
      if (to === from) return state;
      const surfaces = [...p.surfaces];
      const [s] = surfaces.splice(from, 1);
      surfaces.splice(to, 0, s!);
      return { ...state, project: { ...p, surfaces } };
    }
    case 'addMask': {
      const p = state.project;
      if (idExists(p, op.mask.id)) return state;
      if (op.surfaceId === null) return { ...state, project: { ...p, masks: [...p.masks, op.mask] } };
      return mapSurface(state, op.surfaceId, (s) => ({ ...s, masks: [...s.masks, op.mask] }));
    }
    case 'removeMask': {
      const p = state.project;
      if (!findMask(p, op.maskId)) return state;
      return {
        ...state,
        project: {
          ...p,
          masks: p.masks.filter((m) => m.id !== op.maskId),
          surfaces: p.surfaces.map((s) =>
            s.masks.some((m) => m.id === op.maskId) ? { ...s, masks: s.masks.filter((m) => m.id !== op.maskId) } : s,
          ),
        },
      };
    }
    case 'updateMask':
      return mapMask(state, op.maskId, (m) => ({ ...m, ...op.patch }));
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

function parseColor(v: unknown): string | null {
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
  if (typeof v.invert === 'boolean') patch.invert = v.invert;
  if (typeof v.enabled === 'boolean') patch.enabled = v.enabled;
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
      return {
        type: 'video',
        mediaId,
        loop: p.loop ?? true,
        speed: p.speed ?? 1,
        playing: p.playing ?? true,
      };
    }
    default:
      return null;
  }
}

export function parseMask(v: unknown): Mask | null {
  if (!isObj(v)) return null;
  const id = parseId(v.id);
  const points = parsePoints(v.points ?? []);
  if (!id || !points) return null;
  return {
    id,
    name: parseName(v.name, 'Maske'),
    points,
    invert: v.invert === true,
    feather: finite(v.feather) ? clamp(v.feather, 0, FEATHER_MAX) : 0,
    enabled: v.enabled !== false,
  };
}

function parseMasks(v: unknown): Mask[] {
  if (!Array.isArray(v)) return [];
  return v.map(parseMask).filter((m): m is Mask => m !== null);
}

export function parseSurface(v: unknown): Surface | null {
  if (!isObj(v)) return null;
  const id = parseId(v.id);
  const corners = parseQuad(v.corners);
  if (!id || !corners) return null;
  return {
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

const TEST_PATTERNS: readonly TestPattern[] = ['none', 'grid', 'white'];
const TOOLS: readonly Tool[] = ['surface', 'mask'];
const MASK_SCOPES: readonly MaskScope[] = ['surface', 'global'];

function parseViewPatch(v: unknown): Partial<ViewState> | null {
  if (!isObj(v)) return null;
  const patch: Partial<ViewState> = {};
  if (typeof v.editMode === 'boolean') patch.editMode = v.editMode;
  const tp = parseEnum(v.testPattern, TEST_PATTERNS);
  if (tp) patch.testPattern = tp;
  const tool = parseEnum(v.tool, TOOLS);
  if (tool) patch.tool = tool;
  const scope = parseEnum(v.maskScope, MASK_SCOPES);
  if (scope) patch.maskScope = scope;
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
    case 'addSurface': {
      const surface = parseSurface(v.surface);
      return surface && finite(v.index) ? { kind: 'addSurface', surface, index: Math.round(v.index) } : null;
    }
    case 'removeSurface': {
      const surfaceId = parseId(v.surfaceId);
      return surfaceId ? { kind: 'removeSurface', surfaceId } : null;
    }
    case 'updateSurface': {
      const surfaceId = parseId(v.surfaceId);
      const patch = parseSurfacePatch(v.patch);
      return surfaceId && patch ? { kind: 'updateSurface', surfaceId, patch } : null;
    }
    case 'moveSurface': {
      const surfaceId = parseId(v.surfaceId);
      return surfaceId && finite(v.index) ? { kind: 'moveSurface', surfaceId, index: Math.round(v.index) } : null;
    }
    case 'addMask': {
      const surfaceId = v.surfaceId === null ? null : parseId(v.surfaceId);
      const mask = parseMask(v.mask);
      return mask && (surfaceId !== null || v.surfaceId === null) ? { kind: 'addMask', surfaceId, mask } : null;
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

/** Liest eine Projektdatei ein (auch Format 1) und repariert fehlende Felder, so gut es geht. */
export function parseProject(v: unknown): Project | null {
  if (!isObj(v) || !Array.isArray(v.surfaces)) return null;
  const surfaces = v.surfaces.map(parseSurface).filter((s): s is Surface => s !== null);
  return {
    format: 2,
    name: parseName(v.name, 'Unbenannt'),
    surfaces,
    masks: parseMasks(v.masks),
  };
}
