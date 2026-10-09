// Preset-Browser für Milkdrop (Butterchurn): suchen, Favoriten, Zufall, automatischer Wechsel.

import { useEffect, useMemo, useState } from 'react';
import type { MilkdropContent, Surface } from '../../../shared/types.js';
import { repeatGesture } from '../lib/editor/actions';
import { currentPreset, loadMilkdropPresets } from '../lib/render/milkdrop';
import { conn } from './store';

const FAV_KEY = 'pm.milkdropFavs';

function loadFavs(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function MilkdropPanel({ s, content }: { s: Surface; content: MilkdropContent }) {
  const [names, setNames] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [favs, setFavs] = useState(loadFavs);
  const [, tick] = useState(0);

  useEffect(() => {
    void loadMilkdropPresets().then((p) => setNames(p.names));
  }, []);
  // Bei automatischem Wechsel die Anzeige des aktuellen Presets mitlaufen lassen
  useEffect(() => {
    if (!content.cycle) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [content.cycle]);

  const set = (patch: Partial<MilkdropContent>, gesture?: string) =>
    conn.op({ kind: 'setContent', surfaceId: s.id, content: { ...content, ...patch } }, gesture);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return names.filter((n) => (!onlyFavs || favs.has(n)) && (!q || n.toLowerCase().includes(q)));
  }, [names, query, onlyFavs, favs]);

  const toggleFav = (n: string) => {
    const next = new Set(favs);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setFavs(next);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
    } catch {
      /* egal */
    }
  };

  const step = (dir: number) => {
    const list = filtered.length ? filtered : names;
    if (!list.length) return;
    const i = list.indexOf(content.preset);
    set({ preset: list[(i + dir + list.length) % list.length]! });
  };
  const random = () => {
    const list = filtered.length ? filtered : names;
    if (list.length) set({ preset: list[Math.floor(Math.random() * list.length)]! });
  };

  const showing = names.length ? currentPreset(content, names, conn.serverNow(), 0) : content.preset;

  return (
    <div className="milkdrop-panel">
      <div className="muted small">
        Original-Milkdrop-Visualisierungen aus Winamp ({names.length || '…'} Presets), reagieren auf die Musik aus dem
        Reiter „Audio“.
      </div>
      <div className="md-current" title={showing}>
        {favs.has(showing) ? '★ ' : ''}
        {showing}
      </div>
      <div className="button-row">
        <button onClick={() => step(-1)} title="Vorheriges Preset">
          ◀
        </button>
        <button onClick={random} title="Zufälliges Preset">
          🎲 Zufall
        </button>
        <button onClick={() => step(1)} title="Nächstes Preset">
          ▶
        </button>
        <button className={`icon-btn${favs.has(content.preset) ? ' on' : ''}`} onClick={() => toggleFav(content.preset)} title="Favorit">
          {favs.has(content.preset) ? '★' : '☆'}
        </button>
      </div>
      <div className="button-row">
        <input className="search" placeholder="Suchen …" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={onlyFavs} onChange={(e) => setOnlyFavs(e.target.checked)} />★
        </label>
      </div>
      <ul className="list md-list">
        {filtered.map((n) => (
          <li key={n} className={`list-row${n === content.preset ? ' active' : ''}`} onClick={() => set({ preset: n })} title={n}>
            <span className="row-name">{n}</span>
            <button
              className={`icon-btn${favs.has(n) ? ' on' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleFav(n);
              }}
            >
              {favs.has(n) ? '★' : '☆'}
            </button>
          </li>
        ))}
        {names.length > 0 && filtered.length === 0 && <li className="muted small">Nichts gefunden.</li>}
        {names.length === 0 && <li className="muted small">Presets werden geladen …</li>}
      </ul>
      <label className="field">
        <span>Überblendung beim Wechsel {content.blend.toFixed(1)} s</span>
        <input
          type="range"
          min={0}
          max={10}
          step={0.1}
          value={content.blend}
          onChange={(e) => set({ blend: Number(e.target.value) }, repeatGesture(`md-blend-${s.id}`, 800))}
        />
      </label>
      <div className="button-row">
        <label className="mini">
          Automatisch wechseln (s, 0 = aus)
          <input type="number" min={0} max={600} value={content.cycle} onChange={(e) => set({ cycle: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={content.random} onChange={(e) => set({ random: e.target.checked })} />
          zufällig
        </label>
      </div>
      <div className="muted small">Presets: Milkdrop-Community · Wiedergabe: Butterchurn (MIT-Lizenz)</div>
    </div>
  );
}
