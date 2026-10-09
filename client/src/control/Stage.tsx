// Verkleinerte Ausgabefläche zum Ziehen der Eckpunkte.
// Man muss den Punkt nicht genau treffen: Der Finger greift den nächstgelegenen Eckpunkt
// und bewegt ihn relativ – so verdeckt der Finger nicht die Stelle, die man justiert.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CornerIndex, Point, Surface } from '../../../shared/types.js';
import { POINT_MAX, POINT_MIN } from '../../../shared/state.js';
import { CORNER_COLORS, CORNER_LABELS } from '../lib/colors';
import { conn } from './store';

interface Props {
  surfaces: Surface[];
  activeId: string | null;
  selectedCorner: CornerIndex | null;
  aspect: number;
  /** Faktor für Feinmodus (< 1 = langsamer) */
  sensitivity: number;
}

interface DragState {
  pointerId: number;
  surfaceId: string;
  index: CornerIndex;
  startX: number;
  startY: number;
  origin: Point;
}

interface LocalPoint {
  surfaceId: string;
  index: CornerIndex;
  point: Point;
  released: boolean;
}

const clamp = (v: number) => Math.min(POINT_MAX, Math.max(POINT_MIN, v));

export function Stage({ surfaces, activeId, selectedCorner, aspect, sensitivity }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const drag = useRef<DragState | null>(null);
  const [local, setLocal] = useState<LocalPoint | null>(null);
  const pending = useRef<LocalPoint | null>(null);
  const raf = useRef<number | undefined>(undefined);

  // Bühne mit dem Seitenverhältnis der Ausgabe in den verfügbaren Platz einpassen
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect; // ohne Padding
      let w = width;
      let h = w / aspect;
      if (h > height) {
        h = height;
        w = h * aspect;
      }
      setBox({ w: Math.floor(w), h: Math.floor(h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  // Lokale Vorschau verwerfen, sobald der Server den Endpunkt bestätigt hat
  useEffect(() => {
    if (!local?.released) return;
    const s = surfaces.find((x) => x.id === local.surfaceId);
    const p = s?.corners[local.index];
    const t = window.setTimeout(() => setLocal(null), 1000);
    if (!p || (Math.abs(p.x - local.point.x) < 1e-9 && Math.abs(p.y - local.point.y) < 1e-9)) {
      setLocal(null);
    }
    return () => window.clearTimeout(t);
  }, [surfaces, local]);

  const flush = () => {
    raf.current = undefined;
    const p = pending.current;
    if (p) conn.op({ kind: 'setCorner', surfaceId: p.surfaceId, index: p.index, point: p.point });
  };

  const cornerOf = (s: Surface, i: CornerIndex): Point =>
    local && local.surfaceId === s.id && local.index === i ? local.point : s.corners[i];

  const onPointerDown = (e: React.PointerEvent) => {
    if (drag.current || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    // Nächstgelegenen Eckpunkt suchen; aktive Fläche bevorzugen
    let best: { s: Surface; i: CornerIndex; d: number } | null = null;
    for (const s of surfaces) {
      if (!s.visible) continue;
      for (let i = 0 as CornerIndex; i < 4; i = (i + 1) as CornerIndex) {
        const c = s.corners[i];
        let d = Math.hypot(c.x * rect.width - px, c.y * rect.height - py);
        if (s.id === activeId) d *= 0.7;
        if (!best || d < best.d) best = { s, i, d };
      }
    }
    if (!best) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pointerId: e.pointerId,
      surfaceId: best.s.id,
      index: best.i,
      startX: e.clientX,
      startY: e.clientY,
      origin: best.s.corners[best.i],
    };
    if (best.s.id !== activeId || best.i !== selectedCorner) {
      conn.op({ kind: 'setView', patch: { selectedSurfaceId: best.s.id, selectedCorner: best.i } });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || box.w === 0) return;
    const point = {
      x: clamp(d.origin.x + ((e.clientX - d.startX) / box.w) * sensitivity),
      y: clamp(d.origin.y + ((e.clientY - d.startY) / box.h) * sensitivity),
    };
    const lp = { surfaceId: d.surfaceId, index: d.index, point, released: false };
    setLocal(lp);
    pending.current = lp;
    // Höchstens ein Update pro Bildschirmbild senden
    if (raf.current === undefined) raf.current = requestAnimationFrame(flush);
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (raf.current !== undefined) cancelAnimationFrame(raf.current);
    flush();
    pending.current = null;
    setLocal((l) => (l ? { ...l, released: true } : null));
  };

  const W = box.w;
  const H = box.h;

  return (
    <div className="stage-wrap" ref={wrapRef}>
      <div
        className="stage"
        ref={stageRef}
        style={{ width: W, height: H }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {W > 0 && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            {Array.from({ length: 9 }, (_, i) => (
              <line key={`v${i}`} x1={((i + 1) * W) / 10} y1={0} x2={((i + 1) * W) / 10} y2={H} className="grid" />
            ))}
            {Array.from({ length: 9 }, (_, i) => (
              <line key={`h${i}`} x1={0} y1={((i + 1) * H) / 10} x2={W} y2={((i + 1) * H) / 10} className="grid" />
            ))}
            {surfaces.map((s, si) => {
              if (!s.visible) return null;
              const pts = ([0, 1, 2, 3] as CornerIndex[]).map((i) => cornerOf(s, i));
              const active = s.id === activeId;
              const cx = (pts.reduce((a, p) => a + p.x, 0) / 4) * W;
              const cy = (pts.reduce((a, p) => a + p.y, 0) / 4) * H;
              return (
                <g key={s.id} className={active ? 'surface active' : 'surface'}>
                  <polygon points={pts.map((p) => `${p.x * W},${p.y * H}`).join(' ')} />
                  <text x={cx} y={cy} className="surface-label">
                    {si + 1}
                  </text>
                  {pts.map((p, i) => (
                    <g key={i} transform={`translate(${p.x * W} ${p.y * H})`}>
                      {active && selectedCorner === i && <circle r={18} className="corner-ring" />}
                      <circle r={11} fill={CORNER_COLORS[i]} className="corner" />
                      <text className="corner-label" dy="0.35em">
                        {CORNER_LABELS[i]}
                      </text>
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
