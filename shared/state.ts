// Zustandsänderungen als serialisierbare Operationen.
// Server und Clients wenden dieselben Operationen mit demselben Reducer an.

import type {
  AppState,
  Content,
  CornerIndex,
  Point,
  Project,
  Quad,
  Surface,
  TestPattern,
  VideoContent,
  ViewState,
} from './types.js';

export type VideoPatch = Partial<Pick<VideoContent, 'loop' | 'speed' | 'playing'>>;

export type Op =
  | { kind: 'setCorner'; surfaceId: string; index: CornerIndex; point: Point }
  | { kind: 'setCorners'; surfaceId: string; corners: Quad }
  | { kind: 'setContent'; surfaceId: string; content: Content }
  | { kind: 'patchVideo'; surfaceId: string; patch: VideoPatch }
  | { kind: 'setView'; patch: Partial<ViewState> };

/** Eckpunkte dürfen etwas außerhalb des Bildes liegen (Fläche ragt aus dem Bild). */
export const POINT_MIN = -1;
export const POINT_MAX = 2;
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;

export function defaultCorners(): Quad {
  return [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ];
}

export function createSurface(id: string, name: string): Surface {
  return { id, name, visible: true, corners: defaultCorners(), content: { type: 'testgrid' } };
}

export function createProject(name: string, surfaceId: string): Project {
  return { format: 1, name, surfaces: [createSurface(surfaceId, 'Fläche 1')] };
}

export function defaultView(): ViewState {
  return { showOutlines: true, testPattern: 'none', selectedSurfaceId: null, selectedCorner: null };
}

/** Ändert die Operation das (speicherbare) Projekt? */
export function touchesProject(op: Op): boolean {
  return op.kind !== 'setView';
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

function parseId(v: unknown): string | null {
  return typeof v === 'string' && /^[a-z0-9_-]{1,64}$/i.test(v) ? v : null;
}

function parsePoint(v: unknown): Point | null {
  if (!isObj(v) || !finite(v.x) || !finite(v.y)) return null;
  return { x: clamp(v.x, POINT_MIN, POINT_MAX), y: clamp(v.y, POINT_MIN, POINT_MAX) };
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

function parseVideoPatch(v: unknown): VideoPatch | null {
  if (!isObj(v)) return null;
  const patch: VideoPatch = {};
  if (typeof v.loop === 'boolean') patch.loop = v.loop;
  if (typeof v.playing === 'boolean') patch.playing = v.playing;
  if (finite(v.speed)) patch.speed = clamp(v.speed, SPEED_MIN, SPEED_MAX);
  return patch;
}

export function parseContent(v: unknown): Content | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case 'none':
      return { type: 'none' };
    case 'testgrid':
      return { type: 'testgrid' };
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

const TEST_PATTERNS: readonly TestPattern[] = ['none', 'grid', 'white'];

function parseViewPatch(v: unknown): Partial<ViewState> | null {
  if (!isObj(v)) return null;
  const patch: Partial<ViewState> = {};
  if (typeof v.showOutlines === 'boolean') patch.showOutlines = v.showOutlines;
  if (typeof v.testPattern === 'string' && TEST_PATTERNS.includes(v.testPattern as TestPattern)) {
    patch.testPattern = v.testPattern as TestPattern;
  }
  if (v.selectedSurfaceId === null || parseId(v.selectedSurfaceId)) {
    patch.selectedSurfaceId = v.selectedSurfaceId as string | null;
  }
  if (v.selectedCorner === null || parseCornerIndex(v.selectedCorner) !== null) {
    patch.selectedCorner = v.selectedCorner as CornerIndex | null;
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
    case 'setView': {
      const patch = parseViewPatch(v.patch);
      return patch ? { kind: 'setView', patch } : null;
    }
    default:
      return null;
  }
}

/** Liest eine Projektdatei ein und repariert fehlende/ungültige Felder, so gut es geht. */
export function parseProject(v: unknown): Project | null {
  if (!isObj(v) || !Array.isArray(v.surfaces)) return null;
  const surfaces: Surface[] = [];
  for (const raw of v.surfaces) {
    if (!isObj(raw)) continue;
    const id = parseId(raw.id);
    const corners = parseQuad(raw.corners);
    if (!id || !corners) continue;
    surfaces.push({
      id,
      name: typeof raw.name === 'string' ? raw.name.slice(0, 100) : 'Fläche',
      visible: raw.visible !== false,
      corners,
      content: parseContent(raw.content) ?? { type: 'none' },
    });
  }
  return {
    format: 1,
    name: typeof v.name === 'string' && v.name.trim() ? v.name.slice(0, 100) : 'Unbenannt',
    surfaces,
  };
}
