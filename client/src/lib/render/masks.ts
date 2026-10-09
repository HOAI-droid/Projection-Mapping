// Masken werden mit Canvas 2D in eine Alpha-Textur gerastert (Weichzeichner = Feather).
// Neu gerastert wird nur, wenn sich Punkte, Einstellungen oder Größe ändern.
//
// Regeln: Gibt es normale Masken, ist nur ihr Inneres sichtbar (Vereinigung).
// Invertierte Masken schneiden ihr Inneres anschließend heraus.

import type { Mask, Point } from '../../../../shared/types.js';
import type { Renderer } from './renderer';

interface Entry {
  key: string;
  texture: WebGLTexture;
}

export class MaskCache {
  private entries = new Map<string, Entry>();
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: false })!;

  constructor(private renderer: Renderer) {}

  /**
   * Liefert die Maskentextur für einen Besitzer ('global' oder Flächen-ID).
   * toPx rechnet einen Maskenpunkt in Texturpixel um; featherScale wandelt
   * Feather (Ausgabepixel) in Texturpixel.
   */
  get(
    owner: string,
    masks: readonly Mask[],
    width: number,
    height: number,
    featherScale: number,
    toPx: (p: Point) => [number, number],
  ): WebGLTexture | null {
    const active = masks.filter((m) => m.enabled && m.points.length >= 3);
    if (active.length === 0) {
      this.drop(owner);
      return null;
    }
    const fs = Math.round(featherScale * 100) / 100;
    const key = JSON.stringify([width, height, fs, active.map((m) => [m.points, m.invert, m.feather])]);
    const cached = this.entries.get(owner);
    if (cached?.key === key) return cached.texture;

    this.rasterize(active, width, height, fs, toPx);
    const entry = cached ?? { key, texture: this.renderer.createTexture() };
    entry.key = key;
    this.renderer.upload(entry.texture, this.canvas);
    this.entries.set(owner, entry);
    return entry.texture;
  }

  /** Einträge entfernen, deren Besitzer es nicht mehr gibt. */
  retain(owners: Set<string>): void {
    for (const owner of this.entries.keys()) if (!owners.has(owner)) this.drop(owner);
  }

  private drop(owner: string): void {
    const e = this.entries.get(owner);
    if (!e) return;
    this.renderer.deleteTexture(e.texture);
    this.entries.delete(owner);
  }

  private rasterize(
    masks: Mask[],
    width: number,
    height: number,
    featherScale: number,
    toPx: (p: Point) => [number, number],
  ): void {
    const c = this.canvas;
    if (c.width !== width || c.height !== height) {
      c.width = width;
      c.height = height;
    }
    const g = this.ctx;
    g.save();
    g.clearRect(0, 0, width, height);
    g.fillStyle = '#fff';

    const positive = masks.filter((m) => !m.invert);
    const negative = masks.filter((m) => m.invert);
    if (positive.length === 0) {
      g.filter = 'none';
      g.fillRect(0, 0, width, height);
    }
    const fill = (m: Mask) => {
      const blur = m.feather * featherScale;
      g.filter = blur > 0.25 ? `blur(${(blur / 2).toFixed(2)}px)` : 'none';
      g.beginPath();
      m.points.forEach((p, i) => {
        const [x, y] = toPx(p);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.closePath();
      g.fill();
    };
    g.globalCompositeOperation = 'source-over';
    positive.forEach(fill);
    g.globalCompositeOperation = 'destination-out';
    negative.forEach(fill);
    g.restore();
  }

  dispose(): void {
    this.retain(new Set());
  }
}
