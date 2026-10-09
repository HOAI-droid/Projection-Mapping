import type { ProjectAction } from '../../../shared/protocol.js';
import { conn, useSnapshot } from './store';

function send(action: ProjectAction) {
  if (!conn.send({ t: 'project', ...action })) alert('Keine Verbindung zum Server.');
}

export function ProjectTab() {
  const snap = useSnapshot();
  const session = snap.session;
  const project = snap.state!.project;
  const dirty = session?.dirty ?? false;

  const confirmDiscard = () => !dirty || confirm('Ungespeicherte Änderungen gehen verloren. Fortfahren?');

  return (
    <div className="page">
      <h2>Projekt</h2>
      <div className="card">
        <div className="project-title">{project.name}</div>
        <div className="muted small">
          {session?.currentProjectId ? (dirty ? 'Ungespeicherte Änderungen' : 'Gespeichert') : 'Noch nicht gespeichert'}
        </div>
        <div className="row">
          <button
            className="primary"
            onClick={() => {
              if (session?.currentProjectId) send({ action: 'save' });
              else {
                const name = prompt('Projektname', project.name);
                if (name) send({ action: 'saveAs', name });
              }
            }}
          >
            Speichern
          </button>
          <button
            className="secondary"
            onClick={() => {
              const name = prompt('Speichern unter', `${project.name} Kopie`);
              if (name) send({ action: 'saveAs', name });
            }}
          >
            Speichern unter …
          </button>
          <button
            className="secondary"
            onClick={() => {
              if (!confirmDiscard()) return;
              const name = prompt('Name des neuen Projekts', 'Neues Projekt');
              if (name) send({ action: 'new', name });
            }}
          >
            Neu
          </button>
        </div>
      </div>

      <h3>Gespeicherte Projekte</h3>
      {(session?.projects.length ?? 0) === 0 && <p className="empty">Noch keine gespeicherten Projekte.</p>}
      {session?.projects.map((p) => (
        <div key={p.id} className={`project-row ${p.id === session.currentProjectId ? 'current' : ''}`}>
          <div className="media-info">
            <div className="media-name">{p.name}</div>
            <div className="muted small">{formatDate(p.updatedAt)}</div>
          </div>
          <div className="media-actions">
            <button
              className="secondary"
              onClick={() => {
                if (confirmDiscard()) send({ action: 'load', id: p.id });
              }}
            >
              Laden
            </button>
            <button
              className="secondary icon"
              aria-label="Umbenennen"
              onClick={() => {
                const name = prompt('Neuer Name', p.name);
                if (name) send({ action: 'rename', id: p.id, name });
              }}
            >
              ✎
            </button>
            <button
              className="danger icon"
              aria-label="Löschen"
              onClick={() => {
                if (confirm(`Projekt „${p.name}“ löschen?`)) send({ action: 'delete', id: p.id });
              }}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}
