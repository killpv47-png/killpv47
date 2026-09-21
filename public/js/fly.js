/**
 * Procedural anatomically-styled Drosophila rig: head with compound eyes + ocelli + antennae +
 * proboscis, dome thorax with bristles + halteres, striped tapering abdomen, 6 legs with
 * coxa/femur/tibia/tarsus (front legs use 2-bone IK to type / use the mouse), veined wings.
 * Fly local frame: faces -Z, +Y up.  Units ~ metres in the room.
 */
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function boneGeo(len, r0, r1) { const g = new THREE.CylinderGeometry(r1, r0, len, 7, 1); g.rotateZ(-Math.PI / 2); g.translate(len / 2, 0, 0); return g; }
function fromX(dir) { return new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), dir.clone().normalize()); }

export class Fly {
  constructor() {
    this.root = new THREE.Group();
    this.t = 0; this.state = { typing: 0.3, mouse: 0.2, groom: 0, escape: 0, action: 'hold', excitement: 0, walk: 0, turn: 0, reward: 0 };
    this._materials();
    this._body(); this._head(); this._legs(); this._wings();
    this.keyTargets = []; this.mouseTarget = V(0.36, 0.05, -0.28); this.mouseHome = this.mouseTarget.clone();
    this.currentTargets = [V(-0.1, 0.05, -0.4), V(0.1, 0.05, -0.4)];
    this.footTargets = [V(-0.26, -0.34, 0.0), V(0.26, -0.34, 0.0), V(-0.24, -0.34, 0.22), V(0.24, -0.34, 0.22)];
    this.tapPhase = [0, Math.PI]; this.nextKey = [null, null]; this.clickAt = -10;
  }
  _materials() {
    this.mat = {
      cuticle: new THREE.MeshPhysicalMaterial({ color: 0x6b4a2a, roughness: 0.55, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.35, sheen: 0.4, sheenColor: new THREE.Color(0xb8865a) }),
      thorax: new THREE.MeshPhysicalMaterial({ color: 0x8a6438, roughness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.3, sheen: 0.5, sheenColor: new THREE.Color(0xd9a86c) }),
      abdomenLight: new THREE.MeshPhysicalMaterial({ color: 0xc79a5c, roughness: 0.45, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
      abdomenDark: new THREE.MeshPhysicalMaterial({ color: 0x2b1a0e, roughness: 0.5, clearcoat: 0.6 }),
      eye: new THREE.MeshPhysicalMaterial({ color: 0xc8241a, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, emissive: 0x3a0500, emissiveIntensity: 0.6 }),
      eyeFacet: new THREE.MeshPhysicalMaterial({ color: 0xff5a3c, roughness: 0.2, clearcoat: 1, transparent: true, opacity: 0.55 }),
      leg: new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.6 }),
      wing: new THREE.MeshPhysicalMaterial({ color: 0xdfe8ff, roughness: 0.1, metalness: 0, transmission: 0.85, thickness: 0.002, ior: 1.3, transparent: true, opacity: 0.55, side: THREE.DoubleSide, iridescence: 0.7, iridescenceIOR: 1.4 }),
      vein: new THREE.LineBasicMaterial({ color: 0x5a4a3a, transparent: true, opacity: 0.6 }),
      bristle: new THREE.MeshStandardMaterial({ color: 0x1a1008, roughness: 0.9 }),
      ocellus: new THREE.MeshPhysicalMaterial({ color: 0xffb04a, roughness: 0.1, clearcoat: 1, emissive: 0x442200, emissiveIntensity: 0.8 }),
    };
  }
  _body() {
    const g = this.root;
    const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.135, 28, 20), this.mat.thorax);
    thorax.scale.set(1, 0.95, 1.25); thorax.castShadow = true; this.thorax = thorax; g.add(thorax);
    const scut = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), this.mat.cuticle); scut.scale.set(1.2, 0.6, 1); scut.position.set(0, 0.06, 0.15); g.add(scut);
    for (let i = 0; i < 40; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0025, 0.05, 4), this.mat.bristle);
      const th = Math.random() * Math.PI * 2, ph = Math.random() * 0.9; const n = V(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th) * 1.25);
      b.position.copy(n.clone().multiply(V(0.135, 0.13, 0.17))); b.quaternion.setFromUnitVectors(V(0, 1, 0), n.clone().normalize()); b.rotateX(-0.5); g.add(b);
    }
    const abd = new THREE.Group(); abd.position.set(0, -0.02, 0.17); this.abdomen = abd; g.add(abd);
    let z = 0; const radii = [0.13, 0.135, 0.125, 0.105, 0.08, 0.05];
    radii.forEach((r, i) => {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 16), i % 2 ? this.mat.abdomenDark : this.mat.abdomenLight);
      seg.scale.set(1, 0.85, 0.7); seg.position.set(0, -i * 0.012, z + r * 0.55); seg.castShadow = true; abd.add(seg); z += r * 0.75;
    });
    for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), this.mat.cuticle); h.position.set(s * 0.13, 0.02, 0.12); g.add(h); const st = new THREE.Mesh(boneGeo(0.05, 0.003, 0.003), this.mat.leg); st.position.set(s * 0.1, 0.02, 0.1); st.quaternion.copy(fromX(V(s, 0.1, 0.3))); g.add(st); }
  }
  _head() {
    const head = new THREE.Group(); head.position.set(0, 0.03, -0.17); this.head = head; this.root.add(head);
    const capsule = new THREE.Mesh(new THREE.SphereGeometry(0.095, 24, 18), this.mat.cuticle); capsule.scale.set(1.15, 1, 0.85); capsule.castShadow = true; head.add(capsule);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.068, 32, 24), this.mat.eye); eye.position.set(s * 0.075, 0.005, -0.01); eye.scale.set(0.8, 1.15, 1); head.add(eye);
      const facets = new THREE.Mesh(new THREE.IcosahedronGeometry(0.0695, 3), this.mat.eyeFacet); facets.position.copy(eye.position); facets.scale.copy(eye.scale); head.add(facets);
      const flat = new THREE.Mesh(new THREE.IcosahedronGeometry(0.0705, 2), new THREE.MeshBasicMaterial({ color: 0x300000, wireframe: true, transparent: true, opacity: 0.25 })); flat.position.copy(eye.position); flat.scale.copy(eye.scale); head.add(flat);
    }
    [[0, 0.09, -0.02], [-0.02, 0.085, 0.0], [0.02, 0.085, 0.0]].forEach(p => { const o = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), this.mat.ocellus); o.position.set(...p); head.add(o); });
    this.antennae = [];
    for (const s of [-1, 1]) {
      const a = new THREE.Group(); a.position.set(s * 0.02, 0.03, -0.085); head.add(a);
      const seg = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), this.mat.cuticle); a.add(seg);
      const seg3 = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), this.mat.cuticle); seg3.position.set(s * 0.008, -0.012, -0.02); a.add(seg3);
      const arista = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0015, 0.07, 4), this.mat.bristle); arista.position.set(s * 0.012, 0.012, -0.045); arista.rotation.set(-1.1, 0, s * 0.5); a.add(arista);
      for (let k = 0; k < 6; k++) { const br = new THREE.Mesh(new THREE.CylinderGeometry(0.0003, 0.0006, 0.018, 3), this.mat.bristle); br.position.set(s * 0.012 + (k % 2 ? 0.006 : -0.006), 0.012 + k * 0.006, -0.05 - k * 0.006); br.rotation.set(-0.6, 0, (k % 2 ? 1 : -1) * 1.2); a.add(br); }
      this.antennae.push(a);
    }
    const pro = new THREE.Group(); pro.position.set(0, -0.06, -0.04); head.add(pro); this.proboscis = pro;
    const rostrum = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.05, 10), this.mat.cuticle); rostrum.position.y = -0.02; pro.add(rostrum);
    const haust = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.04, 10), this.mat.leg); haust.position.y = -0.06; pro.add(haust);
    const lab = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), this.mat.abdomenLight); lab.scale.set(1.4, 0.6, 1); lab.position.y = -0.085; pro.add(lab);
    for (let i = 0; i < 14; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0005, 0.002, 0.03, 4), this.mat.bristle); const th = (Math.random() - 0.5) * 1.6; b.position.set(Math.sin(th) * 0.03, 0.07 + Math.random() * 0.02, -0.03 - Math.random() * 0.04); b.rotation.set(-0.8 + Math.random() * 0.5, 0, th); head.add(b); }
  }
  _legs() {
    this.legs = [];
    const coxae = [[-0.09, -0.07, -0.11], [0.09, -0.07, -0.11], [-0.11, -0.08, -0.01], [0.11, -0.08, -0.01], [-0.1, -0.08, 0.09], [0.1, -0.08, 0.09]];
    const L = [[0.20, 0.23, 0.09], [0.20, 0.23, 0.09], [0.22, 0.25, 0.1], [0.22, 0.25, 0.1], [0.26, 0.3, 0.11], [0.26, 0.3, 0.11]];
    coxae.forEach((c, i) => {
      const grp = new THREE.Group(); this.root.add(grp);
      const coxa = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), this.mat.cuticle); coxa.position.set(...c); grp.add(coxa);
      const femur = new THREE.Mesh(boneGeo(L[i][0], 0.016, 0.011), this.mat.leg); femur.castShadow = true; grp.add(femur);
      const tibia = new THREE.Mesh(boneGeo(L[i][1], 0.011, 0.007), this.mat.leg); tibia.castShadow = true; grp.add(tibia);
      const tarsus = new THREE.Mesh(boneGeo(L[i][2], 0.006, 0.004), this.mat.leg); grp.add(tarsus);
      const claw = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), this.mat.abdomenDark); grp.add(claw);
      for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0004, 0.0012, 0.02, 3), this.mat.bristle); b.position.set(L[i][1] * (0.2 + k * 0.15), 0.008, 0); b.rotation.z = 0.9; tibia.add(b); }
      this.legs.push({ coxa: V(...c), femur, tibia, tarsus, claw, L: L[i], side: i % 2 ? 1 : -1, pair: Math.floor(i / 2) });
    });
  }
  _wings() {
    this.wings = [];
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.bezierCurveTo(0.05, 0.06, 0.28, 0.09, 0.42, 0.04); shape.bezierCurveTo(0.46, 0.02, 0.44, -0.03, 0.4, -0.05); shape.bezierCurveTo(0.25, -0.1, 0.06, -0.06, 0, 0);
    const geo = new THREE.ShapeGeometry(shape, 12);
    for (const s of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(s * 0.09, 0.09, 0.02); this.root.add(w);
      const m = new THREE.Mesh(geo, this.mat.wing); m.rotation.x = -Math.PI / 2; m.rotation.z = s * Math.PI / 2; w.add(m);
      const veins = [[[0, 0], [0.42, 0.04]], [[0, 0], [0.4, -0.05]], [[0, 0], [0.38, -0.01]], [[0.1, 0.02], [0.3, 0.06]], [[0.12, -0.03], [0.32, -0.06]], [[0.2, 0.0], [0.22, 0.05]], [[0.3, -0.02], [0.31, 0.04]]];
      for (const [a, b] of veins) { const g = new THREE.BufferGeometry().setFromPoints([V(a[1] * s, 0.001, a[0]), V(b[1] * s, 0.001, b[0])]); w.add(new THREE.Line(g, this.mat.vein)); }
      this.wings.push({ grp: w, side: s });
    }
  }

  _ik(leg, target, kneeUp = 1) {
    const S = leg.coxa, [L1, L2, L3] = leg.L;
    const toT = target.clone().sub(S); let d = toT.length(); const maxD = (L1 + L2) * 0.985; if (d > maxD) { toT.multiplyScalar(maxD / d); d = maxD; } if (d < 0.02) d = 0.02;
    const dir = toT.clone().normalize();
    const a1 = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
    const up = V(0, 1, 0); let axis = new THREE.Vector3().crossVectors(dir, up); if (axis.lengthSq() < 1e-6) axis = V(1, 0, 0); axis.normalize();
    const femDir = dir.clone().applyAxisAngle(axis, -a1 * kneeUp).normalize();
    leg.femur.position.copy(S); leg.femur.quaternion.copy(fromX(femDir));
    const K = S.clone().add(femDir.clone().multiplyScalar(L1));
    const tibDir = target.clone().sub(K).normalize();
    leg.tibia.position.copy(K); leg.tibia.quaternion.copy(fromX(tibDir));
    const tarDir = tibDir.clone().multiplyScalar(0.4).add(V(0, -0.9, -0.2)).normalize();
    leg.tarsus.position.copy(target); leg.tarsus.quaternion.copy(fromX(tarDir));
    leg.claw.position.copy(target.clone().add(tarDir.multiplyScalar(L3)));
  }

  setKeyboard(keys) { this.keyTargets = keys; }
  setState(s) { Object.assign(this.state, s); if (s.action && s.action !== 'hold') { this.state.excitement = 1; this.clickAt = this.t + 0.9; } }

  update(dt) {
    this.t += dt; const t = this.t, st = this.state;
    st.excitement = Math.max(0, st.excitement - dt * 0.35);
    const breathe = Math.sin(t * 2.1) * 0.5 + 0.5;
    this.abdomen.scale.set(1 + breathe * 0.03, 1 + breathe * 0.05, 1); this.abdomen.rotation.x = 0.15 + Math.sin(t * 1.3) * 0.02;
    this.root.rotation.z = Math.sin(t * 0.7) * 0.01; this.root.rotation.x = -0.18 + Math.sin(t * 0.9) * 0.01 + st.excitement * 0.05;
    this.head.rotation.y = Math.sin(t * 0.5) * 0.08 + Math.sin(t * 3.7) * 0.02 * st.excitement + (st.turn || 0) * 0.01;
    this.head.rotation.x = 0.1 + Math.sin(t * 1.1) * 0.03 - st.excitement * 0.15;
    this.antennae.forEach((a, i) => { a.rotation.x = Math.sin(t * 5 + i) * 0.08 + Math.sin(t * 17 + i * 3) * 0.03 * (0.3 + st.excitement); a.rotation.z = (i ? 1 : -1) * (0.2 + Math.sin(t * 2 + i) * 0.05); });
    const ext = st.reward > 0 ? Math.min(1, st.reward * 2) : 0; this.proboscis.scale.y = 0.55 + 0.45 * ext + Math.sin(t * 3) * 0.02; this.proboscis.position.y = -0.06 - 0.01 * ext;
    const flutter = st.escape > 0 ? 1 : st.excitement > 0.7 ? (st.excitement - 0.7) * 3 : 0;
    this.wings.forEach(w => { const s = w.side; const beat = flutter ? Math.sin(t * 90) * 0.9 * flutter : 0; w.grp.rotation.z = s * (0.05 + Math.sin(t * 1.5) * 0.01) + beat * s; w.grp.rotation.y = s * (0.12 + flutter * 1.2); w.grp.rotation.x = -0.05 + flutter * 0.3; });
    const groom = Math.min(1, (st.groom || 0) / 60);
    const typing = st.typing ?? 0.3;
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i]; const side = leg.side; let target;
      if (groom > 0.5 && st.action === 'hold') {
        target = V(side * (0.04 + Math.sin(t * 6) * 0.02), 0.02 + Math.sin(t * 6 + i) * 0.03, -0.27 - Math.cos(t * 6) * 0.02);
      } else if (i === 1 && (st.mouse > 0.55 || this.clickAt > t - 0.5)) {
        const press = Math.abs(t - this.clickAt) < 0.15 ? -0.012 : 0;
        target = this.mouseTarget.clone().add(V(Math.sin(t * 2) * 0.015, 0.03 + press, Math.cos(t * 1.7) * 0.015 - 0.01));
      } else {
        this.tapPhase[i] += dt * (3 + 6 * typing) * (typing > 0.05 ? 1 : 0.2);
        if (this.tapPhase[i] > Math.PI * 2 || !this.nextKey[i]) { this.tapPhase[i] = this.tapPhase[i] % (Math.PI * 2); if (this.keyTargets.length) { const pool = this.keyTargets.filter(k => Math.sign(k.x) === side || Math.abs(k.x) < 0.04); this.nextKey[i] = pool[Math.floor(Math.random() * pool.length)] || this.keyTargets[0]; } }
        const key = this.nextKey[i] || V(side * 0.1, 0.05, -0.4);
        const lift = Math.max(0, Math.sin(this.tapPhase[i])) * 0.04 * (0.4 + typing);
        this.currentTargets[i].lerp(key, Math.min(1, dt * 10));
        target = this.currentTargets[i].clone().add(V(0, lift + 0.005, 0));
      }
      this._ik(leg, target, 1);
    }
    for (let i = 2; i < 6; i++) { const f = this.footTargets[i - 2].clone(); f.x += Math.sin(t * 0.8 + i) * 0.004; f.y += (st.escape > 0 ? Math.sin(t * 40) * 0.02 : 0); this._ik(this.legs[i], f, 1); }
    this.root.position.y = (this.baseY || 0) + (st.escape > 0 ? Math.abs(Math.sin(t * 6)) * 0.08 : 0) + Math.sin(t * 2.1) * 0.003;
    if (st.escape > 0) st.escape = Math.max(0, st.escape - dt * 30);
    if (st.reward) st.reward *= Math.exp(-dt * 0.6);
  }
}
