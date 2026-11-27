"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { Candle, Quote } from "@/lib/api";

const INTERVAL_SECONDS: Record<string, number> = {
  "1min": 60,
  "5min": 300,
  "15min": 900,
  "1h": 3600,
  "1day": 86400,
};

interface Props {
  candles: Candle[];
  interval: string;
  /** Latest live quote; the last candle is updated (or a new one opened) from it. */
  quote?: Quote;
}

export function PriceChart({ candles, interval, quote }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeries = useRef<ISeriesApi<"Histogram"> | null>(null);
  const last = useRef<CandlestickData<UTCTimestamp> | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const c = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
        fontFamily: "var(--font-quicksand), Quicksand, sans-serif",
      },
      grid: { vertLines: { color: "rgba(156,163,175,0.1)" }, horzLines: { color: "rgba(156,163,175,0.1)" } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "rgba(156,163,175,0.3)" },
      rightPriceScale: { borderColor: "rgba(156,163,175,0.3)" },
    });
    const cs = c.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });
    const vs = c.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "" });
    vs.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chart.current = c;
    candleSeries.current = cs;
    volumeSeries.current = vs;
    return () => {
      c.remove();
      chart.current = candleSeries.current = volumeSeries.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candleSeries.current || !volumeSeries.current) return;
    // Lightweight Charts throws on duplicate or unsorted times, so enforce unique ascending order.
    const clean = [...new Map(candles.map((k) => [k.time, k])).values()].sort((a, b) => a.time - b.time);
    const data = clean.map((k) => ({
      time: k.time as UTCTimestamp,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));
    candleSeries.current.setData(data);
    volumeSeries.current.setData(
      clean
        .filter((k) => k.volume != null)
        .map((k) => ({
          time: k.time as UTCTimestamp,
          value: k.volume as number,
          color: k.close >= k.open ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.4)",
        })),
    );
    last.current = data.length ? data[data.length - 1] : null;
    chart.current?.timeScale().fitContent();
  }, [candles]);

  // Apply live ticks to the most recent candle.
  useEffect(() => {
    if (!quote || !candleSeries.current || !last.current) return;
    const step = INTERVAL_SECONDS[interval] ?? 86400;
    const bucket = (Math.floor((quote.ts || Date.now() / 1000) / step) * step) as UTCTimestamp;
    const prev = last.current;
    const next: CandlestickData<UTCTimestamp> =
      bucket > (prev.time as number)
        ? { time: bucket, open: quote.price, high: quote.price, low: quote.price, close: quote.price }
        : {
            ...prev,
            high: Math.max(prev.high, quote.price),
            low: Math.min(prev.low, quote.price),
            close: quote.price,
          };
    last.current = next;
    candleSeries.current.update(next);
  }, [quote, interval]);

  return <div ref={container} className="h-[420px] w-full" />;
}
