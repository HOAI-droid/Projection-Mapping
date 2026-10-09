import { useEffect, useState } from 'react';
import { handleEditorKey } from '../lib/editor/actions';
import { LayersPanel } from './LayersPanel';
import { MasksPanel } from './MasksPanel';
import { MediaPanel } from './MediaPanel';
import { ProjectDialog } from './ProjectDialog';
import { PropertiesPanel } from './PropertiesPanel';
import { Stage } from './Stage';
import { Toolbar } from './Toolbar';
import { sendProject, TopBar } from './TopBar';
import { conn, outputSize, useSnapshot } from './store';

interface ToastItem {
  id: number;
  level: 'info' | 'error';
  message: string;
}

let toastId = 0;

export function App() {
  const snap = useSnapshot();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(false);

  const toast = (message: string, level: 'info' | 'error' = 'info') => {
    const id = ++toastId;
    setToasts((list) => [...list, { id, level, message }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), level === 'error' ? 6000 : 3500);
  };

  useEffect(() => conn.onToast((t) => toast(t.message, t.level)), []);

  // Tastaturkürzel (gleiche wie auf der Ausgabe) + ⌘S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        const st = conn.snapshot;
        if (st.session?.currentProjectId) sendProject({ action: 'save' });
        else {
          const name = prompt('Projektname', st.state?.project.name ?? 'Projekt');
          if (name) sendProject({ action: 'saveAs', name });
        }
        return;
      }
      if (handleEditorKey(e, conn, outputSize(conn.snapshot))) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <TopBar onOpenProjects={() => setProjectsOpen(true)} toast={toast} />
      {!snap.state ? (
        <div className="empty">Verbinde mit dem Server …</div>
      ) : (
        <div className="workspace">
          <aside className="sidebar left">
            <LayersPanel />
            <MasksPanel />
          </aside>
          <main className="center">
            <Toolbar />
            <Stage />
            <div className="shortcuts">
              Ziehen: Ecke/Fläche · Pinch: skalieren · ⌥+Scrollen: drehen · Pfeile: 1 px (⇧ 10 px) · Tab: nächste Ecke ·
              V Fläche · M Maske · S Snap · G Raster · ⇧G Testgitter · E Bearbeiten/Show · ⌘Z/⇧⌘Z
            </div>
          </main>
          <aside className="sidebar right">
            <PropertiesPanel />
            <MediaPanel />
          </aside>
        </div>
      )}
      {projectsOpen && <ProjectDialog onClose={() => setProjectsOpen(false)} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
