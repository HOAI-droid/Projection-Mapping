// Interaktive Bearbeitungsebene (SVG) über dem gerenderten Bild.
// Wird in der Steuerung (über der Vorschau) und direkt auf der Beamer-Ausgabe benutzt.
//
// Werkzeug „Fläche“:  Ecke ziehen · Fläche innen ziehen = verschieben ·
//                     Trackpad-Pinch = skalieren · ⌥ + Scrollen = drehen
// Werkzeug „Maske“:   ziehen = Freihand-Umriss · Klick = Punkt setzen ·
//                     Punkt ziehen · Klick auf Kante = Punkt einfügen · Entf = löschen
// Snap (Taste S): Punkte rasten an Ecken, Maskenpunkten und Kanten ein; ⌥ beim Ziehen = ohne Snap.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { centroid, distToSegment, pointInPolygon, translateQuad } from '../../../../shared/geometry.js';
import { newId } from '../../../../shared/ids.js';
import { surfacesOf, type Op } from '../../../../shared/state.js';
import type { AppState, CornerIndex, Mask, MaskLayer, Point, Quad, Surface } from '../../../../shared/types.js';
import { CORNER_COLORS, CORNER_LABELS } from '../colors';
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
  selectMask,
  selectSurface,
  type Size,
} from './actions';
import { simplifyPath, snapDelta, snapPoint, snapTargets, type SnapTargets } from './snap';
import './editor.css';

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
  | { kind: 'corner'; surfaceId: string; index: CornerIndex; origin: Point; start: Point; gesture: string; snap: SnapTargets }
  | { kind: 'move'; surfaceId: string; origin: Quad; start: Point; gesture: string; moved: boolean; snap: SnapTargets }
  | {
      kind: 'maskPoint';
      maskId: string;
      surface: Surface | null;
      index: number;
      points: Point[];
      originOut: Point;
      start: Point;
      gesture: string;
      snap: SnapTargets;
    }
  /** Neue Maske: Freihand-Linie oder (ohne Bewegung) erster Punkt */
  | { kind: 'draw'; path: Point[]; moved: boolean };

interface MaskEntry {
  mask: Mask;
  surface: Surface | null;
  layer: MaskLayer | null;
}

const HIT_CORNER = 16;
const HIT_POINT = 12;
const HIT_EDGE = 8;

/** Abgeleitete Auswahl: sichtbare Flächen, gewählte Fläche/Maske, bearbeitbare Masken */
function derive(state: AppState) {
  const { project, view } = state;
  const surfaces = surfacesOf(project);
  const visible = surfaces.filter((s) => s.visible);
  const selected = surfaces.find((s) => s.id === view.selectedSurfaceId) ?? null;
  const sel = selectedMask(state);
  // Im Masken-Werkzeug bearbeitbar: alle Masken-Ebenen + die Masken der gewählten Fläche
  const maskList: MaskEntry[] = [
    ...project.layers
      .filter((l): l is MaskLayer => l.kind === 'mask')
      .map((layer) => ({ mask: layer, surface: null, layer })),
    ...(selected ? selected.masks.map((mask) => ({ mask, surface: selected, layer: null })) : []),
  ];
  return { visible, selected, sel, maskList };
}

export function Editor({ state, conn, width: W, height: H, out, onOutput }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const pending = useRef<{ op: Op; gesture: string } | null>(null);
  const raf = useRef<number | undefined>(undefined);
  const [snapMark, setSnapMark] = useState<Point | null>(null);
  const [drawPath, setDrawPath] = useState<Point[] | null>(null);
  const { project, view } = state;
  const { visible, selected, sel, maskList } = derive(state);

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

  /** Snap anwenden, wenn eingeschaltet und ⌥ nicht gedrückt */
  const snapped = (p: Point, st: AppState, exclude: { surfaceId?: string; maskId?: string }, alt: boolean): Point =>
    st.view.snap && !alt ? snapPoint(p, snapTargets(st, exclude), W, H).point : p;

  const startPointDrag = (
    st: AppState,
    mask: Mask,
    surface: Surface | null,
    index: number,
    points: Point[],
    originOut: Point,
    start: Point,
    gesture: string,
  ) => {
    drag.current = {
      kind: 'maskPoint',
      maskId: mask.id,
      surface,
      index,
      points,
      originOut,
      start,
      gesture,
      snap: snapTargets(st, { maskId: mask.id }),
    };
  };

  // --- Zeiger

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || drag.current) return;
    // Immer den neuesten Stand nehmen (inkl. eigener, noch unbestätigter Ops) –
    // sonst überschreiben schnelle Klicks einander.
    const st = conn.snapshot.state ?? state;
    const { view } = st;
    const { visible, sel, maskList } = derive(st);
    const p = eventPoint(e);
    const capture = () => e.currentTarget.setPointerCapture(e.pointerId);

    if (view.tool === 'surface') {
      // 1. Ecken (gewählte Fläche zuerst, dann oberste zuerst)
      const order = [...visible]
        .reverse()
        .sort((a, b) => Number(b.id === view.selectedSurfaceId) - Number(a.id === view.selectedSurfaceId));
      for (const s of order) {
        if (s.locked) continue;
        for (let i = 0; i < 4; i++) {
          const c = s.corners[i as CornerIndex];
          if (pxDist(c, p) <= HIT_CORNER) {
            selectSurface(conn, s.id, i as CornerIndex);
            drag.current = {
              kind: 'corner',
              surfaceId: s.id,
              index: i as CornerIndex,
              origin: c,
              start: p,
              gesture: newId(),
              snap: snapTargets(st, { surfaceId: s.id }),
            };
            capture();
            return;
          }
        }
      }
      // 2. Innenfläche → verschieben (oberste zuerst)
      for (const s of [...visible].reverse()) {
        if (pointInPolygon(p, s.corners)) {
          selectSurface(conn, s.id, null);
          if (!s.locked) {
            drag.current = {
              kind: 'move',
              surfaceId: s.id,
              origin: s.corners,
              start: p,
              gesture: newId(),
              moved: false,
              snap: snapTargets(st, { surfaceId: s.id }),
            };
            capture();
          }
          return;
        }
      }
      // 3. Leerer Bereich → Auswahl aufheben
      if (view.selectedSurfaceId || view.selectedCorner !== null) selectSurface(conn, null);
      return;
    }

    // --- Masken-Werkzeug
    const editable = !!sel && !sel.layer?.locked;
    if (sel && editable) {
      const pts = maskPointsOut(sel.mask, sel.surface);
      // 1. Punkt der gewählten Maske
      const i = pts.findIndex((q) => pxDist(q, p) <= HIT_POINT);
      if (i >= 0) {
        startPointDrag(st, sel.mask, sel.surface, i, sel.mask.points, pts[i]!, p, newId());
        conn.op({ kind: 'setView', patch: { selectedPoint: i } });
        capture();
        return;
      }
      // 2. Kante der gewählten Maske → Punkt einfügen
      if (pts.length >= 2) {
        const n = pts.length;
        const edges = n >= 3 ? n : n - 1;
        for (let k = 0; k < edges; k++) {
          const a = pts[k]!;
          const b = pts[(k + 1) % n]!;
          const hit = distToSegment({ x: p.x * W, y: p.y * H }, { x: a.x * W, y: a.y * H }, { x: b.x * W, y: b.y * H });
          if (hit.dist <= HIT_EDGE) {
            const mp = outToMask(p, sel.surface);
            if (!mp) return;
            const points = [...sel.mask.points];
            points.splice(k + 1, 0, mp);
            const g = newId();
            conn.op({ kind: 'setMaskPoints', maskId: sel.mask.id, points }, g);
            conn.op({ kind: 'setView', patch: { selectedPoint: k + 1 } });
            startPointDrag(st, sel.mask, sel.surface, k + 1, points, p, p, g);
            capture();
            return;
          }
        }
      }
    }
    // 3. Punkt einer anderen sichtbaren Maske → diese auswählen und ziehen
    for (const m of maskList) {
      if (m.mask.id === sel?.mask.id) continue;
      const pts = maskPointsOut(m.mask, m.surface);
      const i = pts.findIndex((q) => pxDist(q, p) <= HIT_POINT);
      if (i >= 0) {
        selectMask(conn, m.mask.id, i);
        if (!m.layer?.locked) {
          startPointDrag(st, m.mask, m.surface, i, m.mask.points, pts[i]!, p, newId());
          capture();
        }
        return;
      }
    }
    // 4. Gewählte Maske: Klick ins Leere hängt einen Punkt an
    if (sel && editable) {
      const g = newId();
      const target = snapped(p, st, { maskId: sel.mask.id }, e.altKey);
      const mp = outToMask(target, sel.surface);
      if (!mp) return;
      const points = [...sel.mask.points, mp];
      conn.op({ kind: 'setMaskPoints', maskId: sel.mask.id, points }, g);
      conn.op({ kind: 'setView', patch: { selectedPoint: points.length - 1 } });
      startPointDrag(st, sel.mask, sel.surface, points.length - 1, points, target, p, g);
      capture();
      return;
    }
    // 5. Keine Maske gewählt: neue Maske beginnen – auch innerhalb einer bestehenden
    //    (Masken auf Masken). Auswählen geht über die Punkte oder die Liste.
    const first = snapped(p, st, {}, e.altKey);
    drag.current = { kind: 'draw', path: [first], moved: false };
    setDrawPath([first]);
    capture();
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = eventPoint(e);
    const useSnap = (conn.snapshot.state?.view.snap ?? true) && !e.altKey;

    if (d.kind === 'draw') {
      const last = d.path[d.path.length - 1]!;
      if (pxDist(last, p) < 4) return;
      d.moved = d.moved || pxDist(d.path[0]!, p) > 6;
      d.path = [...d.path, p];
      setDrawPath(d.path);
      return;
    }

    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    switch (d.kind) {
      case 'corner': {
        let pt: Point = { x: d.origin.x + dx, y: d.origin.y + dy };
        let mark: Point | null = null;
        if (useSnap) ({ point: pt, target: mark } = snapPoint(pt, d.snap, W, H));
        setSnapMark(mark);
        queue({ kind: 'setCorner', surfaceId: d.surfaceId, index: d.index, point: clampPoint(pt) }, d.gesture);
        break;
      }
      case 'move': {
        // Kleine Zitterbewegungen beim Anklicken nicht als Verschieben werten
        if (!d.moved && Math.hypot(dx * W, dy * H) < 3) return;
        d.moved = true;
        let moved = translateQuad(d.origin, dx, dy);
        let mark: Point | null = null;
        if (useSnap) {
          const s = snapDelta(moved, d.snap, W, H);
          moved = translateQuad(moved, s.dx, s.dy);
          mark = s.target;
        }
        setSnapMark(mark);
        queue({ kind: 'setCorners', surfaceId: d.surfaceId, corners: clampQuad(moved) }, d.gesture);
        break;
      }
      case 'maskPoint': {
        let pt: Point = { x: d.originOut.x + dx, y: d.originOut.y + dy };
        let mark: Point | null = null;
        if (useSnap) ({ point: pt, target: mark } = snapPoint(pt, d.snap, W, H));
        setSnapMark(mark);
        const mp = outToMask(pt, d.surface);
        if (!mp) return;
        const points = [...d.points];
        points[d.index] = mp;
        queue({ kind: 'setMaskPoints', maskId: d.maskId, points }, d.gesture);
        break;
      }
    }
  };

  const onPointerEnd = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setSnapMark(null);
    if (d.kind === 'draw') {
      setDrawPath(null);
      const st = conn.snapshot.state;
      if (!st) return;
      const scope = st.view.maskScope === 'layer' || !st.view.selectedSurfaceId ? 'layer' : 'surface';
      // Freihand: Linie vereinfachen; sonst ein einzelner Startpunkt (weiter per Klick)
      const simplified = d.moved ? simplifyPath(d.path, 2.5, W, H) : [];
      if (simplified.length >= 3) {
        newMask(conn, scope, simplified);
        conn.op({ kind: 'setView', patch: { selectedPoint: null } });
      } else {
        newMask(conn, scope, [d.path[0]!]);
      }
      return;
    }
    if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    flush();
  };

  // --- Mausrad/Trackpad: Pinch (ctrlKey) skaliert, ⌥ + Scrollen dreht. Braucht passive: false.
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
  const surfaces = surfacesOf(project);
  const maskLayers = project.layers.filter((l): l is MaskLayer => l.kind === 'mask');

  const hint =
    view.tool === 'mask'
      ? sel
        ? sel.layer?.locked
          ? 'Ebene gesperrt'
          : 'Klick: Punkt anhängen · Kante: Punkt einfügen · Entf: Punkt löschen · Enter: fertig'
        : view.maskScope === 'layer' || !selected
          ? 'Ziehen: Umriss frei zeichnen · Klick: Punkt für Punkt → neue Masken-Ebene (schneidet alles darunter aus)'
          : `Ziehen: Umriss frei zeichnen · Klick: Punkt für Punkt → neue Maske auf „${selected.name}“`
      : null;

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
      {surfaces.map((s, idx) => {
        if (!s.visible) return null;
        const active = s.id === view.selectedSurfaceId;
        const [cx, cy] = toPx(centroid(s.corners));
        return (
          <g
            key={s.id}
            className={`ed-surface${active ? ' active' : ''}${s.locked ? ' locked' : ''}${view.tool === 'mask' ? ' dim' : ''}`}
          >
            <polygon points={poly(s.corners)} />
            <text x={cx} y={cy} fontSize={font} className="ed-label">
              {idx + 1} · {s.name}
              {s.locked ? ' 🔒' : ''}
            </text>
          </g>
        );
      })}

      {/* Masken-Ebenen sind im Flächen-Werkzeug als Umriss zu sehen */}
      {view.tool === 'surface' &&
        maskLayers.map((m) =>
          m.points.length >= 2 ? (
            <polygon key={m.id} points={poly(m.points)} className={`ed-masklayer ${m.mode}${m.enabled ? '' : ' disabled'}`} />
          ) : null,
        )}

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
      {view.tool === 'surface' &&
        selected &&
        view.selectedCorner !== null &&
        (() => {
          const [x, y] = toPx(selected.corners[view.selectedCorner]);
          return (
            <g className="ed-crosshair" stroke={CORNER_COLORS[view.selectedCorner]}>
              <line x1={0} y1={y} x2={W} y2={y} />
              <line x1={x} y1={0} x2={x} y2={H} />
            </g>
          );
        })()}

      {/* Masken (Farbe zeigt den Modus: grün hinzufügen, rot ausschneiden, gelb Schnittmenge) */}
      {view.tool === 'mask' &&
        maskList.map(({ mask, surface, layer }) => {
          const pts = maskPointsOut(mask, surface);
          if (pts.length === 0) return null;
          const isSel = mask.id === sel?.mask.id;
          const cls = `ed-mask ${layer ? 'layer' : 'surface'} ${mask.mode}${isSel ? ' active' : ''}${mask.enabled ? '' : ' disabled'}`;
          return (
            <g key={mask.id} className={cls}>
              {pts.length >= 3 ? <polygon points={poly(pts)} /> : <polyline points={poly(pts)} />}
              {(isSel ? pts : []).map((q, i) => {
                const [x, y] = toPx(q);
                const r = view.selectedPoint === i ? 7 : 5;
                return (
                  <rect
                    key={i}
                    x={x - r}
                    y={y - r}
                    width={r * 2}
                    height={r * 2}
                    className={view.selectedPoint === i ? 'pt sel' : 'pt'}
                  />
                );
              })}
            </g>
          );
        })}

      {/* Freihand-Linie während des Zeichnens */}
      {drawPath && drawPath.length > 1 && <polyline points={poly(drawPath)} className="ed-draw" />}

      {/* Snap-Anzeige */}
      {snapMark && (
        <g className="ed-snap" transform={`translate(${toPx(snapMark).join(' ')})`}>
          <circle r={11} />
          <line x1={-16} y1={0} x2={16} y2={0} />
          <line x1={0} y1={-16} x2={0} y2={16} />
        </g>
      )}

      {hint && (
        <text x={12} y={font + 8} fontSize={font * 0.8} className="ed-hint">
          {hint}
        </text>
      )}
    </svg>
  );
}
