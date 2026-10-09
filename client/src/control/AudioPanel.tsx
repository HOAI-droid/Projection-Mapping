// Audio-Quelle wählen (Mikrofon/Eingang, eigener Player, Browser-Tab) und die Analyse ansehen.

import { useEffect, useRef } from 'react';
import type { AudioSourceKind } from '../lib/audio/engine';
import { audio, useAudioState } from './audio';

const SOURCES: { id: AudioSourceKind; label: string }[] = [
  { id: 'none', label: 'Aus' },
  { id: 'file', label: '🎵 Player' },
  { id: 'mic', label: '🎙 Eingang' },
  { id: 'tab', label: '🌐 Browser-Tab' },
];

export function AudioPanel() {
  const st = useAudioState();
  const fileInput = useRef<HTMLInputElement>(null);

  const choose = (id: AudioSourceKind) => {
    if (id === 'none') audio.stop();
    else if (id === 'mic') void audio.useMicrophone(st.deviceId);
    else if (id === 'tab') void audio.useTab();
    else if (st.tracks.length) audio.playTrack(st.trackIndex);
    else fileInput.current?.click();
  };

  return (
    <section
      className="panel-section"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        audio.addFiles(e.dataTransfer.files);
      }}
    >
      <h3>Audio-Quelle</h3>
      <div className="segmented wrap">
        {SOURCES.map((s) => (
          <button key={s.id} className={st.source === s.id ? 'active' : ''} onClick={() => choose(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <input ref={fileInput} type="file" accept="audio/*" multiple hidden onChange={(e) => e.target.files && audio.addFiles(e.target.files)} />
      {st.error && <div className="warning">{st.error}</div>}

      {st.source === 'mic' && (
        <>
          <label className="field">
            <span>Gerät</span>
            <select value={st.deviceId} onChange={(e) => void audio.useMicrophone(e.target.value)}>
              <option value="">Standard</option>
              {st.devices
                .filter((d) => d.deviceId && d.deviceId !== 'default')
                .map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Eingang ${i + 1}`}
                  </option>
                ))}
            </select>
          </label>
          <p className="muted small">
            Tipp: Für Musik aus Spotify, Apple Music & Co. ein virtuelles Audiogerät wie „BlackHole“ installieren und hier
            auswählen – dann reagiert die Projektion direkt auf den Mac-Ton.
          </p>
        </>
      )}

      {(st.source === 'file' || st.tracks.length > 0) && <Player />}

      {st.source === 'tab' && (
        <p className="muted small">
          Im Dialog den Tab mit der Musik wählen und „Tab-Audio teilen“ einschalten. Der Ton bleibt in dem Tab hörbar.
        </p>
      )}

      <Analyzer />

      <label className="field">
        <span>Verstärkung {st.gain.toFixed(1)}×</span>
        <input type="range" min={0.2} max={4} step={0.1} value={st.gain} onChange={(e) => audio.set({ gain: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>Beat-Erkennung {st.beatSensitivity < 1.3 ? 'empfindlich' : st.beatSensitivity > 1.6 ? 'nur deutliche Schläge' : 'normal'}</span>
        <input
          type="range"
          min={1.1}
          max={2}
          step={0.01}
          value={st.beatSensitivity}
          onChange={(e) => audio.set({ beatSensitivity: Number(e.target.value) })}
        />
      </label>
      <p className="muted small">
        Effekte mit ♪ reagieren von selbst. Jeden anderen Regler (und die Deckkraft) koppelst du mit dem ♪-Knopf daneben an
        Bass, Mitten, Höhen, Pegel oder Beat.
      </p>
    </section>
  );
}

function Player() {
  const st = useAudioState();
  const fileInput = useRef<HTMLInputElement>(null);
  const fmt = (t: number) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00');
  return (
    <div className="player">
      <div className="button-row">
        <button onClick={() => audio.prev()} title="Vorheriger Titel">
          ⏮
        </button>
        <button className="primary" onClick={() => audio.togglePlay()} disabled={!st.tracks.length}>
          {st.playing ? '❚❚' : '▶'}
        </button>
        <button onClick={() => audio.next()} title="Nächster Titel">
          ⏭
        </button>
        <button className="small-btn" onClick={() => fileInput.current?.click()}>
          + Musik
        </button>
        <input ref={fileInput} type="file" accept="audio/*" multiple hidden onChange={(e) => e.target.files && audio.addFiles(e.target.files)} />
      </div>
      {st.source === 'file' && st.duration > 0 && (
        <label className="mini-row">
          <span>
            {fmt(st.currentTime)} / {fmt(st.duration)}
          </span>
          <input type="range" min={0} max={st.duration} step={0.1} value={st.currentTime} onChange={(e) => audio.seek(Number(e.target.value))} />
        </label>
      )}
      <ul className="list">
        {st.tracks.map((t, i) => (
          <li key={t.url} className={`list-row${i === st.trackIndex && st.source === 'file' ? ' active' : ''}`} onClick={() => audio.playTrack(i)}>
            <span className="row-num">{i + 1}</span>
            <span className="row-name">{t.name}</span>
          </li>
        ))}
      </ul>
      {!st.tracks.length && <p className="muted small">Musikdateien (MP3, M4A, WAV …) hierher ziehen oder „+ Musik“.</p>}
    </div>
  );
}

/** Live-Anzeige: Spektrum, Pegel der Bänder, Beat-LED und BPM – direkt auf ein Canvas gezeichnet */
function Analyzer() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bpmRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const c = canvas.current!;
    const g = c.getContext('2d')!;
    return audio.onFrame((f) => {
      const W = (c.width = c.clientWidth * devicePixelRatio);
      const H = (c.height = c.clientHeight * devicePixelRatio);
      g.clearRect(0, 0, W, H);
      const specW = W * 0.62;
      const bw = specW / f.spectrum.length;
      f.spectrum.forEach((v, i) => {
        g.fillStyle = `hsl(${140 - v * 140}, 85%, 50%)`;
        g.fillRect(i * bw, H - v * H, bw - 1, v * H);
        g.fillStyle = '#fff';
        g.fillRect(i * bw, H - (f.peaks[i] ?? 0) * H - 2, bw - 1, 2);
      });
      const labels: [string, number][] = [
        ['P', f.level],
        ['B', f.bass],
        ['M', f.mid],
        ['H', f.high],
      ];
      const x0 = specW + 8 * devicePixelRatio;
      const mw = (W - x0) / 5;
      labels.forEach(([, v], i) => {
        g.fillStyle = ['#e5e7eb', '#f87171', '#facc15', '#60a5fa'][i]!;
        g.fillRect(x0 + i * mw, H - v * H, mw * 0.7, v * H);
      });
      g.fillStyle = `rgba(239, 68, 68, ${Math.min(1, f.beat * 1.4)})`;
      g.beginPath();
      g.arc(x0 + 4.4 * mw, H * 0.2, mw * 0.4, 0, Math.PI * 2);
      g.fill();
      if (bpmRef.current) bpmRef.current.textContent = f.bpm ? `${f.bpm} BPM` : '– BPM';
    });
  }, []);
  return (
    <div className="analyzer">
      <canvas ref={canvas} />
      <div className="analyzer-row">
        <span className="muted small">Spektrum · Pegel · Bass · Mitten · Höhen · Beat</span>
        <span ref={bpmRef} className="mono">– BPM</span>
        <button className="small-btn" onClick={() => audio.tap()} title="Beat von Hand tippen (auch ohne Musik)">
          Tap
        </button>
      </div>
    </div>
  );
}
