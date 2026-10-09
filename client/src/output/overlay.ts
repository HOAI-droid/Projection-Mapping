// 2D-Overlay über dem WebGL-Bild: Kalibrier-Testbild, Umrisse, Nummern, Fadenkreuz.

import type { AppState } from '../../../shared/types.js';
import { CORNER_COLORS, CORNER_LABELS } from '../lib/colors';

export function drawOverlay(ctx: CanvasRenderingContext2D, state: AppState): void {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  const { view, project } = state;
  const unit = Math.max(1, Math.min(W, H) / 720); // Strichstärken skalieren mit der Auflösung

  if (view.testPattern === 'white') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
  } else if (view.testPattern === 'grid') {
    drawFullGrid(ctx, W, H, unit);
  }

  if (!view.showOutlines) return;

  project.surfaces.forEach((s, idx) => {
    if (!s.visible) return;
    const selected = s.id === view.selectedSurfaceId;
    const pts = s.corners.map((p) => ({ x: p.x * W, y: p.y * H }));
    ctx.lineWidth = (selected ? 3 : 2) * unit;
    ctx.strokeStyle = selected ? '#22d3ee' : '#f97316';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();

    // Flächennummer in der Mitte
    const cx = pts.reduce((a, p) => a + p.x, 0) / 4;
    const cy = pts.reduce((a, p) => a + p.y, 0) / 4;
    ctx.font = `bold ${Math.round(28 * unit)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4 * unit;
    ctx.strokeStyle = '#000';
    const label = `${idx + 1} · ${s.name}`;
    ctx.strokeText(label, cx, cy);
    ctx.fillStyle = selected ? '#22d3ee' : '#f97316';
    ctx.fillText(label, cx, cy);

    // Eckpunkte
    pts.forEach((p, i) => {
      const r = (selected && view.selectedCorner === i ? 12 : 8) * unit;
      ctx.fillStyle = CORNER_COLORS[i]!;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.font = `bold ${Math.round(r * 1.3)}px system-ui, sans-serif`;
      ctx.fillText(CORNER_LABELS[i]!, p.x, p.y + unit);
    });

    // Fadenkreuz am gewählten Eckpunkt
    if (selected && view.selectedCorner !== null) {
      const p = pts[view.selectedCorner]!;
      ctx.strokeStyle = CORNER_COLORS[view.selectedCorner]!;
      ctx.lineWidth = 1 * unit;
      ctx.beginPath();
      ctx.moveTo(0, p.y);
      ctx.lineTo(W, p.y);
      ctx.moveTo(p.x, 0);
      ctx.lineTo(p.x, H);
      ctx.stroke();
      ctx.lineWidth = 2 * unit;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 24 * unit, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

function drawFullGrid(ctx: CanvasRenderingContext2D, W: number, H: number, unit: number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const cols = 16;
  const rows = 9;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(1, Math.round(unit));
  ctx.beginPath();
  for (let i = 0; i <= cols; i++) {
    const x = Math.min(W - 0.5, Math.round((i * W) / cols) + 0.5);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  }
  for (let j = 0; j <= rows; j++) {
    const y = Math.min(H - 0.5, Math.round((j * H) / rows) + 0.5);
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.stroke();
  // Mittelkreuz + Kreis (zeigt Verzerrung durch Keystone/Zoom des Beamers)
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 2 * unit;
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, H * 0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.round(18 * unit)}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${W} × ${H} px`, 10 * unit, 10 * unit);
}
