import type { Content, ContentType, MediaItem } from '../../../shared/types.js';
import { mediaUrl } from '../lib/connection';
import { activeSurface, conn, useSnapshot } from './store';

const TYPES: { id: ContentType; label: string }[] = [
  { id: 'none', label: 'Leer' },
  { id: 'testgrid', label: 'Testgitter' },
  { id: 'video', label: 'Video' },
];

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

export function ContentTab() {
  const snap = useSnapshot();
  const surface = activeSurface(snap);
  if (!surface) return <div className="empty">Keine Fläche vorhanden.</div>;

  const content = surface.content;
  const ready = snap.media.filter((m) => m.status === 'ready');
  const set = (c: Content) => conn.op({ kind: 'setContent', surfaceId: surface.id, content: c });

  const chooseType = (t: ContentType) => {
    if (t === content.type) return;
    if (t === 'video') {
      const first = ready[0];
      if (first) set({ type: 'video', mediaId: first.id, loop: true, speed: 1, playing: true });
      else set({ type: 'none' });
    } else {
      set({ type: t });
    }
  };

  return (
    <div className="page">
      <h2>Inhalt · {surface.name}</h2>
      <div className="segmented big">
        {TYPES.map((t) => (
          <button
            key={t.id}
            className={content.type === t.id ? 'active' : ''}
            disabled={t.id === 'video' && ready.length === 0}
            onClick={() => chooseType(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {ready.length === 0 && <p className="muted">Noch keine Videos – im Tab „Medien“ hochladen.</p>}

      {content.type === 'video' && (
        <>
          <div className="row">
            <button
              className="primary big-btn"
              onClick={() => conn.op({ kind: 'patchVideo', surfaceId: surface.id, patch: { playing: !content.playing } })}
            >
              {content.playing ? '❚❚  Pause' : '▶  Abspielen'}
            </button>
            <button
              className={`toggle ${content.loop ? 'on' : ''}`}
              onClick={() => conn.op({ kind: 'patchVideo', surfaceId: surface.id, patch: { loop: !content.loop } })}
            >
              Schleife
            </button>
          </div>
          <div className="row">
            <span className="label">Tempo</span>
            <div className="segmented">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  className={Math.abs(content.speed - s) < 1e-3 ? 'active' : ''}
                  onClick={() => conn.op({ kind: 'patchVideo', surfaceId: surface.id, patch: { speed: s } })}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
          <h3>Video wählen</h3>
          <div className="media-grid">
            {ready.map((m) => (
              <MediaThumb
                key={m.id}
                item={m}
                selected={m.id === content.mediaId}
                onClick={() => set({ ...content, mediaId: m.id, playing: true })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MediaThumb({ item, selected, onClick }: { item: MediaItem; selected: boolean; onClick: () => void }) {
  return (
    <button className={`thumb ${selected ? 'selected' : ''}`} onClick={onClick}>
      <img src={mediaUrl(item.id, 'thumb.jpg')} alt="" loading="lazy" />
      <span>{item.name}</span>
    </button>
  );
}
