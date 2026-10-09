import { useSyncExternalStore } from 'react';
import type { Surface } from '../../../shared/types.js';
import { Connection, type Snapshot } from '../lib/connection';

export const conn = new Connection('control');

export function useSnapshot(): Snapshot {
  return useSyncExternalStore(conn.subscribe, conn.getSnapshot);
}

/** Aktive Fläche: die gewählte oder (Phase 1) die erste. */
export function activeSurface(snap: Snapshot): Surface | null {
  const st = snap.state;
  if (!st) return null;
  return st.project.surfaces.find((s) => s.id === st.view.selectedSurfaceId) ?? st.project.surfaces[0] ?? null;
}

/** Pixelgröße der Ausgabe (erste verbundene Ausgabe, sonst 1280×720). */
export function outputSize(snap: Snapshot): { width: number; height: number; known: boolean } {
  const o = snap.presence.outputs.find((x) => x.width > 0 && x.height > 0);
  return o ? { width: o.width, height: o.height, known: true } : { width: 1280, height: 720, known: false };
}
