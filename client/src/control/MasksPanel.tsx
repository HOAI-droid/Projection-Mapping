// Masken-Stapel der gewählten Fläche (wie in MadMapper: jede Maske fügt hinzu,
// schneidet aus oder bildet die Schnittmenge – von oben nach unten verrechnet).

import type { Mask, MaskMode } from '../../../shared/types.js';
import { findSurface } from '../../../shared/state.js';
import { repeatGesture, selectMask } from '../lib/editor/actions';
import { conn, useSnapshot } from './store';

export const MASK_MODE_LABELS: Record<MaskMode, string> = {
  add: '＋ Hinzufügen',
  subtract: '− Ausschneiden',
  intersect: '∩ Schnittmenge',
};

export function MasksPanel() {
  const snap = useSnapshot();
  const { project, view } = snap.state!;
  const surface = findSurface(project, view.selectedSurfaceId);

  if (!surface) {
    return (
      <section className="panel-section">
        <h3>Masken der Fläche</h3>
        <p className="muted small">Fläche wählen, um ihr Masken zu geben. Für Masken über mehrere Flächen: „+ Maske ✂“ bei den Ebenen.</p>
      </section>
    );
  }

  const masks = surface.masks;
  const sel = masks.find((m) => m.id === view.selectedMaskId) ?? null;

  const startDrawing = () =>
    conn.op({ kind: 'setView', patch: { tool: 'mask', maskScope: 'surface', selectedMaskId: null, selectedPoint: null } });

  return (
    <section className="panel-section">
      <div className="section-head">
        <h3>Masken · {surface.name}</h3>
        <button className="small-btn" onClick={startDrawing} title="Dann auf der Bühne oder der Projektion zeichnen">
          + Maske zeichnen
        </button>
      </div>
      {masks.length === 0 ? (
        <p className="muted small">
          „+ Maske zeichnen“, dann den Umriss mit gedrückter Maustaste nachfahren oder Punkt für Punkt klicken.
          Die erste Maske bestimmt, was sichtbar ist; weitere Masken schneiden heraus oder fügen hinzu.
        </p>
      ) : (
        <ul className="list">
          {masks.map((m, i) => (
            <li key={m.id} className={`list-row${m.id === sel?.id ? ' active' : ''}`} onClick={() => selectMask(conn, m.id)}>
              <input
                type="checkbox"
                checked={m.enabled}
                title="Aktiv"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => conn.op({ kind: 'updateMask', maskId: m.id, patch: { enabled: e.target.checked } })}
              />
              <span className="row-name">{m.name}</span>
              <span className={`mode-badge ${m.mode}`}>{MASK_MODE_LABELS[m.mode].split(' ')[0]}</span>
              <span className="row-meta">{m.points.length} P.</span>
              <button
                className="icon-btn"
                disabled={i === 0}
                title="Nach oben (früher verrechnen)"
                onClick={(e) => {
                  e.stopPropagation();
                  conn.op({ kind: 'moveMask', maskId: m.id, index: i - 1 });
                }}
              >
                ↑
              </button>
              <button
                className="icon-btn"
                disabled={i === masks.length - 1}
                title="Nach unten"
                onClick={(e) => {
                  e.stopPropagation();
                  conn.op({ kind: 'moveMask', maskId: m.id, index: i + 1 });
                }}
              >
                ↓
              </button>
            </li>
          ))}
        </ul>
      )}
      {sel && <MaskProps mask={sel} />}
    </section>
  );
}

/** Einstellungen einer Maske – auch für Masken-Ebenen verwendet */
export function MaskProps({ mask, layer }: { mask: Mask; layer?: boolean }) {
  const modes: MaskMode[] = layer ? ['subtract', 'intersect'] : ['add', 'subtract', 'intersect'];
  return (
    <div className="props">
      <label className="field">
        <span>Name</span>
        <input
          key={mask.id}
          defaultValue={mask.name}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== mask.name) conn.op({ kind: 'updateMask', maskId: mask.id, patch: { name } });
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <div className="field">
        <span>Wirkung</span>
        <div className="segmented">
          {modes.map((m) => (
            <button
              key={m}
              className={mask.mode === m ? 'active' : ''}
              onClick={() => conn.op({ kind: 'updateMask', maskId: mask.id, patch: { mode: m } })}
              title={MODE_HELP[m]}
            >
              {layer ? (m === 'subtract' ? '✂ Ausschneiden' : '◼ Nur Inneres') : MASK_MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <span className="muted small">{layer ? LAYER_HELP[mask.mode] : MODE_HELP[mask.mode]}</span>
      </div>
      <label className="field">
        <span>Weiche Kante {Math.round(mask.feather)} px</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={mask.feather}
          onChange={(e) =>
            conn.op(
              { kind: 'updateMask', maskId: mask.id, patch: { feather: Number(e.target.value) } },
              repeatGesture(`feather-${mask.id}`, 800),
            )
          }
        />
      </label>
      <div className="button-row">
        <button
          className="danger"
          onClick={() => {
            conn.op({ kind: 'removeMask', maskId: mask.id });
            conn.op({ kind: 'setView', patch: { selectedMaskId: null, selectedPoint: null } });
          }}
        >
          Maske löschen
        </button>
      </div>
      <p className="muted small">
        Punkt ziehen · Klick auf Kante: Punkt einfügen · Klick ins Leere: Punkt anhängen · Entf: Punkt löschen · Enter: fertig
      </p>
    </div>
  );
}

const MODE_HELP: Record<MaskMode, string> = {
  add: 'Macht das Innere sichtbar. Steht sie ganz oben, ist nur ihr Inneres zu sehen.',
  subtract: 'Schneidet das Innere aus dem bisher Sichtbaren heraus (z. B. ein Fenster).',
  intersect: 'Lässt nur sichtbar, was auch innerhalb dieser Maske liegt.',
};

const LAYER_HELP: Record<MaskMode, string> = {
  add: '',
  subtract: 'Alles, was in der Ebenenliste darunter liegt, wird innerhalb der Maske ausgeschnitten.',
  intersect: 'Von allem darunter bleibt nur das Innere der Maske übrig.',
};
