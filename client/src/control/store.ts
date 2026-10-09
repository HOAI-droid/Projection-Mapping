import { useSyncExternalStore } from 'react';
import { Connection, type Snapshot } from '../lib/connection';

export const conn = new Connection('control');

export function useSnapshot(): Snapshot {
  return useSyncExternalStore(conn.subscribe, conn.getSnapshot);
}

/** Pixelgröße der Ausgabe (erste verbundene Ausgabe, sonst 1280×720). */
export function outputSize(snap: Snapshot): { width: number; height: number; known: boolean } {
  const o = snap.presence.outputs.find((x) => x.width > 0 && x.height > 0);
  return o ? { width: o.width, height: o.height, known: true } : { width: 1280, height: 720, known: false };
}
