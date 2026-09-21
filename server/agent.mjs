/**
 * The Fly Trader agent — closes the sensorimotor loop:
 *
 *   market  ->  sensory encoding  ->  whole-brain LIF (FlyWire v783)  ->  MBON read-out
 *           ->  FlyBay paper order ->  P&L  ->  dopamine (PAM reward / PPL1 punishment)
 *           ->  KC->MBON plasticity (the fly's mushroom-body learning rule)
 *
 * Sensory encoding (all engineered mappings, documented in README):
 *   VISION   the chart raster on the monitor is projected onto the lamina (L1/L2 cells sorted
 *            retinotopically) and motion cells T4c/T4d (up / down) receive price velocity.
 *   SMELL    market features -> 10 ORN glomeruli "odours" (momentum, RSI, volatility, ...).
 *            Odour identity is what the mushroom body learns valence for.
 *   TASTE    sugar GRNs on realised profit, bitter GRNs on realised loss.
 *   LOOM     LC4/LPLC2 looming detectors fire on sharp drawdown -> DNp01 escape (panic sell).
 */
import { FlyBrain, LIF } from './brain.mjs';
import { Market } from './market.mjs';
import { Exchange, EXCHANGE } from './exchange.mjs';
import { DB } from './db.mjs';

const ODOUR_GLOMERULI = ['ORN_DM1', 'ORN_VA2', 'ORN_DL1', 'ORN_DA1', 'ORN_VM5d', 'ORN_DM3', 'ORN_VA6', 'ORN_DL3', 'ORN_VM4', 'ORN_VL2a'];
const FEATURE_KEYS = ['mom1', 'mom5', 'mom15', 'mom60', 'rsi', 'bbz', 'vol', 'volRatio', 'emaCross', 'spread'];

export class Agent {
  constructor() {
    this.db = new DB();
    this.brain = new FlyBrain();
    this.market = new Market();
    this.exchange = new Exchange(this.db);
    this.running = this.db.get('running', false);
    this.decisionMs = 160;            // brain time simulated per decision
    this.intervalMs = 8000;           // wall-clock between decisions
    this.decisionCount = this.db.get('decisionCount', 0);
    this.listeners = new Set();
    this.lastDecision = null; this.lastSpikes = null; this.busy = false;
    this.body = { walk: 0, turn: 0, groom: 0, escape: 0, backward: 0, arousal: 0, action: 'idle', typing: 0, mouse: 0 };
    this.recentRewards = [];
    this._prepareSensors();
    const saved = this.db.loadBrain();
    if (saved && this.brain.importWeights(saved.weights)) this.log('info', 'brain', `Restored learned synapses from DB (${saved.decisions} decisions)`);
    this.log('info', 'system', `FlyBrain online — ${this.brain.N.toLocaleString()} neurons, ${this.brain.meta.n_edges.toLocaleString()} connections, ${this.brain.meta.n_synapses.toLocaleString()} synapses (FlyWire v783)`);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) { try { fn(type, data); } catch {} } }
  log(level, kind, msg) { this.db.insertEvent(level, kind, msg); this.emit('log', { t: Date.now(), level, kind, msg }); }

  /* --------------------------------------------------------------- sensors */
  _prepareSensors() {
    const b = this.brain;
    const bySide = (arr) => ({ L: arr.filter(i => b.side[i] === 1), R: arr.filter(i => b.side[i] === 2) });
    // Lamina L1+L2 sorted by soma position => retinotopic grid (cols x rows) per eye
    const lam = [...b.neuronsOfType('L1'), ...b.neuronsOfType('L2')];
    const eye = bySide(lam);
    const gridify = (list, cols, rows) => {
      const sorted = list.slice().sort((a, c) => b.pos[a * 3 + 2] - b.pos[c * 3 + 2]); // z = anterior-posterior => columns
      const perCol = Math.ceil(sorted.length / cols); const grid = [];
      for (let c = 0; c < cols; c++) {
        const col = sorted.slice(c * perCol, (c + 1) * perCol).sort((a, d) => b.pos[d * 3 + 1] - b.pos[a * 3 + 1]); // y => rows top->bottom
        const perRow = Math.ceil(col.length / rows) || 1;
        for (let r = 0; r < rows; r++) grid.push(col.slice(r * perRow, (r + 1) * perRow));
      }
      return grid;
    };
    this.cols = 48; this.rows = 24;
    this.retinaL = gridify(eye.L, this.cols, this.rows); this.retinaR = gridify(eye.R, this.cols, this.rows);
    this.T4c = b.neuronsOfType('T4c'); this.T4d = b.neuronsOfType('T4d');   // T4c ~ upward motion, T4d ~ downward (engineered mapping)
    this.odours = ODOUR_GLOMERULI.map(g => b.pop.orn[g] || []);
    this.sugar = b.pop.gustatory.filter((_, i) => i % 2 === 0).slice(0, 120); this.bitter = b.pop.gustatory.filter((_, i) => i % 2 === 1).slice(0, 120);
    this.loom = [...b.pop.LC4, ...b.pop.LPLC2];
    this.driveIdx = new Int32Array(60000); this.driveP = new Float32Array(60000);
  }

  /** Build Poisson drive from the current market state. Returns {n, summary} */
  encode() {
    const m = this.market, f = m.features(); let n = 0; const add = (i, hz) => { if (n < this.driveIdx.length && hz > 0) { this.driveIdx[n] = i; this.driveP[n] = Math.min(0.5, hz / 1000); n++; } };
    // VISION: raster of last 48 candles -> lamina. Lit pixels at up to 60 Hz. Both eyes see the same monitor.
    const img = m.raster(this.cols, this.rows); let lit = 0;
    for (let c = 0; c < this.cols; c++) for (let r = 0; r < this.rows; r++) {
      const v = img[r * this.cols + c]; if (v < 0.2) continue; lit++;
      const k = c * this.rows + r; const hz = 25 + 35 * v;
      const gl = this.retinaL[k], gr = this.retinaR[k];
      if (gl) for (let j = 0; j < gl.length; j += 2) add(gl[j], hz);
      if (gr) for (let j = 0; j < gr.length; j += 2) add(gr[j], hz);
    }
    // MOTION: price velocity -> T4c (up) / T4d (down)
    const vel = f.mom1 * 0.6 + f.mom5 * 0.4; const up = Math.max(0, vel), dn = Math.max(0, -vel);
    for (let j = 0; j < this.T4c.length; j += 3) add(this.T4c[j], 40 * up);
    for (let j = 0; j < this.T4d.length; j += 3) add(this.T4d[j], 40 * dn);
    // SMELL: 10 features -> 10 glomeruli. Positive value = odour concentration; negative value drives the paired glomerulus half.
    const odourVec = [];
    FEATURE_KEYS.forEach((key, gi) => {
      const val = f[key]; const list = this.odours[gi]; const hz = 4 + 24 * Math.abs(val); odourVec.push(+val.toFixed(3));
      const half = Math.ceil(list.length / 2);
      const part = val >= 0 ? list.slice(0, half) : list.slice(half);
      for (const i of part) add(i, hz);
    });
    // TASTE: unrealised P&L on open position (sugar if in profit, bitter if losing)
    const upnl = this.exchange.unrealised(m.price) / Math.max(1, this.exchange.equity(m.price));
    if (upnl > 0.001) for (const i of this.sugar) add(i, Math.min(60, upnl * 3000));
    if (upnl < -0.001) for (const i of this.bitter) add(i, Math.min(60, -upnl * 3000));
    // LOOM: sharp drop in the last 5 min while holding BTC
    const drop = -Math.min(0, m.momentum(5)); if (drop > 0.004 && this.exchange.state.btc > 0) for (let j = 0; j < this.loom.length; j += 2) add(this.loom[j], Math.min(80, drop * 8000));
    return { n, lit, odourVec, features: f, upnl, drop };
  }

  /* --------------------------------------------------------------- decision */
  async decide() {
    if (this.busy) return; this.busy = true;
    const b = this.brain, m = this.market, ex = this.exchange;
    try {
      if (!(m.price > 0)) { await m.tick(); if (!(m.price > 0)) return; }
      const enc = this.encode();
      b.resetWindow();
      const fired = new Uint32Array(120000);
      const t0 = performance.now();
      const firedN = b.run(this.decisionMs, null, { driveIdx: this.driveIdx.subarray(0, enc.n), driveP: this.driveP.subarray(0, enc.n), firedOut: fired, noiseHz: 0 });
      const simMs = performance.now() - t0;
      let active = 0; for (let i = 0; i < b.N; i++) if (b.spikeCount[i]) active++;
      const mb = b.readMBON(this.decisionMs);
      // ----- read-out: approach vs avoid drive from MBONs (normalised), plus escape circuit
      const tot = mb.approach + mb.avoid || 1; const bias = (mb.approach - mb.avoid) / tot;   // -1..1
      const escape = b.count(b.pop.DNp01) > 0;
      const s = ex.state; const price = m.price;
      let action = 'hold', confidence = Math.abs(bias);
      const thr = 0.12;
      const exposure = (s.btc * price) / Math.max(1, ex.equity(price));          // 0..1 fraction of equity in BTC
      const sinceTrade = this.lastTradeAt ? (Date.now() - this.lastTradeAt) / 1000 : 1e9;
      if (escape && s.btc > 0) action = 'sell';
      else if (bias > thr && exposure < 0.8 && s.usd - s.taxReserve > EXCHANGE.minOrderUSD + 1 && sinceTrade > 45) action = 'buy';
      else if (bias < -thr && s.btc * price > EXCHANGE.minOrderUSD && sinceTrade > 45) action = 'sell';
      // ----- position sizing: confidence scales the fraction of available capital (10%..60%)
      let trade = null, err = null;
      if (action === 'buy') {
        const frac = 0.1 + 0.3 * Math.min(1, (confidence - thr) / 0.5); const room = Math.max(0, ex.equity(price) * 0.8 - s.btc * price); const usd = Math.floor(Math.min(s.usd - s.taxReserve, ex.equity(price) * frac, room) * 100) / 100;
        const r = ex.marketOrder('buy', usd, m, `MBON bias +${bias.toFixed(2)}`); if (r.ok) trade = r.trade; else err = r.error;
      } else if (action === 'sell') {
        const frac = escape ? 1 : 0.2 + 0.8 * Math.min(1, (confidence - thr) / 0.5); const btc = Math.floor(s.btc * frac * 1e8) / 1e8;
        const r = ex.marketOrder('sell', btc, m, escape ? 'DNp01 giant-fibre ESCAPE' : `MBON bias ${bias.toFixed(2)}`); if (r.ok) trade = r.trade; else err = r.error;
      }
      if (err) action = 'hold';
      if (trade) this.lastTradeAt = Date.now();
      // ----- reward: realised P&L on sells, mark-to-market change since last decision otherwise
      const equity = ex.equity(price);
      let reward = 0; let dopamine = 'none';
      if (this.lastEquity != null) {
        const dEq = (equity - this.lastEquity) / Math.max(1, this.lastEquity);        // fraction
        reward = clamp(dEq * 200, -1, 1);                                             // 0.5% move => full-scale reward
        if (trade && trade.pnl) reward += clamp(trade.pnl / Math.max(10, this.lastEquity * 0.01), -1, 1) * 0.5; // realised outcome matters
        if (action === 'hold' && s.btc === 0 && Math.abs(dEq) < 1e-6) reward = -0.002;  // tiny boredom cost so it does not sleep forever
      }
      this.lastEquity = equity;
      const actionSign = action === 'buy' ? 1 : action === 'sell' ? -1 : 0;
      // ----- dopamine: PAM (reward) / PPL1 (punishment) gate KC->MBON depression on eligible synapses
      b.updateEligibility(this.decisionMs);
      let plast = { changed: 0, sumAbs: 0 };
      if (Math.abs(reward) > 0.01) {
        dopamine = reward > 0 ? `PAM +${reward.toFixed(2)}` : `PPL1 ${reward.toFixed(2)}`;
        plast = b.applyDopamine(reward, actionSign);
        // also physically fire the dopamine neurons so the viewer shows the reward burst
        const dan = reward > 0 ? b.pop.PAM : b.pop.PPL1; const di = Int32Array.from(dan); const dp = new Float32Array(dan.length).fill(Math.min(0.3, Math.abs(reward) * 0.15));
        b.run(20, null, { driveIdx: di, driveP: dp });
      }
      this.recentRewards.push(reward); if (this.recentRewards.length > 100) this.recentRewards.shift();
      // ----- body: descending neuron read-out drives the 3D fly animation
      const L = b.pop.left, R = b.pop.right;
      this.body = {
        walk: b.count(b.pop.DNp09) + b.count(L.DNa01) + b.count(R.DNa01), turn: (b.count(R.DNa01) + b.count(R.DNa02)) - (b.count(L.DNa01) + b.count(L.DNa02)),
        groom: b.count(b.pop.DNg11), escape: b.count(b.pop.DNp01), backward: b.count(b.pop.MDN), arousal: b.count(b.pop.descending),
        action, typing: action !== 'hold' ? 1 : 0.15 + Math.min(0.6, b.count(b.pop.descending) / 4000), mouse: Math.min(1, Math.abs(bias) * 2),
      };
      // ----- persist
      this.decisionCount++; this.db.set('decisionCount', this.decisionCount);
      ex.updateRisk(price); ex.save();
      const dec = { t: Date.now(), price, action, approach: +mb.approach.toFixed(1), avoid: +mb.avoid.toFixed(1), confidence: +confidence.toFixed(3), reward: +reward.toFixed(4), dopamine, equity: +equity.toFixed(2), spikes: b.totalSpikes, active, features: enc.features };
      this.db.insertDecision(dec); this.db.insertEquity(dec.t, dec.equity, price);
      if (this.decisionCount % 5 === 0) this.db.saveBrain(b.exportWeights(), this.decisionCount);
      const tax = ex.settleTax(); if (tax) this.log('warn', 'tax', `Quarterly capital-gains tax paid: $${tax.toFixed(2)}`);
      // auto-withdraw profits: if equity > $1,250 and no BTC held, withdraw 50% of gains above $1,000
      if (s.btc === 0 && s.usd - s.taxReserve > 1250) { const w = ex.withdraw(Math.floor((s.usd - s.taxReserve - 1000) * 0.5)); if (w.ok) this.log('info', 'withdraw', w.entry.note + ` — $${-w.entry.amount}`); }
      // ----- spike sample for the 3D viewer (subsample to <= 6000 ids)
      const step = Math.max(1, Math.floor(firedN / 6000)); const sample = []; for (let k = 0; k < firedN; k += step) sample.push(fired[k]);
      this.lastSpikes = sample;
      this.lastDecision = { ...dec, bias: +bias.toFixed(3), escape, simMs: Math.round(simMs), firedN, lit: enc.lit, odour: enc.odourVec, plasticity: { ...plast, ...b.plasticityStats() }, trade, body: this.body, decisionCount: this.decisionCount, mbon: mb.per.map(([i, r]) => [i, +r.toFixed(0), b.mbonValence.get(i)]) };
      const msg = trade ? `${action.toUpperCase()} ${trade.btc.toFixed(6)} BTC @ $${price.toFixed(2)} (${trade.reason}) fee $${trade.fee}` + (trade.pnl ? ` P&L ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}` : '') : `HOLD — MBON approach ${mb.approach.toFixed(0)} / avoid ${mb.avoid.toFixed(0)} Hz (bias ${bias.toFixed(2)})`;
      this.log(trade ? 'trade' : 'debug', 'decision', msg + ` · reward ${reward >= 0 ? '+' : ''}${reward.toFixed(3)} · ${dopamine} · ${active.toLocaleString()} neurons active · ${plast.changed} synapses changed`);
      this.emit('decision', this.lastDecision);
      this.emit('spikes', { ids: sample, t: dec.t });
    } catch (e) {
      this.log('error', 'agent', String(e.stack || e));
    } finally { this.busy = false; }
  }

  /* ------------------------------------------------------------- lifecycle */
  async start() {
    await this.market.loadHistory().catch(e => this.log('error', 'market', 'history failed: ' + e.message));
    this.market.on(ev => { if (ev.type === 'tick') { this.exchange.updateRisk(ev.price); this.emit('tick', { price: ev.price, bid: ev.bid, ask: ev.ask, t: ev.t, candle: this.market.candles[this.market.candles.length - 1] }); } else if (ev.type === 'error') this.log('warn', 'market', ev.message); });
    this.tickTimer = setInterval(() => this.market.tick(), 3000);
    await this.market.tick();
    this.lastEquity = this.exchange.equity(this.market.price);
    this.loop();
  }
  loop() {
    clearTimeout(this.loopTimer);
    const next = async () => { if (this.running) await this.decide(); this.loopTimer = setTimeout(next, this.running ? this.intervalMs : 1000); };
    this.loopTimer = setTimeout(next, 500);
  }
  setRunning(on) { this.running = !!on; this.db.set('running', this.running); this.log('info', 'system', this.running ? '▶ Fly trader STARTED' : '⏸ Fly trader PAUSED'); this.emit('status', this.status()); }
  resetBrain() {
    this.brain.resetBrain(); this.db.saveBrain(this.brain.exportWeights(), 0); this.decisionCount = 0; this.db.set('decisionCount', 0); this.recentRewards = [];
    this.log('warn', 'brain', '🧠 Brain reset — all KC→MBON synapses restored to measured FlyWire values'); this.emit('status', this.status());
  }
  resetAccount() { this.exchange.reset(); this.lastEquity = this.exchange.equity(this.market.price); this.log('warn', 'exchange', '💵 FlyBay account reset to $1,000.00'); this.emit('status', this.status()); }
  resetAll() { this.db.resetAll(); this.exchange = new Exchange(this.db); this.resetBrain(); this.resetAccount(); this.db.set('running', this.running); }
  stimulate(pop, hz = 50, ms = 60) {
    const b = this.brain; const list = pop === 'PAM' ? b.pop.PAM : pop === 'PPL1' ? b.pop.PPL1 : pop === 'LC4' ? this.loom : pop === 'sugar' ? this.sugar : pop === 'bitter' ? this.bitter : b.neuronsOfType(pop);
    if (!list.length) return 0; const fired = new Uint32Array(60000);
    b.resetWindow(); const n = b.run(ms, null, { driveIdx: Int32Array.from(list), driveP: new Float32Array(list.length).fill(hz / 1000), firedOut: fired });
    const sample = Array.from(fired.subarray(0, Math.min(n, 6000))); this.emit('spikes', { ids: sample, t: Date.now(), stim: pop });
    this.log('info', 'stim', `Optogenetic stimulation: ${pop} (${list.length} cells @ ${hz} Hz) → ${n} spikes downstream`); return n;
  }
  status() {
    const m = this.market; const price = m.price;
    return {
      running: this.running, decisionCount: this.decisionCount, intervalMs: this.intervalMs, decisionMs: this.decisionMs,
      brain: { neurons: this.brain.N, edges: this.brain.meta.n_edges, synapses: this.brain.meta.n_synapses, ...this.brain.mbStats, plasticity: this.brain.plasticityStats(), totalSpikes: this.brain.totalSpikes, simStep: this.brain.step },
      market: { price, bid: m.bid, ask: m.ask, vol24: m.vol24, source: m.source, lastTick: m.lastTick, candles: m.candles.length, features: price ? m.features() : null },
      wallet: this.exchange.snapshot(price), body: this.body, last: this.lastDecision, avgReward: this.recentRewards.length ? this.recentRewards.reduce((a, b) => a + b, 0) / this.recentRewards.length : 0,
      stats: this.db.stats(), uptime: process.uptime(),
    };
  }
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
