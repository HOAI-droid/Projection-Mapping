import { describe, expect, it } from 'vitest';
import { applyOp, createMask, createProject, createSurface, defaultView, findMask, parseOp, parseProject } from './state.js';
import type { AppState } from './types.js';

function initial(): AppState {
  return { project: createProject('Test', 's1'), view: defaultView() };
}

describe('applyOp', () => {
  it('verschiebt eine Ecke, ohne den alten Zustand zu verändern', () => {
    const s0 = initial();
    const s1 = applyOp(s0, { kind: 'setCorner', surfaceId: 's1', index: 2, point: { x: 0.9, y: 0.95 } });
    expect(s1.project.surfaces[0]!.corners[2]).toEqual({ x: 0.9, y: 0.95 });
    expect(s0.project.surfaces[0]!.corners[2]).toEqual({ x: 0.7, y: 0.75 });
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

describe('Flächen und Masken', () => {
  it('fügt Flächen ein, verschiebt Ebenen und löscht', () => {
    let s = initial();
    s = applyOp(s, { kind: 'addSurface', surface: createSurface('s2', 'Zwei'), index: 1 });
    s = applyOp(s, { kind: 'addSurface', surface: createSurface('s3', 'Drei'), index: 0 });
    expect(s.project.surfaces.map((x) => x.id)).toEqual(['s3', 's1', 's2']);
    s = applyOp(s, { kind: 'moveSurface', surfaceId: 's3', index: 2 });
    expect(s.project.surfaces.map((x) => x.id)).toEqual(['s1', 's2', 's3']);
    s = applyOp(s, { kind: 'removeSurface', surfaceId: 's2' });
    expect(s.project.surfaces.map((x) => x.id)).toEqual(['s1', 's3']);
  });

  it('weist doppelte IDs ab', () => {
    const s0 = initial();
    expect(applyOp(s0, { kind: 'addSurface', surface: createSurface('s1', 'Doppelt'), index: 0 })).toBe(s0);
  });

  it('verwaltet globale und Flächenmasken', () => {
    let s = initial();
    s = applyOp(s, { kind: 'addMask', surfaceId: null, mask: createMask('g1', 'Global') });
    s = applyOp(s, { kind: 'addMask', surfaceId: 's1', mask: createMask('m1', 'Lokal') });
    expect(findMask(s.project, 'g1')?.surface).toBeNull();
    expect(findMask(s.project, 'm1')?.surface?.id).toBe('s1');

    const pts = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }];
    s = applyOp(s, { kind: 'setMaskPoints', maskId: 'm1', points: pts });
    s = applyOp(s, { kind: 'updateMask', maskId: 'm1', patch: { invert: true, feather: 12 } });
    expect(findMask(s.project, 'm1')?.mask).toMatchObject({ points: pts, invert: true, feather: 12 });

    s = applyOp(s, { kind: 'removeMask', maskId: 'm1' });
    s = applyOp(s, { kind: 'removeMask', maskId: 'g1' });
    expect(s.project.masks).toEqual([]);
    expect(s.project.surfaces[0]!.masks).toEqual([]);
  });
});

describe('Validierung neuer Operationen', () => {
  it('prüft Farben, Mischmodi und Maskenwerte', () => {
    expect(parseOp({ kind: 'setContent', surfaceId: 's1', content: { type: 'color', color: 'red' } })).toBeNull();
    expect(parseOp({ kind: 'setContent', surfaceId: 's1', content: { type: 'color', color: '#FF0000' } })).toEqual({
      kind: 'setContent',
      surfaceId: 's1',
      content: { type: 'color', color: '#ff0000' },
    });
    expect(parseOp({ kind: 'updateSurface', surfaceId: 's1', patch: { blend: 'nonsense', opacity: 3 } })).toEqual({
      kind: 'updateSurface',
      surfaceId: 's1',
      patch: { opacity: 1 },
    });
    expect(parseOp({ kind: 'updateMask', maskId: 'm1', patch: { feather: 9999 } })).toEqual({
      kind: 'updateMask',
      maskId: 'm1',
      patch: { feather: 200 },
    });
    expect(parseOp({ kind: 'addMask', surfaceId: '../x', mask: createMask('m1', 'x') })).toBeNull();
    expect(parseOp({ kind: 'setMaskPoints', maskId: 'm1', points: new Array(501).fill({ x: 0, y: 0 }) })).toBeNull();
  });

  it('liest Projekte im alten Format 1 ein', () => {
    const v1 = {
      format: 1,
      name: 'Alt',
      surfaces: [{ id: 'a', name: 'A', visible: true, corners: createSurface('a', 'A').corners, content: { type: 'testgrid' } }],
    };
    const p = parseProject(v1)!;
    expect(p.format).toBe(2);
    expect(p.masks).toEqual([]);
    expect(p.surfaces[0]).toMatchObject({ locked: false, opacity: 1, blend: 'normal', fit: 'stretch', masks: [] });
  });
});
