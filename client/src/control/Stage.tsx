// Bühne: Live-Vorschau der Ausgabe (gleicher Renderer) mit der Bearbeitungsebene darüber.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Editor } from '../lib/editor/Editor';
import { Scene } from '../lib/render/scene';
import { conn, outputSize, useSnapshot } from './store';

export function Stage() {
  const snap = useSnapshot();
  const out = outputSize(snap);
  const aspect = out.width / out.height;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [error, setError] = useState<string | null>(null);
  const outRef = useRef(out);
  outRef.current = out;

  // Bühne mit dem Seitenverhältnis der Ausgabe in den verfügbaren Platz einpassen
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      let w = width;
      let h = w / aspect;
      if (h > height) {
        h = height;
        w = h * aspect;
      }
      setBox({ w: Math.floor(w), h: Math.floor(h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  useEffect(() => {
    let scene: Scene;
    try {
      scene = new Scene(canvasRef.current!);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    let id = 0;
    const frame = () => {
      id = requestAnimationFrame(frame);
      const { state, media } = conn.snapshot;
      if (state) scene.render(state, media, outRef.current);
    };
    id = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(id);
      scene.dispose();
    };
  }, []);

  return (
    <div className="stage-wrap" ref={wrapRef}>
      <div className="stage" style={{ width: box.w, height: box.h }}>
        <canvas ref={canvasRef} className="stage-canvas" />
        {snap.state && box.w > 0 && <Editor state={snap.state} conn={conn} width={box.w} height={box.h} out={out} />}
        {error && <div className="stage-error">Vorschau nicht möglich: {error}</div>}
      </div>
    </div>
  );
}
