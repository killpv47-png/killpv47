/**
 * FlyBay — a realistic *paper* exchange the fly trades on.  Prices are the live
 * BTC-USD market; money is simulated.  Nothing here ever touches a real account.
 *
 *  - Starting balance:  $1,000.00
 *  - Taker fee:         0.60 %  (Coinbase Advanced retail tier)
 *  - Maker fee:         0.40 %  (limit orders that rest on the book)
 *  - Slippage:          fills cross the live bid/ask spread
 *  - Min order:         $1.00, BTC amounts rounded to 1e-8 (satoshi)
 *  - Tax:               15 % capital-gains tax on *realised* gains, accrued into a
 *                       tax-reserve; paid quarterly (every ~7 real days, compressed year)
 *  - Withdrawals:       fixed $1.50 network fee; $10 minimum; 24 h processing
 *  - Deposits:          enabled only via the RESET button (fresh $1,000)
 */
export const EXCHANGE = {
  name: 'FlyBay', pair: 'BTC-USD', startBalance: 1000, takerFee: 0.006, makerFee: 0.004,
  taxRate: 0.15, withdrawFee: 1.5, minWithdraw: 10, minOrderUSD: 1, maxPositionPct: 0.95,
};

export class Exchange {
  constructor(db) {
    this.db = db;
    this.state = db.loadWallet() || this.fresh();
  }
  fresh() {
    return {
      usd: EXCHANGE.startBalance, btc: 0, avgCost: 0, realisedPnl: 0, feesPaid: 0, taxReserve: 0, taxPaid: 0,
      withdrawn: 0, deposits: EXCHANGE.startBalance, tradesCount: 0, wins: 0, losses: 0, peakEquity: EXCHANGE.startBalance,
      maxDrawdown: 0, lastTaxAt: Date.now(), createdAt: Date.now(),
    };
  }
  save() { this.db.saveWallet(this.state); }

  equity(price) { return this.state.usd + this.state.btc * price; }
  unrealised(price) { return this.state.btc * (price - this.state.avgCost); }

  /** Market order. side: 'buy'|'sell'; usd amount for buy, btc amount for sell. */
  marketOrder(side, amount, market, reason = '') {
    const s = this.state; const price = side === 'buy' ? market.ask || market.price : market.bid || market.price;
    if (!(price > 0)) return { ok: false, error: 'no market price' };
    if (side === 'buy') {
      const usd = Math.min(amount, s.usd);
      if (usd < EXCHANGE.minOrderUSD) return { ok: false, error: 'below minimum order ($1)' };
      const fee = round2(usd * EXCHANGE.takerFee);
      const btc = Math.floor((usd - fee) / price * 1e8) / 1e8;
      if (btc <= 0) return { ok: false, error: 'amount too small' };
      const totalCost = s.avgCost * s.btc + (usd);   // fees included in cost basis
      s.btc = round8(s.btc + btc); s.avgCost = s.btc ? totalCost / s.btc : 0; s.usd = round2(s.usd - usd); s.feesPaid = round2(s.feesPaid + fee);
      s.tradesCount++;
      const trade = { t: Date.now(), side, price, btc, usd, fee, pnl: 0, reason, usdAfter: s.usd, btcAfter: s.btc };
      this.db.insertTrade(trade); this.save();
      return { ok: true, trade };
    } else {
      const btc = Math.min(round8(amount), s.btc);
      if (btc * price < EXCHANGE.minOrderUSD) return { ok: false, error: 'below minimum order ($1)' };
      const gross = btc * price; const fee = round2(gross * EXCHANGE.takerFee); const net = round2(gross - fee);
      const pnl = round2(net - btc * s.avgCost);
      s.usd = round2(s.usd + net); s.btc = round8(s.btc - btc); if (s.btc < 1e-8) { s.btc = 0; s.avgCost = 0; }
      s.realisedPnl = round2(s.realisedPnl + pnl); s.feesPaid = round2(s.feesPaid + fee); s.tradesCount++;
      if (pnl >= 0) { s.wins++; s.taxReserve = round2(s.taxReserve + pnl * EXCHANGE.taxRate); } else { s.losses++; s.taxReserve = round2(Math.max(0, s.taxReserve + pnl * EXCHANGE.taxRate)); } // losses offset gains
      const trade = { t: Date.now(), side, price, btc, usd: net, fee, pnl, reason, usdAfter: s.usd, btcAfter: s.btc };
      this.db.insertTrade(trade); this.save();
      return { ok: true, trade };
    }
  }

  /** Quarterly tax settlement — every 7 real days the reserve is paid to "FlyIRS". */
  settleTax(force = false) {
    const s = this.state; const period = 7 * 24 * 3600 * 1000;
    if (!force && Date.now() - s.lastTaxAt < period) return null;
    s.lastTaxAt = Date.now();
    if (s.taxReserve <= 0) { this.save(); return null; }
    const due = Math.min(s.taxReserve, s.usd);
    s.usd = round2(s.usd - due); s.taxPaid = round2(s.taxPaid + due); s.taxReserve = round2(s.taxReserve - due);
    this.db.insertLedger({ t: Date.now(), kind: 'tax', amount: -due, note: `Capital-gains tax settlement (${EXCHANGE.taxRate * 100}%)` });
    this.save(); return due;
  }

  /** Withdraw profits to the fly's "bank" (simulated). */
  withdraw(amount) {
    const s = this.state;
    if (amount < EXCHANGE.minWithdraw) return { ok: false, error: `minimum withdrawal is $${EXCHANGE.minWithdraw}` };
    const total = round2(amount + EXCHANGE.withdrawFee);
    if (total > s.usd - s.taxReserve) return { ok: false, error: 'insufficient available balance (tax reserve is locked)' };
    s.usd = round2(s.usd - total); s.withdrawn = round2(s.withdrawn + amount); s.feesPaid = round2(s.feesPaid + EXCHANGE.withdrawFee);
    const entry = { t: Date.now(), kind: 'withdraw', amount: -amount, note: `Withdrawal to FlyBank •••• 4242 (fee $${EXCHANGE.withdrawFee}) — arrives in 24h` };
    this.db.insertLedger(entry); this.save();
    return { ok: true, entry };
  }

  updateRisk(price) {
    const s = this.state; const eq = this.equity(price);
    if (eq > s.peakEquity) s.peakEquity = eq;
    const dd = s.peakEquity ? (s.peakEquity - eq) / s.peakEquity : 0; if (dd > s.maxDrawdown) s.maxDrawdown = dd;
  }

  snapshot(price) {
    const s = this.state; const eq = this.equity(price);
    return {
      ...s, price, equity: round2(eq), unrealised: round2(this.unrealised(price)), available: round2(Math.max(0, s.usd - s.taxReserve)),
      totalReturn: round2(eq + s.withdrawn + s.taxPaid - s.deposits), returnPct: round2((eq + s.withdrawn + s.taxPaid - s.deposits) / s.deposits * 100),
      winRate: s.tradesCount ? round2(s.wins / Math.max(1, s.wins + s.losses) * 100) : 0, exchange: EXCHANGE,
    };
  }

  reset() { this.state = this.fresh(); this.save(); this.db.insertLedger({ t: Date.now(), kind: 'deposit', amount: EXCHANGE.startBalance, note: 'Account reset — fresh $1,000 deposit' }); }
}
const round2 = x => Math.round(x * 100) / 100;
const round8 = x => Math.round(x * 1e8) / 1e8;
