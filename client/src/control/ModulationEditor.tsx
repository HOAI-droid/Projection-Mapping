// Kopplung eines Reglers an die Musik: Quelle, Stärke, Glättung, Schwelle.

import { createModulation } from '../../../shared/state.js';
import type { AudioSource, Modulation } from '../../../shared/types.js';
import { repeatGesture } from '../lib/editor/actions';

export const AUDIO_SOURCE_LABELS: Record<AudioSource, string> = {
  level: 'Pegel',
  bass: 'Bass',
  mid: 'Mitten',
  high: 'Höhen',
  beat: 'Beat',
};

/** Kleiner ♪-Knopf neben einem Regler: an/aus */
export function ModToggle({ mod, onChange }: { mod: Modulation | null | undefined; onChange: (m: Modulation | null) => void }) {
  return (
    <button
      type="button"
      className={`mod-btn${mod ? ' on' : ''}`}
      title={mod ? 'Musik-Kopplung entfernen' : 'An die Musik koppeln'}
      onClick={(e) => {
        e.preventDefault();
        onChange(mod ? null : createModulation('bass'));
      }}
    >
      ♪
    </button>
  );
}

/** Einstellungen einer vorhandenen Kopplung */
export function ModulationEditor({
  mod,
  gestureKey,
  onChange,
}: {
  mod: Modulation;
  gestureKey: string;
  onChange: (m: Modulation, gesture?: string) => void;
}) {
  const set = (patch: Partial<Modulation>) => onChange({ ...mod, ...patch }, repeatGesture(`mod-${gestureKey}`, 800));
  return (
    <div className="mod-editor">
      <div className="segmented wrap">
        {(Object.keys(AUDIO_SOURCE_LABELS) as AudioSource[]).map((s) => (
          <button key={s} className={mod.source === s ? 'active' : ''} onClick={() => set({ source: s })}>
            {AUDIO_SOURCE_LABELS[s]}
          </button>
        ))}
      </div>
      <label className="mini-row">
        <span>Stärke {Math.round(mod.amount * 100)} %</span>
        <input type="range" min={-1} max={1} step={0.01} value={mod.amount} onChange={(e) => set({ amount: Number(e.target.value) })} />
      </label>
      <label className="mini-row">
        <span>Glättung</span>
        <input type="range" min={0} max={0.95} step={0.01} value={mod.smoothing} onChange={(e) => set({ smoothing: Number(e.target.value) })} />
      </label>
      <label className="mini-row">
        <span>Schwelle</span>
        <input type="range" min={0} max={0.9} step={0.01} value={mod.threshold} onChange={(e) => set({ threshold: Number(e.target.value) })} />
      </label>
    </div>
  );
}
