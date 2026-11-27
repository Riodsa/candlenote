"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { SymbolSearch } from "@/components/watchlist/SymbolSearch";
import { WatchlistTable } from "@/components/watchlist/WatchlistTable";
import { useQuotes } from "@/hooks/useQuotes";
import { api, WatchlistItem } from "@/lib/api";

export default function WatchlistPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["watchlist"], queryFn: api.watchlist });
  const status = useQuery({ queryKey: ["market-status"], queryFn: api.status });

  const symbols = useMemo(() => (list.data ?? []).map((i) => i.instrument.symbol), [list.data]);
  const { quotes, errors, state } = useQuotes(symbols);

  const remove = useMutation({
    mutationFn: api.removeFromWatchlist,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const reorder = useMutation({
    mutationFn: api.reorderWatchlist,
    onMutate: async (nextSymbols) => {
      await qc.cancelQueries({ queryKey: ["watchlist"] });
      const prev = qc.getQueryData<WatchlistItem[]>(["watchlist"]);
      if (prev) {
        const bySym = new Map(prev.map((i) => [i.instrument.symbol, i]));
        const next = nextSymbols
          .map((s, idx) => {
            const item = bySym.get(s);
            return item ? { ...item, position: idx } : null;
          })
          .filter((x): x is WatchlistItem => x !== null);
        qc.setQueryData(["watchlist"], next);
      }
      return { prev };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["watchlist"], ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const missingKeys = status.data && (!status.data.finnhub || !status.data.twelvedata);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-border/70 bg-gradient-to-r from-indigo-500/10 via-violet-500/10 to-teal-500/10 p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Market Watchlist</h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
                state === "open"
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                  : "border-amber-500/30 bg-amber-500/15 text-amber-400"
              }`}
              title="WebSocket connection to the backend"
            >
              <Radio className="size-3 animate-pulse" />
              {state === "open" ? "Live Stream" : state === "connecting" ? "Connecting\u2026" : "Reconnecting"}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-muted-foreground">
            Track US Stocks, ETFs, and Gold (XAUUSD) in real time. Click any symbol to open interactive charts.
          </p>
        </div>

        <SymbolSearch existing={new Set(symbols)} />
      </div>

      {missingKeys && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium">
          Missing API keys:{" "}
          {[!status.data!.finnhub && "FINNHUB_API_KEY", !status.data!.twelvedata && "TWELVEDATA_API_KEY"]
            .filter(Boolean)
            .join(", ")}
          . Add them to <code>backend/.env</code> and restart the backend to see live prices.
        </div>
      )}

      {list.isLoading && <Skeleton className="h-52 w-full rounded-2xl" />}
      {list.isError && (
        <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm font-medium text-rose-400">
          Can&apos;t reach the backend: {(list.error as Error).message}
        </p>
      )}
      {list.data && list.data.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border/70 bg-card/50 py-16 text-center">
          <Sparkles className="size-10 text-indigo-400 mb-3" />
          <p className="text-base font-bold">Your watchlist is empty</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Search for a ticker above (e.g. AAPL, NVDA, SPY, XAUUSD) to start streaming prices.
          </p>
        </div>
      )}
      {list.data && list.data.length > 0 && (
        <WatchlistTable
          items={list.data}
          quotes={quotes}
          errors={errors}
          onRemove={(s) => remove.mutate(s)}
          onReorder={(nextSymbols) => reorder.mutate(nextSymbols)}
        />
      )}
    </div>
  );
}
