/**
 * FlyBrain — whole-brain leaky integrate-and-fire (LIF) simulation of the
 * FlyWire v783 connectome (139,255 neurons / 2.7M directed connections /
 * 34M synapses), following the model of Shiu et al., Nature 2024:
 *
 *   v_rest = -52 mV, v_thresh = -45 mV, v_reset = -52 mV, tau_m = 20 ms,
 *   refractory = 2.2 ms, synaptic delay = 1.8 ms, one synapse = 0.275 mV,
 *   sign from neurotransmitter prediction (ACh/DA/5-HT/OA +, GABA/Glu -).
 *
 * dt is 1 ms here (Shiu used 0.1 ms) so the whole brain runs in real time on a
 * 2-core sandbox.  Learning is implemented *only* where the fly actually learns:
 * dopamine-gated depression of Kenyon-cell -> MBON synapses in the mushroom
 * body (PAM = reward, PPL1 = punishment).  Every other synapse is the measured
 * connectome and never changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data', 'brain');

export const LIF = {
  V_REST: -52, V_TH: -45, V_RESET: -52, TAU_M: 20, TAU_G: 5, REFRACT_STEPS: 2, DELAY_STEPS: 2, W_SYN: 0.275, DT: 1,
};

function readBin(name, Ctor) {
  const buf = fs.readFileSync(path.join(DATA, name));
  return new Ctor(buf.buffer, buf.byteOffset, buf.byteLength / Ctor.BYTES_PER_ELEMENT);
}

export class FlyBrain {
  constructor() {
    this.meta = JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'));
    this.N = this.meta.n_neurons;
    this.ptr = readBin('csr_ptr.bin', Int32Array);
    this.idx = readBin('csr_idx.bin', Int32Array);
    this.w0 = readBin('csr_w.bin', Float32Array);      // measured (immutable)
    this.w = new Float32Array(this.w0);                 // live (plastic subset changes)
    this.pos = readBin('positions.bin', Float32Array);
    const rec = fs.readFileSync(path.join(DATA, 'neurons.bin'));
    const N = this.N;
    this.superClass = new Uint8Array(N); this.klass = new Uint8Array(N); this.ntOut = new Uint8Array(N);
    this.side = new Uint8Array(N); this.typeId = new Uint16Array(N);
    for (let i = 0; i < N; i++) {
      const o = i * 6;
      this.superClass[i] = rec[o]; this.klass[i] = rec[o + 1]; this.ntOut[i] = rec[o + 2]; this.side[i] = rec[o + 3];
      this.typeId[i] = rec[o + 4] | (rec[o + 5] << 8);
    }
    this.types = this.meta.types;
    this.typeIndex = new Map(this.types.map((t, i) => [t, i]));
    this.classIndex = new Map(this.meta.classes.map((t, i) => [t, i]));
    this.scIndex = new Map(this.meta.super_classes.map((t, i) => [t, i]));

    // state
    this.v = new Float32Array(N).fill(LIF.V_REST);
    this.g = new Float32Array(N);           // synaptic drive (mV), tau_g = 5 ms
    this.refr = new Uint8Array(N);
    this.inbuf = [new Float32Array(N), new Float32Array(N), new Float32Array(N)]; // delay ring
    this.bufHead = 0;
    this.spikeCount = new Uint32Array(N);   // spikes in current window
    this.step = 0;
    this.totalSpikes = 0;
    this.decayM = Math.exp(-LIF.DT / LIF.TAU_M);
    this.decayG = Math.exp(-LIF.DT / LIF.TAU_G);

    this._buildPopulations();
    this._buildMushroomBody();
  }

  /* ---------------------------------------------------------------- populations */
  neuronsOfType(t) { const id = this.typeIndex.get(t); if (id === undefined) return []; const out = []; for (let i = 0; i < this.N; i++) if (this.typeId[i] === id) out.push(i); return out; }
  neuronsOfTypePrefix(p) { const ids = new Set(); this.types.forEach((t, i) => { if (t.startsWith(p)) ids.add(i); }); const out = []; for (let i = 0; i < this.N; i++) if (ids.has(this.typeId[i])) out.push(i); return out; }
  neuronsOfClass(c) { const id = this.classIndex.get(c); const out = []; for (let i = 0; i < this.N; i++) if (this.klass[i] === id) out.push(i); return out; }

  _buildPopulations() {
    const P = this.pop = {};
    // --- vision: photoreceptors (R1-6 outer, R7/R8 inner) -> the chart is projected onto the retina
    P.R16 = this.neuronsOfType('R1-6');
    P.R7 = this.neuronsOfType('R7');
    P.R8 = this.neuronsOfType('R8');
    // sort photoreceptors into a 2D retinotopic grid by soma position (x = left-right, y = up)
    const grid = (arr) => arr.slice().sort((a, b) => this.pos[a * 3] - this.pos[b * 3]);
    P.retina = grid(P.R16);
    P.retinaR7 = grid(P.R7);
    P.retinaR8 = grid(P.R8);
    // --- olfaction: 54 ORN glomeruli => market "odours"
    const orn = {};
    this.types.forEach((t, id) => { if (t.startsWith('ORN_')) orn[t] = []; });
    for (let i = 0; i < this.N; i++) { const t = this.types[this.typeId[i]]; if (orn[t]) orn[t].push(i); }
    P.ornTypes = Object.keys(orn).sort();
    P.orn = orn;
    // --- taste: gustatory receptor neurons (sugar => profit, bitter => loss)
    P.gustatory = this.neuronsOfClass('gustatory');
    // --- mushroom body
    P.KC = this.neuronsOfClass('Kenyon_Cell');
    P.MBON = this.neuronsOfClass('MBON');
    P.PAM = this.neuronsOfTypePrefix('PAM');     // reward dopamine
    P.PPL1 = this.neuronsOfTypePrefix('PPL1');   // punishment dopamine
    P.DAN = this.neuronsOfClass('DAN');
    // --- descending "motor" neurons that animate the fly's body
    P.DNa01 = this.neuronsOfType('DNa01'); P.DNa02 = this.neuronsOfType('DNa02'); // steering L/R
    P.DNp09 = this.neuronsOfType('DNp09');   // forward walking
    P.DNg11 = this.neuronsOfType('DNg11');   // grooming
    P.MDN = this.neuronsOfType('MDN');       // backward walking
    P.DNp01 = this.neuronsOfType('DNp01');   // giant fibre escape
    P.LC4 = this.neuronsOfType('LC4'); P.LPLC2 = this.neuronsOfType('LPLC2'); // looming detectors
    P.CX = this.neuronsOfClass('CX');        // central complex (navigation / decision)
    P.descending = []; const dsc = this.scIndex.get('descending');
    for (let i = 0; i < this.N; i++) if (this.superClass[i] === dsc) P.descending.push(i);
    // per-side lists for steering read-out
    P.left = {}; P.right = {};
    for (const k of ['DNa01', 'DNa02', 'DNp09', 'MDN', 'DNg11']) {
      P.left[k] = P[k].filter(i => this.side[i] === 1); P.right[k] = P[k].filter(i => this.side[i] === 2);
    }
  }

  /* ------------------------------------------------------------ mushroom body */
  _buildMushroomBody() {
    const P = this.pop;
    const isKC = new Uint8Array(this.N); for (const i of P.KC) isKC[i] = 1;
    const isMBON = new Uint8Array(this.N); for (const i of P.MBON) isMBON[i] = 1;
    const isPAM = new Uint8Array(this.N); for (const i of P.PAM) isPAM[i] = 1;
    const isPPL1 = new Uint8Array(this.N); for (const i of P.PPL1) isPPL1[i] = 1;

    // KC -> MBON edges (the plastic synapses)
    const plastic = [];
    for (const kc of P.KC) for (let e = this.ptr[kc]; e < this.ptr[kc + 1]; e++) if (isMBON[this.idx[e]]) plastic.push(e);
    this.plasticEdges = Int32Array.from(plastic);
    this.plasticW0 = Float32Array.from(plastic, e => this.w0[e]);
    this.elig = new Float32Array(plastic.length);      // eligibility trace per plastic synapse
    this.mbonOfEdge = Int32Array.from(plastic, e => this.idx[e]);

    // MBON valence from measured dopamine input: PAM-dominated compartments -> "approach" MBONs
    // (their depression by reward biases behaviour toward the option); PPL1-dominated -> "avoid".
    const dan = new Map(P.MBON.map(m => [m, { pam: 0, ppl1: 0 }]));
    for (const d of P.DAN) for (let e = this.ptr[d]; e < this.ptr[d + 1]; e++) {
      const m = this.idx[e]; if (!isMBON[m]) continue;
      const s = Math.abs(this.w0[e]);
      if (isPAM[d]) dan.get(m).pam += s; else if (isPPL1[d]) dan.get(m).ppl1 += s;
    }
    this.mbonValence = new Map();   // +1 approach (buy-ish), -1 avoid (sell-ish)
    let ap = 0, av = 0;
    for (const m of P.MBON) { const { pam, ppl1 } = dan.get(m); const val = pam >= ppl1 ? 1 : -1; this.mbonValence.set(m, val); if (val > 0) ap++; else av++; }
    this.mbStats = { kc: P.KC.length, mbon: P.MBON.length, pam: P.PAM.length, ppl1: P.PPL1.length, plastic: plastic.length, approachMBON: ap, avoidMBON: av };
    // which MBONs receive each DAN class (for compartment-specific plasticity)
    this.mbonPAMInput = new Float32Array(this.N); this.mbonPPL1Input = new Float32Array(this.N);
    for (const m of P.MBON) { const { pam, ppl1 } = dan.get(m); const t = pam + ppl1 || 1; this.mbonPAMInput[m] = pam / t; this.mbonPPL1Input[m] = ppl1 / t; }
  }

  /* -------------------------------------------------------------- simulation */
  /**
   * Run `steps` ms of brain time.  `drive` = Map<neuronIndex, rateHz> of Poisson-driven
   * neurons (sensory input / optogenetic-like activation).  Returns spike counts window.
   */
  run(steps, drive, opts = {}) {
    const { v, g, refr, ptr, idx, w, N } = this;
    const th = LIF.V_TH, vr = LIF.V_RESET, vrest = LIF.V_REST, dM = this.decayM, dG = this.decayG, kIn = 1 - dM, wsyn = LIF.W_SYN;
    const driveIdx = opts.driveIdx, driveP = opts.driveP; // typed arrays (index, probability per step)
    const fired = opts.firedOut || null; // optional Uint32Array collector of fired neuron ids
    let firedN = 0;
    const noise = opts.noiseHz ? opts.noiseHz / 1000 : 0; // sparse background depolarisation
    const spk = this.spikeCount;
    for (let s = 0; s < steps; s++) {
      const cur = this.inbuf[this.bufHead];
      const nxt = this.inbuf[(this.bufHead + LIF.DELAY_STEPS) % 3];
      if (driveIdx) for (let k = 0; k < driveIdx.length; k++) { if (Math.random() < driveP[k]) { const i = driveIdx[k]; if (refr[i] === 0) v[i] = th + 1; } }
      for (let i = 0; i < N; i++) {
        // Shiu et al. 2024:  dv/dt = (v0 - v + g)/tau_m ;  dg/dt = -g/tau_g ;  on spike: g_post += w_syn * w
        let gi = g[i] + cur[i] * wsyn; cur[i] = 0;
        if (refr[i] > 0) { refr[i]--; g[i] = gi * dG; continue; }
        let vi = vrest + (v[i] - vrest) * dM + gi * kIn;
        g[i] = gi * dG;
        if (noise && Math.random() < noise) vi += 2.0;
        if (vi >= th) {
          v[i] = vr; refr[i] = LIF.REFRACT_STEPS; spk[i]++; this.totalSpikes++;
          if (fired && firedN < fired.length) fired[firedN++] = i;
          for (let e = ptr[i], end = ptr[i + 1]; e < end; e++) nxt[idx[e]] += w[e];
        } else v[i] = vi;
      }
      this.bufHead = (this.bufHead + 1) % 3;
      this.step++;
    }
    return firedN;
  }

  resetWindow() { this.spikeCount.fill(0); }

  rate(list, ms) { let s = 0; for (const i of list) s += this.spikeCount[i]; return list.length ? (s / list.length) * (1000 / ms) : 0; } // Hz mean
  count(list) { let s = 0; for (const i of list) s += this.spikeCount[i]; return s; }

  /** MBON read-out: approach vs avoid drive, per hemisphere. */
  readMBON(ms) {
    let approach = 0, avoid = 0; const per = [];
    for (const m of this.pop.MBON) { const r = this.spikeCount[m] * (1000 / ms); if (this.mbonValence.get(m) > 0) approach += r; else avoid += r; per.push([m, r]); }
    return { approach, avoid, per };
  }

  /* ------------------------------------------------------------- plasticity */
  /** Update eligibility from KC spikes in this window (which KC->MBON synapses carried the "situation"). */
  updateEligibility(ms) {
    const el = this.elig, pe = this.plasticEdges, spk = this.spikeCount, mb = this.mbonOfEdge;
    const kcOf = this._kcOfEdge || (this._kcOfEdge = this._computeKcOfEdge());
    for (let k = 0; k < pe.length; k++) {
      el[k] *= 0.6; // trace decay across decisions
      const pre = spk[kcOf[k]], post = spk[mb[k]];
      if (pre) el[k] += pre * (1 + 0.5 * Math.min(post, 4));
    }
  }
  _computeKcOfEdge() {
    const out = new Int32Array(this.plasticEdges.length); let k = 0;
    for (const kc of this.pop.KC) for (let e = this.ptr[kc]; e < this.ptr[kc + 1]; e++) if (this.mbonValence.has(this.idx[e])) out[k++] = kc;
    return out;
  }
  /**
   * Dopamine-gated depression (the fly's real learning rule).
   *  reward  > 0 => PAM dopamine: depress eligible KC synapses onto AVOID MBONs (=> approach the situation)
   *  reward  < 0 => PPL1 dopamine: depress eligible KC synapses onto APPROACH MBONs (=> avoid it)
   * `actionSign` (+1 buy, -1 sell, 0 hold) makes learning action-specific: a punished BUY depresses
   * the approach pathway harder; a punished SELL depresses the avoid pathway (so it stops selling).
   * Weights slowly recover toward the measured value (forgetting / extinction).
   */
  applyDopamine(reward, actionSign, lr = 0.08) {
    const pe = this.plasticEdges, mb = this.mbonOfEdge, el = this.elig, w = this.w, w0 = this.plasticW0;
    const mag = Math.min(1, Math.abs(reward));
    let changed = 0, sumAbs = 0;
    for (let k = 0; k < pe.length; k++) {
      const e = pe[k], m = mb[k];
      // forgetting: recover 1% toward measured value each decision
      w[e] += (w0[k] - w[e]) * 0.01;
      if (el[k] < 0.5 || mag === 0) continue;
      const val = this.mbonValence.get(m);
      let gate = 0;
      if (reward > 0) {          // PAM reward -> depress avoid MBON inputs (and, if we sold, depress approach a bit less)
        if (val < 0) gate = this.mbonPAMInput[m] + 0.3;
        if (actionSign < 0 && val > 0) gate = 0.4;   // a rewarded SELL also weakens the buy drive
      } else {                   // PPL1 punishment -> depress approach MBON inputs
        if (val > 0) gate = this.mbonPPL1Input[m] + 0.3;
        if (actionSign < 0 && val < 0) gate = 0.6;   // a punished SELL weakens the sell drive
        if (actionSign > 0 && val > 0) gate += 0.4;  // a punished BUY weakens the buy drive harder
      }
      if (gate <= 0) continue;
      const d = lr * mag * Math.min(el[k], 3) * gate * Math.abs(w0[k]);
      const floor = w0[k] * 0.05;                    // synapses depress, never flip sign, never below 5%
      const nw = w[e] - Math.sign(w0[k]) * d;
      w[e] = w0[k] > 0 ? Math.max(floor, nw) : Math.min(floor, nw);
      changed++; sumAbs += d;
    }
    return { changed, sumAbs };
  }

  /** Fraction of learning relative to measured wiring (0 = pristine). */
  plasticityStats() {
    let dev = 0, tot = 0, depressed = 0; const pe = this.plasticEdges, w0 = this.plasticW0;
    for (let k = 0; k < pe.length; k++) { const a = Math.abs(w0[k]); tot += a; const d = a - Math.abs(this.w[pe[k]]); dev += d; if (d > a * 0.1) depressed++; }
    return { synapses: pe.length, depressed, deviation: tot ? dev / tot : 0 };
  }

  exportWeights() { return Buffer.from(Float32Array.from(this.plasticEdges, e => this.w[e]).buffer); }
  importWeights(buf) {
    if (!buf) return false; const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    if (arr.length !== this.plasticEdges.length) return false;
    for (let k = 0; k < arr.length; k++) this.w[this.plasticEdges[k]] = arr[k];
    return true;
  }
  resetBrain() {
    this.w.set(this.w0); this.elig.fill(0); this.v.fill(LIF.V_REST); this.g.fill(0); this.refr.fill(0);
    for (const b of this.inbuf) b.fill(0); this.spikeCount.fill(0); this.step = 0; this.totalSpikes = 0;
  }
}
