// Szene = Renderer + Medien + Masken. Wird von der Ausgabe und von der
// Live-Vorschau in der Steuerung gleichermaßen benutzt.

import { quadPixelSize } from '../../../../shared/geometry.js';
import type { AppState, FitMode, MediaItem, Surface } from '../../../../shared/types.js';
import { ImageCache } from './images';
import { MaskCache } from './masks';
import { hexToRgb, Renderer, type DrawItem } from './renderer';
import { createTestGridCanvas } from './testgrid';
import { VideoPool } from './videos';

/** Auflösung der Flächenmasken (im Inhaltsraum der Fläche) */
const SURFACE_MASK_SIZE = 1024;

export interface RefSize {
  width: number;
  height: number;
}

export class Scene {
  readonly renderer: Renderer;
  readonly videos: VideoPool;
  private images: ImageCache;
  private masks: MaskCache;
  private grid: WebGLTexture;
  private lastProject: AppState['project'] | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.videos = new VideoPool(this.renderer);
    this.images = new ImageCache(this.renderer);
    this.masks = new MaskCache(this.renderer);
    this.grid = this.renderer.createTexture();
    this.renderer.upload(this.grid, createTestGridCanvas(), { mipmap: true });
  }

  /**
   * Zeichnet ein Bild. ref = Pixelgröße der echten Ausgabe; daraus folgen
   * Seitenverhältnis der Flächen (Einpassung, Effekte), Feather-Breiten und Rasterlinien.
   */
  render(state: AppState, media: readonly MediaItem[], ref: RefSize): { width: number; height: number } {
    const size = this.renderer.resize();
    const { project, view } = state;
    if (project !== this.lastProject) {
      this.videos.sync(project);
      this.lastProject = project;
    }
    // Pixel dieser Leinwand je Ausgabepixel (Vorschau ist kleiner als die Ausgabe)
    const pxScale = size.width / Math.max(1, ref.width);
    const grid = view.grid;
    const gridColor = hexToRgb(grid.color);

    const items: DrawItem[] = [];
    const usedImages = new Set<string>();
    const maskOwners = new Set<string>();
    for (const layer of project.layers) {
      if (layer.kind === 'mask') {
        if (!layer.enabled) continue;
        maskOwners.add(layer.id);
        // Region der Masken-Ebene als Alpha (Modus wirkt erst beim Verrechnen)
        const tex = this.masks.get(layer.id, [{ ...layer, mode: 'add' }], size.width, size.height, pxScale, (p) => [
          p.x * size.width,
          p.y * size.height,
        ]);
        if (tex) items.push({ kind: 'mask', texture: tex, mode: layer.mode });
        continue;
      }

      const s = layer;
      if (!s.visible) continue;
      const showGrid = grid.enabled && (!grid.onlySelected || s.id === view.selectedSurfaceId);
      const src = this.source(s, media, usedImages);
      if (!src && !showGrid) continue;
      if (s.opacity <= 0 && !showGrid) continue;
      const px = quadPixelSize(s.corners, ref.width, ref.height);
      const aspect = px.w / Math.max(1, px.h);
      maskOwners.add(s.id);
      const mask = this.masks.get(
        s.id,
        s.masks,
        SURFACE_MASK_SIZE,
        SURFACE_MASK_SIZE,
        SURFACE_MASK_SIZE / Math.max(1, (px.w + px.h) / 2),
        (p) => [p.x * SURFACE_MASK_SIZE, p.y * SURFACE_MASK_SIZE],
      );
      items.push({
        kind: 'surface',
        corners: s.corners,
        source: src?.source ?? 'none',
        texture: src?.texture ?? null,
        color: src?.color ?? [0, 0, 0],
        effect: s.content.type === 'effect' ? s.content.effect : null,
        params: s.content.type === 'effect' ? s.content.params : null,
        opacity: s.opacity,
        blend: s.blend,
        fitScale: src?.aspect ? fitScale(s.fit, src.aspect, aspect) : [1, 1],
        mask,
        aspect,
        seed: seedOf(s.id),
        grid: showGrid
          ? { cols: grid.cols, rows: grid.rows, thickness: grid.thickness * pxScale, color: gridColor, diagonals: grid.diagonals }
          : null,
      });
    }
    this.images.retain(usedImages);
    this.masks.retain(maskOwners);
    this.renderer.draw(items);
    return size;
  }

  private source(
    s: Surface,
    media: readonly MediaItem[],
    usedImages: Set<string>,
  ): {
    source: 'texture' | 'color' | 'effect';
    texture: WebGLTexture | null;
    color: [number, number, number];
    aspect: number | null;
  } | null {
    const c = s.content;
    switch (c.type) {
      case 'none':
        return null;
      case 'testgrid':
        return { source: 'texture', texture: this.grid, color: [0, 0, 0], aspect: null };
      case 'color':
        return { source: 'color', texture: null, color: hexToRgb(c.color), aspect: null };
      case 'effect':
        return { source: 'effect', texture: null, color: [0, 0, 0], aspect: null };
      case 'image': {
        const item = media.find((m) => m.id === c.mediaId && m.status === 'ready');
        if (!item) return null;
        usedImages.add(item.id);
        const t = this.images.texture(item);
        return t ? { source: 'texture', texture: t.texture, color: [0, 0, 0], aspect: t.width / t.height } : null;
      }
      case 'video': {
        const t = this.videos.texture(c.mediaId);
        return t && t.height > 0
          ? { source: 'texture', texture: t.texture, color: [0, 0, 0], aspect: t.width / t.height }
          : null;
      }
    }
  }

  dispose(): void {
    this.videos.dispose();
    this.images.dispose();
    this.masks.dispose();
  }
}

/**
 * Skalierung der Texturkoordinaten für die Einpassung:
 * t = (uv − 0.5) · scale + 0.5. Werte > 1 lassen Ränder frei, < 1 schneiden ab.
 */
export function fitScale(fit: FitMode, contentAspect: number, surfaceAspect: number): [number, number] {
  if (fit === 'stretch' || !(contentAspect > 0) || !(surfaceAspect > 0)) return [1, 1];
  const wider = contentAspect > surfaceAspect;
  if (fit === 'fit') return wider ? [1, contentAspect / surfaceAspect] : [surfaceAspect / contentAspect, 1];
  return wider ? [surfaceAspect / contentAspect, 1] : [1, contentAspect / surfaceAspect];
}

/** Stabiler Zufallswert 0…1 je Fläche, damit gleiche Effekte nicht synchron laufen */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
