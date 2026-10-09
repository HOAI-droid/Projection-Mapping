import { sendProject } from './TopBar';
import { useSnapshot } from './store';

export function ProjectDialog({ onClose }: { onClose: () => void }) {
  const snap = useSnapshot();
  const session = snap.session;
  const dirty = session?.dirty ?? false;
  const confirmDiscard = () => !dirty || confirm('Ungespeicherte Änderungen gehen verloren. Fortfahren?');

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Projekte">
        <div className="section-head">
          <h2>Projekte</h2>
          <button
            onClick={() => {
              if (!confirmDiscard()) return;
              const name = prompt('Name des neuen Projekts', 'Neues Projekt');
              if (name) {
                sendProject({ action: 'new', name });
                onClose();
              }
            }}
          >
            + Neues Projekt
          </button>
          <button onClick={onClose}>Schließen</button>
        </div>
        {(session?.projects.length ?? 0) === 0 && <p className="muted">Noch keine gespeicherten Projekte.</p>}
        <ul className="list">
          {session?.projects.map((p) => (
            <li key={p.id} className={`list-row${p.id === session.currentProjectId ? ' active' : ''}`}>
              <span className="row-name">{p.name}</span>
              <span className="row-meta">{formatDate(p.updatedAt)}</span>
              <button
                onClick={() => {
                  if (!confirmDiscard()) return;
                  sendProject({ action: 'load', id: p.id });
                  onClose();
                }}
              >
                Laden
              </button>
              <button
                onClick={() => {
                  const name = prompt('Neuer Name', p.name);
                  if (name) sendProject({ action: 'rename', id: p.id, name });
                }}
              >
                Umbenennen
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (confirm(`Projekt „${p.name}“ löschen?`)) sendProject({ action: 'delete', id: p.id });
                }}
              >
                Löschen
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}
