/**
 * The fly's office: a cosy night-time room with a desk, a gaming PC, a monitor whose screen is a
 * live CanvasTexture showing the FlyBay terminal (real BTC candles + the fly's account), a
 * keyboard the fly types on, a mouse, lamp, plant, coffee cup. Soft shadows, bloom-ish glow via
 * emissive materials, low poly-count so it stays smooth on phones.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Fly } from './fly.js';
import { drawTerminal } from './terminal.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Room3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x05060b); this.scene.fog = new THREE.Fog(0x05060b, 6, 14);
    const pmrem = new THREE.PMREMGenerator(this.renderer); this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 40);
    this.controls = new OrbitControls(this.camera, canvas); this.controls.enableDamping = true; this.controls.dampingFactor = 0.07; this.controls.maxPolarAngle = Math.PI * 0.55; this.controls.minDistance = 0.3; this.controls.maxDistance = 6;
    this.clock = new THREE.Clock();
    canvas.addEventListener('pointerdown', () => { this._camTo = null; });
    this._build(); this.setCamera('desk');
    this._resize(); new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
    this.data = { candles: [], price: 0, wallet: null, last: null, logs: [] };
  }
  _resize() { const el = this.canvas.parentElement; const w = el.clientWidth || 300, h = el.clientHeight || 300; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  _mat(color, o = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...o }); }
  _box(w, h, d, mat, x = 0, y = 0, z = 0, shadow = true) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; this.scene.add(m); return m; }

  _build() {
    const S = this.scene;
    // ---- room shell
    const wall = this._mat(0x151a2b, { roughness: 0.95 }); const floorMat = this._mat(0x1d1a22, { roughness: 0.9 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.75; floor.receiveShadow = true; S.add(floor);
    // wooden plank lines on the floor
    for (let i = -8; i <= 8; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.002, 8), this._mat(0x0f0d12)); l.position.set(i * 0.45, -0.749, 0); S.add(l); }
    this._box(8, 3.2, 0.1, wall, 0, 0.85, -1.6, false);                 // back wall
    this._box(0.1, 3.2, 8, wall, -3, 0.85, 0, false); this._box(0.1, 3.2, 8, wall, 3, 0.85, 0, false);
    // window with night city glow
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), new THREE.MeshBasicMaterial({ color: 0x0b1030 })); win.position.set(-1.7, 1.2, -1.54); S.add(win);
    for (let i = 0; i < 40; i++) { const b = new THREE.Mesh(new THREE.PlaneGeometry(0.03 + Math.random() * 0.04, 0.03 + Math.random() * 0.06), new THREE.MeshBasicMaterial({ color: Math.random() > 0.5 ? 0xffd27a : 0x8ad1ff })); b.position.set(-1.7 + (Math.random() - 0.5) * 1.4, 1.2 + (Math.random() - 0.5) * 0.9, -1.535); S.add(b); }
    const frame = this._mat(0x2a2f45); this._box(1.56, 0.04, 0.06, frame, -1.7, 1.72, -1.53); this._box(1.56, 0.04, 0.06, frame, -1.7, 0.68, -1.53); this._box(0.04, 1.06, 0.06, frame, -2.48, 1.2, -1.53); this._box(0.04, 1.06, 0.06, frame, -0.92, 1.2, -1.53); this._box(0.04, 1.06, 0.06, frame, -1.7, 1.2, -1.53);
    // poster: neuron art
    const poster = this._box(0.7, 0.9, 0.02, new THREE.MeshStandardMaterial({ color: 0x2b1f4a, emissive: 0x1b0f3a, emissiveIntensity: 0.6 }), 1.6, 1.25, -1.54, false);
    const pText = makeTextTexture(['FLYWIRE', 'v783', '', '139,255', 'neurons'], 256, 328, '#c4b5fd', '#1c1240'); poster.material.map = pText; poster.material.needsUpdate = true;
    // shelf with books
    this._box(1.2, 0.04, 0.25, this._mat(0x3b2a1e), 1.5, 0.55, -1.45);
    const bookColors = [0xd94f4f, 0x4f8ad9, 0xe0b04f, 0x5fbf7a, 0xb45fd9, 0xd9d9d9, 0x4fd9c7];
    for (let i = 0; i < 9; i++) this._box(0.05, 0.16 + Math.random() * 0.08, 0.18, this._mat(bookColors[i % bookColors.length]), 1.05 + i * 0.075, 0.66, -1.45);

    // ---- desk
    const wood = this._mat(0x5a3d2b, { roughness: 0.55 });
    this.desk = this._box(2.2, 0.05, 1.05, wood, 0, -0.025, -0.55);
    for (const [x, z] of [[-1.0, -0.15], [1.0, -0.15], [-1.0, -0.95], [1.0, -0.95]]) this._box(0.06, 0.7, 0.06, this._mat(0x222), x, -0.4, z);
    const DESK_Y = 0; this.deskY = DESK_Y;
    // desk mat
    this._box(1.2, 0.006, 0.6, this._mat(0x101218, { roughness: 0.95 }), 0.05, DESK_Y + 0.003, -0.5, false);

    // ---- monitor
    const monW = 1.0, monH = 0.56;
    this._box(0.32, 0.02, 0.2, this._mat(0x0b0b0e, { metalness: 0.4, roughness: 0.4 }), 0, DESK_Y + 0.01, -0.93);
    this._box(0.05, 0.3, 0.04, this._mat(0x0b0b0e, { metalness: 0.4 }), 0, DESK_Y + 0.16, -0.97);
    const bezel = this._box(monW + 0.04, monH + 0.04, 0.03, this._mat(0x0a0a0c, { metalness: 0.5, roughness: 0.35 }), 0, DESK_Y + 0.5, -0.99);
    this.screenCanvas = document.createElement('canvas'); this.screenCanvas.width = 1024; this.screenCanvas.height = 576;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas); this.screenTex.colorSpace = THREE.SRGBColorSpace; this.screenTex.anisotropy = 4;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(monW, monH), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }));
    screen.position.set(0, DESK_Y + 0.5, -0.973); S.add(screen); this.screen = screen;
    // screen glow light onto the fly & desk
    const glow = new THREE.PointLight(0x6d8cff, 1.6, 2.5, 2); glow.position.set(0, DESK_Y + 0.5, -0.8); S.add(glow); this.glow = glow;
    // small LED strip behind the monitor
    const strip = new THREE.Mesh(new THREE.BoxGeometry(monW, 0.01, 0.01), new THREE.MeshBasicMaterial({ color: 0x7c5cff })); strip.position.set(0, DESK_Y + 0.21, -1.0); S.add(strip); this.strip = strip;
    const stripLight = new THREE.PointLight(0x7c5cff, 0.8, 1.5); stripLight.position.set(0, DESK_Y + 0.25, -1.0); S.add(stripLight);

    // ---- PC tower with glass side and RGB fans
    const pc = this._box(0.22, 0.48, 0.45, this._mat(0x0d0d10, { metalness: 0.5, roughness: 0.3 }), 0.85, DESK_Y + 0.24, -0.7);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.42), new THREE.MeshPhysicalMaterial({ color: 0x88aaff, transmission: 0.9, roughness: 0.05, transparent: true, opacity: 0.35 })); glass.position.set(0.738, DESK_Y + 0.25, -0.7); glass.rotation.y = -Math.PI / 2; S.add(glass);
    this.fans = [];
    for (let i = 0; i < 3; i++) { const f = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.006, 8, 24), new THREE.MeshBasicMaterial({ color: 0x22d3ee })); f.position.set(0.76, DESK_Y + 0.1 + i * 0.14, -0.7); f.rotation.y = Math.PI / 2; S.add(f); this.fans.push(f); const blades = new THREE.Mesh(new THREE.CircleGeometry(0.04, 3), this._mat(0x222)); blades.position.copy(f.position); blades.rotation.y = Math.PI / 2; S.add(blades); f.userData.blades = blades; }
    const gpu = this._box(0.18, 0.03, 0.28, new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0x7c5cff, emissiveIntensity: 0.6 }), 0.85, DESK_Y + 0.3, -0.7);
    const pcLight = new THREE.PointLight(0x22d3ee, 0.6, 1.2); pcLight.position.set(0.7, DESK_Y + 0.25, -0.6); S.add(pcLight);

    // ---- keyboard (fly-sized: it's a compact 60% board)
    const kbW = 0.5, kbD = 0.17; this.kb = this._box(kbW, 0.02, kbD, this._mat(0x1a1c24, { metalness: 0.3, roughness: 0.5 }), 0, DESK_Y + 0.012, -0.45);
    this.keys = []; this.keyMeshes = [];
    const rows = 4, cols = 13; const keyMat = new THREE.MeshStandardMaterial({ color: 0x2a2d3a, roughness: 0.6 });
    const keyGeo = new THREE.BoxGeometry(0.03, 0.012, 0.03);
    this.keyInst = new THREE.InstancedMesh(keyGeo, keyMat, rows * cols); this.keyInst.castShadow = true; S.add(this.keyInst);
    const dummy = new THREE.Object3D(); let k = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x = -kbW / 2 + 0.03 + c * 0.036 + (r * 0.008), z = -0.45 - kbD / 2 + 0.03 + r * 0.037; dummy.position.set(x, DESK_Y + 0.028, z); dummy.updateMatrix(); this.keyInst.setMatrixAt(k, dummy.matrix); this.keys.push(V(x, DESK_Y + 0.034, z)); k++; }
    this.keyInst.instanceMatrix.needsUpdate = true;
    // RGB underglow of the keyboard
    const kbGlow = new THREE.Mesh(new THREE.PlaneGeometry(kbW + 0.02, kbD + 0.02), new THREE.MeshBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.35 })); kbGlow.rotation.x = -Math.PI / 2; kbGlow.position.set(0, DESK_Y + 0.001, -0.45); S.add(kbGlow); this.kbGlow = kbGlow;
    // ---- mouse
    const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), this._mat(0x15161c, { metalness: 0.3, roughness: 0.4 })); mouse.scale.set(0.75, 0.55, 1.15); mouse.position.set(0.38, DESK_Y + 0.02, -0.45); mouse.castShadow = true; S.add(mouse); this.mouse = mouse;
    const mLight = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.05), new THREE.MeshBasicMaterial({ color: 0x22d3ee })); mLight.position.set(0.38, DESK_Y + 0.045, -0.46); S.add(mLight);

    // ---- lamp, cup, plant, sticky note
    this._box(0.12, 0.02, 0.12, this._mat(0x222), -0.85, DESK_Y + 0.01, -0.8); this._box(0.02, 0.45, 0.02, this._mat(0x333), -0.85, DESK_Y + 0.23, -0.8);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.14, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xe8c07a, side: THREE.DoubleSide, emissive: 0xffb45a, emissiveIntensity: 0.5 })); shade.position.set(-0.78, DESK_Y + 0.5, -0.78); shade.rotation.z = -0.35; S.add(shade);
    const lamp = new THREE.SpotLight(0xffc98a, 6, 3, 0.7, 0.6, 1.5); lamp.position.set(-0.78, DESK_Y + 0.47, -0.78); lamp.target.position.set(-0.4, DESK_Y, -0.5); lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.bias = -0.0005; S.add(lamp, lamp.target);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 20), this._mat(0xf1e4d3, { roughness: 0.4 })); cup.position.set(-0.5, DESK_Y + 0.05, -0.45); cup.castShadow = true; S.add(cup);
    const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.04, 20), this._mat(0x2a150a, { roughness: 0.2, metalness: 0.1 })); coffee.rotation.x = -Math.PI / 2; coffee.position.set(-0.5, DESK_Y + 0.095, -0.45); S.add(coffee);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 8, 16, Math.PI), this._mat(0xf1e4d3)); handle.position.set(-0.455, DESK_Y + 0.05, -0.45); handle.rotation.z = -Math.PI / 2; S.add(handle);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.1, 16), this._mat(0xb5542b)); pot.position.set(-0.95, DESK_Y + 0.05, -0.35); pot.castShadow = true; S.add(pot);
    for (let i = 0; i < 7; i++) { const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), this._mat(0x2f8f4e, { roughness: 0.7 })); leaf.scale.set(0.5, 1.4, 0.3); const a = i / 7 * Math.PI * 2; leaf.position.set(-0.95 + Math.cos(a) * 0.05, DESK_Y + 0.17, -0.35 + Math.sin(a) * 0.05); leaf.rotation.set(Math.cos(a) * 0.5, a, Math.sin(a) * 0.5); S.add(leaf); }
    const note = this._box(0.09, 0.001, 0.09, new THREE.MeshStandardMaterial({ color: 0xffe36b, emissive: 0x332a00, emissiveIntensity: 0.2 }), 0.6, DESK_Y + 0.006, -0.35, false); note.rotation.y = 0.3;
    note.material.map = makeTextTexture(['BUY LOW', 'SELL HIGH', '- mom'], 128, 128, '#5a3a00', '#ffe36b'); note.material.needsUpdate = true;

    // ---- chair (fly stands on it / desk edge)
    this._box(0.45, 0.05, 0.45, this._mat(0x1e2230), 0, -0.35, 0.15); this._box(0.45, 0.5, 0.05, this._mat(0x1e2230), 0, -0.1, 0.37); this._box(0.05, 0.4, 0.05, this._mat(0x222), 0, -0.55, 0.15);
    // ---- the fly: standing on the desk in front of the keyboard, facing the monitor
    this.fly = new Fly(); this.fly.root.scale.setScalar(0.34); this.fly.root.position.set(0, DESK_Y + 0.115, -0.24); this.fly.baseY = DESK_Y + 0.115; S.add(this.fly.root);
    this.fly.setKeyboard(this.keys.map(p => this.fly.root.worldToLocal(p.clone())));
    this.fly.mouseTarget = this.fly.root.worldToLocal(V(0.38, DESK_Y + 0.05, -0.45)); this.fly.mouseHome = this.fly.mouseTarget.clone();
    this.fly.footTargets = [V(-0.26, -0.34, 0.0), V(0.26, -0.34, 0.0), V(-0.24, -0.34, 0.22), V(0.24, -0.34, 0.22)];
    // ---- lights
    S.add(new THREE.AmbientLight(0x3a4266, 0.35));
    const moon = new THREE.DirectionalLight(0x8fb3ff, 0.5); moon.position.set(-2, 3, 1); moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024); moon.shadow.camera.left = -2; moon.shadow.camera.right = 2; moon.shadow.camera.top = 2; moon.shadow.camera.bottom = -2; S.add(moon);
    // dust motes
    const dust = new Float32Array(400 * 3); for (let i = 0; i < 400; i++) { dust[i * 3] = (Math.random() - 0.5) * 3; dust[i * 3 + 1] = Math.random() * 1.6 - 0.4; dust[i * 3 + 2] = (Math.random() - 0.5) * 2.5 - 0.5; }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dust, 3)); this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xffe0b0, size: 0.008, transparent: true, opacity: 0.35 })); S.add(this.dust);
  }

  setCamera(mode) {
    const views = { desk: [[0.85, 0.62, 0.95], [0, 0.22, -0.6]], fly: [[-0.42, 0.26, -0.62], [0, 0.1, -0.3]], screen: [[0, 0.5, -0.1], [0, 0.5, -1]], room: [[2.0, 1.3, 2.2], [0, 0.2, -0.6]] };
    const [p, l] = views[mode] || views.desk; this.camMode = mode;
    if (!this._camInit) { this._camInit = true; this.camera.position.set(...p); this.controls.target.set(...l); this.controls.update(); return; }
    this._camTo = { p: V(...p), l: V(...l), p0: this.camera.position.clone(), l0: this.controls.target.clone(), t0: performance.now(), dur: 1100 };
  }

  setData(d) { Object.assign(this.data, d); this._dirty = true; }
  setBody(body, last) {
    this.fly.setState({ typing: body.typing ?? 0.3, mouse: body.mouse ?? 0.2, groom: body.groom, escape: body.escape, action: body.action, turn: body.turn, reward: last?.reward > 0 ? last.reward : 0 });
    if (body.action && body.action !== 'hold') { this.flashScreen = 1; }
  }

  render() {
    const dt = Math.min(0.05, this.clock.getDelta()); const t = this.clock.elapsedTime;
    this.fly.update(dt);
    if (this._camTo) { const c = this._camTo; const k = Math.min(1, (performance.now() - c.t0) / c.dur); const e = 1 - Math.pow(1 - k, 3); this.camera.position.lerpVectors(c.p0, c.p, e); this.controls.target.lerpVectors(c.l0, c.l, e); this.camera.lookAt(this.controls.target); if (k >= 1) this._camTo = null; }
    else this.controls.update();
    // screen refresh at ~6 fps (cheap) or when dirty
    if (!this._lastScreen || t - this._lastScreen > 0.16 || this._dirty) { this._lastScreen = t; this._dirty = false; drawTerminal(this.screenCanvas, this.data, t); this.screenTex.needsUpdate = true; }
    // glow colour follows last action
    const act = this.data.last?.action; const col = act === 'buy' ? 0x2ee59d : act === 'sell' ? 0xff4d6d : 0x6d8cff; this.glow.color.setHex(col); this.glow.intensity = 1.4 + Math.sin(t * 3) * 0.1 + (this.flashScreen || 0) * 2; this.flashScreen = Math.max(0, (this.flashScreen || 0) - dt * 2);
    this.fans.forEach((f, i) => { f.userData.blades.rotation.x += dt * 12; f.material.color.setHSL((t * 0.1 + i * 0.2) % 1, 0.9, 0.6); });
    this.kbGlow.material.color.setHSL((t * 0.05) % 1, 0.8, 0.55); this.strip.material.color.copy(this.kbGlow.material.color);
    this.dust.rotation.y = t * 0.01; this.dust.position.y = Math.sin(t * 0.2) * 0.02;
    // mouse jiggles a bit when the fly uses it
    if (this.fly.state.mouse > 0.55) { this.mouse.position.x = 0.38 + Math.sin(t * 2) * 0.006; this.mouse.position.z = -0.45 + Math.cos(t * 1.7) * 0.006; }
    this.renderer.render(this.scene, this.camera);
  }
}

function makeTextTexture(lines, w, h, fg, bg) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h); x.fillStyle = fg; x.textAlign = 'center'; x.font = `bold ${Math.floor(w / 7)}px Inter, sans-serif`;
  lines.forEach((l, i) => x.fillText(l, w / 2, h * 0.25 + i * (w / 6)));
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}
