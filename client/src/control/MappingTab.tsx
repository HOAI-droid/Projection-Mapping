import { useEffect, useState } from 'react';
import type { CornerIndex, TestPattern } from '../../../shared/types.js';
import { POINT_MAX, POINT_MIN, defaultCorners } from '../../../shared/state.js';
import { CORNER_COLORS, CORNER_LABELS } from '../lib/colors';
import { RepeatButton } from './RepeatButton';
import { Stage } from './Stage';
import { activeSurface, conn, outputSize, useSnapshot } from './store';

const PATTERNS: { id: TestPattern; label: string }[] = [
  { id: 'none', label: 'Aus' },
  { id: 'grid', label: 'Gitter' },
  { id: 'white', label: 'Weiß' },
];

const clamp = (v: number) => Math.min(POINT_MAX, Math.max(POINT_MIN, v));

export function MappingTab() {
  const snap = useSnapshot();
  const state = snap.state!;
  const surface = activeSurface(snap);
  const out = outputSize(snap);
  const [fine, setFine] = useState(false);
  const [step, setStep] = useState<1 | 10>(1);
  const corner = state.view.selectedCorner;

  const selectCorner = (i: CornerIndex) =>
    conn.op({ kind: 'setView', patch: { selectedSurfaceId: surface?.id ?? null, selectedCorner: i } });

  /** Eckpunkt um ganze Ausgabepixel verschieben */
  const nudge = (dx: number, dy: number) => {
    if (!surface || corner === null) return;
    // Aktuellsten Stand lesen (beim Gedrückthalten feuert der Button wiederholt)
    const cur = conn.snapshot.state?.project.surfaces.find((s) => s.id === surface.id)?.corners[corner];
    if (!cur) return;
    conn.op({
      kind: 'setCorner',
      surfaceId: surface.id,
      index: corner,
      point: { x: clamp(cur.x + (dx * step) / out.width), y: clamp(cur.y + (dy * step) / out.height) },
    });
  };

  // Pfeiltasten auf iPad-Tastatur: Shift = 10 px
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dirs: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const d = dirs[e.key];
      if (!d || !surface || corner === null) return;
      e.preventDefault();
      const cur = conn.snapshot.state?.project.surfaces.find((s) => s.id === surface.id)?.corners[corner];
      if (!cur) return;
      const k = e.shiftKey ? 10 : 1;
      conn.op({
        kind: 'setCorner',
        surfaceId: surface.id,
        index: corner,
        point: { x: clamp(cur.x + (d[0] * k) / out.width), y: clamp(cur.y + (d[1] * k) / out.height) },
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [surface, corner, out.width, out.height]);

  const cornerPx =
    surface && corner !== null
      ? `${Math.round(surface.corners[corner].x * out.width)}, ${Math.round(surface.corners[corner].y * out.height)} px`
      : '–';

  return (
    <div className="mapping">
      <Stage
        surfaces={state.project.surfaces}
        activeId={surface?.id ?? null}
        selectedCorner={corner}
        aspect={out.width / out.height}
        sensitivity={fine ? 0.2 : 1}
      />

      <div className="panel">
        <div className="row">
          <div className="corner-buttons" role="group" aria-label="Eckpunkt wählen">
            {([0, 1, 2, 3] as CornerIndex[]).map((i) => (
              <button
                key={i}
                className={`corner-btn ${corner === i ? 'active' : ''}`}
                style={{ '--c': CORNER_COLORS[i] } as React.CSSProperties}
                onClick={() => selectCorner(i)}
              >
                {CORNER_LABELS[i]}
              </button>
            ))}
          </div>
          <button className={`toggle ${fine ? 'on' : ''}`} onClick={() => setFine(!fine)}>
            Fein
          </button>
        </div>

        <div className="row nudge-row">
          <div className="dpad">
            <span />
            <RepeatButton label="hoch" onFire={() => nudge(0, -1)}>▲</RepeatButton>
            <span />
            <RepeatButton label="links" onFire={() => nudge(-1, 0)}>◀</RepeatButton>
            <button className="step" onClick={() => setStep(step === 1 ? 10 : 1)} aria-label="Schrittweite">
              {step} px
            </button>
            <RepeatButton label="rechts" onFire={() => nudge(1, 0)}>▶</RepeatButton>
            <span />
            <RepeatButton label="runter" onFire={() => nudge(0, 1)}>▼</RepeatButton>
            <span />
          </div>
          <div className="nudge-info">
            <div className="muted">Ecke {corner !== null ? CORNER_LABELS[corner] : '–'}</div>
            <div className="mono">{cornerPx}</div>
            <div className="muted small">
              Ausgabe {out.width}×{out.height}
              {!out.known && ' (angenommen)'}
            </div>
          </div>
        </div>

        <div className="row">
          <span className="label">Testbild</span>
          <div className="segmented">
            {PATTERNS.map((p) => (
              <button
                key={p.id}
                className={state.view.testPattern === p.id ? 'active' : ''}
                onClick={() => conn.op({ kind: 'setView', patch: { testPattern: p.id } })}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="row">
          <button
            className={`toggle wide ${state.view.showOutlines ? 'on' : ''}`}
            onClick={() => conn.op({ kind: 'setView', patch: { showOutlines: !state.view.showOutlines } })}
          >
            Umrisse auf Ausgabe {state.view.showOutlines ? 'an' : 'aus'}
          </button>
          <button
            className="secondary"
            onClick={() => {
              if (surface && confirm('Eckpunkte dieser Fläche zurücksetzen?')) {
                conn.op({ kind: 'setCorners', surfaceId: surface.id, corners: defaultCorners() });
              }
            }}
          >
            Zurücksetzen
          </button>
        </div>
      </div>
    </div>
  );
}
