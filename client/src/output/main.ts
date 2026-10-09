// /output – Vollbild-Ausgabe für den Beamer. Kein React, damit es auch auf schwacher Hardware schlank bleibt.

import type { AppState } from '../../../shared/types.js';
import { Connection } from '../lib/connection';
import { drawOverlay } from './overlay';
import { Renderer, type DrawItem } from './renderer';
import { createTestGridCanvas } from './testgrid';
import { VideoPool } from './videos';
import './output.css';

const glCanvas = document.getElementById('gl') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement;
const startEl = document.getElementById('start') as HTMLElement;
const errorEl = document.getElementById('error') as HTMLElement;

function fatal(msg: string): never {
  errorEl.textContent = msg;
  errorEl.hidden = false;
  throw new Error(msg);
}

let renderer: Renderer;
try {
  renderer = new Renderer(glCanvas);
} catch (err) {
  fatal(`Ausgabe nicht möglich: ${err instanceof Error ? err.message : String(err)}`);
}

// Kontextverlust (z. B. GPU-Reset, iOS im Hintergrund) → sauber neu laden
glCanvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
glCanvas.addEventListener('webglcontextrestored', () => location.reload());

const overlay = overlayCanvas.getContext('2d')!;
const conn = new Connection('output');
const videos = new VideoPool(renderer);
const gridTexture = renderer.createTexture();
renderer.upload(gridTexture, createTestGridCanvas(), true);

// --- Start per Tipp (iOS: Wiedergabe, Vollbild und Wake Lock brauchen eine Benutzergeste)
let started = false;
let wakeLock: WakeLockSentinel | null = null;

async function requestWakeLock(): Promise<void> {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
}

function enterFullscreen(): void {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (el.requestFullscreen) void el.requestFullscreen().catch(() => {});
    else el.webkitRequestFullscreen?.();
  } catch {
    // iPhone kennt kein Element-Vollbild → PWA vom Home-Bildschirm nutzen
  }
}

startEl.addEventListener('click', () => {
  started = true;
  startEl.hidden = true;
  enterFullscreen();
  void requestWakeLock();
  const state = conn.snapshot.state;
  if (state) videos.unlock(state.project);
  sendStatus();
});

document.addEventListener('visibilitychange', () => {
  // Das System gibt den Wake Lock beim Verstecken frei → beim Zurückkehren neu anfordern
  if (document.visibilityState === 'hidden') wakeLock = null;
  else if (started && !wakeLock) void requestWakeLock();
});

// --- Renderschleife
let lastState: AppState | null = null;
let lastSize = '';
let lastStatus = conn.snapshot.status;
let frames = 0;
let fps = 0;
let fpsSince = performance.now();
let size = { width: 0, height: 0 };

function frame(now: number): void {
  requestAnimationFrame(frame);

  size = renderer.resize();
  const sizeKey = `${size.width}x${size.height}`;
  if (overlayCanvas.width !== size.width || overlayCanvas.height !== size.height) {
    overlayCanvas.width = size.width;
    overlayCanvas.height = size.height;
  }

  const { state, status } = conn.snapshot;
  if (state && state !== lastState) videos.sync(state.project);

  const items: DrawItem[] = [];
  if (state) {
    for (const s of state.project.surfaces) {
      if (!s.visible) continue;
      let texture: WebGLTexture | null = null;
      if (s.content.type === 'testgrid') texture = gridTexture;
      else if (s.content.type === 'video') texture = videos.texture(s.content.mediaId);
      if (texture) items.push({ corners: s.corners, texture, opacity: 1 });
    }
  }
  renderer.draw(items);

  // Overlay nur neu zeichnen, wenn sich etwas geändert hat
  if (state && (state !== lastState || sizeKey !== lastSize || status !== lastStatus)) {
    drawOverlay(overlay, state);
    if (status !== 'online' && state.view.showOutlines) {
      overlay.fillStyle = '#ef4444';
      overlay.font = `bold ${Math.round(size.height / 30)}px system-ui, sans-serif`;
      overlay.textAlign = 'right';
      overlay.textBaseline = 'top';
      overlay.fillText('Server getrennt – verbinde neu …', size.width - 16, 16);
    }
  }
  lastState = state;
  lastSize = sizeKey;
  lastStatus = status;

  frames++;
  if (now - fpsSince >= 1000) {
    fps = (frames * 1000) / (now - fpsSince);
    frames = 0;
    fpsSince = now;
    sendStatus();
  }
}

function sendStatus(): void {
  conn.send({ t: 'outputStatus', fps, width: size.width, height: size.height, started });
}

conn.subscribe(() => {
  // Nach einem Reconnect sofort den Status melden, damit die Steuerung „online“ zeigt
  if (conn.snapshot.status === 'online' && lastStatus !== 'online') sendStatus();
});

requestAnimationFrame(frame);
