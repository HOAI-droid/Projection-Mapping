// Ebenenstapel: Flächen und Masken-Ebenen. Oben in der Liste = vorne im Bild.
// Eine Masken-Ebene wirkt auf alle Ebenen, die in der Liste UNTER ihr stehen.

import { addSurface, duplicateSurface, newMask, removeLayer, selectMask, selectSurface } from '../lib/editor/actions';
import type { Layer } from '../../../shared/types.js';
import { conn, useSnapshot } from './store';

export function LayersPanel() {
  const snap = useSnapshot();
  const { project, view } = snap.state!;
  const layers = project.layers;
  const isSelected = (l: Layer) => l.id === (l.kind === 'surface' ? view.selectedSurfaceId : view.selectedMaskId);
  const selIndex = layers.findIndex(isSelected);
  const sel = layers[selIndex];
  let surfaceNo = 0;
  const numbers = new Map(layers.map((l) => [l.id, l.kind === 'surface' ? ++surfaceNo : 0]));

  return (
    <section className="panel-section">
      <div className="section-head">
        <h3>Ebenen</h3>
        <button className="small-btn" onClick={() => addSurface(conn)} title="Neue Fläche (Viereck mit Corner Pin)">
          + Fläche
        </button>
        <button
          className="small-btn"
          onClick={() => {
            newMask(conn, 'layer');
          }}
          title="Neue Masken-Ebene: schneidet aus allen Ebenen darunter aus"
        >
          + Maske ✂
        </button>
      </div>
      <ul className="list">
        {[...layers].reverse().map((l) => {
          const active = isSelected(l);
          if (l.kind === 'mask') {
            return (
              <li
                key={l.id}
                className={`list-row mask-row${active ? ' active' : ''}${l.enabled ? '' : ' hidden-layer'}`}
                onClick={() => selectMask(conn, l.id)}
                onDoubleClick={() => rename(l)}
                title="Masken-Ebene: wirkt auf alle Ebenen darunter"
              >
                <button
                  className="icon-btn"
                  title={l.enabled ? 'Ausschalten' : 'Einschalten'}
                  onClick={(e) => {
                    e.stopPropagation();
                    conn.op({ kind: 'updateMask', maskId: l.id, patch: { enabled: !l.enabled } });
                  }}
                >
                  {l.enabled ? '👁' : '–'}
                </button>
                <span className="row-num">✂</span>
                <span className="row-name">{l.name}</span>
                <span className="row-meta">{l.mode === 'subtract' ? 'schneidet aus' : 'nur innen'}</span>
                <LockButton layer={l} />
              </li>
            );
          }
          return (
            <li
              key={l.id}
              className={`list-row${active ? ' active' : ''}${l.visible ? '' : ' hidden-layer'}`}
              onClick={() => selectSurface(conn, l.id)}
              onDoubleClick={() => rename(l)}
            >
              <button
                className="icon-btn"
                title={l.visible ? 'Ausblenden' : 'Einblenden'}
                onClick={(e) => {
                  e.stopPropagation();
                  conn.op({ kind: 'updateSurface', surfaceId: l.id, patch: { visible: !l.visible } });
                }}
              >
                {l.visible ? '👁' : '–'}
              </button>
              <span className="row-num">{numbers.get(l.id)}</span>
              <span className="row-name">{l.name}</span>
              <span className="row-meta">
                {contentLabel(l)}
                {l.masks.length > 0 && ` · ${l.masks.length} M.`}
              </span>
              <LockButton layer={l} />
            </li>
          );
        })}
      </ul>
      {sel && (
        <div className="button-row">
          <button
            disabled={selIndex >= layers.length - 1}
            onClick={() => conn.op({ kind: 'moveLayer', layerId: sel.id, index: selIndex + 1 })}
            title="Eine Ebene nach vorne (in der Liste nach oben)"
          >
            ↑
          </button>
          <button
            disabled={selIndex <= 0}
            onClick={() => conn.op({ kind: 'moveLayer', layerId: sel.id, index: selIndex - 1 })}
            title="Eine Ebene nach hinten"
          >
            ↓
          </button>
          {sel.kind === 'surface' && <button onClick={() => duplicateSurface(conn, sel.id)}>Duplizieren</button>}
          <button
            className="danger"
            onClick={() => {
              if (confirm(`„${sel.name}“ löschen?`)) removeLayer(conn, sel.id);
            }}
          >
            Löschen
          </button>
        </div>
      )}
      <p className="muted small">
        Oben in der Liste = vorne. Eine <b>Masken-Ebene ✂</b> schneidet aus allem darunter aus – so lassen sich Flächen
        aus Flächen ausschneiden.
      </p>
    </section>
  );
}

function rename(l: Layer): void {
  const name = prompt('Name', l.name);
  if (!name) return;
  if (l.kind === 'surface') conn.op({ kind: 'updateSurface', surfaceId: l.id, patch: { name } });
  else conn.op({ kind: 'updateMask', maskId: l.id, patch: { name } });
}

function LockButton({ layer }: { layer: Layer }) {
  return (
    <button
      className={`icon-btn${layer.locked ? ' on' : ''}`}
      title={layer.locked ? 'Entsperren' : 'Sperren (gegen versehentliches Verschieben)'}
      onClick={(e) => {
        e.stopPropagation();
        if (layer.kind === 'surface') conn.op({ kind: 'updateSurface', surfaceId: layer.id, patch: { locked: !layer.locked } });
        else conn.op({ kind: 'updateMask', maskId: layer.id, patch: { locked: !layer.locked } });
      }}
    >
      {layer.locked ? '🔒' : '🔓'}
    </button>
  );
}

function contentLabel(l: Layer): string {
  if (l.kind !== 'surface') return '';
  const t = l.content.type;
  return ({ none: 'leer', testgrid: 'Gitter', color: 'Farbe', image: 'Bild', video: 'Video', effect: 'Effekt' } as Record<string, string>)[t] ?? t;
}
