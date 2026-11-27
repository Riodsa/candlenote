"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api, SearchResult } from "@/lib/api";

export function SymbolSearch({ existing }: { existing: Set<string> }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .search(q)
        .then((r) => !cancelled && setResults(r))
        .catch(() => !cancelled && setResults([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const add = useMutation({
    mutationFn: (r: SearchResult) => api.addToWatchlist(r.symbol, r.asset_class, r.name),
    onSuccess: (item) => {
      toast.success(`Added ${item.instrument.symbol}`);
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      setQuery("");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="relative w-full max-w-sm">
      <Input
        placeholder="Add symbol (AAPL, SPY, XAUUSD…)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          const sym = query.trim().toUpperCase();
          if (e.key === "Enter" && sym && !add.isPending) {
            const hit = results.find((r) => r.symbol === sym);
            add.mutate(hit ?? { symbol: sym, name: null, asset_class: "stock" });
          }
        }}
      />
      {open && query.trim() && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
          {results.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No matches. Press Enter to try &ldquo;{query.trim().toUpperCase()}&rdquo; as a US ticker.
            </li>
          )}
          {results.map((r) => (
            <li key={r.symbol}>
              <button
                type="button"
                disabled={existing.has(r.symbol) || add.isPending}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add.mutate(r)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
              >
                <span>
                  <span className="font-medium">{r.symbol}</span>
                  <span className="ml-2 text-muted-foreground">{r.name}</span>
                </span>
                <Badge variant="secondary">{existing.has(r.symbol) ? "added" : r.asset_class}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
