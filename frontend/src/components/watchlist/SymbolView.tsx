"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { PriceChart } from "@/components/charts/PriceChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuotes } from "@/hooks/useQuotes";
import { api, INTERVALS, Interval } from "@/lib/api";
import { changeColor, formatCompact, formatPct, formatPrice, formatSigned } from "@/lib/format";

const DASH = "\u2014";

export function SymbolView({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = use(params);
  const symbol = decodeURIComponent(raw).toUpperCase();
  const [interval, setInterval] = useState<Interval>("1day");

  const { quotes } = useQuotes([symbol]);
  const quote = quotes[symbol];
  const candles = useQuery({
    queryKey: ["candles", symbol, interval],
    queryFn: () => api.candles(symbol, interval),
  });
  const stats = useQuery({ queryKey: ["stats", symbol], queryFn: () => api.stats(symbol) });

  const rows: [string, string][] = [
    ["Volume", formatCompact(quote?.volume ?? stats.data?.volume)],
    ["Avg volume (10d)", formatCompact(stats.data?.avg_volume_10d)],
    ["Open", formatPrice(quote?.open)],
    ["Prev close", formatPrice(quote?.prev_close)],
    ["Day high", formatPrice(quote?.high)],
    ["Day low", formatPrice(quote?.low)],
    ["52w high", formatPrice(stats.data?.week52_high)],
    ["52w low", formatPrice(stats.data?.week52_low)],
    ["Market cap", formatCompact(stats.data?.market_cap)],
    ["P/E (TTM)", stats.data?.pe_ratio?.toFixed(2) ?? DASH],
    ["Dividend yield", stats.data?.dividend_yield != null ? `${stats.data.dividend_yield.toFixed(2)}%` : DASH],
    ["Beta", stats.data?.beta?.toFixed(2) ?? DASH],
  ];

  const isUp = (quote?.change_pct ?? 0) >= 0;

  return (
    <div className="space-y-6">
      <Link
        href="/watchlist"
        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3.5 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to Watchlist
      </Link>

      <div className="flex flex-wrap items-baseline justify-between gap-4 rounded-3xl border border-border/70 bg-gradient-to-r from-indigo-500/10 via-violet-500/10 to-teal-500/10 p-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight">{symbol}</h1>
            {stats.data?.exchange && (
              <Badge variant="secondary" className="rounded-full font-semibold">
                {stats.data.exchange}
              </Badge>
            )}
          </div>
          {stats.data?.name && <p className="text-sm font-semibold text-muted-foreground">{stats.data.name}</p>}
        </div>

        {quote && (
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-3xl font-bold tabular-nums">{formatPrice(quote.price)}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 font-mono text-sm font-semibold tabular-nums ${
                isUp
                  ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                  : "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30"
              }`}
            >
              {isUp ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
              {formatSigned(quote.change)} ({formatPct(quote.change_pct)})
            </span>
          </div>
        )}
      </div>

      <Card className="rounded-3xl border-border/70 bg-card/85 shadow-lg shadow-indigo-950/10">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-lg font-extrabold">Interactive Price Chart</CardTitle>
          <div className="flex gap-1 rounded-full border border-border/60 bg-muted/50 p-1">
            {INTERVALS.map((i) => (
              <Button
                key={i}
                size="sm"
                variant={i === interval ? "default" : "ghost"}
                onClick={() => setInterval(i)}
                className="rounded-full px-3 font-bold"
              >
                {i}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {candles.isLoading && <Skeleton className="h-[420px] w-full rounded-2xl" />}
          {candles.isError && (
            <p className="py-10 text-center text-sm font-medium text-rose-400">
              {(candles.error as Error).message}
            </p>
          )}
          {candles.data && <PriceChart candles={candles.data} interval={interval} quote={quote} />}
        </CardContent>
      </Card>

      <Card className="rounded-3xl border-border/70 bg-card/85 shadow-lg shadow-indigo-950/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg font-extrabold">
            Key Statistics{" "}
            <Badge variant="secondary" className="rounded-full font-semibold">
              {stats.isLoading ? "loading" : "snapshot"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 md:grid-cols-4">
            {rows.map(([k, v]) => (
              <div
                key={k}
                className="rounded-2xl border border-border/50 bg-muted/30 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <dt className="text-xs font-semibold text-muted-foreground">{k}</dt>
                <dd className={`mt-1 font-mono text-base font-semibold tabular-nums ${changeColor(null)}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
