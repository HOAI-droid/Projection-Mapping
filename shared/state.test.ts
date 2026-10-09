import { describe, expect, it } from 'vitest';
import { applyOp, createProject, defaultView, parseOp, parseProject } from './state.js';
import type { AppState } from './types.js';

function initial(): AppState {
  return { project: createProject('Test', 's1'), view: defaultView() };
}

describe('applyOp', () => {
  it('verschiebt eine Ecke, ohne den alten Zustand zu verändern', () => {
    const s0 = initial();
    const s1 = applyOp(s0, { kind: 'setCorner', surfaceId: 's1', index: 2, point: { x: 0.9, y: 0.95 } });
    expect(s1.project.surfaces[0]!.corners[2]).toEqual({ x: 0.9, y: 0.95 });
    expect(s0.project.surfaces[0]!.corners[2]).toEqual({ x: 0.8, y: 0.8 });
  });

  it('ignoriert unbekannte Flächen', () => {
    const s0 = initial();
    expect(applyOp(s0, { kind: 'setCorner', surfaceId: 'nope', index: 0, point: { x: 0, y: 0 } })).toBe(s0);
  });

  it('patcht Video-Einstellungen nur bei Videoinhalt', () => {
    let s = initial();
    s = applyOp(s, { kind: 'patchVideo', surfaceId: 's1', patch: { playing: false } });
    expect(s.project.surfaces[0]!.content).toEqual({ type: 'testgrid' });
    s = applyOp(s, {
      kind: 'setContent',
      surfaceId: 's1',
      content: { type: 'video', mediaId: 'm1', loop: true, speed: 1, playing: true },
    });
    s = applyOp(s, { kind: 'patchVideo', surfaceId: 's1', patch: { playing: false, speed: 2 } });
    expect(s.project.surfaces[0]!.content).toMatchObject({ playing: false, speed: 2, loop: true });
  });
});

describe('parseOp', () => {
  it('lehnt ungültige Daten ab', () => {
    expect(parseOp(null)).toBeNull();
    expect(parseOp({ kind: 'setCorner', surfaceId: 's1', index: 4, point: { x: 0, y: 0 } })).toBeNull();
    expect(parseOp({ kind: 'setCorner', surfaceId: 's1', index: 0, point: { x: NaN, y: 0 } })).toBeNull();
    expect(parseOp({ kind: 'setContent', surfaceId: '../etc', content: { type: 'none' } })).toBeNull();
    expect(parseOp({ kind: 'explode' })).toBeNull();
  });

  it('begrenzt Werte auf sinnvolle Bereiche', () => {
    const op = parseOp({ kind: 'setCorner', surfaceId: 's1', index: 1, point: { x: 99, y: -99 } });
    expect(op).toEqual({ kind: 'setCorner', surfaceId: 's1', index: 1, point: { x: 2, y: -1 } });
    const v = parseOp({ kind: 'patchVideo', surfaceId: 's1', patch: { speed: 100 } });
    expect(v).toEqual({ kind: 'patchVideo', surfaceId: 's1', patch: { speed: 4 } });
  });
});

describe('parseProject', () => {
  it('liest ein gespeichertes Projekt wieder ein', () => {
    const p = createProject('Kiste', 'abc');
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});
