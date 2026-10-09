import { describe, expect, it } from 'vitest';
import { outputToSurface, pointInPolygon, quadPixelSize, rotateQuad, scaleQuad, surfaceToOutput } from './geometry.js';
import type { Quad } from './types.js';

const Q: Quad = [
  { x: 0.2, y: 0.2 },
  { x: 0.6, y: 0.25 },
  { x: 0.65, y: 0.7 },
  { x: 0.15, y: 0.6 },
];

describe('geometry', () => {
  it('Flächen- und Ausgaberaum sind zueinander invers', () => {
    const uv = { x: 0.3, y: 0.8 };
    const back = outputToSurface(Q, surfaceToOutput(Q, uv)!)!;
    expect(back.x).toBeCloseTo(uv.x, 9);
    expect(back.y).toBeCloseTo(uv.y, 9);
  });

  it('Drehen um 90° in Pixeln erhält die Kantenlängen', () => {
    const square: Quad = [
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.4 },
      { x: 0.6, y: 0.6 },
      { x: 0.4, y: 0.6 },
    ];
    const before = quadPixelSize(square, 1600, 900);
    const after = quadPixelSize(rotateQuad(square, Math.PI / 2, 1600 / 900), 1600, 900);
    // Jede Kante behält ihre Pixellänge → keine Verzerrung durch das 16:9-Format.
    // (Würde man im normierten Raum drehen, wäre die 320-px-Kante danach nur 180 px lang.)
    expect(after.w).toBeCloseTo(before.w, 6);
    expect(after.h).toBeCloseTo(before.h, 6);
    expect(before.w).not.toBeCloseTo(before.h, 0);
  });

  it('Skalieren hält den Schwerpunkt fest', () => {
    const s = scaleQuad(Q, 2);
    const c0 = Q.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
    const c1 = s.reduce((a, p) => ({ x: a.x + p.x / 4, y: a.y + p.y / 4 }), { x: 0, y: 0 });
    expect(c1.x).toBeCloseTo(c0.x, 12);
    expect(c1.y).toBeCloseTo(c0.y, 12);
  });

  it('Punkt-in-Polygon', () => {
    expect(pointInPolygon({ x: 0.4, y: 0.4 }, Q)).toBe(true);
    expect(pointInPolygon({ x: 0.9, y: 0.4 }, Q)).toBe(false);
  });
});
