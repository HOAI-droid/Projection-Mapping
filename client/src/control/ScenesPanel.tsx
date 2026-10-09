// Szenen und Playlist. Eine Szene merkt sich das Aussehen aller Flächen (Inhalt, Effekt,
// Deckkraft …); die Geometrie bleibt für alle Szenen gleich.

import { useEffect, useState } from 'react';
import { newId } from '../../../shared/ids.js';
import { looksOf } from '../../../shared/state.js';
import type { FadeKind, ShowSettings } from '../../../shared/types.js';
import { repeatGesture } from '../lib/editor/actions';
import { conn, useSnapshot } from './store';

const FADES: { id: FadeKind; label: string }[] = [
  { id: 'cross', label: 'Überblenden' },
  { id: 'black', label: 'Schwarzblende' },
  { id: 'cut', label: 'Schnitt' },
];

export function ScenesPanel() {
  const snap = useSnapshot();
  const { project, show } = snap.state!;
  const settings = project.show;
  const scenes = project.scenes;
  const [, tick] = useState(0);

  // Fortschrittsbalken der laufenden Szene aktualisieren
  useEffect(() => {
    if (!show.playing) return;
    const t = window.setInterval(() => tick((n) => n + 1), 200);
    return () => window.clearInterval(t);
  }, [show.playing]);

  const setSettings = (patch: Partial<ShowSettings>, gesture?: string) => conn.op({ kind: 'setShowSettings', patch }, gesture);
  const go = (sceneId: string) => conn.op({ kind: 'goScene', sceneId, at: 0 });

  const save = () => {
    const name = prompt('Name der Szene', `Szene ${scenes.length + 1}`);
    if (!name) return;
    const scene = { id: newId(), name, looks: looksOf(project), duration: 10 };
    conn.op({ kind: 'addScene', scene, index: scenes.length });
    // Die neue Szene gilt als aktiv – sie zeigt ja genau den aktuellen Zustand
    conn.op({ kind: 'goScene', sceneId: scene.id, at: 0, fade: 'cut' });
  };

  const active = scenes.find((s) => s.id === show.activeSceneId);
  const progress =
    show.playing && active && settings.advance === 'time'
      ? Math.min(1, (conn.serverNow() - show.sceneStartedAt) / (active.duration * 1000))
      : null;

  return (
    <section className="panel-section">
      <div className="section-head">
        <h3>Szenen</h3>
        <button className="small-btn primary" onClick={save} title="Aktuelles Aussehen aller Flächen als Szene speichern">
          + Szene speichern
        </button>
      </div>
      {scenes.length === 0 && (
        <p className="muted small">
          Stell Inhalte und Effekte ein und speichere sie als Szene. Dann ändern, nächste Szene speichern … Ein Klick auf ▶
          blendet zur Szene über. Tasten 1–9 lösen Szenen aus, N die nächste.
        </p>
      )}
      <ul className="list scenes">
        {scenes.map((s, i) => {
          const isActive = s.id === show.activeSceneId;
          return (
            <li key={s.id} className={`list-row scene-row${isActive ? ' active' : ''}`}>
              <button className="go-btn" onClick={() => go(s.id)} title={`Auslösen (Taste ${i + 1})`}>
                ▶
              </button>
              <span className="row-num">{i + 1}</span>
              <span
                className="row-name"
                onDoubleClick={() => {
                  const name = prompt('Name', s.name);
                  if (name) conn.op({ kind: 'updateScene', sceneId: s.id, patch: { name } });
                }}
                title="Doppelklick: umbenennen"
              >
                {s.name}
              </span>
              <input
                className="dur"
                type="number"
                min={0.5}
                step={0.5}
                value={s.duration}
                title="Dauer in der Playlist (Sekunden)"
                onChange={(e) => conn.op({ kind: 'updateScene', sceneId: s.id, patch: { duration: Number(e.target.value) || 1 } })}
              />
              <span className="row-meta">s</span>
              <button
                className="icon-btn"
                title="Mit dem aktuellen Aussehen überschreiben"
                onClick={() => {
                  if (confirm(`„${s.name}“ mit dem aktuellen Zustand überschreiben?`)) {
                    conn.op({ kind: 'updateScene', sceneId: s.id, patch: { looks: looksOf(project) } });
                  }
                }}
              >
                ⟳
              </button>
              <button
                className="icon-btn"
                disabled={i === 0}
                title="Nach oben"
                onClick={() => conn.op({ kind: 'moveScene', sceneId: s.id, index: i - 1 })}
              >
                ↑
              </button>
              <button
                className="icon-btn danger"
                title="Löschen"
                onClick={() => {
                  if (confirm(`Szene „${s.name}“ löschen?`)) conn.op({ kind: 'removeScene', sceneId: s.id });
                }}
              >
                ✕
              </button>
              {isActive && progress !== null && <div className="scene-progress" style={{ width: `${progress * 100}%` }} />}
            </li>
          );
        })}
      </ul>

      <div className="field">
        <span>Übergang</span>
        <div className="segmented">
          {FADES.map((f) => (
            <button key={f.id} className={settings.fadeKind === f.id ? 'active' : ''} onClick={() => setSettings({ fadeKind: f.id })}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {settings.fadeKind !== 'cut' && (
        <label className="field">
          <span>Dauer {settings.fadeDuration.toFixed(1)} s</span>
          <input
            type="range"
            min={0.1}
            max={10}
            step={0.1}
            value={settings.fadeDuration}
            onChange={(e) => setSettings({ fadeDuration: Number(e.target.value) }, repeatGesture('fade', 800))}
          />
        </label>
      )}

      <h3>Playlist</h3>
      <div className="button-row">
        <button
          className={show.playing ? 'primary' : ''}
          disabled={scenes.length === 0}
          onClick={() => conn.op({ kind: 'setShow', patch: { playing: !show.playing }, at: 0 })}
        >
          {show.playing ? '■ Stopp' : '▶ Playlist abspielen'}
        </button>
        <label className="check">
          <input type="checkbox" checked={settings.loop} onChange={(e) => setSettings({ loop: e.target.checked })} />
          Schleife
        </label>
      </div>
      <div className="field">
        <span>Weiter nach</span>
        <div className="button-row">
          <div className="segmented">
            <button className={settings.advance === 'time' ? 'active' : ''} onClick={() => setSettings({ advance: 'time' })}>
              Zeit
            </button>
            <button className={settings.advance === 'beats' ? 'active' : ''} onClick={() => setSettings({ advance: 'beats' })}>
              Beats ♪
            </button>
          </div>
          {settings.advance === 'beats' && (
            <label className="mini">
              Beats je Szene
              <input
                type="number"
                min={1}
                max={512}
                value={settings.beatsPerScene}
                onChange={(e) => setSettings({ beatsPerScene: Number(e.target.value) || 1 })}
              />
            </label>
          )}
        </div>
        <span className="muted small">
          {settings.advance === 'time'
            ? 'Jede Szene läuft so lange wie ihre Dauer.'
            : 'Szenenwechsel im Takt der Musik (Audio-Quelle im Tab „Audio“).'}
        </span>
      </div>

      <h3>Ausgabe</h3>
      <label className="field">
        <span>Helligkeit (Master) {Math.round(show.master * 100)} %</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={show.master}
          onChange={(e) => conn.op({ kind: 'setShow', patch: { master: Number(e.target.value) }, at: 0 })}
        />
      </label>
    </section>
  );
}
