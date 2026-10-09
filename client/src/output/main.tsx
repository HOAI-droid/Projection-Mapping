// /output – Vollbild-Ausgabe für den Beamer. Im Bearbeitungsmodus lassen sich
// Ecken und Masken direkt hier mit der Maus setzen – dort, wo man sie auf dem Objekt sieht.

import { StrictMode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Connection } from '../lib/connection';
import { handleEditorKey } from '../lib/editor/actions';
import { Editor } from '../lib/editor/Editor';
import { Scene } from '../lib/render/scene';
import { drawTestPattern } from './testpattern';
import './output.css';

const conn = new Connection('output');

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen().catch(() => {});
}

function OutputApp() {
  const snap = useSyncExternalStore(conn.subscribe, conn.getSnapshot);
  const glRef = useRef<HTMLCanvasElement>(null);
  const patternRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [px, setPx] = useState({ width: 1280, height: 720 });
  const [fullscreen, setFullscreen] = useState(false);
  const pxRef = useRef(px);
  pxRef.current = px;

  // Renderschleife (unabhängig von React-Renderings)
  useEffect(() => {
    let scene: Scene;
    try {
      scene = new Scene(glRef.current!);
    } catch (err) {
      setError(`Ausgabe nicht möglich: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    sceneRef.current = scene;
    const canvas = glRef.current!;
    // Kontextverlust (GPU-Reset) → sauber neu laden
    const onLost = (e: Event) => e.preventDefault();
    const onRestored = () => location.reload();
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    let frames = 0;
    let fps = 0;
    let since = performance.now();
    let size = { width: 0, height: 0 };
    let lastPattern = '';
    let id = 0;
    const sendStatus = () =>
      conn.send({ t: 'outputStatus', fps, width: size.width, height: size.height, videoBlocked: scene.videos.blocked });

    const frame = (now: number) => {
      id = requestAnimationFrame(frame);
      const { state, media } = conn.snapshot;
      if (!state) return;
      size = scene.render(state, media, { width: canvas.width || 1280, height: canvas.height || 720 });

      // Testbild nur bei Änderung neu zeichnen
      const pc = patternRef.current!;
      const key = `${state.view.testPattern}|${size.width}x${size.height}`;
      if (key !== lastPattern) {
        pc.width = size.width;
        pc.height = size.height;
        drawTestPattern(pc.getContext('2d')!, state.view.testPattern);
        lastPattern = key;
        setPx((p) => (p.width === size.width && p.height === size.height ? p : { ...size }));
      }

      frames++;
      if (now - since >= 1000) {
        fps = (frames * 1000) / (now - since);
        frames = 0;
        since = now;
        sendStatus();
      }
    };
    id = requestAnimationFrame(frame);
    const unsub = conn.subscribe(() => {
      if (conn.snapshot.status === 'online') sendStatus();
    });
    return () => {
      cancelAnimationFrame(id);
      unsub();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Fenstergröße, Vollbild, Tastatur, Wake Lock
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) {
        toggleFullscreen();
        e.preventDefault();
        return;
      }
      if (handleEditorKey(e, conn, pxRef.current)) e.preventDefault();
    };
    let lock: WakeLockSentinel | null = null;
    const requestLock = async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        lock = null;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void requestLock();
      else lock = null; // vom System freigegeben
    };
    void requestLock();
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);

  const state = snap.state;
  const edit = state?.view.editMode ?? false;

  // Erster Klick: blockierte Videos starten (Autoplay-Sperre)
  const onPointerDownCapture = () => {
    const sc = sceneRef.current;
    if (sc?.videos.blocked && state) sc.videos.unlock(state.project);
  };

  return (
    <div className={`output${edit ? ' edit' : ''}`} onPointerDownCapture={onPointerDownCapture}>
      <canvas ref={glRef} className="layer" />
      <canvas ref={patternRef} className="layer" />
      {state && edit && (
        <Editor state={state} conn={conn} width={viewport.w} height={viewport.h} out={px} onOutput />
      )}
      {edit && (
        <div className="hud">
          {!fullscreen && (
            <button type="button" onClick={toggleFullscreen}>
              Vollbild (F)
            </button>
          )}
          <span>
            E Show · V Fläche · M Maske · S Snap · G Raster · Pfeile 1 px (⇧ 10 px) · ⌘Z Rückgängig
          </span>
        </div>
      )}
      {edit && snap.status !== 'online' && <div className="offline">Server getrennt – verbinde neu …</div>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OutputApp />
  </StrictMode>,
);
