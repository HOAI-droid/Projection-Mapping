// Geometrie-Helfer für Flächen und Masken.
// Drehen/Skalieren rechnet in Ausgabepixeln (aspect = Breite/Höhe), damit
// eine Drehung auf einem 16:9-Bild nicht verzerrt.

import { apply, invert, squareToQuad } from './homography.js';
import type { Point, Quad } from './types.js';

export function centroid(pts: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

export function translateQuad(q: Quad, dx: number, dy: number): Quad {
  return q.map((p) => ({ x: p.x + dx, y: p.y + dy })) as Quad;
}

export function scaleQuad(q: Quad, factor: number): Quad {
  const c = centroid(q);
  return q.map((p) => ({ x: c.x + (p.x - c.x) * factor, y: c.y + (p.y - c.y) * factor })) as Quad;
}

export function rotateQuad(q: Quad, radians: number, aspect: number): Quad {
  const c = centroid(q);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return q.map((p) => {
    const dx = (p.x - c.x) * aspect;
    const dy = p.y - c.y;
    return { x: c.x + (dx * cos - dy * sin) / aspect, y: c.y + dx * sin + dy * cos };
  }) as Quad;
}

/** Inhaltskoordinate (u,v) einer Fläche → Ausgaberaum */
export function surfaceToOutput(corners: Quad, uv: Point): Point | null {
  const h = squareToQuad(corners);
  return h ? apply(h, uv) : null;
}

/** Ausgaberaum → Inhaltskoordinate (u,v) einer Fläche */
export function outputToSurface(corners: Quad, p: Point): Point | null {
  const h = squareToQuad(corners);
  const inv = h && invert(h);
  return inv ? apply(inv, p) : null;
}

/** Punkt-in-Polygon (Even-odd-Regel) */
export function pointInPolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Abstand Punkt–Strecke und Parameter t (0…1) des nächsten Punkts */
export function distToSegment(p: Point, a: Point, b: Point): { dist: number; t: number } {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
  const x = a.x + t * vx;
  const y = a.y + t * vy;
  return { dist: Math.hypot(p.x - x, p.y - y), t };
}

/** Mittlere Kantenlänge einer Fläche in Pixeln (für Feather-Umrechnung und Seitenverhältnis). */
export function quadPixelSize(q: Quad, width: number, height: number): { w: number; h: number } {
  const len = (a: Point, b: Point) => Math.hypot((b.x - a.x) * width, (b.y - a.y) * height);
  return {
    w: (len(q[0], q[1]) + len(q[3], q[2])) / 2,
    h: (len(q[0], q[3]) + len(q[1], q[2])) / 2,
  };
}
