"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { JournalDrawer } from "@/components/journal/JournalDrawer";
import { TiltBadges } from "@/components/journal/TiltBadges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, DailyPnlPoint, Trade } from "@/lib/api";
import { convertCurrency, formatCurrency, formatDateTimeTz, formatDuration, formatPrice } from "@/lib/format";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function parseYm(dateStr?: string): [number, number] {
  if (dateStr) {
    const [y, m] = dateStr.split("-").map(Number);
    if (y && m) return [y, m - 1];
  }
  return [2026, 0];
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

interface Props {
  days: DailyPnlPoint[];
  currency: string;
  baseCurrency: string;
  timeZone: string;
  symbol?: string;
  rates?: Record<string, number>;
}

export function CalendarHeatmap({ days, currency, baseCurrency, timeZone, symbol, rates }: Props) {
  const latestDate = days.length > 0 ? days[days.length - 1].date : undefined;
  const [defaultYear, defaultMonth] = parseYm(latestDate);
  const [ymOverride, setYmOverride] = useState<[number, number] | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

  const [year, month] = ymOverride ?? [defaultYear, defaultMonth];

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  const { weeks, monthNet, winDays, lossDays, monthTrades, maxAbs } = useMemo(() => {
    const firstDow = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // Mon=0..Sun=6
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    const cells: ({ day: number; date: string; data?: DailyPnlPoint } | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${pad2(month + 1)}-${pad2(d)}`;
      cells.push({ day: d, date, data: byDate.get(date) });
    }
    while (cells.length % 7 !== 0) cells.push(null);

    let mNet = 0;
    let wDays = 0;
    let lDays = 0;
    let mTrades = 0;
    let mAbs = 0;

    const wkRows = [];
    for (let i = 0; i < cells.length; i += 7) {
      const row = cells.slice(i, i + 7);
      let wkNet = 0;
      let wkTrades = 0;
      for (const c of row) {
        if (!c?.data) continue;
        const p = Number(c.data.net_pnl);
        wkNet += p;
        wkTrades += c.data.trades;
        mNet += p;
        mTrades += c.data.trades;
        if (p > 0) wDays += 1;
        else if (p < 0) lDays += 1;
        mAbs = Math.max(mAbs, Math.abs(p));
      }
      wkRows.push({ cells: row, net: wkNet, trades: wkTrades });
    }
    return { weeks: wkRows, monthNet: mNet, winDays: wDays, lossDays: lDays, monthTrades: mTrades, maxAbs: mAbs };
  }, [year, month, byDate]);

  const shiftMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setYmOverride([y, m]);
  };

  const dayTradesQ = useQuery({
    queryKey: ["day-trades", selectedDate, symbol ?? ""],
    queryFn: () => api.trades({ date: selectedDate!, symbol: symbol || undefined, limit: 200 }),
    enabled: selectedDate !== null,
  });

  const shortMoney = (raw: number) => {
    const val = convertCurrency(raw, baseCurrency, currency, rates);
    const sign = val > 0 ? "+" : "";
    if (Math.abs(val) >= 1000) return `${sign}${(val / 1000).toFixed(1)}k`;
    return `${sign}${val.toFixed(Math.abs(val) >= 100 ? 0 : 2)}`;
  };

  return (
    <div className="rounded-3xl border border-border/70 bg-card/85 p-5 shadow-lg shadow-indigo-950/10">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-extrabold">
            <CalendarDays className="size-4 text-indigo-400" />
            Monthly P/L Calendar ({currency})
          </h2>
          <p className="text-xs text-muted-foreground">
            Click any trading day to inspect all trades, tilt warnings, and replay charts
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3.5 py-1 text-xs font-bold">
            <span className={monthNet > 0 ? "text-emerald-400" : monthNet < 0 ? "text-rose-400" : "text-muted-foreground"}>
              {formatCurrency(monthNet, currency, true, baseCurrency)}
            </span>
            <span className="text-muted-foreground">&middot;</span>
            <span className="text-emerald-400">{winDays}W</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-rose-400">{lossDays}L</span>
            <span className="text-muted-foreground">({monthTrades}t)</span>
          </div>

          <div className="flex items-center gap-1 rounded-full border border-border/70 bg-background/70 p-1">
            <Button variant="ghost" size="icon" className="size-7 rounded-full" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-32 text-center text-xs font-extrabold">
              {MONTHS[month]} {year}
            </span>
            <Button variant="ghost" size="icon" className="size-7 rounded-full" onClick={() => shiftMonth(1)} aria-label="Next month">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="mb-1.5 grid grid-cols-8 gap-1.5 text-center text-[11px] font-bold text-muted-foreground">
            {WEEKDAYS.map((w) => (
              <div key={w}>{w}</div>
            ))}
            <div className="text-indigo-400">Week</div>
          </div>

          <div className="space-y-1.5">
            {weeks.map((wk, wIdx) => (
              <div key={wIdx} className="grid grid-cols-8 gap-1.5">
                {wk.cells.map((cell, cIdx) => {
                  if (!cell) {
                    return <div key={cIdx} className="h-20 rounded-xl bg-muted/15" />;
                  }
                  const d = cell.data;
                  const pnl = d ? Number(d.net_pnl) : 0;
                  const ratio = d && maxAbs > 0 ? Math.min(1, Math.abs(pnl) / maxAbs) : 0;
                  const bg = !d
                    ? "border-border/40 bg-background/40"
                    : pnl > 0
                      ? ratio > 0.5
                        ? "border-emerald-500/50 bg-emerald-500/20 hover:bg-emerald-500/30"
                        : "border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20"
                      : pnl < 0
                        ? ratio > 0.5
                          ? "border-rose-500/50 bg-rose-500/20 hover:bg-rose-500/30"
                          : "border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20"
                        : "border-border/60 bg-muted/40 hover:bg-muted/60";

                  return (
                    <button
                      key={cell.date}
                      type="button"
                      disabled={!d}
                      onClick={() => d && setSelectedDate(cell.date)}
                      className={`flex h-20 flex-col justify-between rounded-xl border p-2 text-left transition-colors ${bg} ${
                        d ? "cursor-pointer" : "cursor-default opacity-60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-muted-foreground">{cell.day}</span>
                        {d && d.tilt_trades > 0 && (
                          <span
                            title={`${d.tilt_trades} tilt trade(s)`}
                            className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-extrabold text-amber-400"
                          >
                            <AlertTriangle className="size-2.5" />
                            {d.tilt_trades}
                          </span>
                        )}
                      </div>
                      {d ? (
                        <div>
                          <div
                            className={`font-mono text-xs font-extrabold tabular-nums ${
                              pnl > 0 ? "text-emerald-400" : pnl < 0 ? "text-rose-400" : "text-foreground"
                            }`}
                          >
                            {shortMoney(pnl)}
                          </div>
                          <div className="text-[10px] font-semibold text-muted-foreground">
                            {d.trades}t &middot; {d.win_rate.toFixed(0)}%
                          </div>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/30">&mdash;</span>
                      )}
                    </button>
                  );
                })}

                <div className="flex h-20 flex-col justify-center rounded-xl border border-border/50 bg-muted/25 px-2.5 text-right">
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">W{wIdx + 1}</span>
                  {wk.trades > 0 ? (
                    <>
                      <span
                        className={`mt-0.5 font-mono text-xs font-extrabold tabular-nums ${
                          wk.net > 0 ? "text-emerald-400" : wk.net < 0 ? "text-rose-400" : "text-foreground"
                        }`}
                      >
                        {shortMoney(wk.net)}
                      </span>
                      <span className="text-[10px] font-semibold text-muted-foreground">{wk.trades}t</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground/40">&mdash;</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Day Trades Slide-Over Panel */}
      {selectedDate && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/55 backdrop-blur-sm"
          onClick={() => setSelectedDate(null)}
        >
          <div
            className="flex h-full w-full max-w-xl flex-col border-l border-border/70 bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-4">
              <div>
                <h3 className="text-lg font-extrabold">Trades on {selectedDate}</h3>
                {dayTradesQ.data && (
                  <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                    {dayTradesQ.data.total} trades ({dayTradesQ.data.wins}W &middot; {dayTradesQ.data.losses}L) &middot;{" "}
                    <span className={Number(dayTradesQ.data.net_pnl) >= 0 ? "text-emerald-400" : "text-rose-400"}>
                      {formatCurrency(dayTradesQ.data.net_pnl, currency, true, baseCurrency)}
                    </span>
                  </p>
                )}
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSelectedDate(null)} className="rounded-full">
                <X className="size-4" />
              </Button>
            </div>

            <div className="mt-4 flex-1 space-y-2.5 overflow-y-auto pr-1">
              {dayTradesQ.isLoading && <Skeleton className="h-40 w-full rounded-2xl" />}
              {dayTradesQ.data?.items.map((t) => {
                const pnl = Number(t.net_pnl);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTrade(t)}
                    className="w-full rounded-2xl border border-border/60 bg-background/60 p-3.5 text-left transition-colors hover:border-indigo-500/50 hover:bg-accent/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold">{t.symbol}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                            t.side === "buy" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
                          }`}
                        >
                          {t.side}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">{Number(t.volume)} lots</span>
                      </div>
                      <span
                        className={`font-mono text-sm font-extrabold tabular-nums ${
                          pnl > 0 ? "text-emerald-400" : pnl < 0 ? "text-rose-400" : "text-muted-foreground"
                        }`}
                      >
                        {formatCurrency(t.net_pnl, currency, true, baseCurrency)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">
                        {formatDateTimeTz(t.close_time, timeZone)} &middot; {formatDuration(t.open_time, t.close_time)}
                      </span>
                      <span className="font-mono">
                        {formatPrice(t.open_price)} &rarr; {formatPrice(t.close_price)}
                      </span>
                    </div>
                    {t.tilt_flags?.length > 0 && (
                      <div className="mt-2">
                        <TiltBadges flags={t.tilt_flags} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <JournalDrawer
        key={selectedTrade?.id ?? "cal-drawer-closed"}
        trade={selectedTrade}
        currency={currency}
        baseCurrency={baseCurrency}
        timeZone={timeZone}
        onClose={() => setSelectedTrade(null)}
      />
    </div>
  );
}
