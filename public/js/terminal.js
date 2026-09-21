/**
 * Draws the FlyBay trading terminal (what the fly sees on its monitor) into a canvas.
 * Also exports drawCandles() reused by the side-panel chart.
 */
const fmt = (n, d = 2) => (n == null || isNaN(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));

export function drawCandles(ctx, x0, y0, w, h, candles, opts = {}) {
  const { grid = true, trades = [], showVolume = true, bg = '#0a0d16', label = true } = opts;
  ctx.fillStyle = bg; ctx.fillRect(x0, y0, w, h);
  if (!candles?.length) { ctx.fillStyle = '#5b6478'; ctx.font = '12px JetBrains Mono, monospace'; ctx.fillText('waiting for market data…', x0 + 12, y0 + 24); return; }
  const volH = showVolume ? h * 0.16 : 0; const ch = h - volH - 6;
  let lo = Infinity, hi = -Infinity, vmax = 0; for (const c of candles) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; if (c.v > vmax) vmax = c.v; }
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad; const span = hi - lo;
  const Y = p => y0 + 4 + (hi - p) / span * ch; const cw = w / candles.length; const X = i => x0 + i * cw + cw / 2;
  if (grid) { ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1; ctx.font = '10px JetBrains Mono, monospace'; ctx.fillStyle = '#5b6478'; ctx.textAlign = 'right';
    for (let k = 0; k <= 4; k++) { const p = lo + span * k / 4; const y = Y(p); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke(); if (label) ctx.fillText(fmt(p, 0), x0 + w - 4, y - 3); } ctx.textAlign = 'left'; }
  // volume
  if (showVolume) candles.forEach((c, i) => { const vh = vmax ? c.v / vmax * volH : 0; ctx.fillStyle = c.c >= c.o ? 'rgba(46,229,157,0.25)' : 'rgba(255,77,109,0.25)'; ctx.fillRect(X(i) - cw * 0.35, y0 + h - vh, cw * 0.7, vh); });
  // ema 9/21
  const ema = (n) => { const k = 2 / (n + 1); let e = candles[0].c; return candles.map(c => (e = c.c * k + e * (1 - k))); };
  for (const [n, col] of [[9, '#22d3ee'], [21, '#a78bfa']]) { const e = ema(n); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.8; ctx.beginPath(); e.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))); ctx.stroke(); ctx.globalAlpha = 1; }
  // candles
  candles.forEach((c, i) => {
    const up = c.c >= c.o; const col = up ? '#2ee59d' : '#ff4d6d'; const x = X(i);
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, cw * 0.12); ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
    const bw = Math.max(1.5, cw * 0.62); const top = Y(Math.max(c.o, c.c)), bh = Math.max(1, Math.abs(Y(c.o) - Y(c.c)));
    ctx.fillStyle = col; ctx.fillRect(x - bw / 2, top, bw, bh);
  });
  // last price line
  const last = candles[candles.length - 1]; const ly = Y(last.c);
  ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(x0, ly); ctx.lineTo(x0 + w, ly); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = last.c >= last.o ? '#2ee59d' : '#ff4d6d'; ctx.fillRect(x0 + w - 78, ly - 9, 76, 18); ctx.fillStyle = '#05070c'; ctx.font = 'bold 11px JetBrains Mono, monospace'; ctx.textAlign = 'right'; ctx.fillText(fmt(last.c, 2), x0 + w - 6, ly + 4); ctx.textAlign = 'left';
  // trade markers
  const t0 = candles[0].t, t1 = last.t + 60000;
  for (const tr of trades) { if (tr.t < t0 || tr.t > t1) continue; const i = Math.min(candles.length - 1, Math.floor((tr.t - t0) / 60000)); const x = X(i); const y = Y(tr.price); ctx.fillStyle = tr.side === 'buy' ? '#2ee59d' : '#ff4d6d'; ctx.beginPath(); if (tr.side === 'buy') { ctx.moveTo(x, y + 14); ctx.lineTo(x - 6, y + 24); ctx.lineTo(x + 6, y + 24); } else { ctx.moveTo(x, y - 14); ctx.lineTo(x - 6, y - 24); ctx.lineTo(x + 6, y - 24); } ctx.fill(); }
  return { Y, X, lo, hi };
}

export function drawTerminal(canvas, d, t) {
  const ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
  const w = d.wallet || {}; const price = d.price || 0; const last = d.last;
  ctx.fillStyle = '#070a12'; ctx.fillRect(0, 0, W, H);
  // top bar
  ctx.fillStyle = '#0d1120'; ctx.fillRect(0, 0, W, 44);
  ctx.fillStyle = '#7c5cff'; ctx.font = 'bold 20px Inter, sans-serif'; ctx.fillText('🪰 FlyBay', 16, 29);
  ctx.fillStyle = '#8a94ab'; ctx.font = '12px Inter, sans-serif'; ctx.fillText('PRO  ·  BTC-USD  ·  1m  ·  Coinbase feed', 128, 28);
  const up = d.candles?.length > 1 && price >= d.candles[d.candles.length - 2].c;
  ctx.font = 'bold 22px JetBrains Mono, monospace'; ctx.fillStyle = up ? '#2ee59d' : '#ff4d6d'; ctx.textAlign = 'right'; ctx.fillText('$' + fmt(price), W - 200, 30); ctx.textAlign = 'left';
  const c0 = d.candles?.length > 60 ? d.candles[d.candles.length - 61].c : null; if (c0) { const pct = (price - c0) / c0 * 100; ctx.font = '13px JetBrains Mono, monospace'; ctx.fillStyle = pct >= 0 ? '#2ee59d' : '#ff4d6d'; ctx.fillText(`${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% 1h`, W - 190, 29); }
  // live dot
  ctx.fillStyle = (Math.sin(t * 4) > 0) ? '#2ee59d' : '#1a6b4a'; ctx.beginPath(); ctx.arc(W - 30, 22, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#8a94ab'; ctx.font = '10px Inter'; ctx.fillText('LIVE', W - 66, 26);
  // chart
  const trades = d.trades || [];
  drawCandles(ctx, 12, 56, W - 300, H - 200, d.candles?.slice(-90) || [], { trades });
  // right column: account
  const rx = W - 276, ry = 56; ctx.fillStyle = '#0d1120'; ctx.fillRect(rx, ry, 264, H - 200);
  ctx.fillStyle = '#8a94ab'; ctx.font = '11px Inter'; ctx.fillText('PORTFOLIO', rx + 14, ry + 22);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 28px JetBrains Mono, monospace'; ctx.fillText('$' + fmt(w.equity), rx + 14, ry + 54);
  const ret = w.returnPct || 0; ctx.fillStyle = ret >= 0 ? '#2ee59d' : '#ff4d6d'; ctx.font = '13px JetBrains Mono, monospace'; ctx.fillText(`${ret >= 0 ? '+' : ''}${fmt(ret)}%  all-time`, rx + 14, ry + 74);
  const rows = [['USD', '$' + fmt(w.usd)], ['BTC', fmt(w.btc, 6)], ['Unrealised', (w.unrealised >= 0 ? '+' : '') + '$' + fmt(w.unrealised)], ['Realised', (w.realisedPnl >= 0 ? '+' : '') + '$' + fmt(w.realisedPnl)], ['Fees', '$' + fmt(w.feesPaid)], ['Tax reserve', '$' + fmt(w.taxReserve)], ['Withdrawn', '$' + fmt(w.withdrawn)], ['Trades', String(w.tradesCount ?? 0) + `  (${fmt(w.winRate, 0)}% win)`]];
  ctx.font = '12px JetBrains Mono, monospace'; rows.forEach(([k, v], i) => { const y = ry + 104 + i * 22; ctx.fillStyle = '#8a94ab'; ctx.fillText(k, rx + 14, y); ctx.fillStyle = k === 'Unrealised' || k === 'Realised' ? (v.startsWith('+') ? '#2ee59d' : '#ff4d6d') : '#e7ecf5'; ctx.textAlign = 'right'; ctx.fillText(v, rx + 250, y); ctx.textAlign = 'left'; });
  // order box
  const oy = ry + 292; ctx.fillStyle = '#111627'; ctx.fillRect(rx + 10, oy, 244, 68);
  ctx.fillStyle = '#8a94ab'; ctx.font = '10px Inter'; ctx.fillText('LAST ORDER (market)', rx + 20, oy + 16);
  if (last) { const a = last.action; ctx.fillStyle = a === 'buy' ? '#2ee59d' : a === 'sell' ? '#ff4d6d' : '#8a94ab'; ctx.font = 'bold 18px Inter'; ctx.fillText(a.toUpperCase(), rx + 20, oy + 40); ctx.fillStyle = '#e7ecf5'; ctx.font = '11px JetBrains Mono, monospace'; ctx.fillText(last.trade ? `${last.trade.btc.toFixed(6)} BTC @ ${fmt(last.trade.price)}` : `bias ${last.bias?.toFixed(2)}  conf ${(last.confidence * 100).toFixed(0)}%`, rx + 20, oy + 58); }
  // bottom: order book-ish + neural bar + log ticker
  const by = H - 136; ctx.fillStyle = '#0d1120'; ctx.fillRect(12, by, W - 24, 124);
  ctx.fillStyle = '#8a94ab'; ctx.font = '10px Inter'; ctx.fillText('MUSHROOM BODY READ-OUT', 24, by + 18); ctx.fillText('ORDER BOOK', 420, by + 18); ctx.fillText('ACTIVITY', 700, by + 18);
  if (last) {
    const tot = (last.approach + last.avoid) || 1; const ap = last.approach / tot, av = last.avoid / tot;
    ctx.fillStyle = '#1a2033'; ctx.fillRect(24, by + 30, 360, 14); ctx.fillStyle = '#2ee59d'; ctx.fillRect(24, by + 30, 360 * ap, 14); ctx.fillStyle = '#ff4d6d'; ctx.fillRect(24 + 360 * ap, by + 30, 360 * av, 14);
    ctx.fillStyle = '#e7ecf5'; ctx.font = '11px JetBrains Mono, monospace'; ctx.fillText(`approach ${fmt(last.approach, 0)} Hz   avoid ${fmt(last.avoid, 0)} Hz   bias ${last.bias >= 0 ? '+' : ''}${last.bias?.toFixed(2)}`, 24, by + 62);
    ctx.fillStyle = last.reward >= 0 ? '#2ee59d' : '#ff4d6d'; ctx.fillText(`reward ${last.reward >= 0 ? '+' : ''}${last.reward?.toFixed(3)}  ${last.dopamine}`, 24, by + 82);
    ctx.fillStyle = '#8a94ab'; ctx.fillText(`${fmt(last.active, 0)} neurons active · ${fmt(last.plasticity?.changed, 0)} synapses changed · decision #${last.decisionCount}`, 24, by + 102);
  }
  // fake order book from price + spread (visual only)
  ctx.font = '11px JetBrains Mono, monospace';
  for (let i = 0; i < 5; i++) { const pa = price * (1 + 0.00004 * (i + 1)), pb = price * (1 - 0.00004 * (i + 1)); const sa = (0.2 + Math.abs(Math.sin(t + i)) * 1.5), sb = (0.2 + Math.abs(Math.cos(t * 1.1 + i)) * 1.5); ctx.fillStyle = '#ff4d6d'; ctx.fillText(fmt(pa), 420, by + 34 + i * 16); ctx.fillStyle = 'rgba(255,77,109,.25)'; ctx.fillRect(500, by + 24 + i * 16, sa * 30, 12); ctx.fillStyle = '#2ee59d'; ctx.fillText(fmt(pb), 560, by + 34 + i * 16); ctx.fillStyle = 'rgba(46,229,157,.25)'; ctx.fillRect(640, by + 24 + i * 16, sb * 30, 12); }
  // recent log lines
  ctx.fillStyle = '#c9d1e0'; ctx.font = '10px JetBrains Mono, monospace'; (d.logs || []).slice(-6).forEach((l, i) => { ctx.fillStyle = l.level === 'trade' ? '#2ee59d' : l.level === 'warn' ? '#ffb454' : '#8a94ab'; ctx.fillText((l.msg || '').slice(0, 44), 700, by + 34 + i * 15); });
  // subtle scanlines + vignette
  ctx.fillStyle = 'rgba(0,0,0,0.08)'; for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
}
