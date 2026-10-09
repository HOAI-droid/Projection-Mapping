// Einrasten (Snap): Punkte fangen sich an Ecken anderer Flächen, an Maskenpunkten,
// an Kanten und am Bildrand. Gerechnet wird in Bildschirmpixeln, damit sich der
// Fangradius auf Bühne und Beamer gleich anfühlt.

import { distToSegment } from '../../../../shared/geometry.js';
import type { AppState, Point } from '../../../../shared/types.js';
import { maskPointsOut } from './actions';

export const SNAP_RADIUS_PX = 12;

export interface SnapTargets {
  points: Point[];
  segments: [Point, Point][];
}

const FRAME: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/**
 * Sammelt Fangziele. exclude: Fläche bzw. Maske, die gerade bewegt wird
 * (deren eigene Punkte bewegen sich mit und taugen nicht als Ziel).
 */
export function snapTargets(state: AppState, exclude: { surfaceId?: string; maskId?: string }): SnapTargets {
  const points: Point[] = [...FRAME];
  const segments: [Point, Point][] = FRAME.map((p, i) => [p, FRAME[(i + 1) % 4]!]);
  const poly = (pts: Point[]) => {
    points.push(...pts);
    if (pts.length >= 2) pts.forEach((p, i) => segments.push([p, pts[(i + 1) % pts.length]!]));
  };
  for (const l of state.project.layers) {
    if (l.kind === 'mask') {
      if (l.id !== exclude.maskId && l.enabled) poly(l.points);
      continue;
    }
    if (!l.visible || l.id === exclude.surfaceId) continue;
    poly([...l.corners]);
    for (const m of l.masks) if (m.id !== exclude.maskId && m.enabled) poly(maskPointsOut(m, l));
  }
  return { points, segments };
}

/** Rastet p ein (zuerst an Punkten, dann an Kanten). target = Fangpunkt für die Anzeige. */
export function snapPoint(p: Point, t: SnapTargets, W: number, H: number): { point: Point; target: Point | null } {
  const px = (q: Point) => ({ x: q.x * W, y: q.y * H });
  const pp = px(p);
  let best: Point | null = null;
  let bestD = SNAP_RADIUS_PX;
  for (const q of t.points) {
    const d = Math.hypot(q.x * W - pp.x, q.y * H - pp.y);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  if (best) return { point: best, target: best };

  bestD = SNAP_RADIUS_PX * 0.7;
  for (const [a, b] of t.segments) {
    const r = distToSegment(pp, px(a), px(b));
    if (r.dist < bestD) {
      bestD = r.dist;
      best = { x: a.x + (b.x - a.x) * r.t, y: a.y + (b.y - a.y) * r.t };
    }
  }
  return best ? { point: best, target: best } : { point: p, target: null };
}

/**
 * Für das Verschieben ganzer Flächen: Korrektur, damit die nächstgelegene Ecke einrastet.
 */
export function snapDelta(corners: Point[], t: SnapTargets, W: number, H: number): { dx: number; dy: number; target: Point | null } {
  let best: { dx: number; dy: number; target: Point } | null = null;
  let bestD = SNAP_RADIUS_PX;
  for (const c of corners) {
    for (const q of t.points) {
      const d = Math.hypot((q.x - c.x) * W, (q.y - c.y) * H);
      if (d < bestD) {
        bestD = d;
        best = { dx: q.x - c.x, dy: q.y - c.y, target: q };
      }
    }
  }
  return best ?? { dx: 0, dy: 0, target: null };
}

/** Ramer-Douglas-Peucker: vereinfacht eine Freihand-Linie auf die wesentlichen Punkte. */
export function simplifyPath(pts: Point[], epsilonPx: number, W: number, H: number): Point[] {
  if (pts.length < 3) return pts;
  const px = pts.map((p) => ({ x: p.x * W, y: p.y * H }));
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(px[i]!, px[a]!, px[b]!).dist;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > epsilonPx) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
