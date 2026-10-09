import { describe, expect, it } from 'vitest';
import { apply, invert, isConvexQuad, multiply, quadToQuad, squareToQuad, IDENTITY, type Mat3 } from './homography.js';
import type { Point, Quad } from './types.js';

const UNIT: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

// Deutlich perspektivisch verzerrtes Viereck (Trapez mit schiefer Kante)
const PERSP: Quad = [
  { x: 0.1, y: 0.15 },
  { x: 0.85, y: 0.05 },
  { x: 0.7, y: 0.9 },
  { x: 0.2, y: 0.75 },
];

function expectPoint(actual: Point, expected: Point, digits = 9) {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

function expectMat(actual: Mat3, expected: Mat3, digits = 9) {
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, digits));
}

/** Schnittpunkt der Diagonalen q0–q2 und q1–q3 */
function diagonalIntersection(q: Quad): Point {
  const [a, b, c, d] = q;
  const r = { x: c.x - a.x, y: c.y - a.y };
  const s = { x: d.x - b.x, y: d.y - b.y };
  const denom = r.x * s.y - r.y * s.x;
  const t = ((b.x - a.x) * s.y - (b.y - a.y) * s.x) / denom;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

describe('squareToQuad', () => {
  it('liefert die Identität für das Einheitsquadrat', () => {
    const m = squareToQuad(UNIT)!;
    expectMat(m, IDENTITY);
  });

  it('bildet die vier Ecken exakt ab', () => {
    const m = squareToQuad(PERSP)!;
    UNIT.forEach((p, i) => expectPoint(apply(m, p), PERSP[i]!));
  });

  it('bildet die Quadratmitte auf den Diagonalenschnittpunkt ab (echt perspektivisch)', () => {
    const m = squareToQuad(PERSP)!;
    expectPoint(apply(m, { x: 0.5, y: 0.5 }), diagonalIntersection(PERSP));

    // Starkes Trapez: zwei affine Dreiecke würden die Mitte auf den Mittelpunkt
    // der Diagonalen legen – die echte Perspektive verschiebt sie deutlich.
    const trapez: Quad = [
      { x: 0.4, y: 0.1 },
      { x: 0.6, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ];
    const center = apply(squareToQuad(trapez)!, { x: 0.5, y: 0.5 });
    expectPoint(center, diagonalIntersection(trapez));
    const naive = { x: (trapez[0].x + trapez[2].x) / 2, y: (trapez[0].y + trapez[2].y) / 2 };
    expect(Math.hypot(center.x - naive.x, center.y - naive.y)).toBeGreaterThan(0.01);
  });

  it('bildet gerade Linien auf gerade Linien ab (keine Knickkante an der Diagonalen)', () => {
    const m = squareToQuad(PERSP)!;
    // Punkte auf einer Linie im Quellraum, die die Diagonale u = v schneidet
    const pts = [0, 0.25, 0.5, 0.75, 1].map((t) => apply(m, { x: t, y: 0.3 + 0.2 * t }));
    const [p0, , , , p4] = pts;
    for (const p of pts) {
      const cross = (p4!.x - p0!.x) * (p.y - p0!.y) - (p4!.y - p0!.y) * (p.x - p0!.x);
      expect(Math.abs(cross)).toBeLessThan(1e-12);
    }
  });

  it('erzeugt für Parallelogramme eine affine Abbildung (g = h = 0)', () => {
    const para: Quad = [
      { x: 0.1, y: 0.1 },
      { x: 0.6, y: 0.2 },
      { x: 0.7, y: 0.7 },
      { x: 0.2, y: 0.6 },
    ];
    const m = squareToQuad(para)!;
    expect(m[6]).toBeCloseTo(0, 12);
    expect(m[7]).toBeCloseTo(0, 12);
    UNIT.forEach((p, i) => expectPoint(apply(m, p), para[i]!));
  });

  it('erkennt entartete Vierecke', () => {
    const p = { x: 0.5, y: 0.5 };
    expect(squareToQuad([p, p, p, p])).toBeNull();
    const line: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(squareToQuad(line)).toBeNull();
  });
});

describe('invert / multiply', () => {
  it('Inverse ergibt Rundreise Quad → Quadrat → Quad', () => {
    const m = squareToQuad(PERSP)!;
    const inv = invert(m)!;
    for (const uv of [{ x: 0.3, y: 0.7 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.5 }]) {
      expectPoint(apply(inv, apply(m, uv)), uv);
    }
    const prod = multiply(m, inv);
    const s = prod[8];
    expectMat(prod.map((v) => v / s) as Mat3, IDENTITY);
  });

  it('gibt null für singuläre Matrizen zurück', () => {
    expect(invert([1, 2, 3, 2, 4, 6, 0, 0, 1])).toBeNull();
  });
});

describe('quadToQuad', () => {
  it('bildet die Ecken eines Vierecks auf die eines anderen ab', () => {
    const src: Quad = [
      { x: 10, y: 10 },
      { x: 200, y: 30 },
      { x: 180, y: 160 },
      { x: 20, y: 140 },
    ];
    const m = quadToQuad(src, PERSP)!;
    src.forEach((p, i) => expectPoint(apply(m, p), PERSP[i]!));
  });
});

describe('isConvexQuad', () => {
  it('akzeptiert konvexe Vierecke in beiden Umlaufrichtungen', () => {
    expect(isConvexQuad(UNIT)).toBe(true);
    expect(isConvexQuad(PERSP)).toBe(true);
    expect(isConvexQuad([...UNIT].reverse() as Quad)).toBe(true);
  });

  it('lehnt verdrehte und konkave Vierecke ab', () => {
    const bowtie: Quad = [UNIT[0], UNIT[1], UNIT[3], UNIT[2]];
    expect(isConvexQuad(bowtie)).toBe(false);
    const concave: Quad = [UNIT[0], UNIT[1], { x: 0.4, y: 0.4 }, UNIT[3]];
    expect(isConvexQuad(concave)).toBe(false);
  });
});
