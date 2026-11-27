# CandleNote

![CandleNote Logo](./CandleNoteLogo.jpg)

A real-time investing watchlist and MetaTrader 5 (MT5) trading journal built to track US stocks, ETFs, and Gold (`XAUUSD`), replay executed trades on candlestick charts, and uncover performance and discipline patterns.

## Features

- **Live Market Watchlist & Interactive Charts (`/watchlist`)**
  - Real-time price streaming via WebSocket (Finnhub for US stocks/ETFs, Twelve Data for Gold `XAUUSD` with REST polling fallback).
  - Search and add/remove symbols, drag-and-drop row reordering, sortable columns, and price flash indicators.
  - Per-symbol candlestick + volume charts (`1m`, `5m`, `15m`, `1h`, `1d`) with live bar updates and key market statistics.
- **MT5 Trade History Import (`/journal/import`)**
  - Drag-and-drop upload for MetaTrader 5 `.html` (UTF-16/UTF-8) and `.xlsx` reports.
  - Auto-detects account metadata and currency (`USD`, `USC`, etc.), normalizes broker suffixes (e.g. `XAUUSDc` → `XAUUSD`), deduplicates by file hash and Ticket/Deal ID, and reconciles parsed vs. reported Net P/L.
- **Trading Journal & Trade Replay (`/journal`)**
  - Filterable, sortable log of closed positions with setup tags, 1–5 star execution ratings, and trade notes.
  - Built-in **Trade Replay Chart** showing candlesticks around each trade with Entry, Exit, SL, and TP markers/lines (`Auto`, `1m`, `5m`, `15m`, `1h`).
- **Analytics Dashboard & Monthly P/L Calendar (`/dashboard`)**
  - Core KPIs (Net P/L, Win Rate by Buy/Sell, Profit Factor, Payoff Ratio, Expectancy, Max Drawdown, Streaks, Average Hold Time, Ending Balance).
  - Equity / Cumulative P/L curve, Daily Net P/L, Hourly P/L, Market Sessions (`Asian`, `London`, `New York`, `Rollover`), Exit Type, and Symbol breakdowns.
  - **Monthly P/L Calendar Heatmap** with weekly summaries — click any trading day to inspect all trades and open Trade Replay directly.
- **Auto Tilt & Overtrading Detector**
  - Automatically flags same-day discipline slips: **Revenge Entry** (entering shortly after a loss), **Lot Size Up** (increasing lot size after a same-symbol loss), **After Loss Streak** (continuing to trade past consecutive losses), and **No Stop Loss**.
  - Displays **Tilt & Discipline Impact** and **What-If Discipline P/L (0 Tilt)** on `/dashboard`, warning badges + Tilt filter on `/journal`, and configurable thresholds in `/settings`.
- **Multi-Currency, Timezone & Theme (`/settings`)**
  - Convert P/L and balances across `USD`, `USC`, `THB`, and `EUR` using cached live ECB FX rates (with offline fallback).
  - Configurable display timezone, MT5 broker server UTC offset, initial balance, and persistent Dark / Light mode.

## How to Use

### Run Locally with Docker Compose

1. Get free API keys from [Finnhub](https://finnhub.io) and [Twelve Data](https://twelvedata.com).
2. Create `backend/.env` from `.env.example` and fill in both keys:
   ```powershell
   Copy-Item .env.example backend/.env
   ```
3. Start PostgreSQL, FastAPI, and Next.js together:
   ```powershell
   docker compose up --build
   ```
4. Open **http://localhost:3000** (API docs at **http://localhost:8010/docs**).

### Workflow Inside the App

1. **Watchlist (`/watchlist`)**: Search for tickers (e.g. `AAPL`, `NVDA`, `SPY`, `XAUUSD`), drag rows to reorder, and click any symbol to view live candlestick charts and stats.
2. **Import MT5 Report (`/journal/import`)**: Export your Trade History report from MetaTrader 5 as `.html` or `.xlsx`, then drop it onto the import page.
3. **Review & Tag Trades (`/journal`)**: Filter by symbol, side, outcome, setup tag, or tilt flag; click any row to inspect the Trade Replay chart and save notes, setup tags, and ratings.
4. **Analyze Performance (`/dashboard`)**: Inspect KPIs, Equity Curve, Hourly/Session edge, Monthly P/L Calendar (click any day to view its trades), and Tilt & Discipline Impact.
5. **Configure Preferences (`/settings`)**: Adjust display currency (`USD`/`USC`/`THB`/`EUR`), display timezone, MT5 server UTC offset, initial balance, and Tilt detection thresholds.
