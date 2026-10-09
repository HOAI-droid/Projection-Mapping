// Verzerrungsgitter (Mesh-Warp) und Abbildungen für alle Flächenformen.
//
// Jede Fläche bildet ihren Inhaltsraum (u,v ∈ 0…1) auf den Ausgaberaum ab:
//   Viereck/Kreis: Homographie aus den 4 Ecken (Kreis = Scheibe im Inhaltsraum)
//   Dreieck:       affin, Spitze (0.5,0) → Ecke 0, (1,1) → Ecke 1, (0,1) → Ecke 2
//   Mesh:          bikubische Catmull-Rom-Interpolation über das Kontrollgitter

import { apply, invert, squareToQuad, type Mat3 } from './homography.js';
import type { Mesh, Point, Quad, Shape } from './types.js';

export const MESH_MAX = 16;

interface ShapeLike {
  shape: Shape;
  corners: Quad;
  mesh: Mesh | null;
}

// --- Dreieck

/** Affine Matrix Inhalt → Ausgabe für ein Dreieck aus den Ecken 0–2 */
export function triangleMatrix(c: Quad): Mat3 {
  const [a, b, d] = c; // Spitze, unten rechts, unten links
  const col0 = { x: b.x - d.x, y: b.y - d.y };
  const col1 = { x: 0.5 * col0.x - (a.x - d.x), y: 0.5 * col0.y - (a.y - d.y) };
  const off = { x: d.x - col1.x, y: d.y - col1.y };
  return [col0.x, col1.x, off.x, col0.y, col1.y, off.y, 0, 0, 1];
}

// --- Mesh

function gridPoint(m: Mesh, ix: number, iy: number): Point {
  // Außerhalb des Gitters linear fortsetzen (für die Randzellen der Interpolation)
  if (ix < 0) return lerpOut(gridPoint(m, 0, iy), gridPoint(m, 1, iy));
  if (ix > m.cols) return lerpOut(gridPoint(m, m.cols, iy), gridPoint(m, m.cols - 1, iy));
  if (iy < 0) return lerpOut(gridPoint(m, ix, 0), gridPoint(m, ix, 1));
  if (iy > m.rows) return lerpOut(gridPoint(m, ix, m.rows), gridPoint(m, ix, m.rows - 1));
  return m.points[iy * (m.cols + 1) + ix]!;
}

function lerpOut(edge: Point, inner: Point): Point {
  return { x: 2 * edge.x - inner.x, y: 2 * edge.y - inner.y };
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Punkt des Meshs bei (u,v) – weich interpoliert und exakt durch alle Kontrollpunkte */
export function evalMesh(m: Mesh, u: number, v: number): Point {
  const fx = Math.min(Math.max(u, 0), 1) * m.cols;
  const fy = Math.min(Math.max(v, 0), 1) * m.rows;
  const ix = Math.min(Math.floor(fx), m.cols - 1);
  const iy = Math.min(Math.floor(fy), m.rows - 1);
  const s = fx - ix;
  const t = fy - iy;
  const row = (y: number) => {
    const a = gridPoint(m, ix - 1, y);
    const b = gridPoint(m, ix, y);
    const c = gridPoint(m, ix + 1, y);
    const d = gridPoint(m, ix + 2, y);
    return { x: catmull(a.x, b.x, c.x, d.x, s), y: catmull(a.y, b.y, c.y, d.y, s) };
  };
  const r0 = row(iy - 1);
  const r1 = row(iy);
  const r2 = row(iy + 1);
  const r3 = row(iy + 2);
  return { x: catmull(r0.x, r1.x, r2.x, r3.x, t), y: catmull(r0.y, r1.y, r2.y, r3.y, t) };
}

/** Neues Gitter, das eine bestehende Abbildung nachbildet (beim Umschalten oder Ändern der Auflösung) */
export function createMesh(map: (u: number, v: number) => Point, cols: number, rows: number): Mesh {
  const points: Point[] = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) points.push(map(x / cols, y / rows));
  return { cols, rows, points };
}

/** Indizes der vier Gitter-Ecken (oben links, oben rechts, unten rechts, unten links) */
export function meshCornerIndices(m: Pick<Mesh, 'cols' | 'rows'>): [number, number, number, number] {
  const w = m.cols + 1;
  return [0, m.cols, m.rows * w + m.cols, m.rows * w];
}

export function meshCorners(m: Mesh): Quad {
  return meshCornerIndices(m).map((i) => m.points[i]!) as Quad;
}

/**
 * Feines Dreiecksnetz für die Darstellung: pro Zelle sub×sub Teilquadrate.
 * Liefert Positionen (Ausgaberaum) und uv als flache Arrays (6 Ecken je Teilquadrat).
 */
export function tessellateMesh(m: Mesh, sub = 8): { pos: Float32Array; uv: Float32Array } {
  const nx = m.cols * sub;
  const ny = m.rows * sub;
  const grid: Point[] = [];
  for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) grid.push(evalMesh(m, x / nx, y / ny));
  const pos = new Float32Array(nx * ny * 12);
  const uv = new Float32Array(nx * ny * 12);
  let k = 0;
  const push = (x: number, y: number) => {
    const p = grid[y * (nx + 1) + x]!;
    pos[k] = p.x;
    pos[k + 1] = p.y;
    uv[k] = x / nx;
    uv[k + 1] = y / ny;
    k += 2;
  };
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      push(x, y);
      push(x + 1, y);
      push(x, y + 1);
      push(x, y + 1);
      push(x + 1, y);
      push(x + 1, y + 1);
    }
  }
  return { pos, uv };
}

// --- Allgemein für alle Formen

/** Inhaltskoordinate → Ausgaberaum */
export function shapeToOutput(s: ShapeLike, uv: Point): Point | null {
  switch (s.shape) {
    case 'triangle':
      return apply(triangleMatrix(s.corners), uv);
    case 'mesh':
      return s.mesh ? evalMesh(s.mesh, uv.x, uv.y) : null;
    default: {
      const h = squareToQuad(s.corners);
      return h ? apply(h, uv) : null;
    }
  }
}

/** Ausgaberaum → Inhaltskoordinate (beim Mesh numerisch per Newton-Verfahren) */
export function outputToShape(s: ShapeLike, p: Point): Point | null {
  if (s.shape === 'triangle') {
    const inv = invert(triangleMatrix(s.corners));
    return inv ? apply(inv, p) : null;
  }
  const h = squareToQuad(s.corners);
  const hinv = h && invert(h);
  let uv = hinv ? apply(hinv, p) : { x: 0.5, y: 0.5 };
  if (s.shape !== 'mesh' || !s.mesh) return hinv ? uv : null;

  const m = s.mesh;
  const e = 1e-4;
  for (let i = 0; i < 20; i++) {
    const f = evalMesh(m, uv.x, uv.y);
    const rx = f.x - p.x;
    const ry = f.y - p.y;
    if (Math.hypot(rx, ry) < 1e-7) break;
    const fu = evalMesh(m, uv.x + e, uv.y);
    const fv = evalMesh(m, uv.x, uv.y + e);
    const a = (fu.x - f.x) / e;
    const b = (fv.x - f.x) / e;
    const c = (fu.y - f.y) / e;
    const d = (fv.y - f.y) / e;
    const det = a * d - b * c;
    if (Math.abs(det) < 1e-12) break;
    uv = { x: uv.x - (d * rx - b * ry) / det, y: uv.y - (-c * rx + a * ry) / det };
  }
  return uv;
}

/** Umriss der Fläche im Ausgaberaum (für Treffer, Snap und Darstellung) */
export function shapeOutline(s: ShapeLike): Point[] {
  switch (s.shape) {
    case 'triangle':
      return [s.corners[0], s.corners[1], s.corners[2]];
    case 'circle': {
      const h = squareToQuad(s.corners);
      if (!h) return [...s.corners];
      const pts: Point[] = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        pts.push(apply(h, { x: 0.5 + 0.5 * Math.cos(a), y: 0.5 + 0.5 * Math.sin(a) }));
      }
      return pts;
    }
    case 'mesh': {
      if (!s.mesh) return [...s.corners];
      const m = s.mesh;
      const pts: Point[] = [];
      const n = 6;
      const nx = m.cols * n;
      const ny = m.rows * n;
      for (let i = 0; i < nx; i++) pts.push(evalMesh(m, i / nx, 0));
      for (let i = 0; i < ny; i++) pts.push(evalMesh(m, 1, i / ny));
      for (let i = nx; i > 0; i--) pts.push(evalMesh(m, i / nx, 1));
      for (let i = ny; i > 0; i--) pts.push(evalMesh(m, 0, i / ny));
      return pts;
    }
    default:
      return [...s.corners];
  }
}

/** Ecken, die als Griffe erscheinen (Dreieck: 3) */
export function shapeHandleCount(shape: Shape): number {
  return shape === 'triangle' ? 3 : 4;
}
