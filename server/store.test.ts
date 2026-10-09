import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSurface } from '../shared/state.js';
import type { Surface } from '../shared/types.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pm-store-'));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Store: Rückgängig/Wiederherstellen', () => {
  it('fasst eine Geste zu einem Schritt zusammen', async () => {
    const { Store } = await import('./store.js');
    const store = new Store();
    await store.init();
    const id = (store.state.project.layers[0] as Surface).id;
    const orig = (store.state.project.layers[0] as Surface).corners[0];

    // Ziehen: viele Ops mit derselben Geste
    for (let i = 1; i <= 5; i++) store.apply({ kind: 'setCorner', surfaceId: id, index: 0, point: { x: i / 10, y: 0 } }, 'g1');
    store.apply({ kind: 'addLayer', layer: createSurface('neu', 'Neu'), index: 1 });
    expect(store.session.canUndo).toBe(true);

    store.undo(); // Fläche wieder weg
    expect(store.state.project.layers).toHaveLength(1);
    expect((store.state.project.layers[0] as Surface).corners[0]).toEqual({ x: 0.5, y: 0 });
    store.undo(); // ganze Ziehbewegung zurück
    expect((store.state.project.layers[0] as Surface).corners[0]).toEqual(orig);
    expect(store.session.canUndo).toBe(false);

    store.redo();
    expect((store.state.project.layers[0] as Surface).corners[0]).toEqual({ x: 0.5, y: 0 });
    // Neue Änderung verwirft den Wiederherstellen-Stapel
    store.apply({ kind: 'updateSurface', surfaceId: id, patch: { opacity: 0.5 } });
    expect(store.session.canRedo).toBe(false);
    await store.flush();
  });

  it('Auswahländerungen landen nicht im Verlauf', async () => {
    const { Store } = await import('./store.js');
    const store = new Store();
    await store.init();
    store.apply({ kind: 'setView', patch: { editMode: false } });
    expect(store.session.canUndo).toBe(false);
  });
});
