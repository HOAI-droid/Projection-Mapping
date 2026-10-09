// Interaktive Bearbeitungsebene (SVG) über dem gerenderten Bild.
// Wird in der Steuerung (über der Vorschau) und direkt auf der Beamer-Ausgabe benutzt.
//
// Werkzeug „Fläche“:  Ecke ziehen · Fläche innen ziehen = verschieben ·
//                     Trackpad-Pinch = skalieren · Alt + Scrollen = drehen
// Werkzeug „Maske“:   Klick = Punkt anhängen (bzw. neue Maske) · Punkt ziehen ·
//                     Klick auf Kante = Punkt einfügen · Entf = Punkt löschen

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { distToSegment, pointInPolygon, translateQuad } from '../../../../shared/geometry.js';
import { newId } from '../../../../shared/ids.js';
import type { Op } from '../../../../shared/state.js';
import type { AppState, CornerIndex, Mask, Point, Quad, Surface } from '../../../../shared/types.js';
import { CORNER_COLORS, CORNER_LABELS } from '../colors';
import './editor.css';
import type { Connection } from '../connection';
import {
  clampPoint,
  clampQuad,
  maskPointsOut,
  newMask,
  outToMask,
  repeatGesture,
  rotateSelected,
  scaleSelected,
  selectedMask,
  selectSurface,
  type Size,
} from './actions';

interface Props {
  state: AppState;
  conn: Connection;
  /** Größe der Fläche in CSS-Pixeln */
  width: number;
  height: number;
  /** Pixelgröße der echten Ausgabe (für Drehung ohne Verzerrung) */
  out: Size;
  /** Auf der Ausgabe größere Beschriftung */
  onOutput?: boolean;
}

type Drag =
  | { kind: 'corner'; surfaceId: string; index: CornerIndex; origin: Point; start: Point; gesture: string }
  | { kind: 'move'; surfaceId: string; origin: Quad; start: Point; gesture: string; moved: boolean }
  | {
      kind: 'maskPoint';
      maskId: string;
      surface: Surface | null;
      index: number;
      points: Point[];
      originOut: Point;
      start: Point;
      gesture: string;
    };

/** Abgeleitete Auswahl: sichtbare Flächen, gewählte Fläche/Maske, angezeigte Masken */
function derive(state: AppState) {
  const { project, view } = state;
  const visible = project.surfaces.filter((s) => s.visible);
  const selected = project.surfaces.find((s) => s.id === view.selectedSurfaceId) ?? null;
  const sel = selectedMask(state);
  // Im Masken-Werkzeug sichtbar: globale Masken + die der gewählten Fläche
  const maskList: { mask: Mask; surface: Surface | null }[] = [
    ...project.masks.map((mask) => ({ mask, surface: null })),
    ...(selected ? selected.masks.map((mask) => ({ mask, surface: selected })) : []),
  ];
  return { visible, selected, sel, maskList };
}

const HIT_CORNER = 16;
const HIT_POINT = 12;
const HIT_EDGE = 8;
const MASK_COLOR = '#e879f9';

export function Editor({ state, conn, width: W, height: H, out, onOutput }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const pending = useRef<{ op: Op; gesture: string } | null>(null);
  const raf = useRef<number | undefined>(undefined);
  const { project, view } = state;

  const flush = () => {
    raf.current = undefined;
    const p = pending.current;
    pending.current = null;
    if (p) conn.op(p.op, p.gesture);
  };
  /** Höchstens ein Update pro Bildschirmbild senden */
  const queue = (op: Op, gesture: string) => {
    pending.current = { op, gesture };
    if (raf.current === undefined) raf.current = requestAnimationFrame(flush);
  };

  const toPx = (p: Point): [number, number] => [p.x * W, p.y * H];
  const eventPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const pxDist = (a: Point, b: Point) => Math.hypot((a.x - b.x) * W, (a.y - b.y) * H);

  const { visible, selected, sel, maskList } = derive(state);

  // --- Zeiger

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || drag.current) return;
    // Immer den neuesten Stand nehmen (inkl. eigener, noch unbestätigter Ops) –
    // sonst überschreiben schnelle Klicks einander.
    const st = conn.snapshot.state ?? state;
    const { view } = st;
    const { visible, selected, sel, maskList } = derive(st);
    const p = eventPoint(e);
    const captured = () => e.currentTarget.setPointerCapture(e.pointerId);

    if (view.tool === 'surface') {
      // 1. Ecken (gewählte Fläche zuerst, dann oberste zuerst)
      const order = [...visible].reverse().sort((a, b) => Number(b.id === view.selectedSurfaceId) - Number(a.id === view.selectedSurfaceId));
      for (const s of order) {
        if (s.locked) continue;
        for (let i = 0; i < 4; i++) {
          const c = s.corners[i as CornerIndex];
          if (pxDist(c, p) <= HIT_CORNER) {
            selectSurface(conn, s.id, i as CornerIndex);
            drag.current = { kind: 'corner', surfaceId: s.id, index: i as CornerIndex, origin: c, start: p, gesture: newId() };
            captured();
            return;
          }
        }
      }
      // 2. Innenfläche → verschieben (oberste zuerst)
      for (const s of [...visible].reverse()) {
        if (pointInPolygon(p, s.corners)) {
          selectSurface(conn, s.id, null);
          if (!s.locked) {
            drag.current = { kind: 'move', surfaceId: s.id, origin: s.corners, start: p, gesture: newId(), moved: false };
            captured();
          }
          return;
        }
      }
      // 3. Leerer Bereich → Auswahl aufheben
      if (view.selectedSurfaceId || view.selectedCorner !== null) selectSurface(conn, null);
      return;
    }

    // --- Masken-Werkzeug
    // 1. Punkt der gewählten Maske
    if (sel) {
      const pts = maskPointsOut(sel.mask, sel.surface);
      const i = pts.findIndex((q) => pxDist(q, p) <= HIT_POINT);
      if (i >= 0) {
        startPointDrag(sel.mask, sel.surface, i, sel.mask.points, pts[i]!, p, newId());
        conn.op({ kind: 'setView', patch: { selectedPoint: i } });
        captured();
        return;
      }
      // 2. Kante der gewählten Maske → Punkt einfügen
      if (pts.length >= 2) {
        const n = pts.length;
        const edges = n >= 3 ? n : n - 1;
        for (let k = 0; k < edges; k++) {
          const a = pts[k]!;
          const b = pts[(k + 1) % n]!;
          const pa = { x: a.x * W, y: a.y * H };
          const pb = { x: b.x * W, y: b.y * H };
          if (distToSegment({ x: p.x * W, y: p.y * H }, pa, pb).dist <= HIT_EDGE) {
            const mp = outToMask(p, sel.surface);
            if (!mp) return;
            const points = [...sel.mask.points];
            points.splice(k + 1, 0, mp);
            const g = newId();
            conn.op({ kind: 'setMaskPoints', maskId: sel.mask.id, points }, g);
            conn.op({ kind: 'setView', patch: { selectedPoint: k + 1 } });
            startPointDrag(sel.mask, sel.surface, k + 1, points, p, p, g);
            captured();
            return;
          }
        }
      }
    }
    // 3. Punkt einer anderen sichtbaren Maske → diese auswählen
    for (const m of maskList) {
      if (m.mask.id === sel?.mask.id) continue;
      const pts = maskPointsOut(m.mask, m.surface);
      const i = pts.findIndex((q) => pxDist(q, p) <= HIT_POINT);
      if (i >= 0) {
        conn.op({ kind: 'setView', patch: { selectedMaskId: m.mask.id, selectedPoint: i } });
        startPointDrag(m.mask, m.surface, i, m.mask.points, pts[i]!, p, newId());
        captured();
        return;
      }
    }
    // 4. Leerer Bereich: Punkt an gewählte Maske anhängen oder neue Maske beginnen
    const g = newId();
    if (sel) {
      const mp = outToMask(p, sel.surface);
      if (!mp) return;
      const points = [...sel.mask.points, mp];
      conn.op({ kind: 'setMaskPoints', maskId: sel.mask.id, points }, g);
      conn.op({ kind: 'setView', patch: { selectedPoint: points.length - 1 } });
      startPointDrag(sel.mask, sel.surface, points.length - 1, points, p, p, g);
      captured();
      return;
    }
    const global = view.maskScope === 'global' || !selected;
    const id = newMask(conn, global, p, g);
    if (!id) return;
    const surface = global ? null : selected;
    const mp = outToMask(p, surface);
    if (!mp) return;
    drag.current = { kind: 'maskPoint', maskId: id, surface, index: 0, points: [mp], originOut: p, start: p, gesture: g };
    captured();
  };

  const startPointDrag = (
    mask: Mask,
    surface: Surface | null,
    index: number,
    points: Point[],
    originOut: Point,
    start: Point,
    gesture: string,
  ) => {
    drag.current = { kind: 'maskPoint', maskId: mask.id, surface, index, points, originOut, start, gesture };
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = eventPoint(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    switch (d.kind) {
      case 'corner':
        queue(
          {
            kind: 'setCorner',
            surfaceId: d.surfaceId,
            index: d.index,
            point: clampPoint({ x: d.origin.x + dx, y: d.origin.y + dy }),
          },
          d.gesture,
        );
        break;
      case 'move':
        // Kleine Zitterbewegungen beim Anklicken nicht als Verschieben werten
        if (!d.moved && Math.hypot(dx * W, dy * H) < 3) return;
        d.moved = true;
        queue({ kind: 'setCorners', surfaceId: d.surfaceId, corners: clampQuad(translateQuad(d.origin, dx, dy)) }, d.gesture);
        break;
      case 'maskPoint': {
        const mp = outToMask({ x: d.originOut.x + dx, y: d.originOut.y + dy }, d.surface);
        if (!mp) return;
        const points = [...d.points];
        points[d.index] = mp;
        queue({ kind: 'setMaskPoints', maskId: d.maskId, points }, d.gesture);
        break;
      }
    }
  };

  const onPointerEnd = () => {
    if (!drag.current) return;
    drag.current = null;
    if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    flush();
  };

  // --- Mausrad/Trackpad: Pinch (ctrlKey) skaliert, Alt + Scrollen dreht. Braucht passive: false.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const st = conn.snapshot.state;
      if (!st || st.view.tool !== 'surface' || !st.view.selectedSurfaceId) return;
      if (e.ctrlKey) {
        e.preventDefault();
        scaleSelected(conn, Math.exp(-e.deltaY * 0.01), repeatGesture('wheel-scale', 400));
      } else if (e.altKey) {
        e.preventDefault();
        rotateSelected(conn, out, e.deltaY * 0.002, repeatGesture('wheel-rotate', 400));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [conn, out]);

  // --- Darstellung

  const font = onOutput ? 22 : 15;
  const poly = (pts: Point[]) => pts.map((q) => toPx(q).join(',')).join(' ');

  return (
    <svg
      ref={svgRef}
      className={`editor tool-${view.tool}`}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Flächen-Umrisse */}
      {project.surfaces.map((s, idx) => {
        if (!s.visible) return null;
        const active = s.id === view.selectedSurfaceId;
        const [cx, cy] = toPx({
          x: (s.corners[0].x + s.corners[1].x + s.corners[2].x + s.corners[3].x) / 4,
          y: (s.corners[0].y + s.corners[1].y + s.corners[2].y + s.corners[3].y) / 4,
        });
        return (
          <g key={s.id} className={`ed-surface${active ? ' active' : ''}${s.locked ? ' locked' : ''}${view.tool === 'mask' ? ' dim' : ''}`}>
            <polygon points={poly(s.corners)} />
            <text x={cx} y={cy} fontSize={font} className="ed-label">
              {idx + 1} · {s.name}
              {s.locked ? ' 🔒' : ''}
            </text>
          </g>
        );
      })}

      {/* Eckgriffe */}
      {view.tool === 'surface' &&
        visible.map((s) => {
          if (s.locked) return null;
          const active = s.id === view.selectedSurfaceId;
          return s.corners.map((c, i) => {
            const [x, y] = toPx(c);
            const isSel = active && view.selectedCorner === i;
            return (
              <g key={`${s.id}-${i}`} transform={`translate(${x} ${y})`} className="ed-corner">
                {isSel && <circle r={18} className="ed-ring" />}
                <circle r={active ? 10 : 6} fill={CORNER_COLORS[i]} />
                {active && (
                  <text dy="0.35em" className="ed-corner-label">
                    {CORNER_LABELS[i]}
                  </text>
                )}
              </g>
            );
          });
        })}

      {/* Fadenkreuz am gewählten Eckpunkt */}
      {view.tool === 'surface' && selected && view.selectedCorner !== null && (() => {
        const [x, y] = toPx(selected.corners[view.selectedCorner]);
        return (
          <g className="ed-crosshair" stroke={CORNER_COLORS[view.selectedCorner]}>
            <line x1={0} y1={y} x2={W} y2={y} />
            <line x1={x} y1={0} x2={x} y2={H} />
          </g>
        );
      })()}

      {/* Masken */}
      {view.tool === 'mask' &&
        maskList.map(({ mask, surface }) => {
          const pts = maskPointsOut(mask, surface);
          if (pts.length === 0) return null;
          const isSel = mask.id === sel?.mask.id;
          const cls = `ed-mask${isSel ? ' active' : ''}${mask.invert ? ' invert' : ''}${mask.enabled ? '' : ' disabled'}`;
          return (
            <g key={mask.id} className={cls}>
              {pts.length >= 3 ? <polygon points={poly(pts)} /> : <polyline points={poly(pts)} />}
              {(isSel ? pts : []).map((q, i) => {
                const [x, y] = toPx(q);
                const r = view.selectedPoint === i ? 7 : 5;
                return <rect key={i} x={x - r} y={y - r} width={r * 2} height={r * 2} className={view.selectedPoint === i ? 'pt sel' : 'pt'} />;
              })}
            </g>
          );
        })}

      {view.tool === 'mask' && !sel && (
        <text x={12} y={font + 8} fontSize={font * 0.8} className="ed-hint" fill={MASK_COLOR}>
          {view.maskScope === 'global' || !selected
            ? 'Klicken: neue globale Maske zeichnen'
            : `Klicken: neue Maske auf „${selected.name}“ zeichnen`}
        </text>
      )}
    </svg>
  );
}
