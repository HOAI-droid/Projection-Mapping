// Szene = Renderer + Medien + Masken + Kameras. Wird von der Ausgabe und von der
// Live-Vorschau in der Steuerung gleichermaßen benutzt.
//
// Pro Bild: Ebenenstapel durchgehen, für jede Fläche ihr „Aussehen“ (Look) bestimmen,
// während einer Überblendung zusätzlich das alte Aussehen ausblenden, Effekt-Regler
// mit der Musik modulieren und alles an den Renderer geben.

import { quadPixelSize } from '../../../../shared/geometry.js';
import { tessellateMesh } from '../../../../shared/mesh.js';
import { EFFECT_MAP } from '../../../../shared/effects.js';
import type {
  AppState,
  AudioFrame,
  EffectParams,
  FitMode,
  Look,
  MediaItem,
  Mesh,
  Modulation,
  Surface,
} from '../../../../shared/types.js';
import { CameraPool } from './cameras';
import { ImageCache } from './images';
import { MaskCache } from './masks';
import { hexToRgb, Renderer, type DrawItem, type SurfaceItem } from './renderer';
import { createTestGridCanvas } from './testgrid';
import { VideoPool } from './videos';

/** Auflösung der Flächenmasken (im Inhaltsraum der Fläche) */
const SURFACE_MASK_SIZE = 1024;

export interface RefSize {
  width: number;
  height: number;
}

interface MeshCacheEntry {
  mesh: Mesh;
  data: { pos: Float32Array; uv: Float32Array; version: string };
}

let meshVersion = 0;

export class Scene {
  readonly renderer: Renderer;
  readonly videos: VideoPool;
  private images: ImageCache;
  private masks: MaskCache;
  private cameras: CameraPool;
  private grid: WebGLTexture;
  private lastProject: AppState['project'] | null = null;
  private meshCache = new Map<string, MeshCacheEntry>();
  /** geglättete Modulationswerte je Fläche/Regler */
  private modState = new Map<string, number>();
  /** Flächen, deren Aussehen sich in der laufenden Überblendung ändert */
  private changed: { start: number; ids: Set<string> } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.videos = new VideoPool(this.renderer);
    this.images = new ImageCache(this.renderer);
    this.masks = new MaskCache(this.renderer);
    this.cameras = new CameraPool(this.renderer);
    this.grid = this.renderer.createTexture();
    this.renderer.upload(this.grid, createTestGridCanvas(), { mipmap: true });
  }

  /**
   * Zeichnet ein Bild. ref = Pixelgröße der echten Ausgabe (Seitenverhältnisse, Feather,
   * Rasterlinien); now = Server-Uhr in ms (Überblendungen); audio = aktuelle Musik-Analyse.
   */
  render(
    state: AppState,
    media: readonly MediaItem[],
    ref: RefSize,
    now: number,
    audio: AudioFrame | null,
  ): { width: number; height: number } {
    const size = this.renderer.resize();
    const { project, view, show } = state;
    if (project !== this.lastProject) {
      this.videos.sync(project, show.transition ? Object.values(show.transition.from) : []);
      this.lastProject = project;
    }
    this.renderer.setAudio(audio);

    // Gewichte der Überblendung
    const tr = show.transition;
    const t = tr ? Math.min(1, Math.max(0, (now - tr.start) / Math.max(1, tr.duration))) : 1;
    const fading = !!tr && t < 1;
    let wOld = 0;
    let wNew = 1;
    let wSame = 1;
    if (fading && tr) {
      if (tr.kind === 'black') {
        wOld = Math.max(0, 1 - 2 * t);
        wNew = Math.max(0, 2 * t - 1);
        wSame = t < 0.5 ? 1 - 2 * t : 2 * t - 1; // Schwarzblende: alles geht kurz auf Schwarz
      } else {
        // Altes Bild langsamer ausblenden als das neue einblenden: sonst gibt es in der
        // Mitte eine sichtbare Helligkeitsdelle (0,5 über 0,5 ergibt nur 75 %)
        wOld = 1 - t * t * t;
        wNew = t;
      }
      if (this.changed?.start !== tr.start) this.changed = { start: tr.start, ids: changedSurfaces(project.layers, tr.from) };
    }

    // Pixel dieser Leinwand je Ausgabepixel (Vorschau ist kleiner als die Ausgabe)
    const pxScale = size.width / Math.max(1, ref.width);
    const grid = view.grid;
    const gridColor = hexToRgb(grid.color);

    const items: DrawItem[] = [];
    const usedImages = new Set<string>();
    const usedCameras = new Set<string>();
    const maskOwners = new Set<string>();
    const keep = new Set<string>();

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
      const px = quadPixelSize(s.corners, ref.width, ref.height);
      const aspect = px.w / Math.max(1, px.h);
      const base = this.baseItem(s, aspect, px, keep);
      if (!base) continue;
      maskOwners.add(s.id);

      const showGrid = grid.enabled && s.visible && (!grid.onlySelected || s.id === view.selectedSurfaceId);
      const changed = fading && this.changed?.ids.has(s.id);
      const oldLook = changed ? tr!.from[s.id] : undefined;
      if (oldLook && wOld > 0) {
        const it = this.lookItem(base, oldLook, s.id, aspect, wOld, media, usedImages, usedCameras, audio, keep);
        if (it) items.push(it);
      }
      const weight = !fading ? 1 : changed ? wNew : wSame;
      const cur = this.lookItem(base, lookOf(s), s.id, aspect, weight, media, usedImages, usedCameras, audio, keep);
      if (cur) {
        if (showGrid) cur.grid = gridOf(grid, pxScale, gridColor);
        items.push(cur);
      } else if (showGrid) {
        items.push({ ...base, source: 'none', opacity: 1, grid: gridOf(grid, pxScale, gridColor) });
      }
    }

    this.images.retain(usedImages);
    this.cameras.retain(usedCameras);
    this.masks.retain(maskOwners);
    this.renderer.retainFeedback(keep);
    this.renderer.draw(items, show.blackout ? 0 : show.master);
    return size;
  }

  /** Geometrie-Anteil eines Zeichenauftrags (gleich für altes und neues Aussehen) */
  private baseItem(s: Surface, aspect: number, px: { w: number; h: number }, keep: Set<string>): SurfaceItem | null {
    let mesh: SurfaceItem['mesh'] = null;
    if (s.shape === 'mesh' && s.mesh) {
      let c = this.meshCache.get(s.id);
      if (!c || c.mesh !== s.mesh) {
        const t = tessellateMesh(s.mesh, 8);
        c = { mesh: s.mesh, data: { ...t, version: String(++meshVersion) } };
        this.meshCache.set(s.id, c);
      }
      mesh = c.data;
      keep.add(s.id);
    }
    const mask = this.masks.get(
      s.id,
      s.masks,
      SURFACE_MASK_SIZE,
      SURFACE_MASK_SIZE,
      SURFACE_MASK_SIZE / Math.max(1, (px.w + px.h) / 2),
      (p) => [p.x * SURFACE_MASK_SIZE, p.y * SURFACE_MASK_SIZE],
    );
    return {
      kind: 'surface',
      key: s.id,
      shape: s.shape,
      corners: s.corners,
      mesh,
      source: 'none',
      texture: null,
      color: [0, 0, 0],
      effect: null,
      params: null,
      opacity: 1,
      blend: 'normal',
      fitScale: [1, 1],
      mask,
      aspect,
      seed: seedOf(s.id),
      grid: null,
    };
  }

  /** Zeichenauftrag für ein bestimmtes Aussehen; weight = Anteil der Überblendung */
  private lookItem(
    base: SurfaceItem,
    look: Look,
    surfaceId: string,
    aspect: number,
    weight: number,
    media: readonly MediaItem[],
    usedImages: Set<string>,
    usedCameras: Set<string>,
    audio: AudioFrame | null,
    keep: Set<string>,
  ): SurfaceItem | null {
    if (!look.visible || weight <= 0) return null;
    let opacity = look.opacity;
    if (look.opacityMod) {
      const f = this.modValue(`${surfaceId}:opacity`, look.opacityMod, audio);
      const a = look.opacityMod.amount;
      opacity *= a >= 0 ? 1 - a + a * f : 1 + a * f;
    }
    opacity = Math.max(0, Math.min(1, opacity)) * weight;
    if (opacity <= 0.001) return null;

    const c = look.content;
    const item: SurfaceItem = { ...base, opacity, blend: look.blend };
    switch (c.type) {
      case 'none':
        return null;
      case 'testgrid':
        return { ...item, source: 'texture', texture: this.grid };
      case 'color':
        return { ...item, source: 'color', color: hexToRgb(c.color) };
      case 'effect': {
        const def = EFFECT_MAP.get(c.effect);
        if (!def) return null;
        if (def.feedback) keep.add(`${surfaceId}:${c.effect}`);
        return { ...item, source: 'effect', effect: c.effect, params: this.modulate(surfaceId, c.effect, c.params, c.mod, audio) };
      }
      case 'image': {
        const m = media.find((x) => x.id === c.mediaId && x.status === 'ready');
        if (!m) return null;
        usedImages.add(m.id);
        const tex = this.images.texture(m);
        return tex ? { ...item, source: 'texture', texture: tex.texture, fitScale: fitScale(look.fit, tex.width / tex.height, aspect) } : null;
      }
      case 'video': {
        const tex = this.videos.texture(c.mediaId);
        return tex && tex.height > 0
          ? { ...item, source: 'texture', texture: tex.texture, fitScale: fitScale(look.fit, tex.width / tex.height, aspect) }
          : null;
      }
      case 'camera': {
        usedCameras.add(c.deviceId);
        const tex = this.cameras.texture(c.deviceId);
        if (!tex || tex.height <= 0) return null;
        const f = fitScale(look.fit, tex.width / tex.height, aspect);
        // Spiegeln = Textur horizontal umdrehen
        return { ...item, source: 'texture', texture: tex.texture, fitScale: [c.mirror ? -f[0] : f[0], f[1]] };
      }
    }
  }

  /** Effekt-Regler mit der Musik verschieben */
  private modulate(
    surfaceId: string,
    effectId: string,
    params: EffectParams,
    mod: Record<string, Modulation> | undefined,
    audio: AudioFrame | null,
  ): EffectParams {
    if (!mod) return params;
    const def = EFFECT_MAP.get(effectId);
    const out = { ...params };
    for (const p of def?.params ?? []) {
      const m = mod[p.id];
      if (!m || p.type !== 'float') continue;
      const f = this.modValue(`${surfaceId}:${p.id}`, m, audio);
      const base = Number(params[p.id] ?? p.default);
      out[p.id] = Math.min(p.max, Math.max(p.min, base + m.amount * (p.max - p.min) * f));
    }
    return out;
  }

  /** Audio-Wert 0…1 mit Schwelle und Glättung */
  private modValue(key: string, m: Modulation, audio: AudioFrame | null): number {
    const raw = audio ? audio[m.source] : 0;
    const v = m.threshold > 0 ? Math.max(0, (raw - m.threshold) / (1 - m.threshold)) : raw;
    const prev = this.modState.get(key) ?? v;
    const s = prev * m.smoothing + v * (1 - m.smoothing);
    this.modState.set(key, s);
    return s;
  }

  dispose(): void {
    this.videos.dispose();
    this.images.dispose();
    this.masks.dispose();
    this.cameras.dispose();
  }
}

function lookOf(s: Surface): Look {
  return { content: s.content, visible: s.visible, opacity: s.opacity, blend: s.blend, fit: s.fit, opacityMod: s.opacityMod };
}

/** Welche Flächen sehen nach dem Szenenwechsel anders aus als vorher? */
function changedSurfaces(layers: AppState['project']['layers'], from: Record<string, Look>): Set<string> {
  const ids = new Set<string>();
  for (const l of layers) {
    if (l.kind !== 'surface') continue;
    const old = from[l.id];
    if (old && JSON.stringify(old) !== JSON.stringify(lookOf(l))) ids.add(l.id);
  }
  return ids;
}

function gridOf(grid: AppState['view']['grid'], pxScale: number, color: [number, number, number]): SurfaceItem['grid'] {
  return { cols: grid.cols, rows: grid.rows, thickness: grid.thickness * pxScale, color, diagonals: grid.diagonals };
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
