import asyncio

import httpx
import pytest

from app.services.market.base import (
    Candle,
    InstrumentRef,
    MarketDataProvider,
    ProviderError,
    Quote,
    Tick,
)
from app.services.market.finnhub import FinnhubProvider
from app.services.market.fx import FALLBACK_USD_PER_UNIT, FxRates
from app.services.market.hub import Client, QuoteHub
from app.services.market.twelvedata import TwelveDataProvider


class FakeProvider(MarketDataProvider):
    name = "fake"

    def __init__(self, volume=None):
        self.subscribed: list[str] = []
        self.unsubscribed: list[str] = []
        self.quote_calls = 0
        self.volume = volume

    async def subscribe(self, ref):
        self.subscribed.append(ref.symbol)

    async def unsubscribe(self, ref):
        self.unsubscribed.append(ref.symbol)

    async def get_quote(self, ref):
        self.quote_calls += 1
        return Quote(symbol=ref.symbol, price=110.0, prev_close=100.0, change=10.0,
                     change_pct=10.0, high=111.0, low=99.0, volume=self.volume)

    async def get_candles(self, ref, interval, limit):
        return [Candle(1, 1, 2, 0.5, 1.5)]

    async def get_stats(self, ref):
        return {}


AAPL = InstrumentRef("AAPL", "stock")
XAU = InstrumentRef("XAUUSD", "metal", {"twelvedata": "XAU/USD"})


def make_hub(fh=None, td=None):
    hub = QuoteHub(fh or FakeProvider(), td or FakeProvider(volume=5000))
    hub.THROTTLE = 0
    return hub


async def drain(client: Client):
    out = []
    while not client.queue.empty():
        out.append(client.queue.get_nowait())
    return out


async def test_routing_by_asset_class():
    hub = make_hub()
    c = Client()
    await hub.subscribe(c, [AAPL, XAU])
    assert hub.finnhub.subscribed == ["AAPL"]
    assert hub.twelvedata.subscribed == ["XAUUSD"]


async def test_upstream_subscription_is_refcounted():
    hub = make_hub()
    a, b = Client(), Client()
    await hub.subscribe(a, [AAPL])
    await hub.subscribe(b, [AAPL])
    assert hub.finnhub.subscribed == ["AAPL"]  # one upstream sub for two clients
    await hub.unsubscribe(a, ["AAPL"])
    assert hub.finnhub.unsubscribed == []
    await hub.disconnect(b)
    assert hub.finnhub.unsubscribed == ["AAPL"]


async def test_snapshot_pushed_and_volume_borrowed_from_twelvedata():
    hub = make_hub()
    c = Client()
    await hub.subscribe(c, [AAPL])
    msgs = await drain(c)
    assert msgs[0]["type"] == "quote"
    assert msgs[0]["data"]["volume"] == 5000


async def test_tick_updates_change_pct_and_fans_out():
    hub = make_hub()
    a, b = Client(), Client()
    await hub.subscribe(a, [AAPL])
    await hub.subscribe(b, [AAPL])
    await drain(a), await drain(b)
    await hub._on_tick(Tick("AAPL", 120.0, 1.0))
    for c in (a, b):
        (msg,) = await drain(c)
        assert msg["data"]["price"] == 120.0
        assert msg["data"]["change_pct"] == pytest.approx(20.0)
        assert msg["data"]["high"] == 120.0


async def test_snapshot_cached_between_subscribers():
    hub = make_hub()
    await hub.subscribe(Client(), [AAPL])
    await hub.subscribe(Client(), [AAPL])
    assert hub.finnhub.quote_calls == 1


async def test_failed_snapshot_reports_error_to_client():
    class Broken(FakeProvider):
        async def get_quote(self, ref):
            raise ProviderError("no key")

    hub = make_hub(fh=Broken())
    c = Client()
    await hub.subscribe(c, [AAPL])
    (msg,) = await drain(c)
    assert msg == {"type": "error", "symbol": "AAPL", "message": "no key"}


async def test_tick_before_snapshot_is_ignored():
    hub = make_hub()
    await hub._on_tick(Tick("AAPL", 1.0, 1.0))  # must not raise


# -- provider parsing (HTTP mocked) -----------------------------------------
def mock_client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_finnhub_quote_parsing_and_unknown_symbol():
    def handler(req: httpx.Request):
        if req.url.params["symbol"] == "NOPE":
            return httpx.Response(200, json={"c": 0, "d": None, "dp": None, "h": 0, "l": 0, "o": 0, "pc": 0, "t": 0})
        return httpx.Response(200, json={"c": 191.5, "d": 1.5, "dp": 0.79, "h": 192, "l": 189, "o": 190, "pc": 190, "t": 1700000000})

    async with mock_client(handler) as client:
        p = FinnhubProvider("key", client)
        q = await p.get_quote(AAPL)
        assert (q.price, q.prev_close, q.change_pct) == (191.5, 190, 0.79)
        with pytest.raises(ProviderError):
            await p.get_quote(InstrumentRef("NOPE", "stock"))


async def test_missing_api_key_raises_provider_error():
    async with mock_client(lambda r: httpx.Response(200, json={})) as client:
        with pytest.raises(ProviderError, match="FINNHUB_API_KEY"):
            await FinnhubProvider("", client).get_quote(AAPL)


async def test_twelvedata_candles_sorted_ascending_and_symbol_mapped():
    seen = {}

    def handler(req: httpx.Request):
        seen["symbol"] = req.url.params["symbol"]
        return httpx.Response(200, json={"values": [
            {"datetime": "2024-01-03", "open": "2", "high": "3", "low": "1", "close": "2.5", "volume": "10"},
            {"datetime": "2024-01-02", "open": "1", "high": "2", "low": "0.5", "close": "1.5"},
        ]})

    async with mock_client(handler) as client:
        candles = await TwelveDataProvider("key", client).get_candles(XAU, "1day", 2)
    assert seen["symbol"] == "XAU/USD"
    assert [c.time for c in candles] == sorted(c.time for c in candles)
    assert candles[0].close == 1.5 and candles[0].volume is None
    assert candles[1].volume == 10


async def test_twelvedata_error_payload_raises():
    async with mock_client(lambda r: httpx.Response(200, json={"status": "error", "message": "bad key"})) as client:
        with pytest.raises(ProviderError, match="bad key"):
            await TwelveDataProvider("key", client).get_quote(XAU)


async def test_twelvedata_ws_price_event_emits_tick():
    got = []

    async def on_tick(t):
        got.append(t)

    async with mock_client(lambda r: httpx.Response(200, json={})) as client:
        p = TwelveDataProvider("key", client)
        p._on_tick = on_tick
        p._subs["XAU/USD"] = XAU
        await p._handle({"event": "subscribe-status", "success": [{"symbol": "XAU/USD"}], "fails": []})
        await p._handle({"event": "price", "symbol": "XAU/USD", "price": 2650.5, "timestamp": 1700000000})
    assert "XAU/USD" in p._streaming
    assert got[0].symbol == "XAUUSD" and got[0].price == 2650.5


async def test_twelvedata_candles_drop_duplicate_timestamps():
    """Regression: Twelve Data repeated a daily timestamp for XAU/USD, which crashes the chart."""
    rows = [
        {"datetime": "2024-01-03", "open": "3", "high": "4", "low": "2", "close": "3.5"},
        {"datetime": "2024-01-02", "open": "2", "high": "3", "low": "1", "close": "2.5"},
        {"datetime": "2024-01-02", "open": "9", "high": "9", "low": "9", "close": "9"},
    ]
    async with mock_client(lambda r: httpx.Response(200, json={"values": rows})) as client:
        candles = await TwelveDataProvider("key", client).get_candles(XAU, "1day", 3)
    times = [c.time for c in candles]
    assert times == sorted(set(times)) and len(times) == 2
    assert candles[0].close == 2.5  # first (newest) row for the duplicated timestamp wins


async def test_fx_rates_fetches_caches_and_falls_back():
    calls = 0

    def ok_handler(req: httpx.Request):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"base": "USD", "rates": {"THB": 35.0, "EUR": 0.9}})

    async with mock_client(ok_handler) as client:
        fx = FxRates(client)
        r1 = await fx.get_rates()
        r2 = await fx.get_rates()
        assert calls == 1
        assert r1["source"] == "frankfurter"
        assert r1["usd_per_unit"]["THB"] == pytest.approx(1 / 35.0)
        assert r1["usd_per_unit"]["EUR"] == pytest.approx(1 / 0.9)
        assert r1["usd_per_unit"]["USC"] == 0.01
        assert r2 == r1

    def err_handler(req: httpx.Request):
        raise httpx.ConnectError("offline")

    async with mock_client(err_handler) as client:
        fb = await FxRates(client).get_rates()
        assert fb["source"] == "fallback"
        assert fb["usd_per_unit"] == FALLBACK_USD_PER_UNIT
