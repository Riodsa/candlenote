"""Twelve Data adapter: candles for all assets, XAUUSD live quotes (WebSocket with REST-polling fallback)."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

import httpx
import websockets

from app.services.market.base import (
    Candle,
    InstrumentRef,
    MarketDataProvider,
    ProviderError,
    Quote,
    Tick,
    TickHandler,
)

log = logging.getLogger(__name__)
BASE_URL = "https://api.twelvedata.com"
WS_URL = "wss://ws.twelvedata.com/v1/quotes/price"
INTERVALS = {"1min", "5min", "15min", "1h", "1day"}


def _f(v) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _parse_time(s: str) -> int:
    fmt = "%Y-%m-%d %H:%M:%S" if " " in s else "%Y-%m-%d"
    return int(datetime.strptime(s, fmt).replace(tzinfo=timezone.utc).timestamp())


class TwelveDataProvider(MarketDataProvider):
    name = "twelvedata"

    def __init__(self, api_key: str, client: httpx.AsyncClient, poll_interval: float = 10.0) -> None:
        self.api_key = api_key
        self._client = client
        self._poll_interval = poll_interval
        self._on_tick: TickHandler | None = None
        self._tasks: list[asyncio.Task] = []
        self._ws = None
        self._subs: dict[str, InstrumentRef] = {}  # twelvedata symbol -> ref
        self._streaming: set[str] = set()  # symbols confirmed by the WS feed

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def _get(self, path: str, **params) -> dict:
        if not self.api_key:
            raise ProviderError("TWELVEDATA_API_KEY is not configured")
        try:
            resp = await self._client.get(
                f"{BASE_URL}{path}", params={**params, "apikey": self.api_key}, timeout=15
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise ProviderError(f"Twelve Data request failed: HTTP {e.response.status_code} for {path}") from None
        except httpx.HTTPError as e:
            raise ProviderError(f"Twelve Data request failed: {type(e).__name__}") from None
        data = resp.json()
        if isinstance(data, dict) and data.get("status") == "error":
            raise ProviderError(f"Twelve Data: {data.get('message', 'error')}")
        return data

    # -- REST -------------------------------------------------------------
    async def get_quote(self, ref: InstrumentRef) -> Quote:
        d = await self._get("/quote", symbol=ref.sym(self.name))
        return Quote(
            symbol=ref.symbol,
            price=float(d["close"]),
            prev_close=_f(d.get("previous_close")),
            change=_f(d.get("change")),
            change_pct=_f(d.get("percent_change")),
            high=_f(d.get("high")),
            low=_f(d.get("low")),
            open=_f(d.get("open")),
            volume=_f(d.get("volume")),
            ts=float(d.get("timestamp") or 0),
        )

    async def get_candles(
        self,
        ref: InstrumentRef,
        interval: str,
        limit: int,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> list[Candle]:
        if interval not in INTERVALS:
            raise ProviderError(f"Unsupported interval: {interval}")
        params: dict[str, object] = {
            "symbol": ref.sym(self.name),
            "interval": interval,
            "outputsize": limit,
            "timezone": "UTC",
        }
        if start_date:
            params["start_date"] = start_date
        if end_date:
            params["end_date"] = end_date
        d = await self._get("/time_series", **params)
        candles = [
            Candle(
                time=_parse_time(v["datetime"]),
                open=float(v["open"]),
                high=float(v["high"]),
                low=float(v["low"]),
                close=float(v["close"]),
                volume=_f(v.get("volume")),
            )
            for v in d.get("values", [])
        ]
        # API returns newest first, and may repeat a timestamp; charts need unique ascending times.
        # Keep the first row seen per timestamp (the newest), then sort ascending.
        unique: dict[int, Candle] = {}
        for c in candles:
            unique.setdefault(c.time, c)
        return sorted(unique.values(), key=lambda c: c.time)

    async def get_stats(self, ref: InstrumentRef) -> dict:
        d = await self._get("/quote", symbol=ref.sym(self.name))
        wk = d.get("fifty_two_week") or {}
        return {
            "name": d.get("name"),
            "exchange": d.get("exchange"),
            "currency": d.get("currency"),
            "week52_high": _f(wk.get("high")),
            "week52_low": _f(wk.get("low")),
            "avg_volume_10d": _f(d.get("average_volume")),
        }

    # -- Streaming --------------------------------------------------------
    async def start(self, on_tick: TickHandler) -> None:
        self._on_tick = on_tick
        if self.api_key and not self._tasks:
            self._tasks = [
                asyncio.create_task(self._run_ws(), name="twelvedata-ws"),
                asyncio.create_task(self._poll_loop(), name="twelvedata-poll"),
            ]

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []

    async def subscribe(self, ref: InstrumentRef) -> None:
        sym = ref.sym(self.name)
        self._subs[sym] = ref
        await self._send({"action": "subscribe", "params": {"symbols": sym}})

    async def unsubscribe(self, ref: InstrumentRef) -> None:
        sym = ref.sym(self.name)
        self._subs.pop(sym, None)
        self._streaming.discard(sym)
        await self._send({"action": "unsubscribe", "params": {"symbols": sym}})

    async def _send(self, msg: dict) -> None:
        if self._ws is not None:
            try:
                await self._ws.send(json.dumps(msg))
            except Exception as e:
                log.warning("twelvedata send failed: %s", e)

    async def _emit(self, ref: InstrumentRef, price: float, ts: float) -> None:
        if self._on_tick:
            await self._on_tick(Tick(ref.symbol, price, ts))

    async def _run_ws(self) -> None:
        backoff = 1
        while True:
            try:
                async with websockets.connect(f"{WS_URL}?apikey={self.api_key}") as ws:
                    self._ws = ws
                    backoff = 1
                    if self._subs:
                        await ws.send(
                            json.dumps({"action": "subscribe", "params": {"symbols": ",".join(self._subs)}})
                        )
                    hb = asyncio.create_task(self._heartbeat(ws))
                    try:
                        async for raw in ws:
                            await self._handle(json.loads(raw))
                    finally:
                        hb.cancel()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("twelvedata ws error: %s", e)
            finally:
                self._ws = None
                self._streaming.clear()  # poll loop takes over until we reconnect
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)

    @staticmethod
    async def _heartbeat(ws) -> None:
        while True:
            await asyncio.sleep(10)
            await ws.send(json.dumps({"action": "heartbeat"}))

    async def _handle(self, msg: dict) -> None:
        event = msg.get("event")
        if event == "subscribe-status":
            self._streaming.update(s["symbol"] for s in msg.get("success") or [])
            for s in msg.get("fails") or []:
                log.info("twelvedata WS refused %s; falling back to polling", s.get("symbol"))
        elif event == "price":
            ref = self._subs.get(msg.get("symbol"))
            if ref and msg.get("price") is not None:
                await self._emit(ref, float(msg["price"]), float(msg.get("timestamp") or 0))

    async def _poll_loop(self) -> None:
        """REST fallback for subscribed symbols the WebSocket isn't streaming (free-tier limits)."""
        while True:
            await asyncio.sleep(self._poll_interval)
            for sym, ref in list(self._subs.items()):
                if sym in self._streaming:
                    continue
                try:
                    d = await self._get("/price", symbol=sym)
                    await self._emit(ref, float(d["price"]), datetime.now(timezone.utc).timestamp())
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    log.warning("twelvedata poll failed for %s: %s", sym, e)
