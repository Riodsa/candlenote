"""QuoteHub: one upstream subscription per symbol, fanned out to all connected browser clients."""
from __future__ import annotations

import asyncio
import logging
import time

from app.db.models.instrument import Instrument
from app.services.market.base import (
    Candle,
    InstrumentRef,
    MarketDataProvider,
    ProviderError,
    Quote,
    Tick,
)

log = logging.getLogger(__name__)
STOCK_CLASSES = {"stock", "etf"}


def ref_from_instrument(i: Instrument) -> InstrumentRef:
    return InstrumentRef(symbol=i.symbol, asset_class=i.asset_class.value, provider_symbols=i.provider_ref or {})


class Client:
    """A connected browser. The hub pushes messages onto its queue; the WS handler drains it."""

    def __init__(self) -> None:
        self.queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=500)

    def push(self, msg: dict) -> None:
        try:
            self.queue.put_nowait(msg)
        except asyncio.QueueFull:  # slow client: drop rather than block everyone
            pass


class QuoteHub:
    SNAPSHOT_TTL = 300.0  # seconds before a REST snapshot (incl. volume) is refreshed
    THROTTLE = 0.25  # max seconds between pushes per symbol

    def __init__(self, finnhub: MarketDataProvider, twelvedata: MarketDataProvider) -> None:
        self.finnhub = finnhub
        self.twelvedata = twelvedata
        self.quotes: dict[str, Quote] = {}
        self._snapshot_at: dict[str, float] = {}
        self._last_sent: dict[str, float] = {}
        self.refs: dict[str, InstrumentRef] = {}
        self.subs: dict[str, set[Client]] = {}

    # -- routing ---------------------------------------------------------
    def live_provider(self, ref: InstrumentRef) -> MarketDataProvider:
        return self.finnhub if ref.asset_class in STOCK_CLASSES else self.twelvedata

    async def start(self) -> None:
        await self.finnhub.start(self._on_tick)
        await self.twelvedata.start(self._on_tick)

    async def stop(self) -> None:
        await self.finnhub.stop()
        await self.twelvedata.stop()

    # -- REST-style access -----------------------------------------------
    async def get_quote(self, ref: InstrumentRef, force: bool = False) -> Quote:
        cached = self.quotes.get(ref.symbol)
        fresh = time.time() - self._snapshot_at.get(ref.symbol, 0) < self.SNAPSHOT_TTL
        if cached and fresh and not force:
            return cached
        quote = await self.live_provider(ref).get_quote(ref)
        # Finnhub quotes carry no volume; borrow it from Twelve Data when available.
        if quote.volume is None and ref.asset_class in STOCK_CLASSES:
            try:
                quote.volume = (await self.twelvedata.get_quote(ref)).volume
            except ProviderError:
                pass
        self.quotes[ref.symbol] = quote
        self._snapshot_at[ref.symbol] = time.time()
        return quote

    async def get_candles(
        self,
        ref: InstrumentRef,
        interval: str,
        limit: int,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> list[Candle]:
        return await self.twelvedata.get_candles(
            ref, interval, limit, start_date=start_date, end_date=end_date
        )

    async def get_stats(self, ref: InstrumentRef) -> dict:
        return await self.live_provider(ref).get_stats(ref)

    # -- subscriptions ---------------------------------------------------
    async def subscribe(self, client: Client, refs: list[InstrumentRef]) -> None:
        for ref in refs:
            self.refs[ref.symbol] = ref
            clients = self.subs.setdefault(ref.symbol, set())
            first = not clients
            clients.add(client)
            if first:
                await self.live_provider(ref).subscribe(ref)

        results = await asyncio.gather(*(self.get_quote(r) for r in refs), return_exceptions=True)
        for ref, res in zip(refs, results):
            if isinstance(res, Quote):
                client.push({"type": "quote", "data": res.to_dict()})
            else:
                client.push({"type": "error", "symbol": ref.symbol, "message": str(res)})

    async def unsubscribe(self, client: Client, symbols: list[str]) -> None:
        for symbol in symbols:
            clients = self.subs.get(symbol)
            if not clients or client not in clients:
                continue
            clients.discard(client)
            if not clients:
                del self.subs[symbol]
                ref = self.refs.get(symbol)
                if ref:
                    await self.live_provider(ref).unsubscribe(ref)

    async def disconnect(self, client: Client) -> None:
        await self.unsubscribe(client, [s for s, c in self.subs.items() if client in c])

    # -- upstream ticks --------------------------------------------------
    async def _on_tick(self, tick: Tick) -> None:
        quote = self.quotes.get(tick.symbol)
        if quote is None or tick.price <= 0:
            return  # no snapshot yet; the next REST snapshot will seed it
        quote.apply_price(tick.price, tick.ts or time.time())
        now = time.monotonic()
        if now - self._last_sent.get(tick.symbol, 0) < self.THROTTLE:
            return
        self._last_sent[tick.symbol] = now
        msg = {"type": "quote", "data": quote.to_dict()}
        for client in self.subs.get(tick.symbol, ()):
            client.push(msg)
