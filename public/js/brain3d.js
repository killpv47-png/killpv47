/**
 * 3D whole-brain viewer: 139,255 neurons at their real FlyWire soma positions as a GPU point
 * cloud, colored by super-class. Spikes light neurons up with an additive glow that decays.
 * Also draws a soft translucent neuropil shell and highlights the mushroom body / DANs.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CLASS_COLORS = {
  optic: '#3b82f6', central: '#a78bfa', sensory: '#22d3ee', visual_projection: '#60a5fa', ascending: '#f472b6',
  descending: '#fb923c', sensory_ascending: '#2dd4bf', visual_centrifugal: '#818cf8', motor: '#f87171', endocrine: '#facc15', unknown: '#94a3b8',
};

export class Brain3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 50);
    this.camera.position.set(0, 0.35, 2.6);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.06; this.controls.autoRotate = true; this.controls.autoRotateSpeed = 0.6;
    this.controls.minDistance = 0.8; this.controls.maxDistance = 6; this.controls.enablePan = false;
    canvas.addEventListener('pointerdown', () => { this.controls.autoRotate = false; clearTimeout(this._ar); this._ar = setTimeout(() => this.controls.autoRotate = true, 12000); });
    this.clock = new THREE.Clock();
    this.ready = false;
    this._resize(); new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
  }
  _resize() {
    const el = this.canvas.parentElement; const w = el.clientWidth || 300, h = el.clientHeight || 300;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  async load(onProgress) {
    const meta = await (await fetch('/data/brain_meta.json')).json();
    const res = await fetch('/data/brain_points.bin');
    const total = +res.headers.get('content-length') || 0; const reader = res.body.getReader(); const chunks = []; let got = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress?.(total ? got / total : 0.5); }
    const buf = new Uint8Array(got); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
    const n = meta.n; this.n = n; this.meta = meta;
    const pos = new Float32Array(buf.buffer, 0, n * 3);
    const sc = new Uint8Array(buf.buffer, n * 12, n);
    this.superClass = sc;
    const color = new Float32Array(n * 3); const size = new Float32Array(n);
    const palette = meta.super_classes.map(s => new THREE.Color(CLASS_COLORS[s] || '#94a3b8'));
    for (let i = 0; i < n; i++) { const c = palette[sc[i]]; color[i * 3] = c.r; color[i * 3 + 1] = c.g; color[i * 3 + 2] = c.b; size[i] = meta.super_classes[sc[i]] === 'optic' ? 0.7 : 1.0; }
    this.glow = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.glowAttr = new THREE.BufferAttribute(this.glow, 1); this.glowAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGlow', this.glowAttr);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      uniforms: { uTime: { value: 0 }, uPx: { value: this.renderer.getPixelRatio() }, uBase: { value: 0.42 } },
      vertexShader: `
        attribute float aSize; attribute float aGlow; varying vec3 vColor; varying float vGlow; uniform float uPx;
        void main(){ vColor = color; vGlow = aGlow; vec4 mv = modelViewMatrix * vec4(position,1.0);
          float s = (2.1 + 9.0*aGlow) * aSize * uPx; gl_PointSize = s * (1.8 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying vec3 vColor; varying float vGlow; uniform float uBase;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;
          float a = smoothstep(0.5, 0.0, r); vec3 hot = mix(vColor, vec3(1.0,0.98,0.9), clamp(vGlow*1.2,0.0,0.85));
          float alpha = a * (uBase + 1.4*vGlow); gl_FragColor = vec4(hot * (0.8 + 2.5*vGlow), alpha); }`,
    });
    this.points = new THREE.Points(geo, mat); this.scene.add(this.points);
    this.mat = mat;
    // soft shell: a few thousand far points blurred -> gives volume feeling
    this._addShell(pos, n);
    this._addStars();
    this.ready = true;
    return meta;
  }
  _addShell(pos, n) {
    const m = 3000; const arr = new Float32Array(m * 3); for (let k = 0; k < m; k++) { const i = Math.floor(Math.random() * n); arr[k * 3] = pos[i * 3] * 1.02; arr[k * 3 + 1] = pos[i * 3 + 1] * 1.02; arr[k * 3 + 2] = pos[i * 3 + 2] * 1.02; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({ color: 0x6d5cff, size: 0.09, transparent: true, opacity: 0.045, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.scene.add(new THREE.Points(g, mat));
  }
  _addStars() {
    const m = 600; const arr = new Float32Array(m * 3); for (let k = 0; k < m * 3; k++) arr[k] = (Math.random() - 0.5) * 30;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, transparent: true, opacity: 0.35, depthWrite: false })));
  }

  /** Light up a list of neuron ids (spikes from the server). Staggered over ~1.2 s to look like propagation. */
  spikes(ids) {
    if (!this.ready || !ids?.length) return;
    this.pending = this.pending || []; const now = performance.now();
    const chunk = Math.max(1, Math.ceil(ids.length / 40));
    for (let k = 0; k < ids.length; k += chunk) this.pending.push({ at: now + (k / ids.length) * 1200, ids: ids.slice(k, k + chunk) });
  }
  /** Highlight a population strongly (e.g. dopamine burst). */
  flash(ids, strength = 1) { if (!this.ready) return; for (const i of ids) this.glow[i] = Math.min(1.6, this.glow[i] + strength); this.glowAttr.needsUpdate = true; }

  render() {
    if (!this.ready) return;
    const dt = Math.min(0.1, this.clock.getDelta()); const now = performance.now();
    if (this.pending?.length) { let k = 0; while (k < this.pending.length) { const p = this.pending[k]; if (p.at <= now) { for (const i of p.ids) this.glow[i] = Math.min(1.6, this.glow[i] + 1.0); this.pending.splice(k, 1); } else k++; } }
    const g = this.glow, decay = Math.exp(-dt * 2.2); let any = false;
    for (let i = 0; i < g.length; i++) { if (g[i] > 0.002) { g[i] *= decay; any = true; } else if (g[i] !== 0) g[i] = 0; }
    if (any || this._wasAny) this.glowAttr.needsUpdate = true; this._wasAny = any;
    this.mat.uniforms.uTime.value = now / 1000;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  setVisible(v) { this.visible = v; }
}
export { CLASS_COLORS };
