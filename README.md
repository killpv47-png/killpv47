# 🪰 FlyTrader — a real fruit-fly connectome trading Bitcoin

A **whole-brain simulation of the adult *Drosophila* connectome (FlyWire v783: 139,255 neurons, 2.7 M directed connections, 34 M synapses)** watches the **live BTC-USD market**, decides through its mushroom body, places **paper orders on "FlyBay"** (a realistic simulated exchange with fees, capital-gains tax and withdrawals, starting at **$1,000**) and **learns with its own dopamine circuit** — PAM neurons reward profit, PPL1 neurons punish loss, and the KC→MBON synapses depress exactly the way the biology describes.

Everything is rendered in a modern 3D UI (desktop + mobile): the full connectome as a live-spiking point cloud, and the fly's office where an anatomically-styled 3D fly types on a keyboard, uses a mouse and stares at a monitor that shows the real FlyBay terminal.

> **Paper trading only.** No real money, no exchange keys, ever.

---

## What is real vs. engineered (honesty section)

| Part | Status |
|---|---|
| Neurons, their 3D soma positions, every connection & synapse count, neurotransmitter sign | **Measured** — FlyWire FAFB v783 public release (Dorkenwald et al. 2024; Schlegel et al. 2024) |
| Neuron dynamics | Leaky integrate-and-fire with the **Shiu et al. 2024 (Nature)** parameters: v_rest −52 mV, threshold −45 mV, τ_m 20 ms, τ_syn 5 ms, refractory 2.2 ms, delay 1.8 ms, 0.275 mV / synapse. dt = 1 ms (paper used 0.1 ms) so the whole brain runs in ~0.4 s wall time per 160 ms of brain time on 2 CPU cores |
| Learning | **Only** KC→MBON synapses change (21,438 of 2.7 M). Rule: dopamine-gated depression of eligible synapses — PAM (reward, 307 cells) depresses inputs to *avoid* MBONs, PPL1 (punishment, 16 cells) depresses inputs to *approach* MBONs, with slow recovery (forgetting). MBON valence is derived from the measured PAM/PPL1 input each MBON receives (52 approach / 44 avoid) |
| Sensory mapping | **Engineered.** Chart raster → lamina L1/L2 cells sorted retinotopically; price velocity → T4c/T4d motion cells; 10 market features → 10 ORN glomeruli ("odours"); open-position P&L → sugar/bitter gustatory neurons; sharp drawdown → LC4/LPLC2 looming detectors (→ DNp01 giant fibre escape = panic sell) |
| Read-out | approach−avoid MBON firing → buy / sell / hold; confidence sizes the order. Descending neurons (DNp09, DNa01/02, DNg11, MDN, DNp01) animate the 3D body |
| Market | **Live** Coinbase Exchange public API (Kraken fallback), 1-minute candles, ticker every 3 s |
| Money | Simulated. Fees 0.6 % taker, 15 % capital-gains tax settled every 7 days, $1.50 withdrawal fee, $10 minimum, auto-withdraw of profits |

Run `node scripts/selftest.mjs` to verify: silent brain = 0 spikes, odour reaches ~2,200 Kenyon cells, punishment lowers the approach bias for the same odour (0.30 → 0.02), reset restores the measured connectome bit-exactly.

---

## URLs

| | |
|---|---|
| Sandbox preview | `https://3000-<sandbox>.sandbox.novita.ai` |
| Cloudflare quick tunnel | `bash scripts/tunnel.sh` → prints `https://xxxx.trycloudflare.com` (also saved to `data/tunnel_url.txt`) |
| GitHub Actions live session | *Actions → FlyTrader → Run workflow → minutes* → the tunnel URL appears in the job summary |

### API (all JSON)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/status` | wallet, market, brain stats, last decision, body state |
| GET | `/api/stream` | **SSE**: `status`, `tick`, `decision`, `spikes`, `log` events |
| GET | `/api/candles?n=240` · `/api/trades` · `/api/ledger` · `/api/decisions` · `/api/events` · `/api/equity` | history from SQLite |
| GET | `/api/brain/meta` | population indices (KC, MBON, PAM, PPL1, DNp01, …) for the viewer |
| POST | `/api/control/start` · `stop` · `step` | run / pause / single decision |
| POST | `/api/control/reset-brain` | restore all learned synapses to measured values |
| POST | `/api/control/reset-account` | fresh $1,000 |
| POST | `/api/control/withdraw` `{amount}` · `tax` | FlyBay banking |
| POST | `/api/control/stimulate` `{pop:"PAM"\|"PPL1"\|"LC4"\|"sugar"\|"bitter"\|<cell type>, hz}` | optogenetic stimulation, spikes shown in 3D |
| POST | `/api/control/interval` `{ms}` | seconds between decisions (3–60 s) |

---

## UI guide
* **Start / Pause / Step** — top bar. **Reset brain** wipes learning only; **Reset $1000** wipes the account only.
* **Left — Connectome**: 139k neurons at real positions, coloured by super-class, flashing as they spike. Drag to orbit. Buttons stimulate PAM / PPL1 / LC4 / sugar / bitter. Top-right shows the mushroom-body read-out (approach vs avoid, bias, decision).
* **Centre — The fly's office**: camera presets *desk / fly / screen / room*. The monitor is the live FlyBay terminal. Front legs hunt-and-peck the keyboard, the right leg clicks the mouse when an order goes out, wings flutter on escape, proboscis extends on reward, DNg11 drives grooming.
* **Right — FlyBay**: equity, USD/BTC, unrealised/realised P&L, fees, tax reserve, withdrawals, win-rate, drawdown; live candle chart with EMA 9/21 and trade markers; the 10 market "odours"; Trades / Ledger / Decisions tables; Withdraw & Settle-tax buttons.
* **Log**: every decision with MBON rates, reward, dopamine, active neurons and synapses changed.
* **Mobile**: bottom tabs Brain / Room / FlyBay / Logs; only the visible 3D view renders.

---

## Data & storage
* `data/brain/*.bin` — CSR connectome (`csr_ptr/idx/w`), `positions.bin`, `neurons.bin` (6 B/neuron), `meta.json`. Regenerate with `python3 scripts/prepare_data.py` (downloads ~57 MB from FlyWire Codex, ~10 s).
* `public/data/brain_points.bin` — 1.8 MB viewer point cloud.
* `data/flytrader.db` — **SQLite (node:sqlite)**: `kv` (wallet json, running flag), `trades`, `ledger`, `decisions`, `events`, `equity`, `brain` (learned-weights blob, saved every 5 decisions). Everything survives restarts.

## Project structure
```
server/   brain.mjs (LIF engine + plasticity) · agent.mjs (sensory loop) · market.mjs · exchange.mjs · db.mjs · index.mjs (Hono API + SSE)
public/   index.html · css/app.css · js/{app,brain3d,room3d,fly,terminal}.js (Three.js r160 via CDN, no build step)
scripts/  prepare_data.py · selftest.mjs · restore_env.sh · tunnel.sh · shot.py
.github/workflows/flytrader.yml   build + tests on push; on-demand live session with tunnel
```

## Run locally
```bash
bash scripts/restore_env.sh          # npm install, FlyWire download+prep, cloudflared
pm2 start ecosystem.config.cjs       # server on :3000 (or: node server/index.mjs)
bash scripts/tunnel.sh               # public https URL
```
Node ≥ 22 (uses built-in `node:sqlite`), Python 3 with numpy/pandas for the one-time data prep. ~500 MB RAM.

## Not yet implemented / next steps
* Compare against controls (shuffled connectome, silenced circuit) in the UI.
* Slower forgetting + per-odour memory inspector.
* WebGPU path for the brain viewer on very old phones.

## Deployment
* Runs as a Node process (whole-brain LIF needs a persistent CPU loop) — **not** Cloudflare Workers. Use PM2 + Cloudflare quick tunnel (temporary) or GitHub Actions sessions.
* Tech: Node 22 · Hono · node:sqlite · Three.js · Coinbase public API.
* Last updated: 2026-09-21

## Credits & licences
FlyWire FAFB v783 — Dorkenwald et al., *Nature* 634 (2024); Schlegel et al., *Nature* 634 (2024) — data CC BY-NC 4.0. LIF model after Shiu et al., *Nature* (2024). Inspired by the community projects catalogued in [awesome-fly](https://github.com/cobanov/awesome-fly). Code MIT.
