import { CORNER_COLORS, CORNER_LABELS } from '../lib/colors';

/** Testbild für eine Fläche: Gitter, Diagonalen, Kreis und farbige, nummerierte Ecken. */
export function createTestGridCanvas(size = 1024): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);

  const step = size / 16;
  for (let i = 0; i <= 16; i++) {
    const major = i % 4 === 0;
    g.strokeStyle = major ? '#ffffff' : '#666666';
    g.lineWidth = major ? 3 : 1.5;
    const p = Math.round(i * step);
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, size);
    g.moveTo(0, p);
    g.lineTo(size, p);
    g.stroke();
  }

  // Diagonalen und Kreis: zeigen sofort, ob die Perspektive stimmt
  g.strokeStyle = '#888';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(size, size);
  g.moveTo(size, 0);
  g.lineTo(0, size);
  g.stroke();
  g.strokeStyle = '#fff';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.375, 0, Math.PI * 2);
  g.stroke();

  g.lineWidth = 12;
  g.strokeStyle = '#fff';
  g.strokeRect(6, 6, size - 12, size - 12);

  const r = size * 0.09;
  const pos = [
    [r * 1.3, r * 1.3],
    [size - r * 1.3, r * 1.3],
    [size - r * 1.3, size - r * 1.3],
    [r * 1.3, size - r * 1.3],
  ] as const;
  g.font = `bold ${Math.round(r * 1.2)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  pos.forEach(([x, y], i) => {
    g.fillStyle = CORNER_COLORS[i]!;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#000';
    g.fillText(CORNER_LABELS[i]!, x, y + r * 0.05);
  });

  g.fillStyle = '#fff';
  g.font = `bold ${Math.round(size * 0.05)}px system-ui, sans-serif`;
  g.fillText('▲ OBEN', size / 2, size * 0.2);
  return c;
}
