import { describe, expect, it } from 'vitest';
import { apply, quadToQuad } from './homography.js';
import { createMesh } from './mesh.js';
import { applyOp, createProject, defaultShow, defaultView, looksOf, parseOp } from './state.js';
import type { AppState, Surface } from './types.js';

function initial(): AppState {
  return { project: createProject('Show', 's1'), view: defaultView(), show: defaultShow() };
}
const s0 = (st: AppState) => st.project.layers[0] as Surface;

describe('Szenen', () => {
  it('speichert das Aussehen und blendet beim Auslösen über', () => {
    let st = initial();
    const looksA = looksOf(st.project); // Testgitter
    st = applyOp(st, { kind: 'addScene', scene: { id: 'a', name: 'A', looks: looksA, duration: 5 }, index: 0 });
    st = applyOp(st, { kind: 'setContent', surfaceId: 's1', content: { type: 'color', color: '#ff0000' } });
    st = applyOp(st, { kind: 'addScene', scene: { id: 'b', name: 'B', looks: looksOf(st.project), duration: 5 }, index: 1 });

    st = applyOp(st, { kind: 'goScene', sceneId: 'a', at: 1000 });
    expect(s0(st).content).toEqual({ type: 'testgrid' });
    expect(st.show.activeSceneId).toBe('a');
    // Überblendung von Rot (vorher) zum Testgitter
    expect(st.show.transition).toMatchObject({ start: 1000, duration: 1500, kind: 'cross' });
    expect(st.show.transition!.from.s1!.content).toEqual({ type: 'color', color: '#ff0000' });

    st = applyOp(st, { kind: 'goScene', sceneId: 'b', at: 9000, fade: 'cut' });
    expect(s0(st).content).toEqual({ type: 'color', color: '#ff0000' });
    expect(st.show.transition).toBeNull();
    expect(st.show.sceneStartedAt).toBe(9000);
  });

  it('Geometrie bleibt beim Szenenwechsel unverändert', () => {
    let st = initial();
    st = applyOp(st, { kind: 'addScene', scene: { id: 'a', name: 'A', looks: looksOf(st.project), duration: 5 }, index: 0 });
    st = applyOp(st, { kind: 'setCorner', surfaceId: 's1', index: 0, point: { x: 0.01, y: 0.02 } });
    st = applyOp(st, { kind: 'goScene', sceneId: 'a', at: 0 });
    expect(s0(st).corners[0]).toEqual({ x: 0.01, y: 0.02 });
  });

  it('Playlist-Start stellt die Szenen-Uhr', () => {
    let st = initial();
    st = applyOp(st, { kind: 'setShow', patch: { playing: true }, at: 4242 });
    expect(st.show).toMatchObject({ playing: true, sceneStartedAt: 4242 });
    st = applyOp(st, { kind: 'setShow', patch: { blackout: true, master: 0.4 }, at: 5000 });
    expect(st.show).toMatchObject({ blackout: true, master: 0.4, sceneStartedAt: 4242 });
  });
});

describe('Mesh in Operationen', () => {
  it('Ecken verschieben zieht das ganze Gitter perspektivisch mit', () => {
    let st = initial();
    const s = s0(st);
    const h = quadToQuad([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], s.corners)!;
    const mesh = createMesh((u, v) => apply(h, { x: u, y: v }), 3, 3);
    st = applyOp(st, { kind: 'setMesh', surfaceId: 's1', mesh });
    st = applyOp(st, { kind: 'updateSurface', surfaceId: 's1', patch: { shape: 'mesh' } });
    st = applyOp(st, { kind: 'setCorner', surfaceId: 's1', index: 2, point: { x: 0.9, y: 0.95 } });
    const m = s0(st).mesh!;
    expect(m.points[m.points.length - 1]!.x).toBeCloseTo(0.9, 9);
    expect(s0(st).corners[2].x).toBeCloseTo(0.9, 9);
    // Ein innerer Punkt hat sich mitbewegt
    expect(m.points[5]).not.toEqual(mesh.points[5]);
    st = applyOp(st, { kind: 'setMeshPoint', surfaceId: 's1', index: 0, point: { x: 0.05, y: 0.06 } });
    expect(s0(st).corners[0]).toEqual({ x: 0.05, y: 0.06 });
  });

  it('prüft Mesh und Modulation', () => {
    expect(parseOp({ kind: 'setMesh', surfaceId: 's1', mesh: { cols: 2, rows: 2, points: [] } })).toBeNull();
    expect(parseOp({ kind: 'setMesh', surfaceId: 's1', mesh: { cols: 99, rows: 2, points: [] } })).toBeNull();
    expect(
      parseOp({ kind: 'setModulation', surfaceId: 's1', param: 'speed', mod: { source: 'bass', amount: 5, smoothing: 2 } }),
    ).toEqual({ kind: 'setModulation', surfaceId: 's1', param: 'speed', mod: { source: 'bass', amount: 1, smoothing: 0.99, threshold: 0 } });
    expect(parseOp({ kind: 'setModulation', surfaceId: 's1', param: 'speed', mod: { source: 'lautstärke' } })).toBeNull();
  });
});

describe('Milkdrop-Inhalt', () => {
  it('prüft und begrenzt die Einstellungen', () => {
    expect(
      parseOp({ kind: 'setContent', surfaceId: 's1', content: { type: 'milkdrop', preset: 'Geiss - Artifact 01', blend: 99, cycle: -3 } }),
    ).toEqual({
      kind: 'setContent',
      surfaceId: 's1',
      content: { type: 'milkdrop', preset: 'Geiss - Artifact 01', blend: 20, cycle: 0, random: false },
    });
    expect(parseOp({ kind: 'setContent', surfaceId: 's1', content: { type: 'milkdrop', preset: '' } })).toBeNull();
  });
});
