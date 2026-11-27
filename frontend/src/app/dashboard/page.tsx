"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  Clock,
  Coins,
  Flame,
  Globe2,
  Layers,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
  Upload,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { CalendarHeatmap } from "@/components/dashboard/CalendarHeatmap";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useFxRates } from "@/hooks/useFxRates";
import { convertCurrency, formatCurrency, formatSeconds, getTzShortLabel } from "@/lib/format";

const CURRENCIES = ["USC", "USD", "THB", "EUR"] as const;
const DATE_RANGES: { label: string; days: number | null }[] = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "All Time", days: null },
];

export default function AnalyticsDashboardPage() {
  const qc = useQueryClient();
  const fx = useFxRates();
  const [days, setDays] = useState<number | null>(null);
  const [symbol, setSymbol] = useState<string>("");
  const [curveMode, setCurveMode] = useState<"cumulative_pnl" | "equity">("cumulative_pnl");

  const q = useQuery({
    queryKey: ["analytics", days, symbol],
    queryFn: () => api.analytics({ days, symbol: symbol || undefined }),
  });

  const switchCurrency = useMutation({
    mutationFn: (nextCurrency: string) => api.updateAccount({ currency: nextCurrency }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["analytics"] });
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["account"] });
      toast.success(`Converted analytics to ${updated.currency}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const data = q.data;
  const currency = data?.account.currency ?? "USD";
  const baseCurrency = data?.account.base_currency ?? currency;
  const tz = data?.account.display_timezone ?? "Asia/Bangkok";
  const tzShort = getTzShortLabel(tz);
  const s = data?.summary;

  const rates = fx?.usd_per_unit;

  const equityData = useMemo(() => {
    if (!data) return [];
    return data.equity_curve.map((pt) => ({
      index: pt.index,
      label: pt.index === 0 ? "Start" : `#${pt.index} (${pt.date_label})`,
      shortLabel: `#${pt.index}`,
      symbol: pt.symbol ?? "\u2014",
      cumulative_pnl: Number(convertCurrency(Number(pt.cumulative_pnl), baseCurrency, currency, rates).toFixed(2)),
      equity: Number(convertCurrency(Number(pt.equity), baseCurrency, currency, rates).toFixed(2)),
      drawdown: Number(convertCurrency(Number(pt.drawdown), baseCurrency, currency, rates).toFixed(2)),
      trade_pnl: Number(convertCurrency(Number(pt.trade_pnl), baseCurrency, currency, rates).toFixed(2)),
    }));
  }, [data, baseCurrency, currency, rates]);

  const dailyData = useMemo(() => {
    if (!data) return [];
    return data.daily_pnl.map((d) => ({
      date: d.date.slice(5),
      fullDate: d.date,
      net_pnl: Number(convertCurrency(Number(d.net_pnl), baseCurrency, currency, rates).toFixed(2)),
      trades: d.trades,
      win_rate: d.win_rate,
    }));
  }, [data, baseCurrency, currency, rates]);

  const hourlyData = useMemo(() => {
    if (!data) return [];
    return data.by_hour.map((h) => ({
      hour: h.hour,
      label: h.label,
      net_pnl: Number(convertCurrency(Number(h.net_pnl), baseCurrency, currency, rates).toFixed(2)),
      trades: h.trades,
      win_rate: h.win_rate,
    }));
  }, [data, baseCurrency, currency, rates]);

  const netNum = Number(s?.net_pnl ?? 0);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-border/70 bg-gradient-to-r from-indigo-500/10 via-violet-500/10 to-teal-500/10 p-6">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Analytics Dashboard</h1>
            {data?.account && (
              <span className="rounded-full border border-indigo-500/30 bg-indigo-500/15 px-3 py-1 text-xs font-bold text-indigo-300">
                {data.account.name}
                {data.account.mt5_login ? ` (#${data.account.mt5_login})` : ""} &middot; Base {baseCurrency}
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full border border-teal-500/30 bg-teal-500/15 px-3 py-1 text-xs font-bold text-teal-300">
              <Clock className="size-3" />
              {tz} ({tzShort})
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            Deep performance metrics, equity curve, drawdown, and session analytics from your MT5 history.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Currency Switcher */}
          <div
            className="flex items-center gap-1 rounded-full border border-border/70 bg-card/80 p-1"
            title="Convert displayed P/L values"
          >
            <Coins className="ml-2 size-3.5 text-amber-400" />
            {CURRENCIES.map((c) => (
              <button
                key={c}
                type="button"
                disabled={switchCurrency.isPending}
                onClick={() => switchCurrency.mutate(c)}
                className={`rounded-full px-2.5 py-1 text-xs font-bold transition-colors ${
                  currency === c
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Date Range Filter */}
          <div className="flex items-center gap-1 rounded-full border border-border/70 bg-card/80 p-1">
            {DATE_RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => setDays(r.days)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                  days === r.days
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Symbol Filter */}
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="rounded-full border border-border/70 bg-card/80 px-3.5 py-1.5 text-xs font-bold"
          >
            <option value="">All Symbols</option>
            {(data?.symbols ?? []).map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>
      </div>

      {q.isLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-80 w-full rounded-3xl" />
        </div>
      )}

      {data && s && s.total_trades === 0 && (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border/70 bg-card/50 py-16 text-center">
          <BarChart3 className="mb-3 size-10 text-indigo-400" />
          <p className="text-base font-bold">No closed trades found for this filter</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Import your MetaTrader 5 report or widen the date/symbol filter to inspect analytics.
          </p>
          <Link
            href="/journal/import"
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
          >
            <Upload className="size-4" />
            Import MT5 Report
          </Link>
        </div>
      )}

      {data && s && s.total_trades > 0 && (
        <>
          {/* 8 Primary KPI Cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {/* 1. Net P/L */}
            <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
                <span>Net P/L ({currency})</span>
                {netNum >= 0 ? (
                  <TrendingUp className="size-4 text-emerald-400" />
                ) : (
                  <TrendingDown className="size-4 text-rose-400" />
                )}
              </div>
              <p
                className={`mt-2 text-2xl font-extrabold tabular-nums ${
                  netNum > 0 ? "text-emerald-400" : netNum < 0 ? "text-rose-400" : ""
                }`}
              >
                {formatCurrency(s.net_pnl, currency, true, baseCurrency)}
              </p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                <span className="text-emerald-400">+{formatCurrency(s.gross_profit, currency, false, baseCurrency)}</span>
                {" / "}
                <span className="text-rose-400">{formatCurrency(s.gross_loss, currency, false, baseCurrency)}</span>
              </p>
            </div>

            {/* 2. Win Rate */}
            <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
                <span>Win Rate ({s.total_trades} Trades)</span>
                <Award className="size-4 text-violet-400" />
              </div>
              <p className="mt-2 text-2xl font-extrabold tabular-nums">{s.win_rate.toFixed(1)}%</p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                {s.wins}W &middot; {s.losses}L &middot; Buy {s.buy_win_rate.toFixed(0)}% / Sell{" "}
                {s.sell_win_rate.toFixed(0)}%
              </p>
            </div>

            {/* 3. Profit Factor & Payoff */}
            <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
                <span>Profit Factor</span>
                <Target className="size-4 text-indigo-400" />
              </div>
              <p className="mt-2 text-2xl font-extrabold tabular-nums">
                {s.profit_factor != null ? s.profit_factor.toFixed(2) : "\u221e"}
              </p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                Payoff Ratio (R:R): {s.payoff_ratio != null ? `${s.payoff_ratio.toFixed(2)}x` : "\u2014"}
              </p>
            </div>

            {/* 4. Expectancy per Trade */}
            <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
                <span>Expectancy / Trade</span>
                <Activity className="size-4 text-teal-400" />
              </div>
              <p
                className={`mt-2 text-2xl font-extrabold tabular-nums ${
                  Number(s.expectancy) > 0
                    ? "text-emerald-400"
                    : Number(s.expectancy) < 0
                      ? "text-rose-400"
                      : ""
                }`}
              >
                {formatCurrency(s.expectancy, currency, true, baseCurrency)}
              </p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                Avg W: <span className="text-emerald-400">{formatCurrency(s.avg_win, currency, false, baseCurrency)}</span>
                {" · "}L: <span className="text-rose-400">{formatCurrency(s.avg_loss, currency, false, baseCurrency)}</span>
              </p>
            </div>

            {/* 5. Max Drawdown */}
            <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
                <span>Max Drawdown</span>
                <ShieldAlert className="size-4 text-rose-400" />
              </div>
              <p className="mt-2 text-2xl font-extrabold text-rose-400 tabular-nums">
                {formatCurrency(s.max_drawdown, currency, false, baseCurrency)}
              </p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                Peak-to-Trough: {s.max_drawdown_pct.toFixed(2)}% of peak equity
              </p>
            </div>

            {/* 6. Best & Worst Trade */}
            <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
                <span>Best / Worst Trade</span>
                <Flame className="size-4 text-amber-400" />
              </div>
              <p className="mt-2 text-base font-extrabold text-emerald-400 tabular-nums">
                Best: {formatCurrency(s.best_trade, currency, true, baseCurrency)}
              </p>
              <p className="mt-0.5 text-xs font-bold text-rose-400 tabular-nums">
                Worst: {formatCurrency(s.worst_trade, currency, true, baseCurrency)}
              </p>
            </div>

            {/* 7. Streaks & Avg Hold Time */}
            <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
                <span>Streaks &amp; Hold Time</span>
                <Timer className="size-4 text-indigo-400" />
              </div>
              <p className="mt-2 text-xl font-extrabold tabular-nums">
                <span className="text-emerald-400">{s.max_win_streak}W</span>
                {" / "}
                <span className="text-rose-400">{s.max_loss_streak}L</span>
                <span className="ml-1.5 text-xs font-semibold text-muted-foreground">max streak</span>
              </p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                Avg Hold Duration: {formatSeconds(s.avg_duration_seconds)}
              </p>
            </div>

            {/* 8. Account Capital & Balance */}
            <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
                <span>Ending Balance</span>
                <Wallet className="size-4 text-teal-400" />
              </div>
              <p className="mt-2 text-2xl font-extrabold tabular-nums">
                {formatCurrency(s.ending_balance, currency, false, baseCurrency)}
              </p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                Deposits: {formatCurrency(s.total_deposits, currency, false, baseCurrency)}
              </p>
            </div>
          </div>

          {/* Monthly P/L Calendar Heatmap */}
          <CalendarHeatmap
            days={data.calendar_daily_pnl}
            currency={currency}
            baseCurrency={baseCurrency}
            timeZone={tz}
            symbol={symbol || undefined}
            rates={rates}
          />

          {/* Tilt & Discipline Impact */}
          <div className="rounded-3xl border border-border/70 bg-card/85 p-5 shadow-lg shadow-indigo-950/10">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-extrabold">
                  <AlertTriangle className="size-4 text-amber-400" />
                  Tilt &amp; Discipline Impact ({currency})
                </h2>
                <p className="text-xs text-muted-foreground">
                  Auto-detected from same-day trade timestamps, lot sizing, loss streaks, and SL presence
                </p>
              </div>
              <Link
                href="/settings"
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
              >
                <SlidersHorizontal className="size-3.5" />
                Tune Rules
              </Link>
            </div>

            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                <div className="flex items-center justify-between text-xs font-bold text-amber-300">
                  <span>Flagged Tilt Trades</span>
                  <AlertTriangle className="size-4" />
                </div>
                <p
                  className={`mt-1.5 font-mono text-2xl font-extrabold tabular-nums ${
                    Number(data.tilt.tilt_net_pnl) > 0
                      ? "text-emerald-400"
                      : Number(data.tilt.tilt_net_pnl) < 0
                        ? "text-rose-400"
                        : ""
                  }`}
                >
                  {formatCurrency(data.tilt.tilt_net_pnl, currency, true, baseCurrency)}
                </p>
                <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                  {data.tilt.total_tilt_trades} of {s.total_trades} trades flagged
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <div className="flex items-center justify-between text-xs font-bold text-emerald-300">
                  <span>What-If Discipline P/L (0 Tilt)</span>
                  <ShieldCheck className="size-4" />
                </div>
                <p
                  className={`mt-1.5 font-mono text-2xl font-extrabold tabular-nums ${
                    Number(data.tilt.clean_net_pnl) > 0
                      ? "text-emerald-400"
                      : Number(data.tilt.clean_net_pnl) < 0
                        ? "text-rose-400"
                        : ""
                  }`}
                >
                  {formatCurrency(data.tilt.clean_net_pnl, currency, true, baseCurrency)}
                </p>
                <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                  Across {data.tilt.clean_trades} clean trades vs actual{" "}
                  {formatCurrency(s.net_pnl, currency, true, baseCurrency)}
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-background/50 p-4">
                <div className="text-xs font-bold text-muted-foreground">Discipline Rate</div>
                <p className="mt-1.5 font-mono text-2xl font-extrabold tabular-nums">
                  {s.total_trades > 0 ? ((data.tilt.clean_trades / s.total_trades) * 100).toFixed(1) : "0.0"}%
                </p>
                <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                  <Link href="/journal?tilt=any" className="text-indigo-400 hover:underline">
                    Inspect all {data.tilt.total_tilt_trades} tilt trades in Journal &rarr;
                  </Link>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data.tilt.rules.map((r) => {
                const rPnl = Number(r.net_pnl);
                return (
                  <Link
                    key={r.rule}
                    href={`/journal?tilt=${r.rule}`}
                    className="rounded-2xl border border-border/60 bg-background/50 p-3.5 transition-colors hover:border-indigo-500/45 hover:bg-accent/30"
                  >
                    <div className="text-xs font-extrabold">{r.label}</div>
                    <p
                      className={`mt-1.5 font-mono text-base font-extrabold tabular-nums ${
                        rPnl > 0 ? "text-emerald-400" : rPnl < 0 ? "text-rose-400" : "text-muted-foreground"
                      }`}
                    >
                      {formatCurrency(r.net_pnl, currency, true, baseCurrency)}
                    </p>
                    <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                      {r.trades} trades &middot; {r.win_rate.toFixed(0)}% W
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Row 1: Equity Curve & Daily Net P/L */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Cumulative P/L / Equity Curve */}
            <div className="rounded-3xl border border-border/70 bg-card/85 p-5 shadow-lg shadow-indigo-950/10">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-extrabold">
                    {curveMode === "cumulative_pnl" ? "Cumulative Net P/L Curve" : "Account Equity Curve"} ({currency})
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Trade-by-trade progression across {s.total_trades} closed positions
                  </p>
                </div>

                <div className="flex items-center gap-1 rounded-full border border-border/70 bg-background/70 p-1">
                  <button
                    type="button"
                    onClick={() => setCurveMode("cumulative_pnl")}
                    className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                      curveMode === "cumulative_pnl"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Cumulative P/L
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurveMode("equity")}
                    className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                      curveMode === "equity"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Total Equity
                  </button>
                </div>
              </div>

              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                    <XAxis
                      dataKey="shortLabel"
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                      width={65}
                    />
                    <Tooltip
                      cursor={{
                        stroke: "rgba(129, 140, 248, 0.45)",
                        strokeWidth: 1.5,
                        strokeDasharray: "4 4",
                      }}
                      contentStyle={{
                        backgroundColor: "rgba(15, 23, 42, 0.96)",
                        borderColor: "rgba(129, 140, 248, 0.45)",
                        borderRadius: "14px",
                        padding: "10px 14px",
                        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
                        color: "#f8fafc",
                        fontSize: "12px",
                        fontWeight: 700,
                      }}
                      labelStyle={{
                        color: "#cbd5e1",
                        fontWeight: 800,
                        marginBottom: "4px",
                      }}
                      itemStyle={{
                        color: "#f8fafc",
                        fontWeight: 800,
                      }}
                      labelFormatter={(_label, payload) =>
                        payload?.[0]?.payload?.label ?? String(_label)
                      }
                      formatter={(val: unknown) => [
                        `${Number(val) >= 0 ? "+" : ""}${Number(val).toFixed(2)} ${currency}`,
                        curveMode === "cumulative_pnl" ? "Cum. P/L" : "Equity",
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey={curveMode}
                      stroke="#818cf8"
                      strokeWidth={2.5}
                      fill="url(#equityGrad)"
                      activeDot={{ r: 5, fill: "#818cf8", stroke: "#0f172a", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Daily P/L Bar Chart */}
            <div className="rounded-3xl border border-border/70 bg-card/85 p-5 shadow-lg shadow-indigo-950/10">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-extrabold">Daily Net P/L ({currency})</h2>
                  <p className="text-xs text-muted-foreground">
                    Grouped by close date in {tz} ({tzShort})
                  </p>
                </div>
                <span className="rounded-full bg-indigo-500/15 px-3 py-1 text-xs font-bold text-indigo-300">
                  {dailyData.length} Trading Days
                </span>
              </div>

              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                      width={65}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(99, 102, 241, 0.12)", radius: 6 }}
                      contentStyle={{
                        backgroundColor: "rgba(15, 23, 42, 0.96)",
                        borderColor: "rgba(129, 140, 248, 0.45)",
                        borderRadius: "14px",
                        padding: "10px 14px",
                        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
                        color: "#f8fafc",
                        fontSize: "12px",
                        fontWeight: 700,
                      }}
                      labelStyle={{
                        color: "#cbd5e1",
                        fontWeight: 800,
                        marginBottom: "4px",
                      }}
                      itemStyle={{
                        color: "#f8fafc",
                        fontWeight: 800,
                      }}
                      labelFormatter={(_label, payload) =>
                        payload?.[0]?.payload?.fullDate
                          ? `${payload[0].payload.fullDate} (${payload[0].payload.trades} trades)`
                          : String(_label)
                      }
                      formatter={(val: unknown) => [
                        `${Number(val) >= 0 ? "+" : ""}${Number(val).toFixed(2)} ${currency}`,
                        "Daily Net P/L",
                      ]}
                    />
                    <Bar dataKey="net_pnl" radius={[6, 6, 6, 6]}>
                      {dailyData.map((entry, idx) => (
                        <Cell
                          key={`cell-${idx}`}
                          fill={entry.net_pnl >= 0 ? "#34d399" : "#fb7185"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Row 2: Hourly Performance (GMT+7) & Trading Sessions */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Hourly P/L Bar Chart */}
            <div className="rounded-3xl border border-border/70 bg-card/85 p-5 shadow-lg shadow-indigo-950/10">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-extrabold">P/L by Entry Hour ({tzShort})</h2>
                  <p className="text-xs text-muted-foreground">
                    Discover which hours of the day in {tz} yield your best results
                  </p>
                </div>
                <Clock className="size-4 text-teal-400" />
              </div>

              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyData} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      interval={2}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                      width={65}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(99, 102, 241, 0.12)", radius: 6 }}
                      contentStyle={{
                        backgroundColor: "rgba(15, 23, 42, 0.96)",
                        borderColor: "rgba(129, 140, 248, 0.45)",
                        borderRadius: "14px",
                        padding: "10px 14px",
                        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
                        color: "#f8fafc",
                        fontSize: "12px",
                        fontWeight: 700,
                      }}
                      labelStyle={{
                        color: "#cbd5e1",
                        fontWeight: 800,
                        marginBottom: "4px",
                      }}
                      itemStyle={{
                        color: "#f8fafc",
                        fontWeight: 800,
                      }}
                      labelFormatter={(label, payload) =>
                        payload?.[0]?.payload
                          ? `${label} ${tzShort} (${payload[0].payload.trades} trades)`
                          : `${label} ${tzShort}`
                      }
                      formatter={(val: unknown) => [
                        `${Number(val) >= 0 ? "+" : ""}${Number(val).toFixed(2)} ${currency}`,
                        "Net P/L",
                      ]}
                    />
                    <Bar dataKey="net_pnl" radius={[5, 5, 5, 5]}>
                      {hourlyData.map((entry, idx) => (
                        <Cell
                          key={`hr-${idx}`}
                          fill={entry.net_pnl >= 0 ? "#2dd4bf" : "#fb7185"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Session & Exit Type Breakdown */}
            <div className="space-y-6">
              {/* Trading Sessions */}
              <div className="rounded-3xl border border-border/70 bg-card/85 p-5 shadow-lg shadow-indigo-950/10">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-extrabold">Market Sessions (GMT+7)</h2>
                    <p className="text-xs text-muted-foreground">
                      Performance grouped by Asian, London, and New York trading hours
                    </p>
                  </div>
                  <Globe2 className="size-4 text-indigo-400" />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {data.by_session.map((sess) => {
                    const sessPnl = Number(sess.net_pnl);
                    return (
                      <div
                        key={sess.session}
                        className="rounded-2xl border border-border/60 bg-background/50 p-3.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-extrabold">{sess.session}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                            {sess.hours_gmt7}
                          </span>
                        </div>
                        <div className="mt-2 flex items-baseline justify-between">
                          <span
                            className={`text-base font-extrabold tabular-nums ${
                              sessPnl > 0
                                ? "text-emerald-400"
                                : sessPnl < 0
                                  ? "text-rose-400"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {formatCurrency(sess.net_pnl, currency, true, baseCurrency)}
                          </span>
                          <span className="text-xs font-bold text-muted-foreground">
                            {sess.trades} trades &middot; {sess.win_rate.toFixed(0)}% W
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Exit Reason Breakdown */}
              <div className="rounded-3xl border border-border/70 bg-card/85 p-5 shadow-lg shadow-indigo-950/10">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-extrabold">Performance by Exit Type</h2>
                    <p className="text-xs text-muted-foreground">
                      How your trades closed (TP, SL, Stop Out, Manual)
                    </p>
                  </div>
                  <Layers className="size-4 text-violet-400" />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {data.by_exit_reason.map((r) => {
                    const rPnl = Number(r.net_pnl);
                    return (
                      <div
                        key={r.reason}
                        className="rounded-2xl border border-border/60 bg-background/50 p-3.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-extrabold">{r.label}</span>
                          <span className="text-xs font-bold text-muted-foreground">
                            {r.trades} ({r.win_rate.toFixed(0)}% W)
                          </span>
                        </div>
                        <p
                          className={`mt-1.5 text-base font-extrabold tabular-nums ${
                            rPnl > 0 ? "text-emerald-400" : rPnl < 0 ? "text-rose-400" : ""
                          }`}
                        >
                          {formatCurrency(r.net_pnl, currency, true, baseCurrency)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Symbol Performance Table */}
          <div className="overflow-hidden rounded-3xl border border-border/70 bg-card/85 shadow-lg shadow-indigo-950/10">
            <div className="border-b border-border/60 px-6 py-4">
              <h2 className="text-base font-extrabold">Performance by Symbol</h2>
              <p className="text-xs text-muted-foreground">
                Normalized instrument breakdown across all closed positions ({currency})
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-6 font-bold">Symbol</TableHead>
                  <TableHead className="text-right font-bold">Trades</TableHead>
                  <TableHead className="text-right font-bold">Wins / Losses</TableHead>
                  <TableHead className="text-right font-bold">Win Rate</TableHead>
                  <TableHead className="text-right font-bold">Profit Factor</TableHead>
                  <TableHead className="text-right font-bold">Gross Profit</TableHead>
                  <TableHead className="text-right font-bold">Gross Loss</TableHead>
                  <TableHead className="pr-6 text-right font-bold">Net P/L ({currency})</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.by_symbol.map((row) => {
                  const pnl = Number(row.net_pnl);
                  return (
                    <TableRow key={row.symbol} className="border-border/50">
                      <TableCell className="pl-6 font-extrabold">{row.symbol}</TableCell>
                      <TableCell className="text-right font-bold tabular-nums">{row.trades}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-muted-foreground tabular-nums">
                        <span className="text-emerald-400">{row.wins}W</span> &middot;{" "}
                        <span className="text-rose-400">{row.losses}L</span>
                      </TableCell>
                      <TableCell className="text-right font-bold tabular-nums">
                        {row.win_rate.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right font-bold tabular-nums">
                        {row.profit_factor != null ? row.profit_factor.toFixed(2) : "\u221e"}
                      </TableCell>
                      <TableCell className="text-right font-bold text-emerald-400 tabular-nums">
                        +{formatCurrency(row.gross_profit, currency, false, baseCurrency)}
                      </TableCell>
                      <TableCell className="text-right font-bold text-rose-400 tabular-nums">
                        {formatCurrency(row.gross_loss, currency, false, baseCurrency)}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-extrabold tabular-nums ${
                            pnl > 0
                              ? "bg-emerald-500/15 text-emerald-400"
                              : pnl < 0
                                ? "bg-rose-500/15 text-rose-400"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {formatCurrency(row.net_pnl, currency, true, baseCurrency)}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
