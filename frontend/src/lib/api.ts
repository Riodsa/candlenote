export type AssetClass = "stock" | "etf" | "forex" | "metal" | "crypto" | "index";
export type TradeSide = "buy" | "sell";
export type TiltFlag = "revenge" | "size_up" | "after_loss_streak" | "no_sl";

export interface Instrument {
  symbol: string;
  name: string | null;
  asset_class: AssetClass;
  exchange: string | null;
  currency: string | null;
}

export interface WatchlistItem {
  instrument: Instrument;
  position: number;
  notes: string | null;
  added_at: string;
}

export interface SearchResult {
  symbol: string;
  name: string | null;
  asset_class: AssetClass;
}

export interface Quote {
  symbol: string;
  price: number;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  volume: number | null;
  ts: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface Stats {
  symbol: string;
  volume: number | null;
  name?: string | null;
  exchange?: string | null;
  currency?: string | null;
  market_cap?: number | null;
  pe_ratio?: number | null;
  week52_high?: number | null;
  week52_low?: number | null;
  dividend_yield?: number | null;
  beta?: number | null;
  avg_volume_10d?: number | null;
}

export interface Account {
  id: string;
  name: string;
  broker: string | null;
  mt5_login: string | null;
  currency: string;
  base_currency: string;
  server_utc_offset: number;
  display_timezone: string;
  initial_balance: string;
  tilt_revenge_minutes: number;
  tilt_size_up_multiplier: string;
  tilt_max_loss_streak: number;
}

export interface AccountUpdate {
  name?: string;
  currency?: string;
  server_utc_offset?: number;
  display_timezone?: string;
  initial_balance?: string | number;
  tilt_revenge_minutes?: number;
  tilt_size_up_multiplier?: number;
  tilt_max_loss_streak?: number;
}

export interface ImportRecord {
  id: string;
  filename: string;
  file_sha256: string;
  format: string;
  rows_total: number;
  rows_inserted: number;
  rows_duplicate: number;
  rows_skipped: number;
  deals_inserted: number;
  reported_net_pnl: string | null;
  parsed_net_pnl: string | null;
  errors: string[] | null;
  imported_at: string;
}

export interface ImportResponse {
  import_record: ImportRecord;
  account: Account;
  already_imported: boolean;
}

export interface Trade {
  id: string;
  ticket: number;
  symbol: string;
  normalized_symbol: string;
  side: TradeSide;
  volume: string;
  open_time: string;
  close_time: string;
  open_price: string;
  close_price: string;
  stop_loss: string | null;
  take_profit: string | null;
  commission: string;
  swap: string;
  fee: string;
  profit: string;
  net_pnl: string;
  close_reason: string | null;
  comment: string | null;
  setup_tag: string | null;
  notes: string | null;
  rating: number | null;
  tilt_flags: TiltFlag[];
}

export interface TradesListResponse {
  account: Account;
  total: number;
  wins: number;
  losses: number;
  net_pnl: string;
  gross_profit: string;
  gross_loss: string;
  symbols: string[];
  tags: string[];
  items: Trade[];
}

export interface TradeFilters {
  symbol?: string;
  side?: TradeSide | "";
  outcome?: "win" | "loss" | "breakeven" | "";
  tag?: string;
  tilt?: "any" | TiltFlag | "";
  date?: string;
  limit?: number;
  offset?: number;
}

export interface TradeJournalPatch {
  setup_tag?: string | null;
  notes?: string | null;
  rating?: number | null;
}

export interface AnalyticsSummary {
  total_trades: number;
  wins: number;
  losses: number;
  breakevens: number;
  win_rate: number;
  buy_trades: number;
  buy_win_rate: number;
  sell_trades: number;
  sell_win_rate: number;
  net_pnl: string;
  gross_profit: string;
  gross_loss: string;
  profit_factor: number | null;
  expectancy: string;
  avg_win: string;
  avg_loss: string;
  payoff_ratio: number | null;
  best_trade: string;
  worst_trade: string;
  avg_duration_seconds: number;
  max_win_streak: number;
  max_loss_streak: number;
  max_drawdown: string;
  max_drawdown_pct: number;
  total_deposits: string;
  total_withdrawals: string;
  ending_balance: string;
}

export interface EquityPoint {
  index: number;
  time: string;
  date_label: string;
  ticket: number | null;
  symbol: string | null;
  trade_pnl: string;
  cumulative_pnl: string;
  equity: string;
  drawdown: string;
}

export interface DailyPnlPoint {
  date: string;
  net_pnl: string;
  gross_profit: string;
  gross_loss: string;
  trades: number;
  wins: number;
  win_rate: number;
  tilt_trades: number;
}

export interface SymbolBreakdown {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  net_pnl: string;
  gross_profit: string;
  gross_loss: string;
  profit_factor: number | null;
}

export interface HourBreakdown {
  hour: number;
  label: string;
  trades: number;
  wins: number;
  win_rate: number;
  net_pnl: string;
}

export interface SessionBreakdown {
  session: string;
  hours_gmt7: string;
  trades: number;
  wins: number;
  win_rate: number;
  net_pnl: string;
}

export interface ReasonBreakdown {
  reason: string;
  label: string;
  trades: number;
  wins: number;
  win_rate: number;
  net_pnl: string;
}

export interface TiltRuleBreakdown {
  rule: TiltFlag;
  label: string;
  trades: number;
  wins: number;
  win_rate: number;
  net_pnl: string;
}

export interface TiltAnalytics {
  total_tilt_trades: number;
  tilt_net_pnl: string;
  clean_trades: number;
  clean_net_pnl: string;
  rules: TiltRuleBreakdown[];
}

export interface AnalyticsResponse {
  account: Account;
  symbols: string[];
  summary: AnalyticsSummary;
  equity_curve: EquityPoint[];
  daily_pnl: DailyPnlPoint[];
  calendar_daily_pnl: DailyPnlPoint[];
  by_symbol: SymbolBreakdown[];
  by_hour: HourBreakdown[];
  by_session: SessionBreakdown[];
  by_exit_reason: ReasonBreakdown[];
  tilt: TiltAnalytics;
}

export interface TradeReplayResponse {
  trade_id: string;
  symbol: string;
  interval: string;
  source: "twelvedata" | "synthetic";
  entry_candle_time: number;
  exit_candle_time: number;
  candles: Candle[];
}

export interface FxRatesResponse {
  source: "frankfurter" | "fallback";
  updated_at: string | null;
  usd_per_unit: Record<string, number>;
}

export const INTERVALS = ["1min", "5min", "15min", "1h", "1day"] as const;
export type Interval = (typeof INTERVALS)[number];

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL;
// Empty string means same-origin (behind Caddy/reverse proxy); undefined falls back to local dev backend.
export const API_URL = rawApiUrl === undefined ? "http://localhost:8010" : rawApiUrl.replace(/\/$/, "");

export function getWsUrl(): string {
  if (API_URL) return API_URL.replace(/^http/, "ws") + "/ws/quotes";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/quotes`;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: isForm ? init?.headers : { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  watchlist: () => request<WatchlistItem[]>("/watchlist"),
  addToWatchlist: (symbol: string, asset_class?: AssetClass, name?: string | null) =>
    request<WatchlistItem>("/watchlist", {
      method: "POST",
      body: JSON.stringify({ symbol, asset_class, name }),
    }),
  removeFromWatchlist: (symbol: string) => request<void>(`/watchlist/${symbol}`, { method: "DELETE" }),
  reorderWatchlist: (symbols: string[]) =>
    request<WatchlistItem[]>("/watchlist/order", {
      method: "PUT",
      body: JSON.stringify({ symbols }),
    }),
  search: (q: string) => request<SearchResult[]>(`/instruments/search?q=${encodeURIComponent(q)}`),
  status: () => request<{ finnhub: boolean; twelvedata: boolean }>("/market/status"),
  fxRates: () => request<FxRatesResponse>("/market/fx-rates"),
  quote: (symbol: string) => request<Quote>(`/market/quote/${symbol}`),
  candles: (symbol: string, interval: Interval, limit = 300) =>
    request<Candle[]>(`/market/candles/${symbol}?interval=${interval}&limit=${limit}`),
  stats: (symbol: string) => request<Stats>(`/market/stats/${symbol}`),

  account: () => request<Account>("/account"),
  updateAccount: (body: AccountUpdate) =>
    request<Account>("/account", { method: "PUT", body: JSON.stringify(body) }),
  imports: () => request<ImportRecord[]>("/imports"),
  uploadImport: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<ImportResponse>("/imports", { method: "POST", body: fd });
  },
  trades: (f: TradeFilters = {}) => {
    const params = new URLSearchParams();
    if (f.symbol) params.set("symbol", f.symbol);
    if (f.side) params.set("side", f.side);
    if (f.outcome) params.set("outcome", f.outcome);
    if (f.tag) params.set("tag", f.tag);
    if (f.tilt) params.set("tilt", f.tilt);
    if (f.date) params.set("date", f.date);
    if (f.limit != null) params.set("limit", String(f.limit));
    if (f.offset != null) params.set("offset", String(f.offset));
    const qs = params.toString();
    return request<TradesListResponse>(`/trades${qs ? `?${qs}` : ""}`);
  },
  patchTrade: (id: string, body: TradeJournalPatch) =>
    request<Trade>(`/trades/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  tradeReplay: (id: string, interval?: string) => {
    const qs = interval ? `?interval=${encodeURIComponent(interval)}` : "";
    return request<TradeReplayResponse>(`/trades/${id}/replay${qs}`);
  },
  analytics: (opts: { days?: number | null; symbol?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.days != null) params.set("days", String(opts.days));
    if (opts.symbol) params.set("symbol", opts.symbol);
    const qs = params.toString();
    return request<AnalyticsResponse>(`/analytics${qs ? `?${qs}` : ""}`);
  },
};
