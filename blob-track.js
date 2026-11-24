/* Local feature & highlight blob tracker (TouchDesigner / Blob Track Lab style).
   Finds tight local highlights, corners and strokes across the logo rather than
   merging the whole mark into one giant bounding box. */
export function createBlobTracker() {
  const N = 64;
  const sample = document.createElement('canvas');
  sample.width = sample.height = N;
  const sx = sample.getContext('2d', { willReadFrequently: true });
  let previous = [];
  let nextId = 1;

  function draw(ctx, source, w, h, { color = '#ffffff', count = 12 } = {}) {
    sx.clearRect(0, 0, N, N);
    sx.drawImage(source, 0, 0, N, N);
    const data = sx.getImageData(0, 0, N, N).data;
    const lum = new Float32Array(N * N);
    const alpha = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const j = i * 4;
      alpha[i] = data[j + 3];
      lum[i] = alpha[i] > 40 ? (0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]) : 0;
    }

    const maxBlobs = Math.max(4, Math.min(24, Math.round(count)));
    const threshold = Math.max(24, 155 - maxBlobs * 4.5);
    /* Partition into small 7x7 local windows so each blob stays a tight sub-feature box. */
    const step = 7;
    const candidates = [];
    for (let gy = 0; gy < N; gy += step) {
      for (let gx = 0; gx < N; gx += step) {
        let sumW = 0, sumX = 0, sumY = 0, peak = 0;
        let xmin = N, ymin = N, xmax = 0, ymax = 0, n = 0;
        const yEnd = Math.min(N, gy + step);
        const xEnd = Math.min(N, gx + step);
        for (let y = gy; y < yEnd; y++) {
          for (let x = gx; x < xEnd; x++) {
            const idx = y * N + x;
            const v = lum[idx];
            if (v <= threshold) continue;
            const lx = x > 0 ? lum[idx - 1] : 0;
            const rx = x + 1 < N ? lum[idx + 1] : 0;
            const ty = y > 0 ? lum[idx - N] : 0;
            const by = y + 1 < N ? lum[idx + N] : 0;
            const edge = Math.abs(rx - lx) + Math.abs(by - ty);
            const weight = v + edge * 0.65;
            sumW += weight;
            sumX += x * weight;
            sumY += y * weight;
            if (weight > peak) peak = weight;
            if (x < xmin) xmin = x;
            if (x > xmax) xmax = x;
            if (y < ymin) ymin = y;
            if (y > ymax) ymax = y;
            n++;
          }
        }
        if (n >= 2 && sumW > 0) {
          /* Clamp each box to a tight minimal footprint (3..8 sample cells). */
          const cx = sumX / sumW;
          const cy = sumY / sumW;
          const halfW = Math.max(1.6, Math.min(4.0, (xmax - xmin + 1) * 0.55));
          const halfH = Math.max(1.6, Math.min(4.0, (ymax - ymin + 1) * 0.55));
          candidates.push({
            x: cx,
            y: cy,
            xmin: Math.max(0, cx - halfW),
            ymin: Math.max(0, cy - halfH),
            xmax: Math.min(N - 1, cx + halfW),
            ymax: Math.min(N - 1, cy + halfH),
            score: sumW * 0.4 + peak,
          });
        }
      }
    }

    /* Non-maximum suppression so boxes stay crisp and spaced apart. */
    candidates.sort((a, b) => b.score - a.score);
    const blobs = [];
    const minSep = maxBlobs > 14 ? 4.8 : 6.0;
    for (const c of candidates) {
      if (blobs.length >= maxBlobs) break;
      if (blobs.every((b) => Math.hypot(c.x - b.x, c.y - b.y) >= minSep)) {
        blobs.push(c);
      }
    }

    /* Nearest-neighbor ID tracking across frames. */
    const used = new Set();
    for (const b of blobs) {
      let best = null;
      let dist = 10;
      for (const p of previous) {
        if (used.has(p.id)) continue;
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d < dist) { dist = d; best = p; }
      }
      b.id = best ? best.id : nextId++;
      used.add(b.id);
    }
    previous = blobs.map((b) => ({ id: b.id, x: b.x, y: b.y }));

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1, Math.round(w / 720));
    const fontSize = Math.max(8, Math.round(w / 100));
    ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = 'bottom';

    /* Subtle connecting vector web between nearest neighbors. */
    ctx.save();
    ctx.globalAlpha = 0.45;
    for (let i = 1; i < blobs.length; i++) {
      const a = blobs[i];
      let best = blobs[0];
      let bestD = Math.hypot(a.x - best.x, a.y - best.y);
      for (let j = 1; j < i; j++) {
        const d = Math.hypot(a.x - blobs[j].x, a.y - blobs[j].y);
        if (d < bestD) { bestD = d; best = blobs[j]; }
      }
      ctx.beginPath();
      ctx.moveTo((a.x / N) * w, (a.y / N) * h);
      ctx.lineTo((best.x / N) * w, (best.y / N) * h);
      ctx.stroke();
    }
    ctx.restore();

    /* Tight minimal tracking boxes, crosshairs, and compact IDs. */
    for (const b of blobs) {
      const x = Math.round((b.xmin / N) * w) + 0.5;
      const y = Math.round((b.ymin / N) * h) + 0.5;
      const bw = Math.max(8, Math.round(((b.xmax - b.xmin) / N) * w));
      const bh = Math.max(8, Math.round(((b.ymax - b.ymin) / N) * h));
      const cx = (b.x / N) * w;
      const cy = (b.y / N) * h;

      ctx.strokeRect(x, y, bw, bh);
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy); ctx.lineTo(cx + 3, cy);
      ctx.moveTo(cx, cy - 3); ctx.lineTo(cx, cy + 3);
      ctx.stroke();

      const label = `${String(b.id).padStart(2, '0')} ${Math.round((b.x / N) * 100)},${Math.round((b.y / N) * 100)}`;
      ctx.fillText(label, x, Math.max(fontSize + 2, y - 2));
    }

    ctx.restore();
    return blobs.length;
  }

  return { draw, reset() { previous = []; nextId = 1; } };
}
window.createBlobTracker = createBlobTracker;
