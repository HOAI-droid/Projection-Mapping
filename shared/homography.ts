// Homographie-Mathematik für Corner Pin.
// Matrizen sind 3×3, zeilenweise (row-major) in einem Array der Länge 9 gespeichert:
// [a b c; d e f; g h i]  →  x' = (a·u + b·v + c) / (g·u + h·v + i), y' analog.

import type { Point, Quad } from './types.js';

export type Mat3 = [number, number, number, number, number, number, number, number, number];

const EPS = 1e-12;

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Projektive Abbildung vom Einheitsquadrat auf ein Viereck (Heckbert 1989).
 * Ecken-Reihenfolge: (0,0)→q[0] oben links, (1,0)→q[1] oben rechts,
 * (1,1)→q[2] unten rechts, (0,1)→q[3] unten links.
 * Gibt null zurück, wenn das Viereck entartet ist (drei Punkte auf einer Linie o. ä.).
 */
export function squareToQuad(q: Quad): Mat3 | null {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > EPS || Math.abs(dy3) > EPS) {
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < EPS) return null;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const m: Mat3 = [
    p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x,
    p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y,
    g, h, 1,
  ];
  // Parallelogramm-Fall kann ebenfalls entartet sein (Fläche 0).
  if (Math.abs(determinant(m)) < EPS) return null;
  return m;
}

export function determinant(m: Mat3): number {
  const [a, b, c, d, e, f, g, h, i] = m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/** Inverse über die Adjunkte; null bei singulärer Matrix. */
export function invert(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < EPS) return null;
  const s = 1 / det;
  return [
    A * s, -(b * i - c * h) * s, (b * f - c * e) * s,
    B * s, (a * i - c * g) * s, -(a * f - c * d) * s,
    C * s, -(a * h - b * g) * s, (a * e - b * d) * s,
  ];
}

export function multiply(m: Mat3, n: Mat3): Mat3 {
  const r = new Array<number>(9).fill(0) as Mat3;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += m[row * 3 + k]! * n[k * 3 + col]!;
      r[row * 3 + col] = sum;
    }
  }
  return r;
}

/** Wendet die Homographie auf einen Punkt an (inkl. perspektivischer Division). */
export function apply(m: Mat3, p: Point): Point {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return {
    x: (m[0] * p.x + m[1] * p.y + m[2]) / w,
    y: (m[3] * p.x + m[4] * p.y + m[5]) / w,
  };
}

/** Allgemeine Abbildung Viereck → Viereck. */
export function quadToQuad(src: Quad, dst: Quad): Mat3 | null {
  const a = squareToQuad(src);
  const b = squareToQuad(dst);
  if (!a || !b) return null;
  const aInv = invert(a);
  if (!aInv) return null;
  return multiply(b, aInv);
}

/** Skaliert die Matrix so, dass m[8] = 1 (falls möglich) – nur zur Normalisierung. */
export function normalize(m: Mat3): Mat3 {
  const s = Math.abs(m[8]) > EPS ? 1 / m[8] : 1;
  return m.map((v) => v * s) as Mat3;
}

/**
 * Prüft, ob das Viereck konvex und nicht verdreht ist. Nur dann ist die
 * Corner-Pin-Abbildung sinnvoll (sonst „klappt“ das Bild um).
 */
export function isConvexQuad(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % 4]!;
    const c = q[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < EPS) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
