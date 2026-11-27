"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { LineChart as LineChartIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { api, Trade } from "@/lib/api";
import { formatPrice, getTzOffsetSeconds, getTzShortLabel } from "@/lib/format";

const REPLAY_INTERVALS = [
  { label: "Auto", value: "" },
  { label: "1m", value: "1min" },
  { label: "5m", value: "5min" },
  { label: "15m", value: "15min" },
  { label: "1h", value: "1h" },
] as const;

export function TradeReplayChart({ trade, timeZone = "Asia/Bangkok" }: { trade: Trade; timeZone?: string }) {
  const [interval, setInterval] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);
  const tzShort = getTzShortLabel(timeZone);

  const q = useQuery({
    queryKey: ["trade-replay", trade.id, interval],
    queryFn: () => api.tradeReplay(trade.id, interval || undefined),
  });

  const replay = q.data;

  useEffect(() => {
    if (!containerRef.current || !replay || replay.candles.length === 0) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
        fontFamily: "var(--font-quicksand), Quicksand, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "rgba(148, 163, 184, 0.25)",
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.25)",
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#f43f5e",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#f43f5e",
    });

    const clean = [...new Map(replay.candles.map((c) => [c.time, c])).values()].sort(
      (a, b) => a.time - b.time,
    );

    const tzOffsetSeconds = getTzOffsetSeconds(timeZone, replay.entry_candle_time);

    const chartData = clean.map((c) => ({
      time: (c.time + tzOffsetSeconds) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    series.setData(chartData);

    const entryTime = (replay.entry_candle_time + tzOffsetSeconds) as Time;
    const exitTime = (replay.exit_candle_time + tzOffsetSeconds) as Time;
    const isWin = Number(trade.net_pnl) >= 0;
    const openPriceNum = Number(trade.open_price);
    const closePriceNum = Number(trade.close_price);
    const entryIsHigher = openPriceNum >= closePriceNum;

    const rawMarkers: SeriesMarker<Time>[] = [
      {
        time: entryTime,
        position: entryIsHigher ? "atPriceTop" : "atPriceBottom",
        price: openPriceNum,
        color: "#818cf8",
        shape: entryIsHigher ? "arrowDown" : "arrowUp",
        text: `${trade.side.toUpperCase()} @ ${formatPrice(trade.open_price)}`,
      },
      {
        time: exitTime,
        position: entryIsHigher ? "atPriceBottom" : "atPriceTop",
        price: closePriceNum,
        color: isWin ? "#34d399" : "#fb7185",
        shape: entryIsHigher ? "arrowUp" : "arrowDown",
        text: `EXIT @ ${formatPrice(trade.close_price)}`,
      },
    ];
    rawMarkers.sort((a, b) => Number(a.time) - Number(b.time));
    createSeriesMarkers(series, rawMarkers);

    // Price lines for Entry, Exit, SL, TP
    series.createPriceLine({
      price: Number(trade.open_price),
      color: "#818cf8",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "Entry",
    });

    series.createPriceLine({
      price: Number(trade.close_price),
      color: isWin ? "#10b981" : "#f43f5e",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "Exit",
    });

    if (trade.stop_loss && Number(trade.stop_loss) > 0) {
      series.createPriceLine({
        price: Number(trade.stop_loss),
        color: "#fb7185",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: "SL",
      });
    }

    if (trade.take_profit && Number(trade.take_profit) > 0) {
      series.createPriceLine({
        price: Number(trade.take_profit),
        color: "#34d399",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: "TP",
      });
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [replay, trade, timeZone]);

  return (
    <div className="rounded-2xl border border-border/70 bg-muted/25 p-3.5">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <LineChartIcon className="size-4 text-indigo-400" />
          <span className="text-xs font-extrabold">
            Trade Replay ({replay?.interval ?? "Auto"} &middot; {tzShort})
          </span>
          {replay && (
            <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-bold text-indigo-300">
              {replay.source === "twelvedata" ? "Twelve Data Market Feed" : "Simulated Price Path"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-full border border-border/60 bg-background/70 p-0.5">
          {REPLAY_INTERVALS.map((opt) => {
            const active = interval === opt.value;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => setInterval(opt.value)}
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {q.isLoading && <Skeleton className="h-56 w-full rounded-xl" />}
      {replay && <div ref={containerRef} className="h-56 w-full" />}
    </div>
  );
}
