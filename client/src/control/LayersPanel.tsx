// Ebenenliste: oberste Fläche steht oben (Zeichenreihenfolge umgekehrt angezeigt).

import { addSurface, duplicateSurface, removeSurface, selectSurface } from '../lib/editor/actions';
import { conn, useSnapshot } from './store';

export function LayersPanel() {
  const snap = useSnapshot();
  const { project, view } = snap.state!;
  const surfaces = project.surfaces;
  const selIndex = surfaces.findIndex((s) => s.id === view.selectedSurfaceId);
  const sel = surfaces[selIndex];

  return (
    <section className="panel-section">
      <div className="section-head">
        <h3>Flächen</h3>
        <button className="small-btn" onClick={() => addSurface(conn)} title="Neue Fläche">
          + Fläche
        </button>
      </div>
      <ul className="list">
        {[...surfaces].reverse().map((s) => {
          const idx = surfaces.indexOf(s);
          const active = s.id === view.selectedSurfaceId;
          return (
            <li
              key={s.id}
              className={`list-row${active ? ' active' : ''}${s.visible ? '' : ' hidden-layer'}`}
              onClick={() => selectSurface(conn, s.id)}
              onDoubleClick={() => {
                const name = prompt('Name der Fläche', s.name);
                if (name) conn.op({ kind: 'updateSurface', surfaceId: s.id, patch: { name } });
              }}
            >
              <button
                className="icon-btn"
                title={s.visible ? 'Ausblenden' : 'Einblenden'}
                onClick={(e) => {
                  e.stopPropagation();
                  conn.op({ kind: 'updateSurface', surfaceId: s.id, patch: { visible: !s.visible } });
                }}
              >
                {s.visible ? '👁' : '–'}
              </button>
              <span className="row-num">{idx + 1}</span>
              <span className="row-name">{s.name}</span>
              <span className="row-meta">{contentLabel(s.content.type)}</span>
              <button
                className={`icon-btn${s.locked ? ' on' : ''}`}
                title={s.locked ? 'Entsperren' : 'Sperren'}
                onClick={(e) => {
                  e.stopPropagation();
                  conn.op({ kind: 'updateSurface', surfaceId: s.id, patch: { locked: !s.locked } });
                }}
              >
                {s.locked ? '🔒' : '🔓'}
              </button>
            </li>
          );
        })}
      </ul>
      {sel && (
        <div className="button-row">
          <button
            disabled={selIndex >= surfaces.length - 1}
            onClick={() => conn.op({ kind: 'moveSurface', surfaceId: sel.id, index: selIndex + 1 })}
            title="Eine Ebene nach oben"
          >
            ↑
          </button>
          <button
            disabled={selIndex <= 0}
            onClick={() => conn.op({ kind: 'moveSurface', surfaceId: sel.id, index: selIndex - 1 })}
            title="Eine Ebene nach unten"
          >
            ↓
          </button>
          <button onClick={() => duplicateSurface(conn, sel.id)}>Duplizieren</button>
          <button
            className="danger"
            onClick={() => {
              if (confirm(`Fläche „${sel.name}“ löschen?`)) removeSurface(conn, sel.id);
            }}
          >
            Löschen
          </button>
        </div>
      )}
    </section>
  );
}

function contentLabel(t: string): string {
  return ({ none: 'leer', testgrid: 'Gitter', color: 'Farbe', image: 'Bild', video: 'Video' } as Record<string, string>)[t] ?? t;
}
