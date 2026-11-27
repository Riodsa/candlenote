"""Provider-agnostic market data types and the provider interface."""
from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field


class ProviderError(Exception):
    """Raised when a market data provider can't fulfil a request."""


@dataclass(frozen=True)
class InstrumentRef:
    symbol: str  # canonical symbol, e.g. AAPL / XAUUSD
    asset_class: str  # stock | etf | forex | metal | ...
    provider_symbols: dict = field(default_factory=dict)  # e.g. {"twelvedata": "XAU/USD"}

    def sym(self, provider: str) -> str:
        return self.provider_symbols.get(provider, self.symbol)


@dataclass
class Quote:
    symbol: str
    price: float
    prev_close: float | None = None
    change: float | None = None
    change_pct: float | None = None
    high: float | None = None
    low: float | None = None
    open: float | None = None
    volume: float | None = None
    ts: float = 0.0  # unix seconds

    def to_dict(self) -> dict:
        return asdict(self)

    def apply_price(self, price: float, ts: float) -> None:
        """Update with a live tick, recomputing change vs the previous close."""
        self.price = price
        self.ts = ts
        if self.prev_close:
            self.change = price - self.prev_close
            self.change_pct = self.change / self.prev_close * 100
        if self.high is not None:
            self.high = max(self.high, price)
        if self.low is not None:
            self.low = min(self.low, price)


@dataclass
class Tick:
    symbol: str
    price: float
    ts: float
    size: float = 0.0


@dataclass
class Candle:
    time: int  # unix seconds (UTC)
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None


TickHandler = Callable[[Tick], Awaitable[None]]


class MarketDataProvider(ABC):
    name: str

    async def start(self, on_tick: TickHandler) -> None:  # noqa: B027
        """Start any background streaming tasks."""

    async def stop(self) -> None:  # noqa: B027
        """Stop background tasks."""

    async def subscribe(self, ref: InstrumentRef) -> None:  # noqa: B027
        """Begin streaming ticks for `ref`."""

    async def unsubscribe(self, ref: InstrumentRef) -> None:  # noqa: B027
        """Stop streaming ticks for `ref`."""

    @abstractmethod
    async def get_quote(self, ref: InstrumentRef) -> Quote: ...

    @abstractmethod
    async def get_candles(self, ref: InstrumentRef, interval: str, limit: int) -> list[Candle]: ...

    @abstractmethod
    async def get_stats(self, ref: InstrumentRef) -> dict: ...
