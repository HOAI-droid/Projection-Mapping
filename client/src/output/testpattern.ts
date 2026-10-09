// Vollflächige Kalibrier-Testbilder (Gitter bzw. Weiß) für die Ausgabe.

import type { TestPattern } from '../../../shared/types.js';

export function drawTestPattern(ctx: CanvasRenderingContext2D, pattern: TestPattern): void {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  if (pattern === 'white') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (pattern !== 'grid') return;

  const unit = Math.max(1, Math.min(W, H) / 720);
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
