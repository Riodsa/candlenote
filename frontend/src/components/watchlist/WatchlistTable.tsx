"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  GripVertical,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssetClass, Quote, WatchlistItem } from "@/lib/api";
import { changeColor, formatCompact, formatPct, formatPrice, formatSigned } from "@/lib/format";

type SortField = "custom" | "symbol" | "price" | "change" | "change_pct" | "volume";
type SortOrder = "asc" | "desc";

const ASSET_STYLES: Record<AssetClass, string> = {
  stock: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  etf: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  metal: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  forex: "bg-teal-500/15 text-teal-400 border-teal-500/30",
  crypto: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  index: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
};

interface Props {
  items: WatchlistItem[];
  quotes: Record<string, Quote>;
  errors: Record<string, string>;
  onRemove: (symbol: string) => void;
  onReorder: (symbols: string[]) => void;
}

export function WatchlistTable({ items, quotes, errors, onRemove, onReorder }: Props) {
  const prevPrices = useRef<Record<string, number>>({});
  const [flashes, setFlashes] = useState<Record<string, "up" | "down">>({});
  const [sortField, setSortField] = useState<SortField>("custom");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [dragSym, setDragSym] = useState<string | null>(null);
  const [overSym, setOverSym] = useState<string | null>(null);

  const handleSort = (field: Exclude<SortField, "custom">) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortOrder(field === "symbol" ? "asc" : "desc");
    }
  };

  const renderSortIcon = (field: Exclude<SortField, "custom">) => {
    if (sortField !== field) {
      return <ArrowUpDown className="size-3.5 opacity-45 transition-opacity group-hover:opacity-100" />;
    }
    return sortOrder === "desc" ? (
      <ArrowDown className="size-3.5 text-indigo-400" />
    ) : (
      <ArrowUp className="size-3.5 text-indigo-400" />
    );
  };

  const sortedItems = useMemo(() => {
    if (sortField === "custom") {
      return [...items].sort((a, b) => a.position - b.position);
    }
    const mult = sortOrder === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      if (sortField === "symbol") {
        return a.instrument.symbol.localeCompare(b.instrument.symbol) * mult;
      }
      const qa = quotes[a.instrument.symbol];
      const qb = quotes[b.instrument.symbol];
      const va = qa?.[sortField];
      const vb = qb?.[sortField];

      if (va == null && vb == null) return a.position - b.position;
      if (va == null) return 1;
      if (vb == null) return -1;

      const diff = va - vb;
      if (diff !== 0) return diff * mult;
      return a.instrument.symbol.localeCompare(b.instrument.symbol);
    });
  }, [items, quotes, sortField, sortOrder]);

  const handleDrop = (targetSym: string) => {
    if (!dragSym || dragSym === targetSym) {
      setDragSym(null);
      setOverSym(null);
      return;
    }
    const order = sortedItems.map((i) => i.instrument.symbol);
    const fromIdx = order.indexOf(dragSym);
    const toIdx = order.indexOf(targetSym);
    if (fromIdx !== -1 && toIdx !== -1) {
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, dragSym);
      setSortField("custom");
      onReorder(order);
    }
    setDragSym(null);
    setOverSym(null);
  };

  useEffect(() => {
    const nextFlashes: Record<string, "up" | "down"> = {};
    for (const [sym, q] of Object.entries(quotes)) {
      const prev = prevPrices.current[sym];
      if (prev != null && q.price !== prev) {
        nextFlashes[sym] = q.price > prev ? "up" : "down";
      }
      prevPrices.current[sym] = q.price;
    }
    if (Object.keys(nextFlashes).length === 0) return;

    const showTimer = setTimeout(() => {
      setFlashes((f) => ({ ...f, ...nextFlashes }));
    }, 0);
    const clearTimer = setTimeout(() => {
      setFlashes((f) => {
        const copy = { ...f };
        for (const k of Object.keys(nextFlashes)) delete copy[k];
        return copy;
      });
    }, 900);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(clearTimer);
    };
  }, [quotes]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-lg shadow-indigo-950/10 backdrop-blur">
      <Table>
        <TableHeader>
          <TableRow className="border-border/60 bg-muted/40 hover:bg-muted/40">
            <TableHead className="w-8 pl-3" title="Drag rows to reorder">
              {sortField !== "custom" && (
                <button
                  type="button"
                  onClick={() => setSortField("custom")}
                  title="Return to custom saved order"
                  className="text-[10px] font-bold text-indigo-400 hover:underline"
                >
                  Order
                </button>
              )}
            </TableHead>
            <TableHead className="font-bold">
              <button
                type="button"
                onClick={() => handleSort("symbol")}
                className={`group inline-flex cursor-pointer items-center gap-1.5 select-none transition-colors hover:text-foreground ${
                  sortField === "symbol" ? "text-indigo-400" : ""
                }`}
              >
                <span>Asset</span>
                {renderSortIcon("symbol")}
              </button>
            </TableHead>
            <TableHead className="text-right font-bold">
              <button
                type="button"
                onClick={() => handleSort("price")}
                className={`group ml-auto inline-flex cursor-pointer items-center justify-end gap-1.5 select-none transition-colors hover:text-foreground ${
                  sortField === "price" ? "text-indigo-400" : ""
                }`}
              >
                <span>Last Price</span>
                {renderSortIcon("price")}
              </button>
            </TableHead>
            <TableHead className="text-right font-bold">
              <button
                type="button"
                onClick={() => handleSort("change")}
                className={`group ml-auto inline-flex cursor-pointer items-center justify-end gap-1.5 select-none transition-colors hover:text-foreground ${
                  sortField === "change" ? "text-indigo-400" : ""
                }`}
              >
                <span>24h Change</span>
                {renderSortIcon("change")}
              </button>
            </TableHead>
            <TableHead className="text-right font-bold">
              <button
                type="button"
                onClick={() => handleSort("change_pct")}
                className={`group ml-auto inline-flex cursor-pointer items-center justify-end gap-1.5 select-none transition-colors hover:text-foreground ${
                  sortField === "change_pct" ? "text-indigo-400" : ""
                }`}
              >
                <span>24h %</span>
                {renderSortIcon("change_pct")}
              </button>
            </TableHead>
            <TableHead className="text-right font-bold">
              <button
                type="button"
                onClick={() => handleSort("volume")}
                className={`group ml-auto inline-flex cursor-pointer items-center justify-end gap-1.5 select-none transition-colors hover:text-foreground ${
                  sortField === "volume" ? "text-indigo-400" : ""
                }`}
              >
                <span>Volume</span>
                {renderSortIcon("volume")}
              </button>
            </TableHead>
            <TableHead className="hidden text-right font-bold md:table-cell">Day Range</TableHead>
            <TableHead className="w-12 pr-4" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedItems.map(({ instrument: i }) => {
            const q = quotes[i.symbol];
            const err = errors[i.symbol];
            const flash = flashes[i.symbol];
            const flashCls =
              flash === "up" ? "animate-flash-up" : flash === "down" ? "animate-flash-down" : "";
            const isUp = (q?.change_pct ?? 0) >= 0;

            const isDragging = dragSym === i.symbol;
            const isDragOver = overSym === i.symbol && dragSym !== i.symbol;

            return (
              <TableRow
                key={i.symbol}
                draggable
                onDragStart={() => setDragSym(i.symbol)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (overSym !== i.symbol) setOverSym(i.symbol);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleDrop(i.symbol);
                }}
                onDragEnd={() => {
                  setDragSym(null);
                  setOverSym(null);
                }}
                className={`border-border/50 transition-colors hover:bg-accent/40 ${flashCls} ${
                  isDragging ? "opacity-40" : ""
                } ${isDragOver ? "border-t-2 border-t-indigo-400 bg-indigo-500/10" : ""}`}
              >
                <TableCell className="w-8 pl-3 pr-0 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground">
                  <GripVertical className="size-4" aria-label={`Drag to reorder ${i.symbol}`} />
                </TableCell>
                <TableCell className="py-3.5">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/watchlist/${i.symbol}`}
                      className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 via-violet-500/15 to-teal-500/20 font-bold text-sm text-foreground ring-1 ring-border/60 transition-transform hover:scale-105"
                    >
                      {i.symbol.slice(0, 3)}
                    </Link>
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/watchlist/${i.symbol}`}
                          className="font-bold text-base tracking-tight hover:text-primary transition-colors"
                        >
                          {i.symbol}
                        </Link>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                            ASSET_STYLES[i.asset_class] ?? ASSET_STYLES.stock
                          }`}
                        >
                          {i.asset_class}
                        </span>
                      </div>
                      <div className="text-xs font-medium text-muted-foreground">{i.name}</div>
                    </div>
                  </div>
                </TableCell>
                {q ? (
                  <>
                    <TableCell className="text-right font-mono text-base font-semibold tabular-nums">
                      {formatPrice(q.price)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono text-sm font-medium tabular-nums ${changeColor(q.change)}`}
                    >
                      {formatSigned(q.change)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`inline-flex items-center gap-0.5 rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums ${
                          q.change_pct == null || q.change_pct === 0
                            ? "bg-muted text-muted-foreground"
                            : isUp
                              ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                              : "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30"
                        }`}
                      >
                        {q.change_pct != null && q.change_pct !== 0 && (
                          isUp ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />
                        )}
                        {formatPct(q.change_pct)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                      {formatCompact(q.volume)}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground md:table-cell">
                      {formatPrice(q.low)} &ndash; {formatPrice(q.high)}
                    </TableCell>
                  </>
                ) : (
                  <TableCell colSpan={5} className="text-right text-sm text-muted-foreground">
                    {err ?? "Fetching live quote\u2026"}
                  </TableCell>
                )}
                <TableCell className="pr-4 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${i.symbol}`}
                    onClick={() => onRemove(i.symbol)}
                    className="rounded-full text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
