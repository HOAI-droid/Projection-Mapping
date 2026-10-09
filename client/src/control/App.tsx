import { useEffect, useState } from 'react';
import type { Toast } from '../lib/connection';
import { ContentTab } from './ContentTab';
import { MappingTab } from './MappingTab';
import { MediaTab } from './MediaTab';
import { ProjectTab } from './ProjectTab';
import { StatusBar } from './StatusBar';
import { conn, useSnapshot } from './store';

type Tab = 'mapping' | 'content' | 'media' | 'project';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'mapping', label: 'Mapping', icon: '⬚' },
  { id: 'content', label: 'Inhalt', icon: '▶' },
  { id: 'media', label: 'Medien', icon: '⇪' },
  { id: 'project', label: 'Projekt', icon: '☰' },
];

export function App() {
  const snap = useSnapshot();
  const [tab, setTab] = useState<Tab>(() => (localStorageGet('pm.tab') as Tab | null) ?? 'mapping');
  const [toasts, setToasts] = useState<(Toast & { id: number })[]>([]);

  useEffect(() => {
    let n = 0;
    return conn.onToast((t) => {
      const id = ++n;
      setToasts((list) => [...list, { ...t, id }]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), t.level === 'error' ? 5000 : 2500);
    });
  }, []);

  const choose = (t: Tab) => {
    setTab(t);
    localStorageSet('pm.tab', t);
  };

  return (
    <div className="app">
      <StatusBar />
      <main className="content">
        {!snap.state ? (
          <div className="empty">Verbinde mit dem Server …</div>
        ) : tab === 'mapping' ? (
          <MappingTab />
        ) : tab === 'content' ? (
          <ContentTab />
        ) : tab === 'media' ? (
          <MediaTab />
        ) : (
          <ProjectTab />
        )}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => choose(t.id)}>
            <span className="tab-icon" aria-hidden>
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>
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

// localStorage kann in privaten Fenstern werfen
function localStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function localStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* egal */
  }
}
