// 2D-canvas renderer. Reads a render snapshot (from the sim worker) via a shared
// Camera (src/camera.js), so pan/zoom/pick match the WebGL backend exactly. Draws
// food (nectar amber / toxic violet), carrion, oriented insect bodies coloured by
// the shared ecological palette, and the selected creature's sensory field.

import { Camera } from './camera.js';
import { CONFIG } from './config.js';
import { CSTRIDE } from './render-snapshot.js';
import { organismColor, cssColor } from './palette.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.camera = new Camera();
    this.config = { ...CONFIG };
    this.t = 0;
    this.resize();
  }

  // --- camera delegation (keeps the public API stable for main.js / ui.js) ---
  setConfig(config) { this.config = { ...this.config, ...config }; }
  setWorldSize(w, h) { this.camera.setWorldSize(w, h); }
  fit() { this.camera.fit(); }
  toScreen(x, y) { return this.camera.toScreen(x, y); }
  toWorld(x, y) { return this.camera.toWorld(x, y); }
  panBy(dx, dy) { this.camera.panBy(dx, dy); }
  zoomAt(x, y, f) { this.camera.zoomAt(x, y, f); }
  pick(x, y, view) { return this.camera.pick(x, y, view); }
  get cx() { return this.camera.cx; }
  set cx(value) { this.camera.cx = value; }
  get cy() { return this.camera.cy; }
  set cy(value) { this.camera.cy = value; }
  get zoom() { return this.camera.zoom; }
  set zoom(value) { this.camera.zoom = Math.max(0.01, value); }
  get cssW() { return this.camera.cssW; }
  get cssH() { return this.camera.cssH; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, r.width), cssH = Math.max(1, r.height);
    this.camera.setViewport(cssW, cssH);
    const dpr = this.camera.dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(view, selectedId, highlightSpecies = null) {
    const ctx = this.ctx;
    const cam = this.camera;
    const zoom = cam.zoom;
    this.t = view?.tick || 0;
    ctx.clearRect(0, 0, cam.cssW, cam.cssH);
    if (!view) return;

    const [bx, by] = cam.toScreen(0, 0);
    ctx.strokeStyle = 'rgba(90,130,150,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, cam.worldW * zoom, cam.worldH * zoom);

    this._drawFood(ctx, cam, zoom, view);
    this._drawCarrion(ctx, cam, zoom, view);
    this._drawCreatures(ctx, cam, zoom, view, selectedId, highlightSpecies);
  }

  _drawFood(ctx, cam, zoom, view) {
    const s = Math.max(1.3, 2.3 * zoom);
    const half = s / 2;
    const cx = cam.cx, cy = cam.cy, w = cam.cssW, h = cam.cssH;
    for (let i = 0; i < view.foodCount; i++) {
      const sx = (view.fx(i) - cx) * zoom + w / 2;
      const sy = (view.fy(i) - cy) * zoom + h / 2;
      if (sx < -4 || sy < -4 || sx > w + 4 || sy > h + 4) continue;
      ctx.fillStyle = view.ftoxic(i) ? 'rgba(138,95,176,0.65)' : 'rgba(255,196,84,0.88)';
      ctx.fillRect(sx - half, sy - half, s, s);
    }
  }

  _drawCarrion(ctx, cam, zoom, view) {
    const s = Math.max(1.8, 3.2 * zoom);
    const half = s / 2;
    const cx = cam.cx, cy = cam.cy, w = cam.cssW, h = cam.cssH;
    ctx.strokeStyle = 'rgba(150,92,70,0.78)';
    ctx.lineWidth = Math.max(0.6, s * 0.3);
    for (let i = 0; i < view.carrionCount; i++) {
      const sx = (view.kx(i) - cx) * zoom + w / 2;
      const sy = (view.ky(i) - cy) * zoom + h / 2;
      if (sx < -4 || sy < -4 || sx > w + 4 || sy > h + 4) continue;
      ctx.beginPath(); ctx.arc(sx, sy, half * 0.78, 0, Math.PI * 2); ctx.stroke();
    }
  }

  _drawCreatures(ctx, cam, zoom, view, selectedId, highlightSpecies) {
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 0.12);
    const camx = cam.cx, camy = cam.cy, w = cam.cssW, h = cam.cssH, f = view.f;
    const clade = typeof highlightSpecies === 'number' ? new Set([highlightSpecies]) : highlightSpecies;
    for (let i = 0; i < view.nc; i++) {
      const p = i * CSTRIDE;
      const sx = (f[p + 1] - camx) * zoom + w / 2;
      const sy = (f[p + 2] - camy) * zoom + h / 2;
      if (sx < -30 || sy < -30 || sx > w + 30 || sy > h + 30) continue;
      const r = Math.max(1.6, f[p + 4] * 4.2 * zoom);
      const color = organismColor(f[p + 6], f[p + 11], f[p + 8], f[p + 7], f[p + 12], !clade?.size || clade.has(f[p + 8]), this.config);
      ctx.fillStyle = cssColor(color);
      const hd = f[p + 3];
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(hd);
      ctx.beginPath();
      if (color.kind === 'carnivore') {
        ctx.moveTo(r * 1.55, 0); ctx.lineTo(-r * 1.083, r * 0.862); ctx.lineTo(-r * 1.083, -r * 0.862); ctx.closePath();
      } else {
        ctx.ellipse(-r * 0.07, 0, r * (color.kind === 'scavenger' ? 1.04 : 1.32), r * (color.kind === 'scavenger' ? 0.85 : 0.66), 0, 0, Math.PI * 2);
      }
      ctx.fill();
      if (r > 4) {
        ctx.strokeStyle = cssColor(color, color.lightness * 0.55);
        ctx.lineWidth = Math.max(0.5, r * 0.07);
        ctx.beginPath(); ctx.moveTo(-r * 0.9, 0); ctx.lineTo(r * 0.25, 0); ctx.stroke();
        ctx.fillStyle = `rgba(237,255,245,${color.alpha * 0.82})`;
        ctx.beginPath(); ctx.arc(r * 0.57, 0, r * 0.16, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (selectedId != null) {
      const c = view.findCreature(selectedId);
      if (c) this._drawSelection(ctx, cam, zoom, c, pulse);
    }
  }

  _drawSelection(ctx, cam, zoom, c, pulse) {
    const sx = (c.x - cam.cx) * zoom + cam.cssW / 2;
    const sy = (c.y - cam.cy) * zoom + cam.cssH / 2;
    const r = Math.max(3, c.body.size * 4.2 * zoom);
    const range = c.body.sensorRange * zoom;
    const half = c.body.fov * 0.5;
    ctx.fillStyle = 'rgba(80,230,200,0.08)';
    ctx.strokeStyle = 'rgba(80,230,200,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.arc(sx, sy, range, c.heading - half, c.heading + half);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = `rgba(120,245,215,${0.5 + 0.4 * pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 2.2 + 3, 0, Math.PI * 2);
    ctx.stroke();
  }
}
