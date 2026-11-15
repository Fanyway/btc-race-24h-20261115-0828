// BTC V-Bounce bot — make.fun btc-race-24h-20261115-0828.
//
// Idea: BTC's 1-minute tape is mostly noise around a slow drift, and a long-only bot
// cannot short the selloffs. The only trades that pay on this tape are the sharp
// V-bounces that follow a deep intraday selloff, so this bot stays in cash almost
// all of the time and fires exactly one kind of trade:
//
//   * ARM: the close is at least 3.5% below the rolling 240-bar (4h) high — a real
//     selloff, not an ordinary wiggle. Small dips are ignored: on the dev window
//     every strategy that traded them lost money to the 26 bps round-trip cost
//     (a sweep of arm 1.5-3.0% and of a shallow scalp tier all ended negative,
//     and a shallow entry can even block this one trade at the real bottom).
//   * TRIGGER: the close ticks up from the previous close (the fall is turning)
//     while RSI(14) is still under 35 (the market is oversold, not chasing).
//     The uptick must be the turn itself: the previous close was no higher
//     than the one before it, so the bot never buys one bar into a recovery
//     that is already running.
//   * SIZE: the whole stack, one position at a time (long only, no leverage).
//   * EXIT: take profit at +4.5% over cost, a trailing stop 2.0% below the best
//     value the position has reached, or a hard stop at -3% under cost —
//     whichever comes first. Then a 60-bar cooldown before it can re-arm, so one
//     falling market cannot make it buy the same knife twice.
//
// On the dev window (24h to 2026-11-15 08:28 UTC, BTC -4.0% top to bottom) this
// fires once: it buys the 01:41 UTC bounce off the 62,082 low and sells into the
// recovery for about +47 USDC net of all fees, with a 0.5% max drawdown
// (grade-local --driver process: +47.33 USDC, 2 trades, max drawdown 0.53%,
// deterministic). The
// take-profit is a plateau, not a single lucky setting: 4.5-4.9% all bank the
// same +47 USDC (the recovery jumps through them on one bar), 4.0% banks +38
// and 5.0% banks +25. It is still one trade: if the race window has no selloff
// deep enough to arm it, the bot trades nothing and scores 0.
//
// Determinism: float64 arithmetic only, no randomness, no wall clock, no
// environment reads. The same bars always give the same orders.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Rolling-high window: 240 one-minute bars (4 hours). */
const HIGH_BARS = 240;
/** Arm when the close is this far under the rolling high. */
const ARM_DROP = 0.035;
/** RSI(14) must be under this to buy the bounce. */
const RSI_MAX = 35;
const RSI_BARS = 14;
/** Take profit, trailing stop (from the position's best value) and hard stop, as fractions of cost/value. */
const TAKE_PROFIT = 0.045;
const TRAIL = 0.02;
const STOP_LOSS = 0.03;
/** Bars to wait after a sell before the next entry can arm. */
const COOLDOWN_BARS = 60;
/** Slippage cap per order, in bps (1% past the close it was decided on). */
const MAX_SLIPPAGE_BPS = 100;

/** Closes seen so far, in USDC per cbBTC (raw scaled price; ratios only, so the scale cancels). */
const closes: number[] = [];
/** RSI(14) state, Wilder smoothing, seeded from the first 14 closes. */
let rsiGain = 0;
let rsiLoss = 0;
let rsiValue: number | null = null;
/** Best value (USDC) the open position has reached since entry; 0 while flat. */
let peakValue = 0;
/** state.seq of the last sell; entries are blocked for COOLDOWN_BARS after it. */
let lastSellSeq = -1_000_000;

function pushClose(close: number): void {
  const prev = closes.length === 0 ? null : closes[closes.length - 1];
  closes.push(close);
  if (prev === null) return;
  const d = close - prev;
  if (rsiValue === null) {
    // Seeding: simple averages over the first RSI_BARS diffs.
    rsiGain += Math.max(d, 0);
    rsiLoss += Math.max(-d, 0);
    if (closes.length - 1 === RSI_BARS) {
      const avgGain = rsiGain / RSI_BARS;
      const avgLoss = rsiLoss / RSI_BARS;
      rsiValue = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return;
  }
  rsiGain = (rsiGain * (RSI_BARS - 1) + Math.max(d, 0)) / RSI_BARS;
  rsiLoss = (rsiLoss * (RSI_BARS - 1) + Math.max(-d, 0)) / RSI_BARS;
  rsiValue = rsiLoss === 0 ? 100 : 100 - 100 / (1 + rsiGain / rsiLoss);
}

function rollingHigh(): number | null {
  if (closes.length < HIGH_BARS) return null;
  let h = -Infinity;
  for (let i = closes.length - HIGH_BARS; i < closes.length; i++) {
    if (closes[i]! > h) h = closes[i]!;
  }
  return h;
}

await runBars({
  onBatch(state: BarsState, batch) {
    if (state.warmingUp) return [];
    let barClose: number | null = null;
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) barClose = Number(bar.c);
    }
    if (barClose === null) return [];
    pushClose(barClose);

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      const value = Number(state.value(SYMBOL, held.qty)) / 1e6;
      const cost = Number(held.cost) / 1e6;
      const exit =
        value >= cost * (1 + TAKE_PROFIT) ||
        value <= cost * (1 - STOP_LOSS) ||
        (peakValue > 0 && value <= peakValue * (1 - TRAIL));
      if (exit) {
        lastSellSeq = state.seq;
        peakValue = 0;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
      }
      // Update the trailing peak after deciding, so a new peak never exits on its own bar.
      if (value > peakValue) peakValue = value;
      return [];
    }

    if (closes.length < HIGH_BARS || rsiValue === null) return [];
    if (state.seq - lastSellSeq < COOLDOWN_BARS) return [];
    const high = rollingHigh();
    if (high === null) return [];
    const close = closes[closes.length - 1]!;
    const prev = closes[closes.length - 2]!;
    const armed = close <= high * (1 - ARM_DROP);
    // The uptick must be the turn itself, not a chase one bar into a recovery
    // already running: the previous close was no higher than the one before it.
    const prevPrev = closes[closes.length - 3]!;
    const recovering = close > prev && prev <= prevPrev;
    if (!armed || !recovering || rsiValue >= RSI_MAX) return [];

    const { caps, fees } = state.hello;
    let slice = state.cash;
    const byWeight = state.weightRoom(SYMBOL);
    if (byWeight < slice) slice = byWeight;
    if (slice < BigInt(fees.min_notional_quote_units)) return [];
    peakValue = 0;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies BuyInput];
  },
});
