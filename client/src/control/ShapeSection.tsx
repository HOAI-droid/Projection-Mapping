// Form der Fläche: Viereck, Kreis, Dreieck oder Verzerrungsgitter (Mesh) für gewölbte Objekte.

import { squareToQuad, apply } from '../../../shared/homography.js';
import { createMesh, evalMesh, MESH_MAX, shapeToOutput } from '../../../shared/mesh.js';
import { newId } from '../../../shared/ids.js';
import type { Point, Quad, Shape, Surface } from '../../../shared/types.js';
import { conn } from './store';

const SHAPES: { id: Shape; label: string; help: string }[] = [
  { id: 'quad', label: '▭ Viereck', help: 'Vier Ecken, perspektivisch (Corner Pin)' },
  { id: 'circle', label: '◯ Kreis', help: 'Kreis/Ellipse innerhalb der vier Ecken' },
  { id: 'triangle', label: '△ Dreieck', help: 'Drei Ecken' },
  { id: 'mesh', label: '▦ Gitter', help: 'Verzerrungsgitter für gewölbte Objekte (Säulen, Kugeln, Fahrzeuge …)' },
];

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function ShapeSection({ s }: { s: Surface }) {
  const setShape = (shape: Shape) => {
    if (shape === s.shape || s.locked) return;
    const g = newId();
    let corners: Quad = s.corners;
    // Dreieck ↔ Viereck: Ecken sinnvoll umrechnen (Spitze = Mitte der Oberkante)
    if (shape === 'triangle' && s.shape !== 'triangle') {
      corners = [mid(s.corners[0], s.corners[1]), s.corners[2], s.corners[3], s.corners[3]];
    } else if (s.shape === 'triangle' && shape !== 'triangle') {
      const [a, b, c] = s.corners;
      const half = { x: (b.x - c.x) / 2, y: (b.y - c.y) / 2 };
      corners = [{ x: a.x - half.x, y: a.y - half.y }, { x: a.x + half.x, y: a.y + half.y }, b, c];
    }
    if (corners !== s.corners) conn.op({ kind: 'setCorners', surfaceId: s.id, corners }, g);
    if (shape === 'mesh') {
      // Neues Gitter bildet die bisherige Abbildung nach – das Bild springt nicht
      const map = (u: number, v: number) => shapeToOutput({ ...s, corners }, { x: u, y: v }) ?? { x: u, y: v };
      conn.op({ kind: 'setMesh', surfaceId: s.id, mesh: createMesh(map, 4, 4) }, g);
    } else if (s.shape === 'mesh') {
      conn.op({ kind: 'setMesh', surfaceId: s.id, mesh: null }, g);
    }
    conn.op({ kind: 'updateSurface', surfaceId: s.id, patch: { shape } }, g);
  };

  const resize = (cols: number, rows: number) => {
    if (!s.mesh) return;
    const m = s.mesh;
    conn.op({ kind: 'setMesh', surfaceId: s.id, mesh: createMesh((u, v) => evalMesh(m, u, v), cols, rows) });
  };

  const flatten = () => {
    const h = squareToQuad(s.corners);
    if (!h || !s.mesh) return;
    conn.op({ kind: 'setMesh', surfaceId: s.id, mesh: createMesh((u, v) => apply(h, { x: u, y: v }), s.mesh.cols, s.mesh.rows) });
  };

  return (
    <div className="field">
      <span>Form</span>
      <div className="segmented wrap">
        {SHAPES.map((x) => (
          <button key={x.id} className={s.shape === x.id ? 'active' : ''} onClick={() => setShape(x.id)} title={x.help} disabled={s.locked}>
            {x.label}
          </button>
        ))}
      </div>
      {s.shape === 'mesh' && s.mesh && (
        <div className="mesh-controls">
          <label className="mini">
            Spalten
            <input type="number" min={1} max={MESH_MAX} value={s.mesh.cols} onChange={(e) => resize(clampN(e.target.value), s.mesh!.rows)} />
          </label>
          <label className="mini">
            Zeilen
            <input type="number" min={1} max={MESH_MAX} value={s.mesh.rows} onChange={(e) => resize(s.mesh!.cols, clampN(e.target.value))} />
          </label>
          <button className="small-btn" onClick={flatten} title="Wölbung entfernen, Ecken behalten">
            Glätten
          </button>
        </div>
      )}
      {s.shape === 'mesh' && (
        <span className="muted small">
          Gitterpunkte ziehen, um die Fläche der Wölbung anzupassen. Die Ecken ziehen das ganze Gitter perspektivisch mit.
        </span>
      )}
    </div>
  );
}

function clampN(v: string): number {
  return Math.min(MESH_MAX, Math.max(1, Math.round(Number(v) || 1)));
}
