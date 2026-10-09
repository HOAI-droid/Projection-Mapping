// Szene = Renderer + Medien + Masken. Wird von der Ausgabe und von der
// Live-Vorschau in der Steuerung gleichermaßen benutzt.

import { quadPixelSize } from '../../../../shared/geometry.js';
import type { AppState, FitMode, MediaItem, Surface } from '../../../../shared/types.js';
import { ImageCache } from './images';
import { MaskCache } from './masks';
import { Renderer, type DrawItem } from './renderer';
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
   * Seitenverhältnis der Flächen (für die Einpassung) und Feather-Breiten.
   */
  render(state: AppState, media: readonly MediaItem[], ref: RefSize): { width: number; height: number } {
    const size = this.renderer.resize();
    const project = state.project;
    if (project !== this.lastProject) {
      this.videos.sync(project);
      this.lastProject = project;
    }

    const items: DrawItem[] = [];
    const usedImages = new Set<string>();
    const maskOwners = new Set<string>(['global']);
    for (const s of project.surfaces) {
      if (!s.visible || s.opacity <= 0) continue;
      const src = this.source(s, media, usedImages);
      if (!src) continue;
      const px = quadPixelSize(s.corners, ref.width, ref.height);
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
        corners: s.corners,
        texture: src.texture,
        color: src.color,
        opacity: s.opacity,
        blend: s.blend,
        fitScale: src.aspect ? fitScale(s.fit, src.aspect, px.w / Math.max(1, px.h)) : [1, 1],
        mask,
      });
    }
    this.images.retain(usedImages);
    this.masks.retain(maskOwners);

    const globalMask = this.masks.get(
      'global',
      project.masks,
      size.width,
      size.height,
      size.width / Math.max(1, ref.width),
      (p) => [p.x * size.width, p.y * size.height],
    );
    this.renderer.draw(items, globalMask);
    return size;
  }

  private source(
    s: Surface,
    media: readonly MediaItem[],
    usedImages: Set<string>,
  ): { texture: WebGLTexture | null; color: [number, number, number]; aspect: number | null } | null {
    const c = s.content;
    switch (c.type) {
      case 'none':
        return null;
      case 'testgrid':
        return { texture: this.grid, color: [0, 0, 0], aspect: null };
      case 'color':
        return { texture: null, color: hexToRgb(c.color), aspect: null };
      case 'image': {
        const item = media.find((m) => m.id === c.mediaId && m.status === 'ready');
        if (!item) return null;
        usedImages.add(item.id);
        const t = this.images.texture(item);
        return t ? { texture: t.texture, color: [0, 0, 0], aspect: t.width / t.height } : null;
      }
      case 'video': {
        const t = this.videos.texture(c.mediaId);
        return t && t.height > 0 ? { texture: t.texture, color: [0, 0, 0], aspect: t.width / t.height } : null;
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

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
