// Medienbibliothek: Upload, Transkodierung per ffmpeg, Vorschaubilder.

import { spawn } from 'node:child_process';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { newId } from '../shared/ids.js';
import type { MediaItem } from '../shared/types.js';
import { config } from './config.js';
import { readJson, writeJsonAtomic } from './fsutil.js';

const dirOf = (id: string) => join(config.mediaDir, id);
const metaFile = (id: string) => join(dirOf(id), 'meta.json');

export const VIDEO_FILE = 'video.mp4';
export const THUMB_FILE = 'thumb.jpg';
/** Längste Bildkante nach der Umwandlung (Texturen bis 2048 px sind überall unproblematisch) */
const IMAGE_MAX = 2048;

const IMAGE_EXT = /\.(jpe?g|png|heic|heif|webp|gif|tiff?|bmp|avif)$/i;
const ALPHA_EXT = /\.(png|webp|gif|tiff?)$/i;

export function isImageUpload(mimetype: string, name: string): boolean {
  return mimetype.startsWith('image/') || IMAGE_EXT.test(name);
}

export function isVideoUpload(mimetype: string, name: string): boolean {
  return mimetype.startsWith('video/') || /\.(mov|mp4|m4v|webm|mkv|avi|3gp)$/i.test(name);
}

interface ProbeInfo {
  duration: number;
  transfer: string;
  hasVideo: boolean;
}

export class MediaLibrary {
  private items = new Map<string, MediaItem>();
  private queue: string[] = [];
  private busy = false;
  private hasZscale = false;
  /** Hardware-Encoder auf dem Mac (Apple Silicon) – um ein Vielfaches schneller als libx264 */
  private hasVideotoolbox = false;
  private notifyTimer: NodeJS.Timeout | null = null;

  /** Wird bei jeder Änderung aufgerufen (gedrosselt). */
  onChange: () => void = () => {};

  async init(): Promise<void> {
    await mkdir(config.mediaDir, { recursive: true });
    await rm(config.uploadTmpDir, { recursive: true, force: true });
    await mkdir(config.uploadTmpDir, { recursive: true });
    this.hasZscale = await detectFilter('zscale');
    this.hasVideotoolbox = process.platform === 'darwin' && (await detectEncoder('h264_videotoolbox'));

    for (const id of await readdir(config.mediaDir)) {
      try {
        const item = (await readJson(metaFile(id))) as MediaItem;
        // Einträge aus v0.1 kennen nur Videos
        item.kind ??= 'video';
        item.file ??= VIDEO_FILE;
        if (item.status === 'processing') {
          // Server wurde während der Transkodierung beendet → neu starten, falls Quelle noch da ist
          if (await this.sourceFile(id)) this.queue.push(id);
          else Object.assign(item, { status: 'error', error: 'Transkodierung abgebrochen' });
        }
        this.items.set(id, item);
      } catch {
        // Ordner ohne gültige meta.json ignorieren
      }
    }
    void this.pump();
  }

  list(): MediaItem[] {
    return [...this.items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): MediaItem | undefined {
    return this.items.get(id);
  }

  /** Übernimmt eine hochgeladene Datei und stellt sie in die Transkodier-Warteschlange. */
  async add(tmpPath: string, originalName: string, kind: MediaItem['kind']): Promise<MediaItem> {
    const id = newId();
    await mkdir(dirOf(id), { recursive: true });
    const ext = extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8) || '.bin';
    await rename(tmpPath, join(dirOf(id), `source${ext}`));
    const item: MediaItem = {
      id,
      name: originalName.slice(0, 200),
      kind,
      file: kind === 'video' ? VIDEO_FILE : ALPHA_EXT.test(originalName) ? 'image.png' : 'image.jpg',
      status: 'processing',
      progress: 0,
      createdAt: new Date().toISOString(),
    };
    this.items.set(id, item);
    await this.persist(item);
    this.queue.push(id);
    void this.pump();
    return item;
  }

  async remove(id: string): Promise<boolean> {
    if (!this.items.has(id)) return false;
    this.items.delete(id);
    this.queue = this.queue.filter((q) => q !== id);
    await rm(dirOf(id), { recursive: true, force: true });
    this.changed(true);
    return true;
  }

  private async sourceFile(id: string): Promise<string | null> {
    try {
      const f = (await readdir(dirOf(id))).find((n) => n.startsWith('source'));
      return f ? join(dirOf(id), f) : null;
    } catch {
      return null;
    }
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      let id: string | undefined;
      while ((id = this.queue.shift())) {
        const item = this.items.get(id);
        if (!item) continue;
        try {
          if (item.kind === 'image') await this.convertImage(item);
          else await this.transcode(item);
          item.status = 'ready';
          item.progress = 1;
          delete item.error;
        } catch (err) {
          item.status = 'error';
          item.error = err instanceof Error ? err.message : String(err);
          console.error(`Transkodierung von „${item.name}“ fehlgeschlagen:`, item.error);
        }
        // Element könnte inzwischen gelöscht worden sein
        if (this.items.has(item.id)) {
          await this.persist(item).catch(() => {});
          this.changed(true);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async transcode(item: MediaItem): Promise<void> {
    const src = await this.sourceFile(item.id);
    if (!src) throw new Error('Quelldatei fehlt');
    const dir = dirOf(item.id);
    const out = join(dir, VIDEO_FILE);
    const tmpOut = join(dir, 'video.tmp.mp4');

    const probe = await probeFile(src);
    if (!probe.hasVideo) throw new Error('Datei enthält keine Videospur');

    // Hochformat bleibt hochformatig; Begrenzung auf 1280×720 bzw. 720×1280, gerade Maße für H.264
    const filters: string[] = [];
    const hdr = probe.transfer === 'arib-std-b67' || probe.transfer === 'smpte2084';
    if (hdr && this.hasZscale) {
      // iPhone-HDR (HLG/Dolby Vision) → SDR, sonst wirken die Farben blass
      filters.push(
        'zscale=t=linear:npl=100',
        'format=gbrpf32le',
        'zscale=p=bt709',
        'tonemap=tonemap=hable:desat=0',
        'zscale=t=bt709:m=bt709:r=tv',
      );
    }
    filters.push(
      "scale=w='if(gte(iw,ih),min(1280,iw),min(720,iw))':h='if(gte(iw,ih),min(720,ih),min(1280,ih))'" +
        ':force_original_aspect_ratio=decrease:force_divisible_by=2',
      'format=yuv420p',
    );

    const encoder = this.hasVideotoolbox
      ? ['-c:v', 'h264_videotoolbox', '-b:v', '8M', '-maxrate', '12M', '-profile:v', 'high', '-allow_sw', '1']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-profile:v', 'high', '-level:v', '4.1'];
    const args = [
      '-hide_banner', '-nostdin', '-y',
      '-i', src,
      '-map', '0:v:0',
      '-an', '-sn', '-dn',
      '-vf', filters.join(','),
      '-fpsmax', '60',
      ...encoder,
      '-g', '60',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
      '-movflags', '+faststart',
      '-progress', 'pipe:1', '-nostats',
      tmpOut,
    ];

    let lastNotify = 0;
    await run(config.ffmpeg, args, (line) => {
      const m = /^out_time_us=(\d+)/.exec(line);
      if (m && probe.duration > 0) {
        item.progress = Math.min(0.99, Number(m[1]) / 1e6 / probe.duration);
        const now = Date.now();
        if (now - lastNotify > 500) {
          lastNotify = now;
          this.changed(false);
        }
      }
    });
    await rename(tmpOut, out);

    const info = await probeVideo(out);
    item.width = info.width;
    item.height = info.height;
    item.duration = info.duration;

    // Vorschaubild etwa bei 1 s (oder in der Mitte bei sehr kurzen Clips)
    const at = Math.min(1, (info.duration || 0) / 2);
    await run(config.ffmpeg, [
      '-hide_banner', '-nostdin', '-y', '-ss', at.toFixed(2), '-i', out,
      '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', join(dir, THUMB_FILE),
    ]);
    await rm(src, { force: true });
  }

  private async convertImage(item: MediaItem): Promise<void> {
    const src = await this.sourceFile(item.id);
    if (!src) throw new Error('Quelldatei fehlt');
    const dir = dirOf(item.id);
    const out = join(dir, item.file);
    const thumb = join(dir, THUMB_FILE);
    const png = item.file.endsWith('.png');

    let done = false;
    if (process.platform === 'darwin') {
      // sips (in macOS eingebaut) liest HEIC/HEIF von iPhone-Fotos zuverlässig
      try {
        const info = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', src]);
        const w = Number(/pixelWidth: (\d+)/.exec(info)?.[1] ?? 0);
        const h = Number(/pixelHeight: (\d+)/.exec(info)?.[1] ?? 0);
        const resize = Math.max(w, h) > IMAGE_MAX ? ['-Z', String(IMAGE_MAX)] : [];
        await run('sips', ['-s', 'format', png ? 'png' : 'jpeg', ...resize, src, '--out', out]);
        await run('sips', ['-s', 'format', 'jpeg', '-Z', '320', out, '--out', thumb]);
        done = true;
      } catch (err) {
        console.warn('sips fehlgeschlagen, versuche ffmpeg:', err instanceof Error ? err.message : err);
      }
    }
    if (!done) {
      const scale =
        `scale=w='min(${IMAGE_MAX},iw)':h='min(${IMAGE_MAX},ih)':force_original_aspect_ratio=decrease`;
      await run(config.ffmpeg, [
        '-hide_banner', '-nostdin', '-y', '-i', src, '-frames:v', '1', '-vf', scale,
        ...(png ? [] : ['-q:v', '2']), out,
      ]);
      await run(config.ffmpeg, [
        '-hide_banner', '-nostdin', '-y', '-i', out, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', thumb,
      ]);
    }
    const info = await probeVideo(out);
    item.width = info.width;
    item.height = info.height;
    await rm(src, { force: true });
  }

  private async persist(item: MediaItem): Promise<void> {
    await writeJsonAtomic(metaFile(item.id), item);
  }

  private changed(immediate: boolean): void {
    if (immediate) {
      if (this.notifyTimer) clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
      this.onChange();
      return;
    }
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.onChange();
    }, 250);
  }
}

// --- ffmpeg-Hilfen -----------------------------------------------------------

function run(cmd: string, args: string[], onStdoutLine?: (line: string) => void): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let buf = '';
    child.stdout.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      stdout += s;
      if (onStdoutLine) {
        buf += s;
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        lines.forEach(onStdoutLine);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on('error', (err) =>
      reject(new Error(`${cmd} konnte nicht gestartet werden (${err.message}). Ist ffmpeg installiert?`)),
    );
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${cmd} beendet mit Code ${code}: ${lastLines(stderr)}`));
    });
  });
}

function lastLines(s: string): string {
  return s.trim().split('\n').slice(-3).join(' | ');
}

async function probeFile(file: string): Promise<ProbeInfo> {
  const out = await run(config.ffprobe, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ]);
  const data = JSON.parse(out) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; color_transfer?: string; duration?: string }[];
  };
  const v = data.streams?.find((s) => s.codec_type === 'video');
  return {
    duration: Number(data.format?.duration ?? v?.duration ?? 0) || 0,
    transfer: v?.color_transfer ?? '',
    hasVideo: !!v,
  };
}

async function probeVideo(file: string): Promise<{ width: number; height: number; duration: number }> {
  const out = await run(config.ffprobe, [
    '-v', 'error', '-select_streams', 'v:0', '-print_format', 'json',
    '-show_entries', 'stream=width,height:format=duration', file,
  ]);
  const data = JSON.parse(out) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
  return {
    width: data.streams?.[0]?.width ?? 0,
    height: data.streams?.[0]?.height ?? 0,
    duration: Number(data.format?.duration ?? 0) || 0,
  };
}

async function detectEncoder(name: string): Promise<boolean> {
  try {
    const out = await run(config.ffmpeg, ['-hide_banner', '-encoders']);
    return new RegExp(`\\s${name}\\s`).test(out);
  } catch {
    return false;
  }
}

async function detectFilter(name: string): Promise<boolean> {
  try {
    const out = await run(config.ffmpeg, ['-hide_banner', '-filters']);
    return new RegExp(`\\s${name}\\s`).test(out);
  } catch {
    return false;
  }
}

export async function checkFfmpeg(): Promise<string | null> {
  try {
    const out = await run(config.ffmpeg, ['-hide_banner', '-version']);
    return out.split('\n')[0] ?? 'ffmpeg';
  } catch {
    return null;
  }
}

