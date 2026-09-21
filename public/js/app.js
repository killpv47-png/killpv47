import { Brain3D, CLASS_COLORS } from './brain3d.js';
import { Room3D } from './room3d.js';
import { drawCandles } from './terminal.js';

const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)];
const fmt = (n, d = 2) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const money = (n, sign = false) => (n == null ? '—' : (sign && n > 0 ? '+' : '') + (n < 0 ? '-' : '') + '$' + fmt(Math.abs(n)));
const time = t => new Date(t).toLocaleTimeString('en-GB', { hour12: false });

const state = { status: null, candles: [], trades: [], ledger: [], decisions: [], logs: [], equity: [], tab: 'brain', t2: 'trades', lastPrice: 0, brainMeta: null };
const boot = (p, msg) => { $('#boot-bar').style.width = Math.round(p * 100) + '%'; if (msg) $('#boot-msg').textContent = msg; };

// ---------- 3D scenes
const brain = new Brain3D($('#brain-canvas'));
const room = new Room3D($('#room-canvas')); window.__room = room; window.__brain = brain;
const isMobile = () => matchMedia('(max-width: 980px)').matches;

async function init() {
  boot(0.05, 'Fetching FlyWire v783 soma positions…');
  const meta = await brain.load(p => boot(0.05 + p * 0.6, `Loading ${Math.round(p * 139255).toLocaleString()} neurons…`));
  $('#legend').innerHTML = meta.super_classes.map(s => `<span><i style="background:${CLASS_COLORS[s] || '#94a3b8'}"></i>${s.replace(/_/g, ' ')}</span>`).join('');
  boot(0.7, 'Connecting to the fly…');
  const [c, tr, lg, dec, eq, bm] = await Promise.all([fetch('/api/candles?n=240').then(r => r.json()), fetch('/api/trades?n=60').then(r => r.json()), fetch('/api/ledger?n=60').then(r => r.json()), fetch('/api/decisions?n=60').then(r => r.json()), fetch('/api/equity?n=1500').then(r => r.json()), fetch('/api/brain/meta').then(r => r.json())]);
  state.candles = c.candles; state.trades = tr; state.ledger = lg; state.decisions = dec; state.equity = eq; state.brainMeta = bm;
  boot(0.9, 'Opening SSE stream…');
  connect();
  requestAnimationFrame(loop);
  setTimeout(() => { $('#boot').classList.add('hide'); boot(1); }, 400);
}

// ---------- SSE
function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('status', e => { state.status = JSON.parse(e.data); renderStatus(); });
  es.addEventListener('tick', e => { const d = JSON.parse(e.data); onTick(d); });
  es.addEventListener('decision', e => { const d = JSON.parse(e.data); onDecision(d); });
  es.addEventListener('spikes', e => { const d = JSON.parse(e.data); brain.spikes(d.ids); if (d.stim) toast(`stimulated ${d.stim}`); });
  es.addEventListener('log', e => addLog(JSON.parse(e.data)));
  es.onerror = () => { setPill('offline', ''); es.close(); setTimeout(connect, 2000); };
}

function onTick(d) {
  const p = d.price; const el = $('#price'); el.textContent = '$' + fmt(p); el.classList.toggle('up', p >= state.lastPrice); el.classList.toggle('down', p < state.lastPrice); state.lastPrice = p;
  if (d.candle) { const last = state.candles[state.candles.length - 1]; if (last && last.t === d.candle.t) Object.assign(last, d.candle); else if (!last || d.candle.t > last.t) { state.candles.push(d.candle); if (state.candles.length > 300) state.candles.shift(); } }
  const c0 = state.candles.length > 60 ? state.candles[state.candles.length - 61].c : null; if (c0) { const pct = (p - c0) / c0 * 100; const ch = $('#chg'); ch.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% 1h`; ch.style.color = pct >= 0 ? 'var(--green)' : 'var(--red)'; }
  room.setData({ candles: state.candles, price: p, trades: state.trades });
  drawChart();
}

function onDecision(d) {
  state.decisions.unshift(d); if (state.decisions.length > 200) state.decisions.pop();
  if (d.trade) { state.trades.unshift({ ...d.trade, t: d.t }); fetch('/api/ledger?n=60').then(r => r.json()).then(l => { state.ledger = l; if (state.t2 === 'ledger') renderTable(); }); }
  state.equity.push({ t: d.t, equity: d.equity, price: d.price }); if (state.equity.length > 2000) state.equity.shift();
  // brain panel
  $('#s-active').textContent = fmt(d.active, 0); $('#s-spikes').textContent = fmt(d.spikes, 0); $('#s-simms').textContent = d.simMs + ' ms / ' + (state.status?.decisionMs || 160) + ' ms brain';
  $('#s-plast').textContent = `${fmt(d.plasticity.depressed, 0)} / ${fmt(d.plasticity.synapses, 0)} (${(d.plasticity.deviation * 100).toFixed(1)}%)`;
  const tot = d.approach + d.avoid || 1; $('#mb-app').style.width = (d.approach / tot * 100) + '%'; $('#mb-av').style.width = (d.avoid / tot * 100) + '%'; $('#mb-app-v').textContent = fmt(d.approach, 0); $('#mb-av-v').textContent = fmt(d.avoid, 0);
  $('#bias-dot').style.left = (50 + d.bias * 50) + '%'; $('#bias-v').textContent = (d.bias >= 0 ? '+' : '') + d.bias.toFixed(2);
  const dec = $('#decision'); dec.textContent = d.escape ? 'ESCAPE → SELL' : d.action.toUpperCase(); dec.className = 'decision ' + d.action;
  // dopamine flash in the brain
  if (state.brainMeta && Math.abs(d.reward) > 0.01) brain.flash(d.reward > 0 ? state.brainMeta.pops.PAM : state.brainMeta.pops.PPL1, 1.2);
  if (state.brainMeta && d.escape) brain.flash([...state.brainMeta.pops.DNp01, ...state.brainMeta.pops.LC4], 1.5);
  // body
  $('#body-state').textContent = d.action === 'hold' ? (d.body.groom > 40 ? 'grooming · watching chart' : 'watching chart') : d.action === 'buy' ? 'placing BUY order' : d.escape ? 'ESCAPE! panic sell' : 'placing SELL order';
  $('#dn-walk').style.width = Math.min(100, d.body.walk * 25) + '%'; $('#dn-turn').style.width = Math.min(100, Math.abs(d.body.turn) * 10) + '%'; $('#dn-groom').style.width = Math.min(100, d.body.groom / 1.5) + '%'; $('#dn-escape').style.width = Math.min(100, d.body.escape * 50) + '%';
  room.setBody(d.body, d);
  room.setData({ last: d, trades: state.trades });
  renderOdours(d.odour);
  if (state.t2 !== 'ledger') renderTable();
  drawSpark();
}

function renderStatus() {
  const s = state.status; if (!s) return;
  setPill(s.running ? 'run' : 'paused', s.running ? 'running' : 'paused');
  $('#btn-start').style.display = s.running ? 'none' : ''; $('#btn-stop').style.display = s.running ? '' : 'none';
  $('#src').textContent = s.market.source; if (s.market.price && !state.lastPrice) onTick({ price: s.market.price });
  const w = s.wallet;
  $('#w-equity').textContent = money(w.equity); const r = $('#w-ret'); r.textContent = (w.returnPct >= 0 ? '+' : '') + fmt(w.returnPct) + '%'; r.className = 'ret ' + (w.returnPct >= 0 ? 'up' : 'down');
  $('#w-usd').textContent = money(w.usd); $('#w-btc').textContent = fmt(w.btc, 6) + ' ₿';
  const set = (id, v, sign = true) => { const el = $(id); el.textContent = money(v, sign); el.className = v > 0 ? 'pos' : v < 0 ? 'neg' : ''; };
  set('#w-upnl', w.unrealised); set('#w-rpnl', w.realisedPnl);
  $('#w-fees').textContent = money(w.feesPaid); $('#w-tax').textContent = money(w.taxReserve); $('#w-wd').textContent = money(w.withdrawn); $('#w-taxp').textContent = money(w.taxPaid);
  $('#w-wr').textContent = fmt(w.winRate, 0) + '%  (' + w.wins + 'W/' + w.losses + 'L)'; $('#w-dd').textContent = fmt(w.maxDrawdown * 100, 1) + '%';
  $('#w-dec').textContent = fmt(s.decisionCount, 0); const rw = $('#w-rew'); rw.textContent = (s.avgReward >= 0 ? '+' : '') + s.avgReward.toFixed(3); rw.className = s.avgReward >= 0 ? 'pos' : 'neg';
  $('#s-spikes').textContent = fmt(s.brain.totalSpikes, 0);
  if (!s.last) { $('#s-plast').textContent = `0 / ${fmt(s.brain.plastic, 0)} (0.0%)`; }
  room.setData({ wallet: w, price: s.market.price, candles: state.candles, trades: state.trades, last: s.last });
  if (s.last && !state._seededLast) { state._seededLast = true; onDecision(s.last); }
  if (s.body) room.setBody(s.body, s.last);
}
function setPill(cls, txt) { const p = $('#status-pill'); p.className = 'status-pill ' + cls; p.querySelector('span').textContent = txt || cls; }

// ---------- panels
const ODOUR_NAMES = ['mom 1m', 'mom 5m', 'mom 15m', 'mom 1h', 'RSI', 'Bollinger', 'volatility', 'volume', 'EMA x', 'spread'];
function renderOdours(v) { if (!v) return; $('#odours').innerHTML = v.map((x, i) => `<span title="${ODOUR_NAMES[i]}: ${x}">${ODOUR_NAMES[i]}<i style="--w:${Math.abs(x) * 50}%;--tx:${x >= 0 ? '0' : '-100%'};--c:${x >= 0 ? 'var(--green)' : 'var(--red)'}"></i></span>`).join(''); }

function renderTable() {
  const th = $('#tbl thead'), tb = $('#tbl tbody');
  if (state.t2 === 'trades') { th.innerHTML = '<tr><th>time</th><th>side</th><th>price</th><th>BTC</th><th>USD</th><th>fee</th><th>P&L</th><th>reason</th></tr>'; tb.innerHTML = state.trades.slice(0, 60).map(t => `<tr><td>${time(t.t)}</td><td class="side-${t.side}">${t.side.toUpperCase()}</td><td>${fmt(t.price)}</td><td>${fmt(t.btc, 6)}</td><td>${fmt(t.usd)}</td><td>${fmt(t.fee)}</td><td class="${t.pnl > 0 ? 'pos' : t.pnl < 0 ? 'neg' : ''}">${t.pnl ? money(t.pnl, true) : '—'}</td><td>${t.reason || ''}</td></tr>`).join('') || '<tr><td colspan=8 style="color:var(--muted)">no trades yet — press Start</td></tr>'; }
  else if (state.t2 === 'ledger') { th.innerHTML = '<tr><th>time</th><th>kind</th><th>amount</th><th>note</th></tr>'; tb.innerHTML = state.ledger.map(l => `<tr><td>${time(l.t)}</td><td>${l.kind}</td><td class="${l.amount >= 0 ? 'pos' : 'neg'}">${money(l.amount, true)}</td><td>${l.note}</td></tr>`).join('') || '<tr><td colspan=4 style="color:var(--muted)">no ledger entries (tax / withdrawals appear here)</td></tr>'; }
  else { th.innerHTML = '<tr><th>time</th><th>action</th><th>approach</th><th>avoid</th><th>conf</th><th>reward</th><th>dopamine</th><th>equity</th><th>active</th></tr>'; tb.innerHTML = state.decisions.slice(0, 80).map(d => `<tr><td>${time(d.t)}</td><td class="side-${d.action === 'hold' ? '' : d.action}">${d.action.toUpperCase()}</td><td>${fmt(d.approach, 0)}</td><td>${fmt(d.avoid, 0)}</td><td>${(d.confidence * 100).toFixed(0)}%</td><td class="${d.reward > 0 ? 'pos' : d.reward < 0 ? 'neg' : ''}">${(d.reward >= 0 ? '+' : '') + Number(d.reward).toFixed(3)}</td><td>${d.dopamine}</td><td>${money(d.equity)}</td><td>${fmt(d.active, 0)}</td></tr>`).join(''); }
}

function addLog(l) {
  state.logs.push(l); if (state.logs.length > 400) state.logs.shift();
  room.setData({ logs: state.logs });
  if (l.level === 'debug' && !$('#log-debug').checked) return;
  const el = document.createElement('div'); el.className = 'l ' + l.level; el.innerHTML = `<span class="t">${time(l.t)}</span><span class="k">${l.kind}</span><span class="m">${escapeHtml(l.msg)}</span>`;
  const log = $('#log'); log.prepend(el); while (log.children.length > 250) log.lastChild.remove();
}
const escapeHtml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function drawChart() {
  const cv = $('#chart'); if (!cv.offsetParent) return; const dpr = Math.min(2, devicePixelRatio); const w = cv.clientWidth, h = cv.clientHeight; if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); drawCandles(ctx, 0, 0, w, h, state.candles.slice(-(isMobile() ? 60 : 110)), { trades: state.trades, bg: '#080b13' });
}
function drawSpark() {
  const cv = $('#equity-spark'); const ctx = cv.getContext('2d'); const w = cv.width, h = cv.height; ctx.clearRect(0, 0, w, h); const e = state.equity; if (e.length < 2) return;
  let lo = Infinity, hi = -Infinity; for (const p of e) { if (p.equity < lo) lo = p.equity; if (p.equity > hi) hi = p.equity; } if (hi - lo < 1) { lo -= 1; hi += 1; }
  const up = e[e.length - 1].equity >= e[0].equity; const col = up ? '#2ee59d' : '#ff4d6d';
  const grad = ctx.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, col + '66'); grad.addColorStop(1, col + '00');
  ctx.beginPath(); e.forEach((p, i) => { const x = i / (e.length - 1) * w, y = h - 4 - (p.equity - lo) / (hi - lo) * (h - 8); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fillStyle = grad; ctx.fill();
  ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,.25)'; const y0 = h - 4 - (1000 - lo) / (hi - lo) * (h - 8); if (y0 > 0 && y0 < h) { ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(w, y0); ctx.stroke(); } ctx.setLineDash([]);
}

// ---------- controls
const post = (cmd, body = {}) => fetch('/api/control/' + cmd, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
$('#btn-start').onclick = () => post('start'); $('#btn-stop').onclick = () => post('stop'); $('#btn-step').onclick = () => post('step');
$('#btn-reset-brain').onclick = () => confirm('Reset the fly\'s brain?\nEvery learned KC→MBON synapse returns to the measured FlyWire value. Trades and account are kept.') && post('reset-brain');
$('#btn-reset-acc').onclick = () => confirm('Reset the FlyBay account to a fresh $1,000? Trade history is kept in the ledger.') && post('reset-account');
$('#btn-withdraw').onclick = () => { const a = prompt('Withdraw how much USD to FlyBank? (min $10, fee $1.50, tax reserve is locked)', '50'); if (a) post('withdraw', { amount: +a }).then(r => r.ok ? toast('withdrawal queued') : toast(r.error, true)); };
$('#btn-tax').onclick = () => post('tax').then(r => toast(r.paid ? `tax paid $${r.paid.toFixed(2)}` : 'no tax due'));
$$('.stim button').forEach(b => b.onclick = () => post('stimulate', { pop: b.dataset.stim, hz: 60 }));
$$('.cam button').forEach(b => b.onclick = () => room.setCamera(b.dataset.cam));
$$('.tabs2 button[data-t2]').forEach(b => b.onclick = () => { $$('.tabs2 button[data-t2]').forEach(x => x.classList.remove('active')); b.classList.add('active'); state.t2 = b.dataset.t2; renderTable(); });
$$('#mobile-tabs button').forEach(b => b.onclick = () => { $$('#mobile-tabs button').forEach(x => x.classList.remove('active')); b.classList.add('active'); state.tab = b.dataset.tab; $$('.view').forEach(v => v.classList.toggle('active', v.dataset.tab === state.tab)); setTimeout(() => { brain._resize(); room._resize(); drawChart(); }, 30); });
$('#log-debug').onchange = () => { $('#log').innerHTML = ''; for (const l of state.logs.slice(-150)) addLog(l); };
function toast(msg, bad) { const t = document.createElement('div'); t.textContent = msg; t.style.cssText = `position:fixed;left:50%;bottom:70px;transform:translateX(-50%);background:${bad ? 'var(--red)' : 'var(--accent)'};color:#fff;padding:8px 14px;border-radius:99px;font-size:12px;font-weight:600;z-index:50;box-shadow:0 8px 30px rgba(0,0,0,.5)`; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }
if (isMobile()) { state.tab = 'room'; $$('#mobile-tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === 'room')); $$('.view').forEach(v => v.classList.toggle('active', v.dataset.tab === 'room')); }
addEventListener('resize', () => { if (!isMobile()) $$('.view').forEach(v => v.classList.remove('active')); drawChart(); });

// ---------- render loop (skip hidden canvases on mobile)
let frame = 0;
function loop() {
  requestAnimationFrame(loop); frame++;
  const mob = isMobile();
  if (!mob || state.tab === 'brain') brain.render();
  if (!mob || state.tab === 'room') room.render();
  if (frame % 30 === 0) drawChart();
}
init().catch(e => { console.error(e); $('#boot-msg').textContent = 'Failed to load: ' + e.message; });
