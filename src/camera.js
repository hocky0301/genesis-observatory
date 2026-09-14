import { CSTRIDE } from './render-snapshot.js';

// Pan/zoom camera — the shared substrate for both the 2D-canvas and WebGL
// renderers (and every island's viewport). Holds world→screen state and the
// pick math so a click resolves to the same creature regardless of backend.

export class Camera {
  constructor(worldW = 2000, worldH = 1300) {
    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.cssW = 0;
    this.cssH = 0;
    this.worldW = worldW;
    this.worldH = worldH;
    this.cx = worldW / 2;
    this.cy = worldH / 2;
    this.zoom = 1;
  }

  setWorldSize(w, h) { this.worldW = w; this.worldH = h; }
  setViewport(cssW, cssH) { this.cssW = Math.max(1, cssW); this.cssH = Math.max(1, cssH); }

  fit() {
    this.zoom = Math.min(this.cssW / this.worldW, this.cssH / this.worldH) * 0.96;
    this.cx = this.worldW / 2;
    this.cy = this.worldH / 2;
  }

  toScreen(wx, wy) {
    return [(wx - this.cx) * this.zoom + this.cssW / 2, (wy - this.cy) * this.zoom + this.cssH / 2];
  }

  toWorld(sx, sy) {
    return [(sx - this.cssW / 2) / this.zoom + this.cx, (sy - this.cssH / 2) / this.zoom + this.cy];
  }

  panBy(dxScreen, dyScreen) {
    this.cx -= dxScreen / this.zoom;
    this.cy -= dyScreen / this.zoom;
  }

  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.zoom = Math.max(0.12, Math.min(8, this.zoom * factor));
    this.cx = wx - (sx - this.cssW / 2) / this.zoom;
    this.cy = wy - (sy - this.cssH / 2) / this.zoom;
  }

  /** nearest creature id to a screen point in the given snapshot view, or null. */
  pick(sx, sy, view) {
    if (!view) return null;
    const [wx, wy] = this.toWorld(sx, sy);
    const tol = 16 / this.zoom + 6;
    let best = null, bestD = tol * tol;
    const f = view.f;
    for (let i = 0; i < view.nc; i++) {
      const p = i * CSTRIDE, dx = f[p + 1] - wx, dy = f[p + 2] - wy;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = f[p]; }
    }
    return best;
  }
}
