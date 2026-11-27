"""Finnhub adapter: live stock/ETF trades over WebSocket, REST quotes, stats and search.

Note: Finnhub's /stock/candle endpoint is premium-only, so candles come from Twelve Data.
"""
from __future__ import annotations

import asyncio
import json
import logging

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
BASE_URL = "https://finnhub.io/api/v1"
WS_URL = "wss://ws.finnhub.io"


class FinnhubProvider(MarketDataProvider):
    name = "finnhub"

    def __init__(self, api_key: str, client: httpx.AsyncClient) -> None:
        self.api_key = api_key
        self._client = client
        self._on_tick: TickHandler | None = None
        self._task: asyncio.Task | None = None
        self._ws = None
        self._subs: dict[str, str] = {}  # finnhub symbol -> canonical symbol

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def _get(self, path: str, **params) -> dict | list:
        if not self.api_key:
            raise ProviderError("FINNHUB_API_KEY is not configured")
        try:
            resp = await self._client.get(
                f"{BASE_URL}{path}", params={**params, "token": self.api_key}, timeout=10
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise ProviderError(f"Finnhub request failed: HTTP {e.response.status_code} for {path}") from None
        except httpx.HTTPError as e:
            raise ProviderError(f"Finnhub request failed: {type(e).__name__}") from None
        return resp.json()

    # -- REST -------------------------------------------------------------
    async def get_quote(self, ref: InstrumentRef) -> Quote:
        d = await self._get("/quote", symbol=ref.sym(self.name))
        if not d.get("c") and not d.get("t"):
            raise ProviderError(f"Unknown symbol on Finnhub: {ref.symbol}")
        return Quote(
            symbol=ref.symbol,
            price=d["c"],
            prev_close=d.get("pc"),
            change=d.get("d"),
            change_pct=d.get("dp"),
            high=d.get("h"),
            low=d.get("l"),
            open=d.get("o"),
            ts=float(d.get("t") or 0),
        )

    async def get_candles(self, ref: InstrumentRef, interval: str, limit: int) -> list[Candle]:
        raise ProviderError("Finnhub candles are premium-only; use Twelve Data")

    async def get_stats(self, ref: InstrumentRef) -> dict:
        sym = ref.sym(self.name)
        profile, metric = await asyncio.gather(
            self._get("/stock/profile2", symbol=sym),
            self._get("/stock/metric", symbol=sym, metric="all"),
            return_exceptions=True,
        )
        profile = profile if isinstance(profile, dict) else {}
        m = (metric.get("metric") if isinstance(metric, dict) else None) or {}

        def millions(v):  # Finnhub reports some figures in millions
            return v * 1_000_000 if isinstance(v, (int, float)) else None

        return {
            "name": profile.get("name"),
            "exchange": profile.get("exchange"),
            "currency": profile.get("currency"),
            "market_cap": millions(profile.get("marketCapitalization")),
            "pe_ratio": m.get("peBasicExclExtraTTM"),
            "week52_high": m.get("52WeekHigh"),
            "week52_low": m.get("52WeekLow"),
            "dividend_yield": m.get("dividendYieldIndicatedAnnual"),
            "beta": m.get("beta"),
            "avg_volume_10d": millions(m.get("10DayAverageTradingVolume")),
        }

    async def search(self, query: str) -> list[dict]:
        d = await self._get("/search", q=query)
        out = []
        for r in d.get("result", []) if isinstance(d, dict) else []:
            sym = r.get("symbol", "")
            if "." in sym or ":" in sym:  # skip non-US listings
                continue
            kind = "etf" if r.get("type") == "ETP" else "stock" if r.get("type") == "Common Stock" else None
            if kind:
                out.append({"symbol": sym, "name": r.get("description"), "asset_class": kind})
        return out[:10]

    # -- Streaming --------------------------------------------------------
    async def start(self, on_tick: TickHandler) -> None:
        self._on_tick = on_tick
        if self.api_key and self._task is None:
            self._task = asyncio.create_task(self._run(), name="finnhub-ws")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    async def subscribe(self, ref: InstrumentRef) -> None:
        sym = ref.sym(self.name)
        self._subs[sym] = ref.symbol
        await self._send({"type": "subscribe", "symbol": sym})

    async def unsubscribe(self, ref: InstrumentRef) -> None:
        sym = ref.sym(self.name)
        self._subs.pop(sym, None)
        await self._send({"type": "unsubscribe", "symbol": sym})

    async def _send(self, msg: dict) -> None:
        if self._ws is not None:
            try:
                await self._ws.send(json.dumps(msg))
            except Exception as e:  # reconnect loop will resubscribe
                log.warning("finnhub send failed: %s", e)

    async def _run(self) -> None:
        backoff = 1
        while True:
            try:
                async with websockets.connect(f"{WS_URL}?token={self.api_key}") as ws:
                    self._ws = ws
                    backoff = 1
                    for sym in list(self._subs):
                        await ws.send(json.dumps({"type": "subscribe", "symbol": sym}))
                    async for raw in ws:
                        msg = json.loads(raw)
                        if msg.get("type") != "trade" or not self._on_tick:
                            continue
                        for t in msg.get("data", []):
                            canon = self._subs.get(t["s"], t["s"])
                            await self._on_tick(Tick(canon, t["p"], t["t"] / 1000, t.get("v", 0)))
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("finnhub ws error: %s", e)
            finally:
                self._ws = None
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)
