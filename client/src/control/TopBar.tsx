import type { ProjectAction } from '../../../shared/protocol.js';
import { openOutputWindow } from './openOutput';
import { conn, useSnapshot } from './store';

export function sendProject(action: ProjectAction): void {
  if (!conn.send({ t: 'project', ...action })) alert('Keine Verbindung zum Server.');
}

interface Props {
  onOpenProjects: () => void;
  toast: (message: string, level?: 'info' | 'error') => void;
}

export function TopBar({ onOpenProjects, toast }: Props) {
  const snap = useSnapshot();
  const session = snap.session;
  const project = snap.state?.project;
  const output = snap.presence.outputs[0];
  const server = snap.status === 'online';

  let outLabel = 'Keine Ausgabe';
  let outClass = 'bad';
  if (server && output) {
    outLabel = `Ausgabe ${output.width}×${output.height} · ${output.fps} fps`;
    outClass = output.fps >= 50 ? 'ok' : output.fps >= 25 ? 'warn' : 'bad';
  }

  const save = () => {
    if (!project) return;
    if (session?.currentProjectId) sendProject({ action: 'save' });
    else {
      const name = prompt('Projektname', project.name);
      if (name) sendProject({ action: 'saveAs', name });
    }
  };

  return (
    <header className="topbar">
      <div className="brand" title={project?.name}>
        {project?.name ?? '…'}
        {session?.dirty && <span className="dirty" title="Ungespeicherte Änderungen"> •</span>}
      </div>
      <div className="group">
        <button onClick={onOpenProjects}>Projekte …</button>
        <button className="primary" onClick={save} title="Speichern (⌘S)">
          Speichern
        </button>
        <button
          onClick={() => {
            const name = project && prompt('Speichern unter', `${project.name} Kopie`);
            if (name) sendProject({ action: 'saveAs', name });
          }}
        >
          Speichern unter …
        </button>
      </div>
      <div className="group">
        <button disabled={!session?.canUndo} onClick={() => conn.undo()} title="Rückgängig (⌘Z)">
          ↶
        </button>
        <button disabled={!session?.canRedo} onClick={() => conn.redo()} title="Wiederherstellen (⇧⌘Z)">
          ↷
        </button>
      </div>
      <div className="spacer" />
      <span className={`pill ${server ? 'ok' : 'bad'}`}>{server ? 'Server' : 'Server getrennt'}</span>
      <span className={`pill ${outClass}`}>{outLabel}</span>
      {output?.videoBlocked && <span className="pill warn">Ausgabe einmal anklicken (Video blockiert)</span>}
      <button
        className="accent"
        onClick={async () => {
          const r = await openOutputWindow();
          toast(r.message, r.ok ? 'info' : 'error');
        }}
      >
        Ausgabe öffnen
      </button>
    </header>
  );
}
