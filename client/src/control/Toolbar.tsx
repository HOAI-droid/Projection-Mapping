import type { GridSettings, TestPattern, Tool, ViewState } from '../../../shared/types.js';
import { repeatGesture } from '../lib/editor/actions';
import { conn, useSnapshot } from './store';

const TOOLS: { id: Tool; label: string; key: string; help: string }[] = [
  { id: 'surface', label: '⬚ Fläche', key: 'V', help: 'Ecken ziehen, Flächen verschieben' },
  { id: 'mask', label: '✎ Maske', key: 'M', help: 'Masken zeichnen und bearbeiten' },
];

const PATTERNS: { id: TestPattern; label: string }[] = [
  { id: 'none', label: 'Aus' },
  { id: 'grid', label: 'Gitter' },
  { id: 'white', label: 'Weiß' },
];

export function Toolbar() {
  const snap = useSnapshot();
  const view = snap.state!.view;
  const set = (patch: Partial<ViewState>, gesture?: string) => conn.op({ kind: 'setView', patch }, gesture);
  const setGrid = (patch: Partial<GridSettings>) => set({ grid: { ...view.grid, ...patch } }, repeatGesture('grid', 500));

  return (
    <div className="toolbar-wrap">
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Werkzeug">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={view.tool === t.id ? 'active' : ''}
              onClick={() => set({ tool: t.id })}
              title={`${t.help} (Taste ${t.key})`}
            >
              {t.label} <kbd>{t.key}</kbd>
            </button>
          ))}
        </div>
        {view.tool === 'mask' && (
          <div className="segmented" role="group" aria-label="Neue Masken gehören zu">
            <button
              className={view.maskScope === 'surface' ? 'active' : ''}
              onClick={() => set({ maskScope: 'surface' })}
              title="Neue Maske gehört zur gewählten Fläche und wandert mit deren Ecken mit"
            >
              Neu: auf Fläche
            </button>
            <button
              className={view.maskScope === 'layer' ? 'active' : ''}
              onClick={() => set({ maskScope: 'layer', selectedMaskId: null, selectedPoint: null })}
              title="Neue Masken-Ebene schneidet aus allen Ebenen darunter aus"
            >
              Neu: als Ebene ✂
            </button>
          </div>
        )}
        <button
          className={`toggle ${view.snap ? 'on' : ''}`}
          onClick={() => set({ snap: !view.snap })}
          title="Punkte rasten an Ecken, Maskenpunkten und Kanten ein (⌥ beim Ziehen: ohne Snap)"
        >
          🧲 Snap {view.snap ? 'an' : 'aus'} <kbd>S</kbd>
        </button>
        <button
          className={`toggle ${view.grid.enabled ? 'on' : ''}`}
          onClick={() => setGrid({ enabled: !view.grid.enabled })}
          title="Raster auf die Flächen legen, um die Verzerrung zu prüfen"
        >
          ▦ Raster <kbd>G</kbd>
        </button>
        <div className="spacer" />
        <span className="label">Testbild</span>
        <div className="segmented" role="group" aria-label="Testbild über das ganze Bild">
          {PATTERNS.map((p) => (
            <button key={p.id} className={view.testPattern === p.id ? 'active' : ''} onClick={() => set({ testPattern: p.id })}>
              {p.label}
            </button>
          ))}
        </div>
        <button
          className={`toggle ${view.editMode ? 'on' : ''}`}
          onClick={() => set({ editMode: !view.editMode })}
          title="Bearbeiten: Umrisse und Griffe auf der Ausgabe · Show: nur das Bild (Taste E)"
        >
          {view.editMode ? '✎ Bearbeiten' : '▶ Show'} <kbd>E</kbd>
        </button>
      </div>

      {view.grid.enabled && (
        <div className="toolbar sub">
          <span className="label">Raster</span>
          <label className="mini">
            Spalten
            <input type="number" min={1} max={64} value={view.grid.cols} onChange={(e) => setGrid({ cols: Number(e.target.value) })} />
          </label>
          <label className="mini">
            Zeilen
            <input type="number" min={1} max={64} value={view.grid.rows} onChange={(e) => setGrid({ rows: Number(e.target.value) })} />
          </label>
          <label className="mini wide">
            Linienstärke {view.grid.thickness} px
            <input
              type="range"
              min={1}
              max={30}
              step={1}
              value={view.grid.thickness}
              onChange={(e) => setGrid({ thickness: Number(e.target.value) })}
            />
          </label>
          <label className="mini">
            Farbe
            <input type="color" value={view.grid.color} onChange={(e) => setGrid({ color: e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={view.grid.diagonals} onChange={(e) => setGrid({ diagonals: e.target.checked })} />
            Diagonalen
          </label>
          <label className="check">
            <input type="checkbox" checked={view.grid.onlySelected} onChange={(e) => setGrid({ onlySelected: e.target.checked })} />
            nur gewählte Fläche
          </label>
        </div>
      )}
    </div>
  );
}
