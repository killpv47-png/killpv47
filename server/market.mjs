/**
 * Live BTC-USD market feed (Coinbase Exchange public REST — no key needed).
 * Keeps 1-minute candles, live ticker, and derives the technical features
 * the fly "smells" (olfactory glomeruli) and "sees" (retina raster).
 * Falls back to Kraken if Coinbase is unreachable.
 */
const CB = 'https://api.exchange.coinbase.com/products/BTC-USD';
const KR = 'https://api.kraken.com/0/public';

export class Market {
  constructor() {
    this.candles = [];         // [{t, o, h, l, c, v}] ascending, 1-minute
    this.price = 0; this.bid = 0; this.ask = 0; this.vol24 = 0;
    this.lastTick = 0; this.source = 'coinbase'; this.errors = 0; this.trades = [];
    this.listeners = new Set();
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of this.listeners) { try { fn(ev); } catch {} } }

  async fetchJSON(url, ms = 8000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try { const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'flytrader/1.0' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    finally { clearTimeout(t); }
  }

  async loadHistory() {
    try {
      const rows = await this.fetchJSON(`${CB}/candles?granularity=60`);
      // coinbase: [time, low, high, open, close, volume] newest first
      this.candles = rows.map(r => ({ t: r[0] * 1000, l: r[1], h: r[2], o: r[3], c: r[4], v: r[5] })).sort((a, b) => a.t - b.t);
      this.source = 'coinbase';
    } catch (e) {
      const j = await this.fetchJSON(`${KR}/OHLC?pair=XBTUSD&interval=1`);
      const rows = j.result.XXBTZUSD;
      this.candles = rows.map(r => ({ t: r[0] * 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[6] }));
      this.source = 'kraken';
    }
    if (this.candles.length) this.price = this.candles[this.candles.length - 1].c;
    this.emit({ type: 'history' });
  }

  async tick() {
    try {
      let price, bid, ask, vol, time;
      if (this.source === 'coinbase') {
        const t = await this.fetchJSON(`${CB}/ticker`);
        price = +t.price; bid = +t.bid; ask = +t.ask; vol = +t.volume; time = Date.parse(t.time);
      } else {
        const j = await this.fetchJSON(`${KR}/Ticker?pair=XBTUSD`); const r = j.result.XXBTZUSD;
        price = +r.c[0]; bid = +r.b[0]; ask = +r.a[0]; vol = +r.v[1]; time = Date.now();
      }
      if (!(price > 0)) throw new Error('bad price');
      this.price = price; this.bid = bid || price; this.ask = ask || price; this.vol24 = vol; this.lastTick = Date.now();
      this.errors = 0;
      this._updateCandle(price, time);
      this.trades.push({ t: time, p: price }); if (this.trades.length > 600) this.trades.shift();
      this.emit({ type: 'tick', price, bid: this.bid, ask: this.ask, t: time });
      return true;
    } catch (e) {
      this.errors++;
      if (this.errors === 3) { this.source = this.source === 'coinbase' ? 'kraken' : 'coinbase'; this.loadHistory().catch(() => {}); }
      this.emit({ type: 'error', message: String(e.message || e) });
      return false;
    }
  }

  _updateCandle(price, time) {
    const minute = Math.floor(time / 60000) * 60000;
    const last = this.candles[this.candles.length - 1];
    if (!last || last.t < minute) {
      this.candles.push({ t: minute, o: price, h: price, l: price, c: price, v: 0 });
      if (this.candles.length > 720) this.candles.shift();
      this.emit({ type: 'candle', candle: this.candles[this.candles.length - 1] });
    } else {
      last.c = price; if (price > last.h) last.h = price; if (price < last.l) last.l = price;
    }
    // Every 5 minutes re-sync history to pick up volume and catch missed minutes
    if (!this._lastSync || Date.now() - this._lastSync > 5 * 60000) { this._lastSync = Date.now(); this.loadHistory().catch(() => {}); }
  }

  /* ------------------------------------------------------------- features */
  closes(n) { return this.candles.slice(-n).map(c => c.c); }
  sma(n) { const c = this.closes(n); return c.reduce((a, b) => a + b, 0) / (c.length || 1); }
  ema(n) { const c = this.closes(n * 3); if (!c.length) return this.price; const k = 2 / (n + 1); let e = c[0]; for (let i = 1; i < c.length; i++) e = c[i] * k + e * (1 - k); return e; }
  rsi(n = 14) {
    const c = this.closes(n + 1); if (c.length < 3) return 50; let g = 0, l = 0;
    for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
    if (l === 0) return 100; const rs = g / l; return 100 - 100 / (1 + rs);
  }
  volatility(n = 20) { const c = this.closes(n + 1); if (c.length < 3) return 0; const r = []; for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1])); const m = r.reduce((a, b) => a + b, 0) / r.length; return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length); }
  momentum(n) { const c = this.closes(n + 1); if (c.length < 2) return 0; return (c[c.length - 1] - c[0]) / c[0]; }
  bollinger(n = 20) { const c = this.closes(n); const m = c.reduce((a, b) => a + b, 0) / (c.length || 1); const sd = Math.sqrt(c.reduce((a, b) => a + (b - m) ** 2, 0) / (c.length || 1)) || 1; return { m, sd, z: (this.price - m) / sd }; }
  volumeRatio() { const v = this.candles.slice(-30).map(c => c.v); if (v.length < 5) return 1; const recent = v.slice(-3).reduce((a, b) => a + b, 0) / 3; const base = v.reduce((a, b) => a + b, 0) / v.length || 1; return recent / base; }

  /** Normalised feature vector in [-1, 1] — the fly's "odour" of the market. */
  features() {
    const bb = this.bollinger(20);
    const f = {
      mom1: clamp(this.momentum(1) * 400), mom5: clamp(this.momentum(5) * 200), mom15: clamp(this.momentum(15) * 100), mom60: clamp(this.momentum(60) * 50),
      rsi: clamp((this.rsi(14) - 50) / 50), bbz: clamp(bb.z / 2.5), vol: clamp(this.volatility(20) * 400 - 1), volRatio: clamp(Math.log(this.volumeRatio() || 1)),
      emaCross: clamp((this.ema(9) - this.ema(21)) / (this.price || 1) * 500), spread: clamp((this.ask - this.bid) / (this.price || 1) * 20000 - 1),
    };
    return f;
  }

  /**
   * Render the last `cols` candles into a `cols x rows` grayscale raster (0..1) — what is
   * "on the monitor" and projected onto the fly's retina. Candle bodies are bright.
   */
  raster(cols = 48, rows = 24) {
    const cs = this.candles.slice(-cols); const img = new Float32Array(cols * rows);
    if (cs.length < 2) return img;
    let lo = Infinity, hi = -Infinity; for (const c of cs) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; }
    const span = hi - lo || 1;
    const y = p => Math.max(0, Math.min(rows - 1, Math.round((hi - p) / span * (rows - 1))));
    cs.forEach((c, x) => {
      const col = x + (cols - cs.length);
      const yh = y(c.h), yl = y(c.l), yo = y(c.o), yc = y(c.c);
      for (let r = yh; r <= yl; r++) img[r * cols + col] = Math.max(img[r * cols + col], 0.35);       // wick
      for (let r = Math.min(yo, yc); r <= Math.max(yo, yc); r++) img[r * cols + col] = c.c >= c.o ? 1.0 : 0.7; // body
    });
    return img;
  }
}
function clamp(x, a = -1, b = 1) { return Math.max(a, Math.min(b, isFinite(x) ? x : 0)); }
