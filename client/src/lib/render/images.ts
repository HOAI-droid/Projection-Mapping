// Bilder als Texturen. Lädt per createImageBitmap – das berücksichtigt die
// EXIF-Ausrichtung von iPhone-Fotos und multipliziert Alpha gleich vor.

import type { MediaItem } from '../../../../shared/types.js';
import { mediaUrl } from '../connection';
import type { Renderer } from './renderer';

interface Entry {
  texture: WebGLTexture;
  width: number;
  height: number;
  ready: boolean;
  failed: boolean;
}

export class ImageCache {
  private entries = new Map<string, Entry>();

  constructor(private renderer: Renderer) {}

  texture(item: MediaItem): { texture: WebGLTexture; width: number; height: number } | null {
    let e = this.entries.get(item.id);
    if (!e) {
      e = { texture: this.renderer.createTexture(), width: 1, height: 1, ready: false, failed: false };
      this.entries.set(item.id, e);
      void this.load(item, e);
    }
    return e.ready ? e : null;
  }

  /** Texturen von Bildern freigeben, die nicht mehr gebraucht werden. */
  retain(ids: Set<string>): void {
    for (const [id, e] of this.entries) {
      if (!ids.has(id)) {
        this.renderer.deleteTexture(e.texture);
        this.entries.delete(id);
      }
    }
  }

  private async load(item: MediaItem, e: Entry): Promise<void> {
    try {
      const res = await fetch(mediaUrl(item.id, item.file));
      if (!res.ok) throw new Error(String(res.status));
      const bitmap = await createImageBitmap(await res.blob(), {
        imageOrientation: 'from-image',
        premultiplyAlpha: 'premultiply',
      });
      if (this.entries.get(item.id) !== e) return bitmap.close(); // inzwischen verworfen
      this.renderer.upload(e.texture, bitmap, { mipmap: true });
      e.width = bitmap.width;
      e.height = bitmap.height;
      e.ready = true;
      bitmap.close();
    } catch (err) {
      e.failed = true;
      console.warn(`Bild ${item.name} konnte nicht geladen werden`, err);
    }
  }

  dispose(): void {
    this.retain(new Set());
  }
}
