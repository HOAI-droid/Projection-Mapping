import { newMask, repeatGesture } from '../lib/editor/actions';
import type { Mask } from '../../../shared/types.js';
import { conn, useSnapshot } from './store';

export function MasksPanel() {
  const snap = useSnapshot();
  const { project, view } = snap.state!;
  const surface = project.surfaces.find((s) => s.id === view.selectedSurfaceId) ?? null;

  const select = (m: Mask) => conn.op({ kind: 'setView', patch: { tool: 'mask', selectedMaskId: m.id, selectedPoint: null } });

  const rows = (masks: Mask[]) =>
    masks.map((m) => {
      const active = m.id === view.selectedMaskId;
      return (
        <li key={m.id} className={`list-row${active ? ' active' : ''}`} onClick={() => select(m)}>
          <input
            type="checkbox"
            checked={m.enabled}
            title="Aktiv"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => conn.op({ kind: 'updateMask', maskId: m.id, patch: { enabled: e.target.checked } })}
          />
          <span className="row-name">{m.name}</span>
          <span className="row-meta">
            {m.points.length} Pkt.{m.invert ? ' · invertiert' : ''}
          </span>
        </li>
      );
    });

  const sel =
    project.masks.find((m) => m.id === view.selectedMaskId) ??
    surface?.masks.find((m) => m.id === view.selectedMaskId) ??
    null;

  return (
    <section className="panel-section">
      <div className="section-head">
        <h3>Masken</h3>
        <button className="small-btn" disabled={!surface} onClick={() => newMask(conn, false)} title="Maske für die gewählte Fläche">
          + Fläche
        </button>
        <button className="small-btn" onClick={() => newMask(conn, true)} title="Maske im Ausgaberaum, wirkt auf alles">
          + Global
        </button>
      </div>
      {project.masks.length > 0 && (
        <>
          <div className="sub-head">Global</div>
          <ul className="list">{rows(project.masks)}</ul>
        </>
      )}
      {surface && surface.masks.length > 0 && (
        <>
          <div className="sub-head">{surface.name}</div>
          <ul className="list">{rows(surface.masks)}</ul>
        </>
      )}
      {project.masks.length === 0 && (!surface || surface.masks.length === 0) && (
        <p className="muted small">
          Werkzeug „Maske“ (M) wählen und auf der Bühne oder direkt auf der Projektion Punkte um das Objekt klicken.
        </p>
      )}
      {sel && (
        <div className="props">
          <label className="field">
            <span>Name</span>
            <input
              key={sel.id}
              defaultValue={sel.name}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== sel.name) conn.op({ kind: 'updateMask', maskId: sel.id, patch: { name } });
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={sel.invert}
              onChange={(e) => conn.op({ kind: 'updateMask', maskId: sel.id, patch: { invert: e.target.checked } })}
            />
            Invertieren (Inneres ausblenden)
          </label>
          <label className="field">
            <span>Weiche Kante {Math.round(sel.feather)} px</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={sel.feather}
              onChange={(e) =>
                conn.op(
                  { kind: 'updateMask', maskId: sel.id, patch: { feather: Number(e.target.value) } },
                  repeatGesture(`feather-${sel.id}`, 800),
                )
              }
            />
          </label>
          <div className="button-row">
            <button
              className="danger"
              onClick={() => {
                conn.op({ kind: 'removeMask', maskId: sel.id });
                conn.op({ kind: 'setView', patch: { selectedMaskId: null, selectedPoint: null } });
              }}
            >
              Maske löschen
            </button>
          </div>
          <p className="muted small">
            Klick ins Leere: Punkt anhängen · Klick auf Kante: Punkt einfügen · Entf: Punkt löschen · Esc: fertig
          </p>
        </div>
      )}
    </section>
  );
}
