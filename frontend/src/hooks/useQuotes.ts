"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getWsUrl, Quote } from "@/lib/api";

export type ConnectionState = "connecting" | "open" | "closed";

/**
 * Subscribes to live quotes over one shared WebSocket. Reconnects with backoff and
 * re-subscribes automatically. `symbols` changes are diffed into subscribe/unsubscribe messages.
 */
export function useQuotes(symbols: string[]) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<ConnectionState>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const subscribed = useRef<Set<string>>(new Set());
  const wanted = useRef<string[]>([]);

  const sync = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const want = new Set(wanted.current);
    const add = [...want].filter((s) => !subscribed.current.has(s));
    const drop = [...subscribed.current].filter((s) => !want.has(s));
    if (add.length) ws.send(JSON.stringify({ action: "subscribe", symbols: add }));
    if (drop.length) ws.send(JSON.stringify({ action: "unsubscribe", symbols: drop }));
    subscribed.current = want;
  }, []);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    let backoff = 1000;

    const connect = () => {
      setState("connecting");
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        backoff = 1000;
        subscribed.current = new Set(); // fresh connection: nothing subscribed yet
        setState("open");
        sync();
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "quote") {
          setQuotes((q) => ({ ...q, [msg.data.symbol]: msg.data }));
          setErrors((e) => {
            if (!(msg.data.symbol in e)) return e;
            const rest = { ...e };
            delete rest[msg.data.symbol];
            return rest;
          });
        } else if (msg.type === "error") {
          setErrors((e) => ({ ...e, [msg.symbol]: msg.message }));
        }
      };
      ws.onclose = () => {
        setState("closed");
        if (closed) return;
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15000);
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [sync]);

  const key = symbols.join(",");
  useEffect(() => {
    wanted.current = key ? key.split(",") : [];
    sync();
  }, [key, sync]);


  return { quotes, errors, state };
}
