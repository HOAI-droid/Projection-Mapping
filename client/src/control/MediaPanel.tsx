// Medienbibliothek: Upload (Knopf oder Dateien hineinziehen), Liste, Zuweisen.

import { useRef, useState } from 'react';
import type { MediaItem } from '../../../shared/types.js';
import { mediaUrl } from '../lib/connection';
import { conn, useSnapshot } from './store';

interface Upload {
  id: number;
  name: string;
  progress: number;
  error?: string;
}

const ACCEPT = 'video/*,image/*,.heic,.heif,.mov';

export function MediaPanel() {
  const snap = useSnapshot();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const surfaceId = snap.state?.view.selectedSurfaceId ?? null;

  const uploadFile = (file: File) => {
    const id = Date.now() + Math.random();
    const patch = (p: Partial<Upload>) => setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...p } : u)));
    setUploads((list) => [...list, { id, name: file.name, progress: 0 }]);
    // XHR statt fetch, weil nur XHR einen Upload-Fortschritt liefert
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media');
    xhr.upload.onprogress = (e) => e.lengthComputable && patch({ progress: e.loaded / e.total });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploads((list) => list.filter((u) => u.id !== id));
      } else {
        let msg = `Fehler ${xhr.status}`;
        try {
          msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg;
        } catch {
          /* kein JSON */
        }
        patch({ error: msg });
      }
    };
    xhr.onerror = () => patch({ error: 'Verbindung abgebrochen' });
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  };

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) uploadFile(f);
    if (input.current) input.current.value = '';
  };

  const remove = async (m: MediaItem) => {
    if (!confirm(`„${m.name}“ löschen? Flächen, die es zeigen, werden geleert.`)) return;
    await fetch(`/api/media/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
  };

  const assign = (m: MediaItem) => {
    if (!surfaceId) return;
    conn.op({
      kind: 'setContent',
      surfaceId,
      content:
        m.kind === 'image'
          ? { type: 'image', mediaId: m.id }
          : { type: 'video', mediaId: m.id, loop: true, speed: 1, playing: true },
    });
  };

  return (
    <section
      className={`panel-section media${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <div className="section-head">
        <h3>Medien</h3>
        <button className="small-btn" onClick={() => input.current?.click()}>
          + Hochladen
        </button>
      </div>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => addFiles(e.target.files)} />
      <p className="muted small">Videos und Bilder hierher ziehen. Videos werden in H.264 (max. 1280×720, ohne Ton) umgewandelt.</p>

      {uploads.map((u) => (
        <div key={u.id} className="media-row">
          <div className="media-info">
            <div className="media-name">{u.name}</div>
            {u.error ? (
              <div className="error-text">{u.error}</div>
            ) : (
              <Progress value={u.progress} label={`Hochladen ${Math.round(u.progress * 100)} %`} />
            )}
          </div>
          {u.error && <button onClick={() => setUploads((l) => l.filter((x) => x.id !== u.id))}>OK</button>}
        </div>
      ))}

      {snap.media.map((m) => (
        <div key={m.id} className="media-row">
          {m.status === 'ready' ? (
            <img className="media-thumb" src={mediaUrl(m.id, 'thumb.jpg')} alt="" loading="lazy" />
          ) : (
            <div className="media-thumb placeholder">{m.status === 'error' ? '⚠' : '…'}</div>
          )}
          <div className="media-info">
            <div className="media-name" title={m.name}>
              {m.kind === 'image' ? '🖼 ' : '🎞 '}
              {m.name}
            </div>
            {m.status === 'processing' && (
              <Progress value={m.progress} label={`Umwandeln ${Math.round(m.progress * 100)} %`} />
            )}
            {m.status === 'error' && <div className="error-text">{m.error ?? 'Fehler'}</div>}
            {m.status === 'ready' && (
              <div className="muted small">
                {m.width}×{m.height}
                {m.kind === 'video' && ` · ${formatDuration(m.duration ?? 0)}`}
              </div>
            )}
          </div>
          {m.status === 'ready' && (
            <button className="small-btn" disabled={!surfaceId} onClick={() => assign(m)} title="Auf gewählte Fläche legen">
              Zuweisen
            </button>
          )}
          <button className="icon-btn danger" aria-label="Löschen" onClick={() => void remove(m)}>
            ✕
          </button>
        </div>
      ))}
    </section>
  );
}

function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div className="progress" aria-label={label}>
      <div className="bar" style={{ width: `${Math.round(value * 100)}%` }} />
      <span>{label}</span>
    </div>
  );
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
