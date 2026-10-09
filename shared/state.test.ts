import { describe, expect, it } from 'vitest';
import { EFFECTS, defaultParams } from './effects.js';
import {
  applyOp,
  createMask,
  createMaskLayer,
  createProject,
  createSurface,
  defaultView,
  findMask,
  parseOp,
  parseProject,
  surfacesOf,
} from './state.js';
import type { AppState, Surface } from './types.js';

function initial(): AppState {
  return { project: createProject('Test', 's1'), view: defaultView() };
}
const surface0 = (s: AppState) => s.project.layers[0] as Surface;

describe('applyOp', () => {
  it('verschiebt eine Ecke, ohne den alten Zustand zu verändern', () => {
    const s0 = initial();
    const s1 = applyOp(s0, { kind: 'setCorner', surfaceId: 's1', index: 2, point: { x: 0.9, y: 0.95 } });
    expect(surface0(s1).corners[2]).toEqual({ x: 0.9, y: 0.95 });
    expect(surface0(s0).corners[2]).toEqual({ x: 0.7, y: 0.75 });
  });

  it('ignoriert unbekannte Flächen', () => {
    const s0 = initial();
    expect(applyOp(s0, { kind: 'setCorner', surfaceId: 'nope', index: 0, point: { x: 0, y: 0 } })).toBe(s0);
  });

  it('patcht Video-Einstellungen nur bei Videoinhalt', () => {
    let s = initial();
    s = applyOp(s, { kind: 'patchVideo', surfaceId: 's1', patch: { playing: false } });
    expect(surface0(s).content).toEqual({ type: 'testgrid' });
    s = applyOp(s, {
      kind: 'setContent',
      surfaceId: 's1',
      content: { type: 'video', mediaId: 'm1', loop: true, speed: 1, playing: true },
    });
    s = applyOp(s, { kind: 'patchVideo', surfaceId: 's1', patch: { playing: false, speed: 2 } });
    expect(surface0(s).content).toMatchObject({ playing: false, speed: 2, loop: true });
  });

  it('ändert einzelne Effekt-Parameter, ohne andere zu überschreiben', () => {
    const fire = EFFECTS.find((e) => e.id === 'fire')!;
    let s = initial();
    s = applyOp(s, { kind: 'setContent', surfaceId: 's1', content: { type: 'effect', effect: 'fire', params: defaultParams(fire) } });
    s = applyOp(s, { kind: 'patchEffect', surfaceId: 's1', effect: 'fire', params: { speed: 2.5 } });
    // Patch für einen anderen Effekt wird ignoriert
    s = applyOp(s, { kind: 'patchEffect', surfaceId: 's1', effect: 'strobe', params: { speed: 0 } });
    const c = surface0(s).content;
    expect(c.type === 'effect' && c.params).toMatchObject({ speed: 2.5, height: 0.75 });
  });
});

describe('Ebenen und Masken', () => {
  it('fügt Ebenen ein, verschiebt und löscht sie', () => {
    let s = initial();
    s = applyOp(s, { kind: 'addLayer', layer: createSurface('s2', 'Zwei'), index: 1 });
    s = applyOp(s, { kind: 'addLayer', layer: createMaskLayer('m1', 'Ausschnitt'), index: 1 });
    expect(s.project.layers.map((x) => x.id)).toEqual(['s1', 'm1', 's2']);
    s = applyOp(s, { kind: 'moveLayer', layerId: 'm1', index: 2 });
    expect(s.project.layers.map((x) => x.id)).toEqual(['s1', 's2', 'm1']);
    s = applyOp(s, { kind: 'removeLayer', layerId: 's2' });
    expect(s.project.layers.map((x) => x.id)).toEqual(['s1', 'm1']);
    expect(surfacesOf(s.project).map((x) => x.id)).toEqual(['s1']);
  });

  it('weist doppelte IDs ab', () => {
    const s0 = initial();
    expect(applyOp(s0, { kind: 'addLayer', layer: createSurface('s1', 'Doppelt'), index: 0 })).toBe(s0);
  });

  it('verwaltet den Masken-Stapel einer Fläche (Masken auf Masken)', () => {
    let s = initial();
    s = applyOp(s, { kind: 'addMask', surfaceId: 's1', mask: createMask('a', 'Umriss', [], 'add') });
    s = applyOp(s, { kind: 'addMask', surfaceId: 's1', mask: createMask('b', 'Fenster', [], 'subtract') });
    s = applyOp(s, { kind: 'addMask', surfaceId: 's1', mask: createMask('c', 'Kreuz', [], 'add') });
    expect(surface0(s).masks.map((m) => m.mode)).toEqual(['add', 'subtract', 'add']);
    s = applyOp(s, { kind: 'moveMask', maskId: 'c', index: 0 });
    expect(surface0(s).masks.map((m) => m.id)).toEqual(['c', 'a', 'b']);

    const pts = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }];
    s = applyOp(s, { kind: 'setMaskPoints', maskId: 'b', points: pts });
    s = applyOp(s, { kind: 'updateMask', maskId: 'b', patch: { mode: 'intersect', feather: 12, locked: true } });
    const b = findMask(s.project, 'b')!;
    expect(b.surface?.id).toBe('s1');
    expect(b.mask).toEqual({ id: 'b', name: 'Fenster', points: pts, mode: 'intersect', feather: 12, enabled: true });

    s = applyOp(s, { kind: 'removeMask', maskId: 'b' });
    expect(surface0(s).masks.map((m) => m.id)).toEqual(['c', 'a']);
  });

  it('Masken-Ebenen lassen sich wie Masken bearbeiten', () => {
    let s = initial();
    s = applyOp(s, { kind: 'addLayer', layer: createMaskLayer('ml', 'Ebene'), index: 1 });
    s = applyOp(s, { kind: 'setMaskPoints', maskId: 'ml', points: [{ x: 0, y: 0 }] });
    s = applyOp(s, { kind: 'updateMask', maskId: 'ml', patch: { locked: true, mode: 'intersect' } });
    expect(findMask(s.project, 'ml')?.layer).toMatchObject({ locked: true, mode: 'intersect', points: [{ x: 0, y: 0 }] });
    s = applyOp(s, { kind: 'removeMask', maskId: 'ml' });
    expect(s.project.layers).toHaveLength(1);
  });
});

describe('Validierung', () => {
  it('lehnt ungültige Daten ab', () => {
    expect(parseOp(null)).toBeNull();
    expect(parseOp({ kind: 'setCorner', surfaceId: 's1', index: 4, point: { x: 0, y: 0 } })).toBeNull();
    expect(parseOp({ kind: 'setCorner', surfaceId: 's1', index: 0, point: { x: NaN, y: 0 } })).toBeNull();
    expect(parseOp({ kind: 'setContent', surfaceId: '../etc', content: { type: 'none' } })).toBeNull();
    expect(parseOp({ kind: 'explode' })).toBeNull();
    expect(parseOp({ kind: 'setContent', surfaceId: 's1', content: { type: 'effect', effect: 'gibtsnicht' } })).toBeNull();
    expect(parseOp({ kind: 'setMaskPoints', maskId: 'm1', points: new Array(2001).fill({ x: 0, y: 0 }) })).toBeNull();
  });

  it('begrenzt Werte auf sinnvolle Bereiche', () => {
    expect(parseOp({ kind: 'setCorner', surfaceId: 's1', index: 1, point: { x: 99, y: -99 } })).toEqual({
      kind: 'setCorner',
      surfaceId: 's1',
      index: 1,
      point: { x: 2, y: -1 },
    });
    expect(parseOp({ kind: 'updateSurface', surfaceId: 's1', patch: { blend: 'nonsense', opacity: 3 } })).toEqual({
      kind: 'updateSurface',
      surfaceId: 's1',
      patch: { opacity: 1 },
    });
    expect(parseOp({ kind: 'setView', patch: { grid: { enabled: true, thickness: 999, cols: 0 } } })).toMatchObject({
      patch: { grid: { enabled: true, thickness: 30, cols: 1 } },
    });
  });

  it('prüft Effekt-Parameter gegen die Definition (Strobe max. 12 Hz)', () => {
    const op = parseOp({
      kind: 'setContent',
      surfaceId: 's1',
      content: { type: 'effect', effect: 'strobe', params: { freq: 50, color: 'rot', unbekannt: 1 } },
    });
    expect(op).toMatchObject({ content: { type: 'effect', effect: 'strobe', params: { freq: 12, duty: 0.15, color: '#ffffff' } } });
    expect(op && op.kind === 'setContent' && op.content.type === 'effect' && 'unbekannt' in op.content.params).toBe(false);
    expect(parseOp({ kind: 'patchEffect', surfaceId: 's1', effect: 'marquee', params: { pattern: 7.6 } })).toEqual({
      kind: 'patchEffect',
      surfaceId: 's1',
      effect: 'marquee',
      params: { pattern: 3 },
    });
  });
});

describe('parseProject / Migration', () => {
  it('liest ein gespeichertes Projekt wieder ein', () => {
    const p = createProject('Kiste', 'abc');
    p.layers.push(createMaskLayer('ml', 'Ausschnitt', [{ x: 0.1, y: 0.2 }]));
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('überführt Format 1/2 in den Ebenenstapel', () => {
    const corners = createSurface('a', 'A').corners;
    const v2 = {
      format: 2,
      name: 'Alt',
      surfaces: [
        { id: 'a', name: 'A', visible: true, corners, content: { type: 'testgrid' }, masks: [{ id: 'm', name: 'M', points: [], invert: true }] },
      ],
      masks: [{ id: 'g', name: 'G', points: [{ x: 0, y: 0 }], invert: false, feather: 5 }],
    };
    const p = parseProject(v2)!;
    expect(p.format).toBe(3);
    expect(p.layers.map((l) => [l.kind, l.id])).toEqual([
      ['surface', 'a'],
      ['mask', 'g'],
    ]);
    expect((p.layers[0] as Surface).masks[0]!.mode).toBe('subtract');
    expect(p.layers[1]).toMatchObject({ kind: 'mask', mode: 'intersect', feather: 5, locked: false });
  });
});
