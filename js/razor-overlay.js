export class RazorOverlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.partials = 48;
    this.show = true;
    this.hue = 262;
    this._smoothed = new Float32Array(128);
    this._waterfall = [];
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
  }

  setPartials(n) { this.partials = n; }
  setShow(v) { this.show = v; }
  setHue(h) { this.hue = h; }

  draw(analysis) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.show) return;
    const { freqData, bpm, isBeat } = analysis;
    const cx = this.w / 2;
    const cy = this.h * 0.5;
    const bandWidth = Math.min(this.w * 0.62, 900);
    const left = cx - bandWidth / 2;
    const n = this.partials;
    const baseHue = this.hue;

    // --- scrolling spectral waterfall history (thin strip above center) ---
    const rowH = 2;
    const wfHeight = 90;
    this._waterfall.unshift(this._sampleBands(freqData, Math.floor(bandWidth / 3)));
    if (this._waterfall.length > wfHeight / rowH) this._waterfall.pop();
    ctx.save();
    ctx.globalAlpha = 0.55;
    for (let row = 0; row < this._waterfall.length; row++) {
      const bands = this._waterfall[row];
      const y = cy - 70 - row * rowH;
      for (let i = 0; i < bands.length; i++) {
        const amp = bands[i];
        if (amp < 0.04) continue;
        const hue = (baseHue + i * 0.6) % 360;
        ctx.fillStyle = `hsla(${hue},95%,${45 + amp * 30}%,${amp})`;
        ctx.fillRect(left + (i / bands.length) * bandWidth, y, bandWidth / bands.length + 1, rowH + 0.5);
      }
    }
    ctx.restore();

    // --- additive harmonic partials (glowing bars mirrored around center line) ---
    const step = bandWidth / n;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const bin = Math.floor((i / n) * freqData.length * 0.6);
      const raw = (freqData[bin] || 0) / 255;
      this._smoothed[i] += (raw - this._smoothed[i]) * 0.35;
      const amp = this._smoothed[i];
      const barH = amp * 130 + 2;
      const x = left + i * step + step * 0.15;
      const w = step * 0.7;
      const hue = (baseHue + (i / n) * 90) % 360;
      const grad = ctx.createLinearGradient(0, cy - barH, 0, cy + barH);
      grad.addColorStop(0, `hsla(${hue},95%,65%,0.95)`);
      grad.addColorStop(0.5, `hsla(${hue},95%,55%,1)`);
      grad.addColorStop(1, `hsla(${hue},95%,65%,0.95)`);
      ctx.fillStyle = grad;
      ctx.shadowColor = `hsla(${hue},95%,60%,0.9)`;
      ctx.shadowBlur = 14 + amp * 18;
      ctx.fillRect(x, cy - barH, w, barH * 2);
    }
    ctx.restore();

    // center line
    ctx.save();
    ctx.strokeStyle = `hsla(${baseHue},80%,70%,0.25)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, cy);
    ctx.lineTo(left + bandWidth, cy);
    ctx.stroke();
    ctx.restore();

    if (isBeat) {
      ctx.save();
      ctx.strokeStyle = `hsla(${baseHue},100%,75%,0.5)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 40, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  _sampleBands(freqData, count) {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const bin = Math.floor((i / count) * freqData.length * 0.7);
      out[i] = (freqData[bin] || 0) / 255;
    }
    return out;
  }
}
