// Live-Kameras (MacBook-Webcam oder angeschlossene USB-/HDMI-Kameras) als Texturen.
// Pro Gerät ein Stream, auch wenn mehrere Flächen dieselbe Kamera zeigen.

import type { Renderer } from './renderer';

interface Entry {
  video: HTMLVideoElement;
  stream: MediaStream | null;
  texture: WebGLTexture;
  dirty: boolean;
  hasFrame: boolean;
  error: string | null;
}

export class CameraPool {
  private entries = new Map<string, Entry>();
  private container: HTMLElement;

  constructor(private renderer: Renderer) {
    this.container = document.createElement('div');
    this.container.style.cssText =
      'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;overflow:hidden';
    document.body.appendChild(this.container);
  }

  /** Textur der Kamera; startet sie beim ersten Aufruf */
  texture(deviceId: string): { texture: WebGLTexture; width: number; height: number } | null {
    let e = this.entries.get(deviceId);
    if (!e) e = this.open(deviceId);
    const v = e.video;
    if (e.dirty && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.renderer.upload(e.texture, v, { premultiply: false });
      e.dirty = false;
      e.hasFrame = true;
    }
    return e.hasFrame ? { texture: e.texture, width: v.videoWidth, height: v.videoHeight } : null;
  }

  /** Kameras schließen, die keine Fläche mehr zeigt (Kamera-LED geht aus) */
  retain(ids: Set<string>): void {
    for (const [id, e] of this.entries) {
      if (ids.has(id)) continue;
      e.stream?.getTracks().forEach((t) => t.stop());
      e.video.remove();
      this.renderer.deleteTexture(e.texture);
      this.entries.delete(id);
    }
  }

  private open(deviceId: string): Entry {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    this.container.appendChild(v);
    const e: Entry = { video: v, stream: null, texture: this.renderer.createTexture(), dirty: false, hasFrame: false, error: null };
    this.entries.set(deviceId, e);
    const onFrame = () => {
      e.dirty = true;
      if (this.entries.get(deviceId) === e) v.requestVideoFrameCallback(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
    navigator.mediaDevices
      .getUserMedia({
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60 },
        },
        audio: false,
      })
      .then((stream) => {
        if (this.entries.get(deviceId) !== e) return stream.getTracks().forEach((t) => t.stop());
        e.stream = stream;
        v.srcObject = stream;
        void v.play().catch(() => {});
      })
      .catch((err: unknown) => {
        e.error = err instanceof Error ? err.message : String(err);
        console.warn('Kamera nicht verfügbar:', e.error);
      });
    return e;
  }

  dispose(): void {
    this.retain(new Set());
    this.container.remove();
  }
}

/** Liste der Kameras (Namen gibt es erst, nachdem einmal eine Kamera erlaubt wurde) */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  }
}
