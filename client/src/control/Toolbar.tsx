import type { TestPattern, Tool, ViewState } from '../../../shared/types.js';
import { conn, useSnapshot } from './store';

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'surface', label: 'Fläche', key: 'V' },
  { id: 'mask', label: 'Maske', key: 'M' },
];

const PATTERNS: { id: TestPattern; label: string }[] = [
  { id: 'none', label: 'Aus' },
  { id: 'grid', label: 'Gitter' },
  { id: 'white', label: 'Weiß' },
];

export function Toolbar() {
  const snap = useSnapshot();
  const view = snap.state!.view;
  const set = (patch: Partial<ViewState>) => conn.op({ kind: 'setView', patch });

  return (
    <div className="toolbar">
      <div className="segmented" role="group" aria-label="Werkzeug">
        {TOOLS.map((t) => (
          <button key={t.id} className={view.tool === t.id ? 'active' : ''} onClick={() => set({ tool: t.id })} title={`Taste ${t.key}`}>
            {t.label} <kbd>{t.key}</kbd>
          </button>
        ))}
      </div>
      {view.tool === 'mask' && (
        <div className="segmented" role="group" aria-label="Neue Masken gehören zu">
          <button className={view.maskScope === 'surface' ? 'active' : ''} onClick={() => set({ maskScope: 'surface' })}>
            Neue Maske: Fläche
          </button>
          <button className={view.maskScope === 'global' ? 'active' : ''} onClick={() => set({ maskScope: 'global' })}>
            Global
          </button>
        </div>
      )}
      <div className="spacer" />
      <span className="label">Testbild</span>
      <div className="segmented" role="group" aria-label="Testbild">
        {PATTERNS.map((p) => (
          <button key={p.id} className={view.testPattern === p.id ? 'active' : ''} onClick={() => set({ testPattern: p.id })}>
            {p.label}
          </button>
        ))}
      </div>
      <button className={`toggle ${view.editMode ? 'on' : ''}`} onClick={() => set({ editMode: !view.editMode })} title="Taste E">
        {view.editMode ? 'Bearbeiten' : 'Show'} <kbd>E</kbd>
      </button>
    </div>
  );
}
