// Playlist: wechselt Szenen nach Zeit oder nach Beats. Läuft auf dem Server, damit
// alle Fenster dieselbe Show sehen – auch wenn die Steuerung kurz weg ist.

import type { Op } from '../shared/state.js';
import type { Store } from './store.js';

export class ShowRunner {
  private beats = 0;
  private lastBeatCount = -1;

  constructor(
    private store: Store,
    private run: (op: Op) => void,
  ) {
    setInterval(() => this.tick(), 100).unref();
  }

  /** Beat-Zähler aus den Audio-Analysen (beatCount steigt bei jedem Beat) */
  onBeatCount(count: number): void {
    if (this.lastBeatCount >= 0 && count > this.lastBeatCount) this.beats += Math.min(8, count - this.lastBeatCount);
    this.lastBeatCount = count;
  }

  /** Manueller Szenenwechsel: Beat-Zähler für die Playlist neu beginnen */
  onSceneChange(): void {
    this.beats = 0;
  }

  /** Szene auslösen (manuell oder durch die Playlist) */
  go(sceneId: string): void {
    this.beats = 0;
    this.run({ kind: 'goScene', sceneId, at: Date.now() });
  }

  private tick(): void {
    const { project, show } = this.store.state;
    if (!show.playing) return;
    const scenes = project.scenes;
    if (scenes.length === 0) {
      this.run({ kind: 'setShow', patch: { playing: false }, at: Date.now() });
      return;
    }
    const idx = scenes.findIndex((s) => s.id === show.activeSceneId);
    if (idx < 0) {
      this.go(scenes[0]!.id);
      return;
    }
    const settings = project.show;
    const due =
      settings.advance === 'beats'
        ? this.beats >= settings.beatsPerScene
        : Date.now() - show.sceneStartedAt >= scenes[idx]!.duration * 1000;
    if (!due) return;
    const next = scenes[idx + 1] ?? (settings.loop ? scenes[0] : undefined);
    if (next) this.go(next.id);
    else this.run({ kind: 'setShow', patch: { playing: false }, at: Date.now() });
  }
}
