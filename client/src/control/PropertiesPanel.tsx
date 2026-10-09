// Eigenschaften der gewählten Fläche: Inhalt, Darstellung, Transformation.

import { EFFECTS, defaultParams } from '../../../shared/effects.js';
import { defaultCorners, findMask, findSurface, SPEED_MAX, SPEED_MIN, type SurfacePatch } from '../../../shared/state.js';
import type { BlendMode, Content, ContentType, FitMode, MediaItem, Surface } from '../../../shared/types.js';
import { mediaUrl } from '../lib/connection';
import { cutoutBelow, repeatGesture, rotateSelected, scaleSelected } from '../lib/editor/actions';
import { CameraSection } from './CameraSection';
import { EffectPanel } from './EffectPanel';
import { ModToggle, ModulationEditor } from './ModulationEditor';
import { ShapeSection } from './ShapeSection';
import { MaskProps } from './MasksPanel';
import { RepeatButton } from './RepeatButton';
import { conn, outputSize, useSnapshot } from './store';

const TYPES: { id: ContentType; label: string }[] = [
  { id: 'none', label: 'Leer' },
  { id: 'testgrid', label: 'Testgitter' },
  { id: 'color', label: 'Farbe' },
  { id: 'image', label: 'Bild' },
  { id: 'video', label: 'Video' },
  { id: 'effect', label: 'Effekt ✨' },
  { id: 'camera', label: 'Live-Kamera 📷' },
];

const BLENDS: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'add', label: 'Additiv' },
  { id: 'screen', label: 'Bildschirm' },
  { id: 'multiply', label: 'Multiplizieren' },
];

const FITS: { id: FitMode; label: string }[] = [
  { id: 'stretch', label: 'Strecken' },
  { id: 'fill', label: 'Füllen' },
  { id: 'fit', label: 'Einpassen' },
];

export function PropertiesPanel() {
  const snap = useSnapshot();
  const { project, view } = snap.state!;
  const s = findSurface(project, view.selectedSurfaceId);
  const out = outputSize(snap);

  // Masken-Ebene gewählt → deren Einstellungen
  const maskSel = view.selectedMaskId ? findMask(project, view.selectedMaskId) : null;
  if (maskSel?.layer) {
    return (
      <section className="panel-section">
        <h3>Masken-Ebene · {maskSel.layer.name}</h3>
        <MaskProps mask={maskSel.layer} layer />
      </section>
    );
  }

  if (!s) {
    return (
      <section className="panel-section">
        <h3>Eigenschaften</h3>
        <p className="muted small">Fläche oder Masken-Ebene in der Liste oder auf der Bühne anklicken.</p>
      </section>
    );
  }

  const setContent = (content: Content) => conn.op({ kind: 'setContent', surfaceId: s.id, content });
  const update = (patch: SurfacePatch, gesture?: string) =>
    conn.op({ kind: 'updateSurface', surfaceId: s.id, patch }, gesture);
  const ready = (kind: MediaItem['kind']) => snap.media.filter((m) => m.kind === kind && m.status === 'ready');

  const chooseType = (t: ContentType) => {
    if (t === s.content.type) return;
    switch (t) {
      case 'none':
      case 'testgrid':
        return setContent({ type: t });
      case 'color':
        return setContent({ type: 'color', color: '#ffffff' });
      case 'image': {
        const first = ready('image')[0];
        return first ? setContent({ type: 'image', mediaId: first.id }) : alert('Noch keine Bilder – im Tab „Medien“ hochladen.');
      }
      case 'video': {
        const first = ready('video')[0];
        return first
          ? setContent({ type: 'video', mediaId: first.id, loop: true, speed: 1, playing: true })
          : alert('Noch keine Videos – im Tab „Medien“ hochladen.');
      }
      case 'effect': {
        const first = EFFECTS.find((e) => e.id === 'edgechase') ?? EFFECTS[0]!;
        return setContent({ type: 'effect', effect: first.id, params: defaultParams(first) });
      }
      case 'camera':
        return setContent({ type: 'camera', deviceId: '', mirror: false });
    }
  };

  const c = s.content;
  return (
    <section className="panel-section">
      <h3>Eigenschaften · {s.name}</h3>

      <ShapeSection s={s} />

      <label className="field">
        <span>Inhalt</span>
        <select value={c.type} onChange={(e) => chooseType(e.target.value as ContentType)}>
          {TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {c.type === 'effect' && <EffectPanel surface={s} content={c} />}
      {c.type === 'camera' && <CameraSection s={s} content={c} />}

      {c.type === 'color' && (
        <label className="field">
          <span>Farbe</span>
          <input
            type="color"
            value={c.color}
            onChange={(e) => conn.op({ kind: 'setContent', surfaceId: s.id, content: { type: 'color', color: e.target.value } }, repeatGesture(`color-${s.id}`, 800))}
          />
        </label>
      )}

      {(c.type === 'image' || c.type === 'video') && (
        <div className="media-picker">
          {ready(c.type).map((m) => (
            <button
              key={m.id}
              className={`thumb${m.id === c.mediaId ? ' selected' : ''}`}
              title={m.name}
              onClick={() => setContent(c.type === 'video' ? { ...c, mediaId: m.id, playing: true } : { type: 'image', mediaId: m.id })}
            >
              <img src={mediaUrl(m.id, 'thumb.jpg')} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {c.type === 'video' && (
        <div className="button-row">
          <button onClick={() => conn.op({ kind: 'patchVideo', surfaceId: s.id, patch: { playing: !c.playing } })}>
            {c.playing ? '❚❚ Pause' : '▶ Abspielen'}
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={c.loop}
              onChange={(e) => conn.op({ kind: 'patchVideo', surfaceId: s.id, patch: { loop: e.target.checked } })}
            />
            Schleife
          </label>
          <label className="field inline">
            <span>Tempo</span>
            <select
              value={c.speed}
              onChange={(e) => conn.op({ kind: 'patchVideo', surfaceId: s.id, patch: { speed: Number(e.target.value) } })}
            >
              {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
                .filter((v) => v >= SPEED_MIN && v <= SPEED_MAX)
                .map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}

      {(c.type === 'image' || c.type === 'video' || c.type === 'camera') && (
        <div className="field">
          <span>Einpassung</span>
          <div className="segmented">
            {FITS.map((f) => (
              <button key={f.id} className={s.fit === f.id ? 'active' : ''} onClick={() => update({ fit: f.id })}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <span className="with-mod">
          Deckkraft {Math.round(s.opacity * 100)} %
          <ModToggle mod={s.opacityMod} onChange={(m) => update({ opacityMod: m })} />
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={s.opacity}
          onChange={(e) => update({ opacity: Number(e.target.value) }, repeatGesture(`opacity-${s.id}`, 800))}
        />
        {s.opacityMod && (
          <ModulationEditor mod={s.opacityMod} gestureKey={`${s.id}-opacity`} onChange={(m, g) => update({ opacityMod: m }, g)} />
        )}
      </div>

      <label className="field">
        <span>Mischmodus</span>
        <select value={s.blend} onChange={(e) => update({ blend: e.target.value as BlendMode })}>
          {BLENDS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>Transformieren {s.locked && '(gesperrt)'}</span>
        <div className="button-row">
          <RepeatButton label="Kleiner" onFire={() => scaleSelected(conn, 1 / 1.01, repeatGesture('scale-btn'))}>
            −
          </RepeatButton>
          <RepeatButton label="Größer" onFire={() => scaleSelected(conn, 1.01, repeatGesture('scale-btn'))}>
            +
          </RepeatButton>
          <RepeatButton label="Links drehen" onFire={() => rotateSelected(conn, out, -Math.PI / 360, repeatGesture('rot-btn'))}>
            ↺
          </RepeatButton>
          <RepeatButton label="Rechts drehen" onFire={() => rotateSelected(conn, out, Math.PI / 360, repeatGesture('rot-btn'))}>
            ↻
          </RepeatButton>
          <button
            disabled={s.locked}
            onClick={() => {
              if (confirm('Ecken dieser Fläche zurücksetzen?')) conn.op({ kind: 'setCorners', surfaceId: s.id, corners: defaultCorners() });
            }}
          >
            Zurücksetzen
          </button>
        </div>
        <CornerReadout s={s} out={out} />
      </div>

      <div className="field">
        <span>Ausschneiden</span>
        <button
          onClick={() => cutoutBelow(conn, s.id)}
          title="Legt direkt unter dieser Fläche eine Masken-Ebene mit ihrer Form an"
        >
          ✂ Form aus Ebenen darunter ausschneiden
        </button>
        <span className="muted small">
          Praktisch, wenn diese Fläche halbtransparent ist oder nur Licht zeigt: Darunterliegende Flächen scheinen dann
          nicht durch.
        </span>
      </div>
    </section>
  );
}

function CornerReadout({ s, out }: { s: Surface; out: { width: number; height: number } }) {
  const snap = useSnapshot();
  const i = snap.state!.view.selectedCorner;
  if (i === null) return <p className="muted small">Ecke wählen (Klick oder Tab) – dann Pfeiltasten: 1 px, mit ⇧ 10 px.</p>;
  const c = s.corners[i];
  return (
    <p className="muted small mono">
      Ecke {i + 1}: {Math.round(c.x * out.width)}, {Math.round(c.y * out.height)} px
    </p>
  );
}
