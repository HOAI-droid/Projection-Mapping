// Auswahl einer Live-Kamera für eine Fläche.

import { useEffect, useState } from 'react';
import type { CameraContent, Surface } from '../../../shared/types.js';
import { listCameras } from '../lib/render/cameras';
import { conn } from './store';

export function CameraSection({ s, content }: { s: Surface; content: CameraContent }) {
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const load = () => void listCameras().then(setCams);
    load();
    // Namen erscheinen erst nach der Kamera-Erlaubnis – danach erneut laden
    const t = window.setTimeout(load, 1500);
    navigator.mediaDevices?.addEventListener?.('devicechange', load);
    return () => {
      window.clearTimeout(t);
      navigator.mediaDevices?.removeEventListener?.('devicechange', load);
    };
  }, []);
  const set = (patch: Partial<CameraContent>) =>
    conn.op({ kind: 'setContent', surfaceId: s.id, content: { ...content, ...patch } });

  return (
    <>
      <label className="field">
        <span>Kamera</span>
        <select value={content.deviceId} onChange={(e) => set({ deviceId: e.target.value })}>
          <option value="">Standardkamera</option>
          {cams
            .filter((c) => c.deviceId)
            .map((c, i) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label || `Kamera ${i + 1}`}
              </option>
            ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={content.mirror} onChange={(e) => set({ mirror: e.target.checked })} />
        Spiegeln
      </label>
      <span className="muted small">
        Chrome fragt beim ersten Mal nach der Kamera-Erlaubnis – auch im Ausgabefenster einmal „Zulassen“ wählen.
      </span>
    </>
  );
}
