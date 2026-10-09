import { useRef, useState } from 'react';
import type { MediaItem } from '../../../shared/types.js';
import { mediaUrl } from '../lib/connection';
import { activeSurface, conn, useSnapshot } from './store';

interface Upload {
  id: number;
  name: string;
  progress: number;
  error?: string;
}

export function MediaTab() {
  const snap = useSnapshot();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const surface = activeSurface(snap);

  const startUploads = (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) uploadFile(file);
    if (input.current) input.current.value = '';
  };

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

  const remove = async (m: MediaItem) => {
    if (!confirm(`„${m.name}“ löschen?`)) return;
    await fetch(`/api/media/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
  };

  const showOnSurface = (m: MediaItem) => {
    if (!surface) return;
    conn.op({
      kind: 'setContent',
      surfaceId: surface.id,
      content: { type: 'video', mediaId: m.id, loop: true, speed: 1, playing: true },
    });
  };

  return (
    <div className="page">
      <h2>Medien</h2>
      <input
        ref={input}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={(e) => startUploads(e.target.files)}
      />
      <button className="primary big-btn full" onClick={() => input.current?.click()}>
        ⇪ Video hochladen
      </button>
      <p className="muted small">
        Videos werden auf dem Server in H.264 (max. 1280×720, ohne Ton) umgewandelt. Das dauert je nach Länge etwas.
      </p>

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
          {u.error && (
            <button className="secondary" onClick={() => setUploads((l) => l.filter((x) => x.id !== u.id))}>
              OK
            </button>
          )}
        </div>
      ))}

      {snap.media.length === 0 && uploads.length === 0 && <p className="empty">Noch keine Medien.</p>}

      {snap.media.map((m) => (
        <div key={m.id} className="media-row">
          {m.status === 'ready' ? (
            <img className="media-thumb" src={mediaUrl(m.id, 'thumb.jpg')} alt="" loading="lazy" />
          ) : (
            <div className="media-thumb placeholder">{m.status === 'error' ? '⚠' : '…'}</div>
          )}
          <div className="media-info">
            <div className="media-name">{m.name}</div>
            {m.status === 'processing' && (
              <Progress value={m.progress} label={`Umwandeln ${Math.round(m.progress * 100)} %`} />
            )}
            {m.status === 'error' && <div className="error-text">{m.error ?? 'Fehler'}</div>}
            {m.status === 'ready' && (
              <div className="muted small">
                {m.width}×{m.height} · {formatDuration(m.duration ?? 0)}
              </div>
            )}
          </div>
          <div className="media-actions">
            {m.status === 'ready' && surface && (
              <button className="secondary" onClick={() => showOnSurface(m)}>
                Zeigen
              </button>
            )}
            <button className="danger icon" aria-label="Löschen" onClick={() => void remove(m)}>
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
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
