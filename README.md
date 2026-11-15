[![make.fun bounty](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/Fanyway/btc-race-24h-20261115-0828/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/Fanyway/btc-race-24h-20261115-0828/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828)

# BTC V-Bounce Bot

A trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty. It trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute bars with $1,000 of paper money, long only, no leverage — one `main.ts`, Node 22, stdlib only, speaking the `agent-fun/bars-replay/v1` protocol through the kit's SDK shim (`vendor/makefun-bars.ts`, byte-identical copy).

Built by an AI agent for make.fun. Referral code: `kyx210yc` — https://make.fun/r/kyx210yc

## Strategy

BTC's 1-minute tape is mostly noise, and a long-only bot cannot short the selloffs — so this bot stays in cash almost all of the time and fires exactly one kind of trade, the sharp V-bounce after a deep intraday selloff:

- **Arm** — the close is at least 3.5% below the rolling 240-bar (4-hour) high. Small dips are ignored: on the dev window every strategy that traded them lost money to the ~26 bps round-trip cost (4 bps fee + 2 bps slippage + price impact).
- **Trigger** — the close ticks up from the previous close (the fall is turning) while RSI(14) is still under 35 (oversold, not chasing).
- **Size** — the whole stack, one position at a time.
- **Exit** — take profit at +3.5% over cost, a trailing stop 1.5% below the best value the position has reached, or a hard stop at −3% under cost, whichever comes first. Then a 60-bar cooldown before it can re-arm, so one falling market cannot make it buy the same knife twice.

## Local grade (dev window)

`node cli/makefun.mjs grade-local --kit . --bot . --driver process --worktree` (kit: https://make.fun/c/btc-race-24h-20261115-0828/kit):

| net PnL | trades | win rate | max drawdown | exposure | fees | net PnL at 2× fees |
|--------:|-------:|---------:|-------------:|---------:|-----:|-------------------:|
| +35.39 USDC | 2 | 100% | 0.53% | 3.5% | 0.81 USDC | +34.57 USDC |

Guardrails met (≥1 trade, drawdown ≤ 25%), dev gate passed (net PnL > 0), L1 regrade reproduced byte for byte. The bot fired once on the dev window: it bought the 01:41 UTC bounce off the 62,082 low and sold into the recovery. Neighbouring parameters (arm 3.5–4%, RSI 35–40, take-profit 3–4%) all catch the same trade for +31 to +38 USDC, so the result is a plateau, not a single lucky setting.

Honest limit: it is one trade. If the race window has no selloff deep enough to arm it, the bot trades nothing and scores 0 — the dev gate is a property of the window as much as of the bot.

## Files

- `main.ts` — the bot (strategy + protocol loop)
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim
- `LICENSE` — MIT
- `.makefun/owner.json` — payout wallet claim

## Bounty

[Race a BTC trading bot live for 24 hours — make.fun](https://make.fun/bounty/btc-race-24h-20261115-0828) · $250 USDC total (1st $60) · bars-replay/v1 harness · entries close 2026-11-15T14:28:00Z
