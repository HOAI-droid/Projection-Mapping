// Verwaltet <video>-Elemente und ihre Texturen. Ein Element pro Medium, auch wenn
// mehrere Flächen dasselbe Video zeigen.

import { surfacesOf } from '../../../../shared/state.js';
import type { Look, Project, VideoContent } from '../../../../shared/types.js';
import { mediaUrl } from '../connection';
import type { Renderer } from './renderer';

interface Entry {
  video: HTMLVideoElement;
  texture: WebGLTexture;
  /** Neues Bild seit dem letzten Upload? */
  dirty: boolean;
  hasFrame: boolean;
  lastTime: number;
}

/** requestVideoFrameCallback meldet jedes neue Videobild (Chrome 83+, Safari 15.4+). */
const HAS_RVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

export class VideoPool {
  private entries = new Map<string, Entry>();
  private container: HTMLElement;
  /** Ein play() wurde vom Browser abgelehnt (Autoplay-Sperre) */
  blocked = false;

  constructor(private renderer: Renderer) {
    // Videos unsichtbar im DOM halten (manche Browser dekodieren sonst nicht zuverlässig)
    this.container = document.createElement('div');
    this.container.style.cssText =
      'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;overflow:hidden';
    document.body.appendChild(this.container);
  }

  /**
   * Gleicht Elemente mit dem Projekt ab: anlegen, Einstellungen übernehmen, entfernen.
   * extra: Aussehen, das gerade ausgeblendet wird (Videos laufen bis zum Ende der Überblendung).
   */
  sync(project: Project, extra: Look[] = []): void {
    const wanted = new Map<string, VideoContent>();
    for (const l of extra) if (l.content.type === 'video') wanted.set(l.content.mediaId, l.content);
    for (const s of surfacesOf(project)) {
      if (s.visible && s.content.type === 'video') wanted.set(s.content.mediaId, s.content);
    }
    for (const [id, e] of this.entries) {
      if (!wanted.has(id)) this.destroy(id, e);
    }
    for (const [id, content] of wanted) {
      const e = this.entries.get(id) ?? this.create(id);
      const v = e.video;
      v.loop = content.loop;
      if (Math.abs(v.playbackRate - content.speed) > 1e-3) v.playbackRate = content.speed;
      if (content.playing) {
        if (v.paused && !(v.ended && !v.loop)) this.play(v);
      } else if (!v.paused) {
        v.pause();
      }
    }
  }

  /** Nach einem Klick (Benutzergeste) alle wartenden Videos erneut anstoßen. */
  unlock(project: Project): void {
    this.blocked = false;
    this.sync(project);
  }

  /** Lädt neue Videobilder in die Texturen. Gibt die Textur zurück, sobald ein Bild da ist. */
  texture(mediaId: string): { texture: WebGLTexture; width: number; height: number } | null {
    const e = this.entries.get(mediaId);
    if (!e) return null;
    const v = e.video;
    if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      // Ohne requestVideoFrameCallback: hochladen, wenn sich die Zeit geändert hat
      const changed = HAS_RVFC ? e.dirty : v.currentTime !== e.lastTime || !e.hasFrame;
      if (changed) {
        this.renderer.upload(e.texture, v, { premultiply: false });
        e.dirty = false;
        e.hasFrame = true;
        e.lastTime = v.currentTime;
      }
    }
    return e.hasFrame ? { texture: e.texture, width: v.videoWidth, height: v.videoHeight } : null;
  }

  private create(id: string): Entry {
    const v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.src = mediaUrl(id, 'video.mp4');
    this.container.appendChild(v);
    const e: Entry = { video: v, texture: this.renderer.createTexture(), dirty: true, hasFrame: false, lastTime: -1 };
    if (HAS_RVFC) {
      const onFrame = () => {
        e.dirty = true;
        if (this.entries.get(id) === e) v.requestVideoFrameCallback(onFrame);
      };
      v.requestVideoFrameCallback(onFrame);
    }
    // Erstes Bild auch im Pausenzustand anzeigen
    v.addEventListener('loadeddata', () => (e.dirty = true));
    v.addEventListener('seeked', () => (e.dirty = true));
    this.entries.set(id, e);
    return e;
  }

  private play(v: HTMLVideoElement): void {
    v.play().catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'NotAllowedError') this.blocked = true;
    });
  }

  private destroy(id: string, e: Entry): void {
    e.video.pause();
    e.video.removeAttribute('src');
    e.video.load();
    e.video.remove();
    this.renderer.deleteTexture(e.texture);
    this.entries.delete(id);
  }

  dispose(): void {
    for (const [id, e] of this.entries) this.destroy(id, e);
    this.container.remove();
  }
}
