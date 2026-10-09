// Bearbeitungsaktionen, die Editor, Tastatur und Seitenleiste gemeinsam nutzen.
// Alle lesen den aktuellsten Stand aus conn.snapshot (wichtig bei Tastenwiederholung).

import {
  outputToSurface,
  rotateQuad,
  scaleQuad,
  surfaceToOutput,
  translateQuad,
} from '../../../../shared/geometry.js';
import { newId } from '../../../../shared/ids.js';
import {
  createMask,
  createMaskLayer,
  createSurface,
  findMask,
  findSurface,
  POINT_MAX,
  POINT_MIN,
  surfacesOf,
} from '../../../../shared/state.js';
import type { AppState, CornerIndex, Mask, MaskLayer, Point, Quad, Surface } from '../../../../shared/types.js';
import type { Connection } from '../connection';

export interface Size {
  width: number;
  height: number;
}

const clamp = (v: number) => Math.min(POINT_MAX, Math.max(POINT_MIN, v));
export const clampPoint = (p: Point): Point => ({ x: clamp(p.x), y: clamp(p.y) });

export function selectedSurface(state: AppState): Surface | null {
  return findSurface(state.project, state.view.selectedSurfaceId);
}

export function selectedMask(state: AppState): { mask: Mask; surface: Surface | null; layer: MaskLayer | null } | null {
  return state.view.selectedMaskId ? findMask(state.project, state.view.selectedMaskId) : null;
}

/** Maskenpunkte im Ausgaberaum (Flächenmasken folgen dem Corner Pin; Masken-Ebenen liegen schon dort) */
export function maskPointsOut(mask: Mask, surface: Surface | null): Point[] {
  if (!surface) return mask.points;
  return mask.points.map((p) => surfaceToOutput(surface.corners, p) ?? p);
}

/** Ausgaberaum → Maskenraum */
export function outToMask(p: Point, surface: Surface | null): Point | null {
  if (!surface) return clampPoint(p);
  const uv = outputToSurface(surface.corners, p);
  return uv ? clampPoint(uv) : null;
}

// --- Gesten-IDs für Rückgängig: wiederholte Tasten/Mausrad zu einem Schritt bündeln

let keyGesture = { id: '', at: 0, key: '' };

export function repeatGesture(key: string, windowMs = 600): string {
  const now = performance.now();
  if (keyGesture.key !== key || now - keyGesture.at > windowMs) keyGesture = { id: newId(), at: now, key };
  keyGesture.at = now;
  return keyGesture.id;
}

// --- Flächen

export function nudge(conn: Connection, out: Size, dx: number, dy: number, gesture?: string): void {
  const st = conn.snapshot.state;
  if (!st) return;
  const ox = dx / out.width;
  const oy = dy / out.height;
  const v = st.view;

  if (v.tool === 'mask') {
    const sel = selectedMask(st);
    if (!sel || v.selectedPoint === null || sel.layer?.locked) return;
    const pts = maskPointsOut(sel.mask, sel.surface);
    const p = pts[v.selectedPoint];
    if (!p) return;
    const np = outToMask({ x: p.x + ox, y: p.y + oy }, sel.surface);
    if (!np) return;
    const points = [...sel.mask.points];
    points[v.selectedPoint] = np;
    conn.op({ kind: 'setMaskPoints', maskId: sel.mask.id, points }, gesture);
    return;
  }

  const s = selectedSurface(st);
  if (!s || s.locked) return;
  if (v.selectedCorner !== null) {
    const c = s.corners[v.selectedCorner];
    conn.op(
      { kind: 'setCorner', surfaceId: s.id, index: v.selectedCorner, point: clampPoint({ x: c.x + ox, y: c.y + oy }) },
      gesture,
    );
  } else {
    conn.op({ kind: 'setCorners', surfaceId: s.id, corners: clampQuad(translateQuad(s.corners, ox, oy)) }, gesture);
  }
}

export function scaleSelected(conn: Connection, factor: number, gesture?: string): void {
  const st = conn.snapshot.state;
  const s = st && selectedSurface(st);
  if (!s || s.locked) return;
  conn.op({ kind: 'setCorners', surfaceId: s.id, corners: clampQuad(scaleQuad(s.corners, factor)) }, gesture);
}

export function rotateSelected(conn: Connection, out: Size, radians: number, gesture?: string): void {
  const st = conn.snapshot.state;
  const s = st && selectedSurface(st);
  if (!s || s.locked) return;
  const corners = rotateQuad(s.corners, radians, out.width / out.height);
  conn.op({ kind: 'setCorners', surfaceId: s.id, corners: clampQuad(corners) }, gesture);
}

export function clampQuad(q: Quad): Quad {
  return q.map(clampPoint) as Quad;
}

export function addSurface(conn: Connection): void {
  const st = conn.snapshot.state;
  if (!st) return;
  const n = surfacesOf(st.project).length;
  // Neue Fläche leicht versetzt, damit sie nicht exakt über der letzten liegt
  const off = (n % 5) * 0.04;
  const corners: Quad = [
    { x: 0.3 + off, y: 0.25 + off },
    { x: 0.7 + off, y: 0.25 + off },
    { x: 0.7 + off, y: 0.75 + off },
    { x: 0.3 + off, y: 0.75 + off },
  ];
  const surface = createSurface(newId(), `Fläche ${n + 1}`, corners);
  conn.op({ kind: 'addLayer', layer: surface, index: st.project.layers.length });
  conn.op({
    kind: 'setView',
    patch: { selectedSurfaceId: surface.id, selectedCorner: null, selectedMaskId: null, selectedPoint: null, tool: 'surface' },
  });
}

export function duplicateSurface(conn: Connection, surfaceId: string): void {
  const st = conn.snapshot.state;
  if (!st) return;
  const idx = st.project.layers.findIndex((l) => l.id === surfaceId);
  const src = findSurface(st.project, surfaceId);
  if (!src) return;
  const copy: Surface = {
    ...structuredClone(src),
    id: newId(),
    name: `${src.name} Kopie`.slice(0, 100),
    locked: false,
    corners: clampQuad(translateQuad(src.corners, 0.03, 0.03)),
    masks: src.masks.map((m) => ({ ...structuredClone(m), id: newId() })),
  };
  conn.op({ kind: 'addLayer', layer: copy, index: idx + 1 });
  conn.op({ kind: 'setView', patch: { selectedSurfaceId: copy.id, selectedCorner: null } });
}

/** Fläche oder Masken-Ebene löschen */
export function removeLayer(conn: Connection, layerId: string): void {
  conn.op({ kind: 'removeLayer', layerId });
  const v = conn.snapshot.state?.view;
  if (v?.selectedSurfaceId === layerId || v?.selectedMaskId === layerId) {
    conn.op({ kind: 'setView', patch: { selectedSurfaceId: null, selectedCorner: null, selectedMaskId: null, selectedPoint: null } });
  }
}

export function selectSurface(conn: Connection, surfaceId: string | null, corner: CornerIndex | null = null): void {
  const st = conn.snapshot.state;
  if (!st) return;
  const v = st.view;
  // Gewählte Maske gehört nicht zu dieser Fläche → Maskenauswahl aufheben
  const sel = selectedMask(st);
  const keepMask = !!sel && sel.surface?.id === surfaceId;
  if (v.selectedSurfaceId === surfaceId && v.selectedCorner === corner && (keepMask || !v.selectedMaskId)) return;
  conn.op({
    kind: 'setView',
    patch: {
      selectedSurfaceId: surfaceId,
      selectedCorner: corner,
      ...(keepMask ? {} : { selectedMaskId: null, selectedPoint: null }),
    },
  });
}

/** Maske (Flächenmaske oder Masken-Ebene) auswählen */
export function selectMask(conn: Connection, maskId: string, point: number | null = null): void {
  const st = conn.snapshot.state;
  if (!st) return;
  const found = findMask(st.project, maskId);
  if (!found) return;
  conn.op({
    kind: 'setView',
    patch: {
      tool: 'mask',
      selectedMaskId: maskId,
      selectedPoint: point,
      // Flächenmaske → zugehörige Fläche mit auswählen; Masken-Ebene → keine Fläche
      selectedSurfaceId: found.surface?.id ?? null,
      selectedCorner: null,
    },
  });
}

// --- Masken

/**
 * Neue Maske anlegen. scope 'surface' = in den Stapel der gewählten Fläche,
 * 'layer' = Masken-Ebene ganz oben (wirkt auf alles darunter).
 * points sind im Ausgaberaum.
 */
export function newMask(conn: Connection, scope: 'surface' | 'layer', points: Point[] = [], gesture?: string): string | null {
  const st = conn.snapshot.state;
  if (!st) return null;
  const surface = scope === 'surface' ? selectedSurface(st) : null;
  if (scope === 'surface' && !surface) return null;
  const id = newId();
  if (surface) {
    const pts = points.map((p) => outToMask(p, surface)).filter((p): p is Point => p !== null);
    // Erste Maske einer Fläche: „hinzufügen“ (nur Inneres zeigen); weitere: „ausschneiden“
    const mode = surface.masks.length === 0 ? 'add' : 'subtract';
    const mask = createMask(id, `Maske ${surface.masks.length + 1}`, pts, mode);
    conn.op({ kind: 'addMask', surfaceId: surface.id, mask }, gesture);
  } else {
    const n = st.project.layers.filter((l) => l.kind === 'mask').length + 1;
    const layer = createMaskLayer(id, `Masken-Ebene ${n}`, points.map(clampPoint));
    conn.op({ kind: 'addLayer', layer, index: st.project.layers.length }, gesture);
  }
  conn.op({
    kind: 'setView',
    patch: {
      tool: 'mask',
      selectedMaskId: id,
      selectedPoint: points.length ? points.length - 1 : null,
      selectedSurfaceId: surface?.id ?? null,
    },
  });
  return id;
}

/**
 * Die Form einer Fläche aus allen Ebenen darunter ausschneiden:
 * legt direkt unter der Fläche eine Masken-Ebene mit ihren Ecken an.
 */
export function cutoutBelow(conn: Connection, surfaceId: string): void {
  const st = conn.snapshot.state;
  const s = st && findSurface(st.project, surfaceId);
  if (!st || !s) return;
  const idx = st.project.layers.findIndex((l) => l.id === surfaceId);
  const layer = createMaskLayer(newId(), `Ausschnitt „${s.name}“`.slice(0, 100), s.corners.map((p) => ({ ...p })));
  conn.op({ kind: 'addLayer', layer, index: idx });
}

export function deleteSelectedPoint(conn: Connection): void {
  const st = conn.snapshot.state;
  if (!st) return;
  const sel = selectedMask(st);
  const i = st.view.selectedPoint;
  if (!sel || i === null || !sel.mask.points[i] || sel.layer?.locked) return;
  const points = sel.mask.points.filter((_, k) => k !== i);
  conn.op({ kind: 'setMaskPoints', maskId: sel.mask.id, points });
  conn.op({ kind: 'setView', patch: { selectedPoint: points.length ? Math.max(0, i - 1) : null } });
}

// --- Tastatur (Steuerung und Ausgabe)

export function handleEditorKey(e: KeyboardEvent, conn: Connection, out: Size): boolean {
  // In Textfeldern gehören alle Tasten dem Feld; Schieberegler behalten ihre Pfeiltasten.
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return false;
  if (t instanceof HTMLInputElement) {
    if (!['checkbox', 'radio', 'range', 'color', 'button'].includes(t.type)) return false;
    if (t.type === 'range' && e.key.startsWith('Arrow')) return false;
  }
  const st = conn.snapshot.state;
  if (!st) return false;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key;

  if (mod && (key === 'z' || key === 'Z')) {
    if (e.shiftKey) conn.redo();
    else conn.undo();
    return true;
  }
  if (mod && (key === 'y' || key === 'Y')) {
    conn.redo();
    return true;
  }
  if (mod || e.altKey) return false;

  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const d = arrows[key];
  if (d) {
    const step = e.shiftKey ? 10 : 1;
    nudge(conn, out, d[0] * step, d[1] * step, repeatGesture('arrows'));
    return true;
  }

  const v = st.view;
  switch (key) {
    case 'Tab': {
      const dir = e.shiftKey ? -1 : 1;
      if (v.tool === 'mask') {
        const sel = selectedMask(st);
        const n = sel?.mask.points.length ?? 0;
        if (!n) return true;
        const i = v.selectedPoint === null ? 0 : (v.selectedPoint + dir + n) % n;
        conn.op({ kind: 'setView', patch: { selectedPoint: i } });
      } else {
        const s = selectedSurface(st) ?? surfacesOf(st.project)[0];
        if (!s) return true;
        const i = v.selectedCorner === null ? 0 : (v.selectedCorner + dir + 4) % 4;
        selectSurface(conn, s.id, i as CornerIndex);
      }
      return true;
    }
    case 'Backspace':
    case 'Delete':
      if (v.tool === 'mask') {
        deleteSelectedPoint(conn);
        return true;
      }
      return false;
    case 'Enter':
      // Maske fertig: Auswahl lösen, nächster Klick beginnt eine neue Maske
      if (v.tool === 'mask' && v.selectedMaskId) {
        conn.op({ kind: 'setView', patch: { selectedMaskId: null, selectedPoint: null } });
        return true;
      }
      return false;
    case 'Escape':
      if (v.tool === 'mask') {
        conn.op({
          kind: 'setView',
          patch: v.selectedPoint !== null ? { selectedPoint: null } : { selectedMaskId: null },
        });
      } else {
        conn.op({ kind: 'setView', patch: v.selectedCorner !== null ? { selectedCorner: null } : { selectedSurfaceId: null } });
      }
      return true;
    case 'e':
    case 'E':
      conn.op({ kind: 'setView', patch: { editMode: !v.editMode } });
      return true;
    case 'v':
    case 'V':
      conn.op({ kind: 'setView', patch: { tool: 'surface' } });
      return true;
    case 'm':
    case 'M':
      conn.op({ kind: 'setView', patch: { tool: 'mask' } });
      return true;
    case 'g':
    case 'G':
      // G: Raster auf den Flächen · ⇧G: Testgitter über das ganze Bild
      if (e.shiftKey) conn.op({ kind: 'setView', patch: { testPattern: v.testPattern === 'grid' ? 'none' : 'grid' } });
      else conn.op({ kind: 'setView', patch: { grid: { ...v.grid, enabled: !v.grid.enabled } } });
      return true;
    case 's':
    case 'S':
      conn.op({ kind: 'setView', patch: { snap: !v.snap } });
      return true;
    default:
      return false;
  }
}
