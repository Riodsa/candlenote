"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { TiltBadges } from "@/components/journal/TiltBadges";
import { TradeReplayChart } from "@/components/journal/TradeReplayChart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, Trade } from "@/lib/api";
import { formatCurrency, formatDateTimeTz, formatDuration, formatPrice } from "@/lib/format";

const QUICK_TAGS = ["Breakout", "Trend Follow", "Reversal", "Scalp", "News", "Pullback"];

interface Props {
  trade: Trade | null;
  currency: string;
  baseCurrency: string;
  timeZone: string;
  onClose: () => void;
}

export function JournalDrawer({ trade, currency, baseCurrency, timeZone, onClose }: Props) {
  const qc = useQueryClient();
  const [tag, setTag] = useState(trade?.setup_tag ?? "");
  const [rating, setRating] = useState<number | null>(trade?.rating ?? null);
  const [notes, setNotes] = useState(trade?.notes ?? "");

  const save = useMutation({
    mutationFn: () =>
      api.patchTrade(trade!.id, {
        setup_tag: tag.trim() || null,
        rating,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      toast.success(`Saved journal entry for #${trade?.ticket}`);
      qc.invalidateQueries({ queryKey: ["trades"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!trade) return null;

  const pnlNum = Number(trade.net_pnl);
  const isWin = pnlNum > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col justify-between overflow-y-auto border-l border-border/70 bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-4">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="text-xl font-extrabold">{trade.symbol}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${
                    trade.side === "buy"
                      ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
                      : "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30"
                  }`}
                >
                  {trade.side}
                </span>
                <span className="font-mono text-xs text-muted-foreground">#{trade.ticket}</span>
              </div>
              <p className="mt-1 text-xs font-medium text-muted-foreground">
                Opened {formatDateTimeTz(trade.open_time, timeZone)} &rarr; Closed{" "}
                {formatDateTimeTz(trade.close_time, timeZone)} ({timeZone})
              </p>
              {trade.tilt_flags?.length > 0 && (
                <div className="mt-2">
                  <TiltBadges flags={trade.tilt_flags} />
                </div>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
              <X className="size-4" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border/60 bg-muted/30 p-4 text-xs sm:grid-cols-4">
            <div>
              <span className="font-semibold text-muted-foreground">Net P/L ({currency})</span>
              <p
                className={`mt-0.5 font-mono text-base font-extrabold tabular-nums ${
                  isWin ? "text-emerald-400" : pnlNum < 0 ? "text-rose-400" : "text-foreground"
                }`}
              >
                {formatCurrency(trade.net_pnl, currency, true, baseCurrency)}
              </p>
            </div>
            <div>
              <span className="font-semibold text-muted-foreground">Volume / Duration</span>
              <p className="mt-0.5 font-mono text-sm font-semibold">
                {Number(trade.volume)} lots &middot; {formatDuration(trade.open_time, trade.close_time)}
              </p>
            </div>
            <div>
              <span className="font-semibold text-muted-foreground">Entry &rarr; Exit</span>
              <p className="mt-0.5 font-mono text-sm font-semibold">
                {formatPrice(trade.open_price)} &rarr; {formatPrice(trade.close_price)}
              </p>
            </div>
            <div>
              <span className="font-semibold text-muted-foreground">SL / TP</span>
              <p className="mt-0.5 font-mono text-sm font-semibold">
                {formatPrice(trade.stop_loss)} / {formatPrice(trade.take_profit)}
              </p>
            </div>
            {trade.comment && (
              <div className="col-span-2 sm:col-span-4">
                <span className="font-semibold text-muted-foreground">MT5 Comment</span>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">{trade.comment}</p>
              </div>
            )}
          </div>

          <TradeReplayChart trade={trade} timeZone={timeZone} />

          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-sm font-bold">
              <Tag className="size-4 text-indigo-400" />
              Setup Tag
            </label>
            <Input
              placeholder="e.g. Breakout, London Open, Pullback"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              className="rounded-xl"
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {QUICK_TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTag(t)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                    tag === t
                      ? "border-indigo-500 bg-indigo-500/20 text-indigo-300"
                      : "border-border/60 bg-muted/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold">Execution Rating</label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(rating === n ? null : n)}
                  className="rounded-xl border border-border/60 bg-muted/30 p-2.5 transition-transform hover:scale-105"
                >
                  <Star
                    className={`size-5 ${
                      (rating ?? 0) >= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/50"
                    }`}
                  />
                </button>
              ))}
              {rating != null && (
                <button
                  type="button"
                  onClick={() => setRating(null)}
                  className="ml-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold">Trade Notes &amp; Lessons</label>
            <textarea
              rows={5}
              placeholder="What was your thesis? Did you follow your rules?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-2xl border border-input bg-transparent px-3.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-4">
          <Button variant="outline" onClick={onClose} className="rounded-full">
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} className="rounded-full px-6 font-bold">
            {save.isPending ? "Saving\u2026" : "Save Journal"}
          </Button>
        </div>
      </div>
    </div>
  );
}
