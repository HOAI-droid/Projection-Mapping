// Effekt-Auswahl (nach Kategorien) und automatisch erzeugte Regler für die Parameter.

import { useState } from 'react';
import { EFFECT_CATEGORIES, EFFECT_MAP, EFFECTS, defaultParams, type EffectCategory } from '../../../shared/effects.js';
import type { EffectContent, Surface } from '../../../shared/types.js';
import { repeatGesture } from '../lib/editor/actions';
import { conn } from './store';

export function EffectPanel({ surface, content }: { surface: Surface; content: EffectContent }) {
  const def = EFFECT_MAP.get(content.effect);
  const [category, setCategory] = useState<EffectCategory>(def?.category ?? 'Licht');

  const choose = (id: string) => {
    const d = EFFECT_MAP.get(id);
    if (!d) return;
    conn.op({ kind: 'setContent', surfaceId: surface.id, content: { type: 'effect', effect: id, params: defaultParams(d) } });
  };
  const setParam = (id: string, value: number | string) =>
    conn.op(
      { kind: 'patchEffect', surfaceId: surface.id, effect: content.effect, params: { [id]: value } },
      repeatGesture(`fx-${surface.id}-${id}`, 800),
    );

  return (
    <div className="effect-panel">
      <div className="chips">
        {EFFECT_CATEGORIES.map((c) => (
          <button key={c} className={`chip${c === category ? ' active' : ''}`} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="effect-grid">
        {EFFECTS.filter((e) => e.category === category).map((e) => (
          <button
            key={e.id}
            className={`effect-btn${e.id === content.effect ? ' selected' : ''}`}
            onClick={() => choose(e.id)}
            title={e.description}
          >
            <span className="effect-icon">{e.icon}</span>
            <span>{e.name}</span>
          </button>
        ))}
      </div>

      {def && (
        <div className="props">
          <div className="muted small">{def.description}</div>
          {def.warning && <div className="warning">⚠ {def.warning}</div>}
          {def.params.map((p) => {
            const v = content.params[p.id] ?? p.default;
            if (p.type === 'color') {
              return (
                <label key={p.id} className="field">
                  <span>{p.label}</span>
                  <input type="color" value={String(v)} onChange={(e) => setParam(p.id, e.target.value)} />
                </label>
              );
            }
            if (p.type === 'select') {
              return (
                <div key={p.id} className="field">
                  <span>{p.label}</span>
                  <div className="segmented wrap">
                    {p.options.map((o, i) => (
                      <button key={o} className={Number(v) === i ? 'active' : ''} onClick={() => setParam(p.id, i)}>
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <label key={p.id} className="field">
                <span>
                  {p.label} <b>{formatNum(Number(v), p.step)}</b>
                  {p.unit ? ` ${p.unit}` : ''}
                </span>
                <input
                  type="range"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={Number(v)}
                  onChange={(e) => setParam(p.id, Number(e.target.value))}
                  onDoubleClick={() => setParam(p.id, p.default)}
                  title="Doppelklick: Standardwert"
                />
              </label>
            );
          })}
          <button className="small-btn" onClick={() => choose(def.id)}>
            Standardwerte
          </button>
        </div>
      )}
    </div>
  );
}

function formatNum(v: number, step: number): string {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return v.toFixed(digits);
}
