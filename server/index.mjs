/**
 * HTTP + SSE server (Hono on Node). Serves the 3D UI from public/ and exposes the agent API.
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { Agent } from './agent.mjs';

const PORT = +(process.env.PORT || 3000);
const agent = new Agent();
const app = new Hono();

app.get('/api/status', c => c.json(agent.status()));
app.get('/api/candles', c => c.json({ candles: agent.market.candles.slice(-+(c.req.query('n') || 240)), price: agent.market.price, source: agent.market.source }));
app.get('/api/trades', c => c.json(agent.db.trades(+(c.req.query('n') || 100))));
app.get('/api/ledger', c => c.json(agent.db.ledger(+(c.req.query('n') || 100))));
app.get('/api/decisions', c => c.json(agent.db.decisions(+(c.req.query('n') || 100))));
app.get('/api/events', c => c.json(agent.db.events(+(c.req.query('n') || 200))));
app.get('/api/equity', c => c.json(agent.db.equityCurve(+(c.req.query('n') || 2000))));
app.get('/api/spikes', c => c.json({ ids: agent.lastSpikes || [], t: agent.lastDecision?.t || 0 }));
app.get('/api/brain/meta', c => { const b = agent.brain; return c.json({ n: b.N, super_classes: b.meta.super_classes, pops: Object.fromEntries(['KC', 'MBON', 'PAM', 'PPL1', 'DNp01', 'DNa01', 'DNa02', 'DNp09', 'DNg11', 'MDN', 'LC4', 'LPLC2', 'CX', 'R7', 'R8'].map(k => [k, b.pop[k]])), retina: b.pop.retina.filter((_, i) => i % 4 === 0), orn: Object.values(b.pop.orn).flat().filter((_, i) => i % 3 === 0) }); });
app.post('/api/control/:cmd', async c => {
  const cmd = c.req.param('cmd'); const body = await c.req.json().catch(() => ({}));
  switch (cmd) {
    case 'start': agent.setRunning(true); break;
    case 'stop': agent.setRunning(false); break;
    case 'step': await agent.decide(); break;
    case 'reset-brain': agent.resetBrain(); break;
    case 'reset-account': agent.resetAccount(); break;
    case 'reset-all': agent.resetAll(); break;
    case 'withdraw': { const r = agent.exchange.withdraw(+body.amount || 0); if (r.ok) agent.log('info', 'withdraw', r.entry.note + ` — $${-r.entry.amount}`); else agent.log('warn', 'withdraw', 'Withdrawal rejected: ' + r.error); return c.json(r); }
    case 'tax': { const t = agent.exchange.settleTax(true); agent.log('info', 'tax', t ? `Tax settled: $${t.toFixed(2)}` : 'No tax due'); return c.json({ paid: t || 0 }); }
    case 'stimulate': { const n = agent.stimulate(body.pop || 'PAM', +body.hz || 50); return c.json({ spikes: n }); }
    case 'interval': agent.intervalMs = Math.max(3000, Math.min(60000, +body.ms || 8000)); agent.loop(); break;
    default: return c.json({ error: 'unknown command' }, 400);
  }
  agent.emit('status', agent.status());
  return c.json({ ok: true, status: agent.status() });
});
app.get('/api/stream', c => streamSSE(c, async (stream) => {
  let alive = true; stream.onAbort(() => { alive = false; });
  const send = (event, data) => alive && stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => { alive = false; });
  await send('status', agent.status());
  for (const e of agent.db.events(40).reverse()) await send('log', e);
  if (agent.lastSpikes) await send('spikes', { ids: agent.lastSpikes, t: agent.lastDecision?.t });
  const off = agent.on((type, data) => send(type, data));
  const hb = setInterval(() => send('status', agent.status()), 5000);
  while (alive) await new Promise(r => setTimeout(r, 1000));
  clearInterval(hb); off();
}));
app.use('/*', serveStatic({ root: './public' }));
app.get('/', serveStatic({ path: './public/index.html' }));

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, () => console.log(`FlyTrader listening on :${PORT}`));
agent.start().catch(e => console.error(e));
