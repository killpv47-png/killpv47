/**
 * Local SQLite persistence (node:sqlite, built into Node 22+). File: data/flytrader.db
 * Tables: kv (wallet json), trades, ledger, decisions, events, brain (plastic weights blob), equity
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class DB {
  constructor(file = path.join(__dirname, '..', 'data', 'flytrader.db')) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, side TEXT, price REAL, btc REAL, usd REAL, fee REAL, pnl REAL, reason TEXT, usd_after REAL, btc_after REAL);
      CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, kind TEXT, amount REAL, note TEXT);
      CREATE TABLE IF NOT EXISTS decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, price REAL, action TEXT, approach REAL, avoid REAL, confidence REAL, reward REAL, dopamine TEXT, equity REAL, spikes INTEGER, active INTEGER, features TEXT);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, level TEXT, kind TEXT, msg TEXT);
      CREATE TABLE IF NOT EXISTS brain (id INTEGER PRIMARY KEY CHECK (id = 1), updated INTEGER, decisions INTEGER, weights BLOB);
      CREATE TABLE IF NOT EXISTS equity (t INTEGER PRIMARY KEY, equity REAL, price REAL);
      CREATE INDEX IF NOT EXISTS idx_trades_t ON trades(t);
      CREATE INDEX IF NOT EXISTS idx_dec_t ON decisions(t);
    `);
    this.s = {
      kvGet: this.db.prepare('SELECT value FROM kv WHERE key = ?'),
      kvSet: this.db.prepare('INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      trade: this.db.prepare('INSERT INTO trades(t, side, price, btc, usd, fee, pnl, reason, usd_after, btc_after) VALUES (?,?,?,?,?,?,?,?,?,?)'),
      ledger: this.db.prepare('INSERT INTO ledger(t, kind, amount, note) VALUES (?,?,?,?)'),
      decision: this.db.prepare('INSERT INTO decisions(t, price, action, approach, avoid, confidence, reward, dopamine, equity, spikes, active, features) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'),
      event: this.db.prepare('INSERT INTO events(t, level, kind, msg) VALUES (?,?,?,?)'),
      brain: this.db.prepare('INSERT INTO brain(id, updated, decisions, weights) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET updated = excluded.updated, decisions = excluded.decisions, weights = excluded.weights'),
      brainGet: this.db.prepare('SELECT updated, decisions, weights FROM brain WHERE id = 1'),
      equity: this.db.prepare('INSERT OR REPLACE INTO equity(t, equity, price) VALUES (?,?,?)'),
    };
  }
  get(key, dflt = null) { const r = this.s.kvGet.get(key); return r ? JSON.parse(r.value) : dflt; }
  set(key, v) { this.s.kvSet.run(key, JSON.stringify(v)); }
  loadWallet() { return this.get('wallet'); }
  saveWallet(w) { this.set('wallet', w); }
  insertTrade(t) { this.s.trade.run(t.t, t.side, t.price, t.btc, t.usd, t.fee, t.pnl, t.reason || '', t.usdAfter, t.btcAfter); }
  insertLedger(l) { this.s.ledger.run(l.t, l.kind, l.amount, l.note || ''); }
  insertDecision(d) { this.s.decision.run(d.t, d.price, d.action, d.approach, d.avoid, d.confidence, d.reward, d.dopamine, d.equity, d.spikes, d.active, JSON.stringify(d.features || {})); }
  insertEvent(level, kind, msg) { this.s.event.run(Date.now(), level, kind, msg); }
  saveBrain(weights, decisions) { this.s.brain.run(Date.now(), decisions, weights); }
  loadBrain() { const r = this.s.brainGet.get(); return r ? { ...r, weights: r.weights ? Buffer.from(r.weights) : null } : null; }
  insertEquity(t, eq, price) { this.s.equity.run(t, eq, price); }
  trades(limit = 100) { return this.db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT ?').all(limit); }
  ledger(limit = 100) { return this.db.prepare('SELECT * FROM ledger ORDER BY id DESC LIMIT ?').all(limit); }
  decisions(limit = 100) { return this.db.prepare('SELECT * FROM decisions ORDER BY id DESC LIMIT ?').all(limit); }
  events(limit = 200) { return this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit); }
  equityCurve(limit = 2000) { return this.db.prepare('SELECT * FROM equity ORDER BY t DESC LIMIT ?').all(limit).reverse(); }
  stats() {
    return {
      trades: this.db.prepare('SELECT COUNT(*) n FROM trades').get().n,
      decisions: this.db.prepare('SELECT COUNT(*) n FROM decisions').get().n,
      actions: this.db.prepare('SELECT action, COUNT(*) n FROM decisions GROUP BY action').all(),
      rewardSum: this.db.prepare('SELECT COALESCE(SUM(reward),0) s, COALESCE(AVG(reward),0) a FROM decisions').get(),
      recentReward: this.db.prepare('SELECT COALESCE(AVG(reward),0) a FROM (SELECT reward FROM decisions ORDER BY id DESC LIMIT 50)').get().a,
    };
  }
  resetAll() {
    this.db.exec('DELETE FROM trades; DELETE FROM ledger; DELETE FROM decisions; DELETE FROM events; DELETE FROM brain; DELETE FROM equity; DELETE FROM kv;');
  }
}
