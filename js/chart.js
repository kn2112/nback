// Hand-drawn canvas line chart: combined accuracy (left axis) and n-level
// (right axis, stepped) per round. No libraries.

import { MIN_N, MAX_N } from './game.js';

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function shortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{ts:string,n:number,combined:number}>} records chronological
 * @param {{range?: number}} opts range = 0 means all
 */
export function drawChart(canvas, records, opts = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 300;
  const cssH = canvas.clientHeight || 220;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const colors = {
    accent: cssVar('--accent') || '#2f6fed',
    n: cssVar('--chart-n') || '#b07c1b',
    muted: cssVar('--muted') || '#777',
    border: cssVar('--border') || '#ddd',
    surface: cssVar('--surface') || '#fff',
  };
  const font = '11px -apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
  ctx.font = font;

  const range = Number(opts.range) || 0;
  const data = range > 0 ? records.slice(-range) : records.slice();
  const N = data.length;

  if (N === 0) {
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Complete a round to see your progress here', cssW / 2, cssH / 2);
    return;
  }

  const pad = { top: 12, right: 30, bottom: 26, left: 36 };
  const w = Math.max(10, cssW - pad.left - pad.right);
  const h = Math.max(10, cssH - pad.top - pad.bottom);
  const x = (i) => (N === 1 ? pad.left + w / 2 : pad.left + (i / (N - 1)) * w);
  const yAcc = (v) => pad.top + (1 - v / 100) * h;
  const yN = (v) => pad.top + (1 - (v - MIN_N) / (MAX_N - MIN_N)) * h;

  // Horizontal grid + left axis labels (accuracy).
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.border;
  ctx.fillStyle = colors.muted;
  ctx.textBaseline = 'middle';
  for (const v of [0, 25, 50, 75, 100]) {
    const y = Math.round(yAcc(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + w, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(v + '%', pad.left - 6, y);
  }

  // Right axis labels (n-level).
  ctx.textAlign = 'left';
  ctx.fillStyle = colors.n;
  for (const v of [1, 3, 5, 7, 9]) {
    ctx.fillText('n' + v, pad.left + w + 6, yN(v));
  }

  // X axis date labels.
  ctx.fillStyle = colors.muted;
  ctx.textBaseline = 'alphabetic';
  const ticks = N === 1 ? [0] : Array.from(new Set([0, Math.round((N - 1) / 3), Math.round((2 * (N - 1)) / 3), N - 1]));
  const yLabel = cssH - 8;
  for (const i of ticks) {
    const label = shortDate(data[i].ts);
    if (!label) continue;
    ctx.textAlign = N === 1 ? 'center' : i === 0 ? 'left' : i === N - 1 ? 'right' : 'center';
    ctx.fillText(label, x(i), yLabel);
  }

  // n-level: stepped dashed line.
  ctx.strokeStyle = colors.n;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  if (N === 1) {
    ctx.moveTo(x(0) - 14, yN(data[0].n));
    ctx.lineTo(x(0) + 14, yN(data[0].n));
  } else {
    for (let i = 0; i < N; i++) {
      const px = x(i);
      const py = yN(data[i].n);
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, yN(data[i - 1].n));
        ctx.lineTo(px, py);
      }
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Combined accuracy: solid line with dots.
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (N > 1) {
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const px = x(i);
      const py = yAcc(data[i].combined);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  const r = N > 60 ? 1.5 : N > 25 ? 2.5 : 3.5;
  ctx.fillStyle = colors.accent;
  for (let i = 0; i < N; i++) {
    ctx.beginPath();
    ctx.arc(x(i), yAcc(data[i].combined), r, 0, Math.PI * 2);
    ctx.fill();
  }
}
