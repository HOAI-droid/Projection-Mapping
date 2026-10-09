// Milkdrop-Presets über Butterchurn (MIT) – die originalen Winamp-Visualisierungen.
//
// Butterchurn rendert in ein eigenes Canvas (eigener WebGL-Kontext). Pro Fläche läuft eine
// Instanz; ihr Bild wird in jedem Frame als Textur in unseren Renderer übernommen und kann
// so auf jede Form, mit Masken, Mesh und in Szenen verwendet werden.
// Die Musik kommt als rohe Samples aus der Audio-Analyse der Steuerung (AudioFrame.pcm).

import type { ButterchurnVisualizer } from 'butterchurn';
import type { AudioFrame, MilkdropContent } from '../../../../shared/types.js';
import type { Renderer } from './renderer';

/** Browser erlauben nur ~16 WebGL-Kontexte pro Seite – mehr Milkdrop-Flächen teilen sich Instanzen */
const MAX_INSTANCES = 6;

type Presets = Record<string, object>;

let presetsPromise: Promise<{ map: Presets; names: string[] }> | null = null;

/** Alle Preset-Pakete laden (einmalig, erst bei Bedarf – ca. 2,4 MB) */
export function loadMilkdropPresets(): Promise<{ map: Presets; names: string[] }> {
  presetsPromise ??= Promise.all([
    import('butterchurn-presets/lib/butterchurnPresets.min.js'),
    import('butterchurn-presets/lib/butterchurnPresetsExtra.min.js'),
    import('butterchurn-presets/lib/butterchurnPresetsExtra2.min.js'),
    import('butterchurn-presets/lib/butterchurnPresetsMD1.min.js'),
  ]).then((mods) => {
    const map: Presets = {};
    for (const m of mods) Object.assign(map, (m.default ?? m).getPresets());
    const names = Object.keys(map).sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
    return { map, names };
  });
  return presetsPromise;
}

let butterchurnPromise: Promise<typeof import('butterchurn').default> | null = null;
function loadButterchurn() {
  butterchurnPromise ??= import('butterchurn').then((m) => m.default ?? (m as unknown as typeof m.default));
  return butterchurnPromise;
}

/** Welches Preset gerade dran ist – beim automatischen Weiterschalten für alle Fenster gleich (Server-Uhr) */
export function currentPreset(c: MilkdropContent, names: string[], now: number, seed: number): string {
  if (!c.cycle || names.length === 0) return c.preset;
  const k = Math.floor(now / (c.cycle * 1000));
  const base = Math.max(0, names.indexOf(c.preset));
  if (!c.random) return names[(base + k) % names.length]!;
  // Zufällig, aber deterministisch aus Schritt und Fläche
  let h = Math.imul(k ^ Math.floor(seed * 1e6), 2654435761) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  return names[(base + 1 + (h % (names.length - 1))) % names.length]!;
}

interface Instance {
  canvas: HTMLCanvasElement;
  viz: ButterchurnVisualizer;
  preset: string;
  texture: WebGLTexture;
  w: number;
  h: number;
  last: number;
  frame: number;
}

const silent = new Uint8Array(1024).fill(128);

export class MilkdropPool {
  private instances = new Map<string, Instance>();
  private pending = new Set<string>();
  private presets: { map: Presets; names: string[] } | null = null;
  private pcmCache: { frame: AudioFrame | null; bytes: Uint8Array } = { frame: null, bytes: silent };
  private frameNo = 0;

  constructor(private renderer: Renderer) {}

  /** Einmal pro gezeichnetem Bild aufrufen (Audio dekodieren, Zähler) */
  beginFrame(audio: AudioFrame | null): void {
    this.frameNo++;
    if (audio !== this.pcmCache.frame) {
      let bytes = silent;
      if (audio?.pcm) {
        const bin = atob(audio.pcm);
        bytes = new Uint8Array(1024);
        for (let i = 0; i < 1024 && i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      }
      this.pcmCache = { frame: audio, bytes };
    }
  }

  /**
   * Textur für eine Milkdrop-Fläche. size = gewünschte Pixelgröße (wird auf 1280 begrenzt).
   * key = tatsächlich genutzte Instanz (für retain). texture = null, solange noch geladen wird.
   */
  texture(
    surfaceKey: string,
    c: MilkdropContent,
    size: { w: number; h: number },
    now: number,
    seed: number,
  ): { key: string; texture: WebGLTexture | null } {
    // Zu viele Instanzen: weitere Flächen mit gleichem Preset teilen sich eine
    let k = surfaceKey;
    if (!this.instances.has(k) && this.instances.size + this.pending.size >= MAX_INSTANCES) k = `preset:${c.preset}`;
    const inst = this.instances.get(k);
    if (!inst || !this.presets) {
      if (!inst) this.create(k, size);
      return { key: k, texture: null };
    }

    // Preset wechseln (mit Überblendung)
    const want = currentPreset(c, this.presets.names, now, seed);
    if (want !== inst.preset && this.presets.map[want]) {
      inst.viz.loadPreset(this.presets.map[want]!, inst.preset ? c.blend : 0);
      inst.preset = want;
    }

    // Auflösung an die Fläche anpassen (spart Rechenzeit bei kleinen Flächen)
    const scale = Math.min(1, 1280 / Math.max(size.w, size.h, 1));
    const w = Math.max(64, Math.round(size.w * scale));
    const h = Math.max(64, Math.round(size.h * scale));
    if (Math.abs(w - inst.w) / inst.w > 0.15 || Math.abs(h - inst.h) / inst.h > 0.15) {
      inst.canvas.width = w;
      inst.canvas.height = h;
      inst.viz.setRendererSize(w, h);
      inst.w = w;
      inst.h = h;
    }

    // Pro Bild nur einmal rendern (bei geteilten Instanzen oder Überblendungen)
    if (inst.frame !== this.frameNo) {
      inst.frame = this.frameNo;
      const t = performance.now();
      const elapsed = Math.min(0.1, (t - inst.last) / 1000);
      inst.last = t;
      const b = this.pcmCache.bytes;
      inst.viz.render({ audioLevels: { timeByteArray: b, timeByteArrayL: b, timeByteArrayR: b }, elapsedTime: elapsed });
      this.renderer.upload(inst.texture, inst.canvas, { premultiply: false });
    }
    return { key: k, texture: inst.texture };
  }

  private create(key: string, size: { w: number; h: number }): void {
    if (this.pending.has(key)) return;
    this.pending.add(key);
    void Promise.all([loadButterchurn(), loadMilkdropPresets()])
      .then(([butterchurn, presets]) => {
        this.presets = presets;
        if (!this.pending.has(key)) return; // inzwischen nicht mehr gebraucht
        const scale = Math.min(1, 1280 / Math.max(size.w, size.h, 1));
        const w = Math.max(64, Math.round(size.w * scale));
        const h = Math.max(64, Math.round(size.h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const viz = butterchurn.createVisualizer(null, canvas, { width: w, height: h, pixelRatio: 1, textureRatio: 1 });
        this.instances.set(key, {
          canvas,
          viz,
          preset: '',
          texture: this.renderer.createTexture([0, 0, 0, 255]),
          w,
          h,
          last: performance.now(),
          frame: -1,
        });
      })
      .catch((err: unknown) => console.error('Butterchurn konnte nicht geladen werden:', err))
      .finally(() => this.pending.delete(key));
  }

  /** Instanzen freigeben, die nicht mehr gebraucht werden (WebGL-Kontext sofort abgeben) */
  retain(keys: Set<string>): void {
    for (const [k, inst] of this.instances) if (!keys.has(k)) this.dispose(k, inst);
    for (const k of [...this.pending]) if (!keys.has(k)) this.pending.delete(k);
  }

  private dispose(key: string, inst: Instance): void {
    const gl = inst.canvas.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.renderer.deleteTexture(inst.texture);
    this.instances.delete(key);
  }

  disposeAll(): void {
    for (const [k, inst] of this.instances) this.dispose(k, inst);
  }
}
