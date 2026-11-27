"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Award,
  BookOpen,
  Clock,
  Coins,
  Filter,
  MessageSquareText,
  Star,
  TrendingDown,
  TrendingUp,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { JournalDrawer } from "@/components/journal/JournalDrawer";
import { TiltBadges } from "@/components/journal/TiltBadges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, TiltFlag, Trade, TradeSide } from "@/lib/api";
import { useFxRates } from "@/hooks/useFxRates";
import { formatCurrency, formatDateTimeTz, formatDuration, formatPrice, getTzShortLabel } from "@/lib/format";

type SortField = "close_time" | "duration" | "net_pnl";
type SortOrder = "asc" | "desc";

const REASON_BADGE: Record<string, { label: string; cls: string }> = {
  tp: { label: "TP", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  sl: { label: "SL", cls: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
  so: { label: "Stop Out", cls: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  manual: { label: "Manual", cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" },
};

const CURRENCIES = ["USC", "USD", "THB", "EUR"] as const;

const VALID_TILTS = new Set(["any", "revenge", "size_up", "after_loss_streak", "no_sl"]);

function JournalContent() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const initialTilt = searchParams.get("tilt") ?? "";
  useFxRates();
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<TradeSide | "">("");
  const [outcome, setOutcome] = useState<"win" | "loss" | "breakeven" | "">("");
  const [tag, setTag] = useState("");
  const [tilt, setTilt] = useState<"any" | TiltFlag | "">(
    VALID_TILTS.has(initialTilt) ? (initialTilt as "any" | TiltFlag) : "",
  );
  const [sortField, setSortField] = useState<SortField>("close_time");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selected, setSelected] = useState<Trade | null>(null);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="size-3.5 opacity-45 transition-opacity group-hover:opacity-100" />;
    }
    return sortOrder === "desc" ? (
      <ArrowDown className="size-3.5 text-indigo-400" />
    ) : (
      <ArrowUp className="size-3.5 text-indigo-400" />
    );
  };

  const q = useQuery({
    queryKey: ["trades", symbol, side, outcome, tag, tilt],
    queryFn: () => api.trades({ symbol, side, outcome, tag, tilt, limit: 500 }),
  });

  const switchCurrency = useMutation({
    mutationFn: (nextCurrency: string) => api.updateAccount({ currency: nextCurrency }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["account"] });
      toast.success(`Converted values to ${updated.currency}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const data = q.data;
  const currency = data?.account.currency ?? "USD";
  const baseCurrency = data?.account.base_currency ?? currency;
  const tz = data?.account.display_timezone ?? "Asia/Bangkok";
  const tzShort = getTzShortLabel(tz);
  const winRate = data && data.total > 0 ? ((data.wins / data.total) * 100).toFixed(1) : "0.0";
  const gp = Number(data?.gross_profit ?? 0);
  const gl = Math.abs(Number(data?.gross_loss ?? 0));
  const profitFactor = gl > 0 ? (gp / gl).toFixed(2) : gp > 0 ? "\u221e" : "\u2014";
  const netNum = Number(data?.net_pnl ?? 0);

  const sortedItems = useMemo(() => {
    if (!data?.items) return [];
    const mult = sortOrder === "asc" ? 1 : -1;
    return [...data.items].sort((a, b) => {
      if (sortField === "close_time") {
        const diff = new Date(a.close_time).getTime() - new Date(b.close_time).getTime();
        if (diff !== 0) return diff * mult;
      } else if (sortField === "duration") {
        const durA = new Date(a.close_time).getTime() - new Date(a.open_time).getTime();
        const durB = new Date(b.close_time).getTime() - new Date(b.open_time).getTime();
        const diff = durA - durB;
        if (diff !== 0) return diff * mult;
      } else if (sortField === "net_pnl") {
        const diff = Number(a.net_pnl) - Number(b.net_pnl);
        if (diff !== 0) return diff * mult;
      }
      return (b.ticket - a.ticket) * mult;
    });
  }, [data, sortField, sortOrder]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-border/70 bg-gradient-to-r from-indigo-500/10 via-violet-500/10 to-teal-500/10 p-6">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">MT5 Trading Journal</h1>
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
            Review your closed MT5 positions. Click any row to add setup tags, star ratings, and notes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
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

          <Link
            href="/journal/import"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-md shadow-indigo-500/20 transition-transform hover:scale-105"
          >
            <Upload className="size-4" />
            Import MT5 Report
          </Link>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
              <span>Closed Trades</span>
              <BookOpen className="size-4 text-indigo-400" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums">{data.total}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {data.wins}W &middot; {data.losses}L
            </p>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
              <span>Win Rate</span>
              <Award className="size-4 text-violet-400" />
            </div>
            <p className="mt-2 font-mono text-2xl font-bold tabular-nums">{winRate}%</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Profit Factor: {profitFactor}</p>
          </div>

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
              className={`mt-2 font-mono text-2xl font-bold tabular-nums ${
                netNum > 0 ? "text-emerald-400" : netNum < 0 ? "text-rose-400" : ""
              }`}
            >
              {formatCurrency(data.net_pnl, currency, true, baseCurrency)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {currency === baseCurrency
                ? `Native ${baseCurrency} report values`
                : `Converted from ${formatCurrency(data.net_pnl, baseCurrency, true, baseCurrency)}`}
            </p>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs font-bold text-muted-foreground">
              <span>Gross Profit / Loss</span>
              <TrendingUp className="size-4 text-teal-400" />
            </div>
            <p className="mt-2 font-mono text-sm font-bold text-emerald-400 tabular-nums">
              +{formatCurrency(data.gross_profit, currency, false, baseCurrency)}
            </p>
            <p className="mt-0.5 font-mono text-xs font-semibold text-rose-400 tabular-nums">
              {formatCurrency(data.gross_loss, currency, false, baseCurrency)}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-card/75 px-4 py-3">
        <span className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
          <Filter className="size-3.5 text-indigo-400" />
          Filters:
        </span>

        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="rounded-full border border-border/70 bg-background px-3 py-1.5 text-xs font-semibold"
        >
          <option value="">All Symbols</option>
          {(data?.symbols ?? []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={side}
          onChange={(e) => setSide(e.target.value as TradeSide | "")}
          className="rounded-full border border-border/70 bg-background px-3 py-1.5 text-xs font-semibold"
        >
          <option value="">Buy &amp; Sell</option>
          <option value="buy">Buy only</option>
          <option value="sell">Sell only</option>
        </select>

        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as "win" | "loss" | "breakeven" | "")}
          className="rounded-full border border-border/70 bg-background px-3 py-1.5 text-xs font-semibold"
        >
          <option value="">All Outcomes</option>
          <option value="win">Winners</option>
          <option value="loss">Losers</option>
        </select>

        {(data?.tags.length ?? 0) > 0 && (
          <select
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            className="rounded-full border border-border/70 bg-background px-3 py-1.5 text-xs font-semibold"
          >
            <option value="">All Setup Tags</option>
            {data!.tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}

        <select
          value={tilt}
          onChange={(e) => setTilt(e.target.value as "any" | TiltFlag | "")}
          className="rounded-full border border-border/70 bg-background px-3 py-1.5 text-xs font-semibold"
        >
          <option value="">All Discipline</option>
          <option value="any">Tilt Flagged Only</option>
          <option value="revenge">Revenge Entry</option>
          <option value="size_up">Lot Size Up</option>
          <option value="after_loss_streak">After Loss Streak</option>
          <option value="no_sl">No Stop Loss</option>
        </select>

        {(symbol || side || outcome || tag || tilt) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSymbol("");
              setSide("");
              setOutcome("");
              setTag("");
              setTilt("");
            }}
            className="rounded-full text-xs font-bold"
          >
            Reset
          </Button>
        )}
      </div>

      {q.isLoading && <Skeleton className="h-64 w-full rounded-2xl" />}

      {data && data.items.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border/70 bg-card/50 py-16 text-center">
          <BookOpen className="size-10 text-indigo-400 mb-3" />
          <p className="text-base font-bold">No trades match the current filters</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload your MetaTrader 5 Trade History report (.html or .xlsx) to populate your journal.
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

      {data && data.items.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-lg shadow-indigo-950/10">
          <Table>
            <TableHeader>
              <TableRow className="border-border/60 bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5 font-bold">
                  <button
                    type="button"
                    onClick={() => handleSort("close_time")}
                    className={`group inline-flex cursor-pointer items-center gap-1.5 select-none transition-colors hover:text-foreground ${
                      sortField === "close_time" ? "text-indigo-400" : ""
                    }`}
                  >
                    <span>Close Time ({tzShort})</span>
                    {renderSortIcon("close_time")}
                  </button>
                </TableHead>
                <TableHead className="font-bold">Symbol</TableHead>
                <TableHead className="font-bold">Side</TableHead>
                <TableHead className="text-right font-bold">Lots</TableHead>
                <TableHead className="text-right font-bold">Entry &rarr; Exit</TableHead>
                <TableHead className="font-bold">Exit Type</TableHead>
                <TableHead className="font-bold">
                  <button
                    type="button"
                    onClick={() => handleSort("duration")}
                    className={`group inline-flex cursor-pointer items-center gap-1.5 select-none transition-colors hover:text-foreground ${
                      sortField === "duration" ? "text-indigo-400" : ""
                    }`}
                  >
                    <span>Duration</span>
                    {renderSortIcon("duration")}
                  </button>
                </TableHead>
                <TableHead className="font-bold">Journal</TableHead>
                <TableHead className="pr-5 text-right font-bold">
                  <button
                    type="button"
                    onClick={() => handleSort("net_pnl")}
                    className={`group ml-auto inline-flex cursor-pointer items-center justify-end gap-1.5 select-none transition-colors hover:text-foreground ${
                      sortField === "net_pnl" ? "text-indigo-400" : ""
                    }`}
                  >
                    <span>Net P/L ({currency})</span>
                    {renderSortIcon("net_pnl")}
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedItems.map((t) => {
                const pnl = Number(t.net_pnl);
                const reason = REASON_BADGE[t.close_reason ?? "manual"] ?? REASON_BADGE.manual;
                return (
                  <TableRow
                    key={t.id}
                    onClick={() => setSelected(t)}
                    className="cursor-pointer border-border/50 transition-colors hover:bg-accent/40"
                  >
                    <TableCell className="pl-5 py-3">
                      <div className="font-mono text-xs font-semibold">
                        {formatDateTimeTz(t.close_time, tz)}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">#{t.ticket}</div>
                    </TableCell>
                    <TableCell className="font-bold">{t.symbol}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${
                          t.side === "buy"
                            ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                            : "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30"
                        }`}
                      >
                        {t.side}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {Number(t.volume)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatPrice(t.open_price)} &rarr; {formatPrice(t.close_price)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${reason.cls}`}
                      >
                        {reason.label}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {formatDuration(t.open_time, t.close_time)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <TiltBadges flags={t.tilt_flags} />
                        {t.setup_tag && (
                          <span className="rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-xs font-bold text-indigo-300 ring-1 ring-indigo-500/30">
                            {t.setup_tag}
                          </span>
                        )}
                        {t.rating != null && (
                          <span className="inline-flex items-center gap-0.5 text-xs font-bold text-amber-400">
                            <Star className="size-3.5 fill-amber-400" />
                            {t.rating}
                          </span>
                        )}
                        {t.notes && <MessageSquareText className="size-3.5 text-teal-400" />}
                        {!t.setup_tag && t.rating == null && !t.notes && (!t.tilt_flags || t.tilt_flags.length === 0) && (
                          <span className="text-xs text-muted-foreground/60">+ Add note</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 font-mono text-xs font-bold tabular-nums ${
                          pnl > 0
                            ? "bg-emerald-500/15 text-emerald-400"
                            : pnl < 0
                              ? "bg-rose-500/15 text-rose-400"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {formatCurrency(t.net_pnl, currency, true, baseCurrency)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <JournalDrawer
        key={selected?.id ?? "closed"}
        trade={selected}
        currency={currency}
        baseCurrency={baseCurrency}
        timeZone={tz}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

export default function JournalPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full rounded-2xl" />}>
      <JournalContent />
    </Suspense>
  );
}
