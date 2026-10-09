import { describe, expect, it } from 'vitest';
import { apply, squareToQuad } from './homography.js';
import { createMesh, evalMesh, meshCorners, outputToShape, shapeOutline, shapeToOutput, triangleMatrix } from './mesh.js';
import type { Quad } from './types.js';

const Q: Quad = [
  { x: 0.2, y: 0.2 },
  { x: 0.7, y: 0.25 },
  { x: 0.75, y: 0.8 },
  { x: 0.15, y: 0.7 },
];

describe('Mesh', () => {
  it('geht exakt durch alle Kontrollpunkte', () => {
    const h = squareToQuad(Q)!;
    const m = createMesh((u, v) => apply(h, { x: u, y: v }), 4, 3);
    // Einen Punkt „wölben“
    m.points[6] = { x: m.points[6]!.x + 0.05, y: m.points[6]!.y - 0.03 };
    for (let y = 0; y <= m.rows; y++) {
      for (let x = 0; x <= m.cols; x++) {
        const p = evalMesh(m, x / m.cols, y / m.rows);
        const q = m.points[y * (m.cols + 1) + x]!;
        expect(p.x).toBeCloseTo(q.x, 9);
        expect(p.y).toBeCloseTo(q.y, 9);
      }
    }
    expect(meshCorners(m)[2]).toEqual(m.points[m.points.length - 1]);
  });

  it('ein Gitter aus einer Ebene bleibt (fast) eben', () => {
    const h = squareToQuad(Q)!;
    const m = createMesh((u, v) => apply(h, { x: u, y: v }), 6, 6);
    const p = evalMesh(m, 0.37, 0.61);
    const q = apply(h, { x: 0.37, y: 0.61 });
    expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(2e-3);
  });

  it('Ausgaberaum → Inhalt wird numerisch exakt umgekehrt', () => {
    const h = squareToQuad(Q)!;
    const m = createMesh((u, v) => apply(h, { x: u, y: v }), 4, 4);
    m.points[12] = { x: m.points[12]!.x + 0.04, y: m.points[12]!.y + 0.02 };
    const s = { shape: 'mesh' as const, corners: meshCorners(m), mesh: m };
    for (const uv of [{ x: 0.3, y: 0.4 }, { x: 0.8, y: 0.15 }, { x: 0.5, y: 0.5 }]) {
      const back = outputToShape(s, shapeToOutput(s, uv)!)!;
      expect(back.x).toBeCloseTo(uv.x, 6);
      expect(back.y).toBeCloseTo(uv.y, 6);
    }
  });
});

describe('Dreieck und Kreis', () => {
  it('Dreieck: Spitze und Grundlinie liegen auf den Ecken', () => {
    const m = triangleMatrix(Q);
    const a = apply(m, { x: 0.5, y: 0 });
    expect(a.x).toBeCloseTo(Q[0].x, 12);
    expect(a.y).toBeCloseTo(Q[0].y, 12);
    const b = apply(m, { x: 1, y: 1 });
    const c = apply(m, { x: 0, y: 1 });
    expect(b.x).toBeCloseTo(Q[1].x, 12);
    expect(c.y).toBeCloseTo(Q[2].y, 12);
    const s = { shape: 'triangle' as const, corners: Q, mesh: null };
    const back = outputToShape(s, shapeToOutput(s, { x: 0.4, y: 0.7 })!)!;
    expect(back.x).toBeCloseTo(0.4, 9);
    expect(shapeOutline(s)).toHaveLength(3);
  });

  it('Kreis-Umriss liegt im Viereck', () => {
    const pts = shapeOutline({ shape: 'circle', corners: Q, mesh: null });
    expect(pts.length).toBeGreaterThan(20);
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(0.1);
      expect(p.x).toBeLessThan(0.8);
    }
  });
});
