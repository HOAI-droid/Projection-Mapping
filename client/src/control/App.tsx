import { useEffect, useState } from 'react';
import { handleEditorKey } from '../lib/editor/actions';
import { LayersPanel } from './LayersPanel';
import { MasksPanel } from './MasksPanel';
import { MediaPanel } from './MediaPanel';
import { ProjectDialog } from './ProjectDialog';
import { AudioPanel } from './AudioPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { ScenesPanel } from './ScenesPanel';
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
              V Fläche · M Maske · S Snap · G Raster · ⇧G Testgitter · E Bearbeiten/Show · 1–9 Szene · N nächste · B Blackout · ⌘Z
            </div>
          </main>
          <aside className="sidebar right">
            <RightTabs />
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

type RightTab = 'surface' | 'show' | 'audio' | 'media';
const RIGHT_TABS: { id: RightTab; label: string }[] = [
  { id: 'surface', label: 'Fläche' },
  { id: 'show', label: 'Show' },
  { id: 'audio', label: 'Audio ♪' },
  { id: 'media', label: 'Medien' },
];

/** Rechte Seitenleiste mit Reitern; der gewählte Reiter wird gemerkt */
function RightTabs() {
  const [tab, setTab] = useState<RightTab>(() => {
    try {
      return (localStorage.getItem('pm.rightTab') as RightTab | null) ?? 'surface';
    } catch {
      return 'surface';
    }
  });
  const choose = (t: RightTab) => {
    setTab(t);
    try {
      localStorage.setItem('pm.rightTab', t);
    } catch {
      /* egal */
    }
  };
  return (
    <>
      <div className="tabs">
        {RIGHT_TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => choose(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'surface' && <PropertiesPanel />}
      {tab === 'show' && <ScenesPanel />}
      {tab === 'audio' && <AudioPanel />}
      {tab === 'media' && <MediaPanel />}
    </>
  );
}
