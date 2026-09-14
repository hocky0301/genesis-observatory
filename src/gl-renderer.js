// WebGL2 renderer — draws tens of thousands of creatures/food/carrion with
// INSTANCED rendering, feeding per-instance attributes straight from the packed
// snapshot buffer (no repack). Same public API as the 2D Renderer + a shared
// Camera, so main.js/ui.js are backend-agnostic. Boundary + selection are drawn
// on a small 2D overlay canvas stacked on top.

import { Camera } from './camera.js';
import { CONFIG } from './config.js';
import { CSTRIDE } from './render-snapshot.js';
import { PALETTE_GLSL } from './palette.js';

const CREATURE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec2 aPos;
layout(location=2) in float aHeading;
layout(location=3) in float aSize;
layout(location=4) in float aHue;
layout(location=5) in float aDiet;
layout(location=6) in float aEnergy;
layout(location=7) in float aScavenge;
layout(location=8) in float aAgeFrac;
layout(location=9) in float aSpecies;
uniform vec2 uCamPos; uniform float uZoom; uniform vec2 uView;
uniform float uCarnThreshold; uniform float uScavLabel;
uniform sampler2D uCladeMask; uniform int uCladeActive;
out vec4 vColor; out vec2 vLocal; flat out float vRadius; flat out int vKind;
vec3 hsl2rgb(float h, float s, float l){
  h = mod(h,360.0)/60.0;
  float c=(1.0-abs(2.0*l-1.0))*s;
  float x=c*(1.0-abs(mod(h,2.0)-1.0));
  vec3 r;
  if(h<1.0) r=vec3(c,x,0.0); else if(h<2.0) r=vec3(x,c,0.0);
  else if(h<3.0) r=vec3(0.0,c,x); else if(h<4.0) r=vec3(0.0,x,c);
  else if(h<5.0) r=vec3(x,0.0,c); else r=vec3(c,0.0,x);
  return r + (l - c/2.0);
}
${PALETTE_GLSL}
void main(){
  float rpx = max(1.6, aSize*4.2*uZoom);
  float ca=cos(aHeading), sa=sin(aHeading);
  vec2 local = aCorner * vec2(1.65, 1.0);
  vec2 rot = vec2(local.x*ca-local.y*sa, local.x*sa+local.y*ca) * rpx/uZoom;
  vec2 screen = (aPos + rot - uCamPos)*uZoom + uView*0.5;
  gl_Position = vec4(screen.x/uView.x*2.0-1.0, 1.0-screen.y/uView.y*2.0, 0.0, 1.0);
  bool highlighted = true;
  if (uCladeActive == 1) {
    ivec2 uv = ivec2(int(aSpecies) % 1024, int(aSpecies) / 1024);
    highlighted = uv.y < textureSize(uCladeMask, 0).y && texelFetch(uCladeMask, uv, 0).r > 0.5;
  }
  vColor = ecologyColor(aDiet, aScavenge, aSpecies, aEnergy, aAgeFrac, highlighted);
  vLocal = local; vRadius = rpx;
  vKind = aDiet > uCarnThreshold ? 2 : (aScavenge > uScavLabel ? 1 : 0);
}`;

const CREATURE_FS = `#version 300 es
precision highp float;
in vec4 vColor; in vec2 vLocal; flat in float vRadius; flat in int vKind;
out vec4 o;
void main(){
  vec2 p = vLocal;
  // Different silhouettes remain useful when colour vision varies. Rounded
  // herbivores, broad scavengers, and pointed carnivores share the same scale.
  float d;
  if(vKind == 2) d = max(abs(p.y)/0.72 + (p.x + 0.65)/2.2, -(p.x+0.75)*3.0);
  else d = length(vec2((p.x+0.07)/(vKind == 1 ? 1.04 : 1.32), p.y/(vKind == 1 ? 0.85 : 0.66)));
  float edge = max(fwidth(d), 0.015);
  float alpha = 1.0 - smoothstep(1.0-edge, 1.0+edge, d);
  if(alpha <= 0.0) discard;
  vec3 rgb = vColor.rgb;
  if (vRadius > 4.0) {
    // Anatomical detail is a static mark, never a shadow/glow pass.
    float eye = 1.0-smoothstep(0.12,0.20,length(p-vec2(0.57,0.0)));
    float seam = (1.0-smoothstep(0.015,0.055,abs(p.y))) * (1.0-smoothstep(0.35,0.9,abs(p.x+0.3)));
    rgb = mix(rgb, rgb*0.55, seam*0.45);
    rgb = mix(rgb, vec3(0.93,1.0,0.96), eye*0.82);
  }
  o = vec4(rgb, vColor.a*alpha);
}`;

const DOT_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec2 aPos;
layout(location=2) in float aToxic;
uniform vec2 uCamPos; uniform float uZoom; uniform vec2 uView;
uniform int uMode; uniform float uHalfPx;
out vec4 vColor; out vec2 vLocal; flat out int vMode;
void main(){
  vec2 world = aPos + aCorner*uHalfPx/uZoom;
  vec2 screen = (world-uCamPos)*uZoom + uView*0.5;
  gl_Position = vec4(screen.x/uView.x*2.0-1.0,1.0-screen.y/uView.y*2.0,0.0,1.0);
  if(uMode==1) vColor=vec4(0.588,0.361,0.275,0.78);
  else vColor=aToxic>0.5 ? vec4(0.541,0.373,0.690,0.65) : vec4(1.0,0.769,0.329,0.88);
  vLocal=aCorner; vMode=uMode;
}`;
const DOT_FS = `#version 300 es
precision highp float;
in vec4 vColor; in vec2 vLocal; flat in int vMode; out vec4 o;
void main(){
  float d=length(vLocal);
  float edge=fwidth(d);
  float alpha=1.0-smoothstep(1.0-edge,1.0+edge,d);
  if(vMode==1) alpha *= smoothstep(0.35,0.58,d);
  o=vec4(vColor.rgb,vColor.a*alpha);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  return sh;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  return p;
}

export class GLRenderer {
  static tryCreate(glCanvas, overlay) {
    if (new URLSearchParams(location.search).get('renderer') === 'canvas') return null;
    const gl = glCanvas.getContext('webgl2', { alpha: true, antialias: true });
    if (!gl) return null;
    try { return new GLRenderer(glCanvas, overlay, gl); } catch (e) { console.warn('WebGL init failed, falling back:', e); return null; }
  }

  constructor(glCanvas, overlay, gl) {
    this.canvas = glCanvas;
    this.overlay = overlay;
    this.octx = overlay.getContext('2d');
    this.gl = gl;
    this.camera = new Camera();
    this.config = { ...CONFIG };
    this.t = 0;
    this.lost = false;

    // survive GPU resets / driver timeouts / sleep-wake: preserve the context and
    // rebuild every GL resource on restore (all state lives in _initResources)
    glCanvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; }, false);
    glCanvas.addEventListener('webglcontextrestored', () => { this._initResources(); this.resize(); this.lost = false; }, false);

    this._initResources();
    this.resize();
  }

  // (re)create all GL objects + fixed state. Called on construct and on context restore.
  _initResources() {
    const gl = this.gl;
    this.creatureProg = program(gl, CREATURE_VS, CREATURE_FS);
    this.dotProg = program(gl, DOT_VS, DOT_FS);
    this.quadVBO = this._staticVBO(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    this.instVBO = gl.createBuffer();
    this.vao = gl.createVertexArray();
    this.cu = {
      carn: gl.getUniformLocation(this.creatureProg, 'uCarnThreshold'), scav: gl.getUniformLocation(this.creatureProg, 'uScavLabel'),
      cladeMask: gl.getUniformLocation(this.creatureProg, 'uCladeMask'), cladeActive: gl.getUniformLocation(this.creatureProg, 'uCladeActive'),
      camPos: gl.getUniformLocation(this.creatureProg, 'uCamPos'), zoom: gl.getUniformLocation(this.creatureProg, 'uZoom'), view: gl.getUniformLocation(this.creatureProg, 'uView'),
    };
    this.du = {
      camPos: gl.getUniformLocation(this.dotProg, 'uCamPos'), zoom: gl.getUniformLocation(this.dotProg, 'uZoom'), view: gl.getUniformLocation(this.dotProg, 'uView'),
      mode: gl.getUniformLocation(this.dotProg, 'uMode'), half: gl.getUniformLocation(this.dotProg, 'uHalfPx'),
    };
    this.cladeTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.cladeTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1024, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1024));
    this._cladeKey = null;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  _staticVBO(data) {
    const gl = this.gl, b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  // --- camera delegation (same API as the 2D Renderer) ---
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
    for (const c of [this.canvas, this.overlay]) { c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr); }
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(view, selectedId, highlightSpecies = null) {
    if (this.lost) return; // context gone — skip until 'webglcontextrestored' rebuilds
    const gl = this.gl, cam = this.camera;
    this.t = view?.tick || 0;
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.octx.clearRect(0, 0, cam.cssW, cam.cssH);
    if (!view || !view.buf) return;

    // upload the whole packed snapshot once; each draw points at its region
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVBO);
    gl.bufferData(gl.ARRAY_BUFFER, view.buf, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(this.vao);

    this._drawDots(view.foodByteOffset, view.nf, 12, 0, Math.max(1.3, 2.3 * cam.zoom) / 2);
    this._drawDots(view.carrionByteOffset, view.nk, 8, 1, Math.max(1.8, 3.2 * cam.zoom) / 2);
    this._drawCreatures(view, highlightSpecies);

    gl.bindVertexArray(null);
    this._drawOverlay(view, selectedId);
  }

  _setCamUniforms(u) {
    const gl = this.gl, cam = this.camera;
    gl.uniform2f(u.camPos, cam.cx, cam.cy);
    gl.uniform1f(u.zoom, cam.zoom);
    gl.uniform2f(u.view, cam.cssW, cam.cssH);
  }

  _drawDots(byteOffset, count, stride, mode, halfPx) {
    if (count <= 0) return;
    const gl = this.gl;
    gl.useProgram(this.dotProg);
    this._setCamUniforms(this.du);
    gl.uniform1i(this.du.mode, mode);
    gl.uniform1f(this.du.half, halfPx);
    // base quad (per-vertex)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(0, 0);
    // instance pos
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVBO);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, byteOffset); gl.vertexAttribDivisor(1, 1);
    if (mode === 0) { // food carries a toxic flag; carrion doesn't
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, byteOffset + 8); gl.vertexAttribDivisor(2, 1);
    } else {
      gl.disableVertexAttribArray(2); gl.vertexAttrib1f(2, 0);
    }
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  _drawCreatures(view, highlightSpecies) {
    if (view.nc <= 0) return;
    const gl = this.gl, o = view.creatureByteOffset, S = CSTRIDE * 4;
    gl.useProgram(this.creatureProg);
    this._setCamUniforms(this.cu);
    gl.uniform1f(this.cu.carn, this.config.carnivoreThreshold);
    gl.uniform1f(this.cu.scav, this.config.scavengerLabel);
    this._setClade(highlightSpecies);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instVBO);
    // aPos@+4, aHeading@+12, aSize@+16, aHue@+20, aDiet@+24, aEnergy@+28 (id@+0 skipped)
    const set = (loc, size, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, S, o + off); gl.vertexAttribDivisor(loc, 1); };
    set(1, 2, 4); set(2, 1, 12); set(3, 1, 16); set(4, 1, 20); set(5, 1, 24); set(6, 1, 28);
    set(7, 1, 44); set(8, 1, 48); set(9, 1, 32);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, view.nc);
    for (let l = 2; l <= 9; l++) gl.disableVertexAttribArray(l);
  }

  _setClade(highlightSpecies) {
    const gl = this.gl;
    const ids = typeof highlightSpecies === 'number' ? [highlightSpecies] : highlightSpecies;
    const active = ids != null && (ids.size ?? ids.length) > 0;
    gl.uniform1i(this.cu.cladeActive, active ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.cladeTexture);
    gl.uniform1i(this.cu.cladeMask, 0);
    if (!active) return;
    const key = Array.from(ids).sort((a,b) => a-b).join(',');
    if (key === this._cladeKey) return;
    let maxId = 0;
    for (const id of ids) if (Number.isSafeInteger(id) && id >= 0) maxId = Math.max(maxId, id);
    const rows = Math.max(1, Math.ceil((maxId + 1) / 1024));
    if (rows > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new RangeError('Species mask exceeds GPU limits');
    const pixels = new Uint8Array(1024 * rows);
    for (const id of ids) if (Number.isSafeInteger(id) && id >= 0) pixels[id] = 255;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1024, rows, 0, gl.RED, gl.UNSIGNED_BYTE, pixels);
    this._cladeKey = key;
  }

  // boundary + selection on the 2D overlay (cheap; only the selected creature)
  _drawOverlay(view, selectedId) {
    const ctx = this.octx, cam = this.camera, zoom = cam.zoom;
    const [bx, by] = cam.toScreen(0, 0);
    ctx.strokeStyle = 'rgba(90,130,150,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, cam.worldW * zoom, cam.worldH * zoom);
    if (selectedId == null) return;
    const c = view.findCreature(selectedId);
    if (!c) return;
    const [sx, sy] = cam.toScreen(c.x, c.y);
    const r = Math.max(3, c.body.size * 4.2 * zoom);
    const range = c.body.sensorRange * zoom, half = c.body.fov * 0.5;
    ctx.fillStyle = 'rgba(80,230,200,0.08)';
    ctx.strokeStyle = 'rgba(80,230,200,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.arc(sx, sy, range, c.heading - half, c.heading + half); ctx.closePath(); ctx.fill(); ctx.stroke();
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 0.12);
    ctx.strokeStyle = `rgba(120,245,215,${0.5 + 0.4 * pulse})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, r * 2.2 + 3, 0, Math.PI * 2); ctx.stroke();
  }
}
