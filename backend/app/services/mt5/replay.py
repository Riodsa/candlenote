from datetime import datetime, timedelta, timezone
import math
import random

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.instrument import Instrument
from app.db.models.journal import Trade
from app.schemas.journal import ReplayCandleOut, TradeReplayResponse
from app.services.market.base import InstrumentRef
from app.services.market.hub import QuoteHub, ref_from_instrument

INTERVAL_SECONDS: dict[str, int] = {
    "1min": 60,
    "5min": 300,
    "15min": 900,
    "1h": 3600,
    "1day": 86400,
}

CCY_CODES = {"USD", "EUR", "JPY", "GBP", "AUD", "CAD", "CHF", "NZD", "XAU", "XAG", "BTC", "ETH"}


def choose_replay_interval(open_time: datetime, close_time: datetime) -> str:
    dur = max(0.0, (close_time - open_time).total_seconds())
    if dur <= 45 * 60:
        return "1min"
    if dur <= 4 * 3600:
        return "5min"
    if dur <= 24 * 3600:
        return "15min"
    return "1h"


async def resolve_replay_ref(session: AsyncSession, symbol: str) -> InstrumentRef:
    sym = symbol.upper()
    inst = await session.scalar(select(Instrument).where(Instrument.symbol == sym))
    if inst is not None:
        return ref_from_instrument(inst)

    td_sym = sym
    if len(sym) == 6 and sym[:3] in CCY_CODES and sym[3:] in CCY_CODES:
        td_sym = f"{sym[:3]}/{sym[3:]}"
    return InstrumentRef(symbol=sym, asset_class="forex", provider_symbols={"twelvedata": td_sym})


def _snap_candle_time(candle_times: list[int], target_ts: int) -> int:
    le = [t for t in candle_times if t <= target_ts]
    if le:
        return le[-1]
    return min(candle_times, key=lambda t: abs(t - target_ts))


def _build_synthetic_replay(trade: Trade, interval: str) -> TradeReplayResponse:
    step = INTERVAL_SECONDS.get(interval, 60)
    open_ts = int(trade.open_time.timestamp()) // step * step
    close_ts = max(open_ts + step, int(trade.close_time.timestamp()) // step * step)

    open_p = float(trade.open_price)
    close_p = float(trade.close_price)
    diff = abs(close_p - open_p)
    unit = max(diff * 0.18, open_p * 0.0006, 0.05)

    n_hold = max(1, min(60, (close_ts - open_ts) // step))
    close_ts = open_ts + n_hold * step

    rng = random.Random(int(trade.ticket))
    candles: list[ReplayCandleOut] = []

    # 18 bars leading up to open_ts
    pre_prices = [open_p]
    for _ in range(18):
        pre_prices.append(pre_prices[-1] + rng.uniform(-unit, unit))
    pre_prices.reverse()

    for idx in range(18):
        t = open_ts - (18 - idx) * step
        o = pre_prices[idx]
        c = pre_prices[idx + 1]
        h = max(o, c) + rng.uniform(0.1 * unit, 0.7 * unit)
        l = min(o, c) - rng.uniform(0.1 * unit, 0.7 * unit)
        candles.append(ReplayCandleOut(time=t, open=round(o, 5), high=round(h, 5), low=round(l, 5), close=round(c, 5)))

    # Hold bars from open_ts to close_ts
    cur = open_p
    for i in range(n_hold + 1):
        t = open_ts + i * step
        progress = i / max(1, n_hold)
        target = open_p + (close_p - open_p) * progress
        wave = math.sin(progress * math.pi) * rng.uniform(-0.6 * unit, 0.6 * unit)
        nxt = close_p if i == n_hold else target + wave + rng.uniform(-0.35 * unit, 0.35 * unit)
        o = open_p if i == 0 else cur
        c = nxt
        h = max(o, c) + rng.uniform(0.15 * unit, 0.65 * unit)
        l = min(o, c) - rng.uniform(0.15 * unit, 0.65 * unit)
        if i == 0:
            h = max(h, open_p)
            l = min(l, open_p)
        if i == n_hold:
            h = max(h, close_p)
            l = min(l, close_p)
        candles.append(ReplayCandleOut(time=t, open=round(o, 5), high=round(h, 5), low=round(l, 5), close=round(c, 5)))
        cur = c

    # 12 bars after close_ts
    for i in range(1, 13):
        t = close_ts + i * step
        o = cur
        c = o + rng.uniform(-0.8 * unit, 0.8 * unit)
        h = max(o, c) + rng.uniform(0.1 * unit, 0.6 * unit)
        l = min(o, c) - rng.uniform(0.1 * unit, 0.6 * unit)
        candles.append(ReplayCandleOut(time=t, open=round(o, 5), high=round(h, 5), low=round(l, 5), close=round(c, 5)))
        cur = c

    return TradeReplayResponse(
        trade_id=trade.id,
        symbol=trade.normalized_symbol,
        interval=interval,
        source="synthetic",
        entry_candle_time=open_ts,
        exit_candle_time=close_ts,
        candles=candles,
    )


async def build_trade_replay(
    session: AsyncSession,
    hub: QuoteHub,
    trade: Trade,
    interval: str | None = None,
) -> TradeReplayResponse:
    chosen = interval if interval in INTERVAL_SECONDS else choose_replay_interval(trade.open_time, trade.close_time)
    step = INTERVAL_SECONDS[chosen]

    start_dt = trade.open_time.astimezone(timezone.utc) - timedelta(seconds=step * 40)
    end_dt = trade.close_time.astimezone(timezone.utc) + timedelta(seconds=step * 25)
    start_str = start_dt.strftime("%Y-%m-%d %H:%M:%S")
    end_str = end_dt.strftime("%Y-%m-%d %H:%M:%S")

    try:
        ref = await resolve_replay_ref(session, trade.normalized_symbol)
        raw_candles = await hub.get_candles(
            ref, chosen, limit=250, start_date=start_str, end_date=end_str
        )
    except Exception:
        raw_candles = []

    if len(raw_candles) < 2:
        return _build_synthetic_replay(trade, chosen)

    times = [c.time for c in raw_candles]
    open_ts = int(trade.open_time.timestamp())
    close_ts = int(trade.close_time.timestamp())
    entry_time = _snap_candle_time(times, open_ts)
    exit_time = _snap_candle_time(times, close_ts)

    open_p = float(trade.open_price)
    close_p = float(trade.close_price)

    out_candles: list[ReplayCandleOut] = []
    for c in raw_candles:
        hi = c.high
        lo = c.low
        if c.time == entry_time:
            hi = max(hi, open_p)
            lo = min(lo, open_p)
        if c.time == exit_time:
            hi = max(hi, close_p)
            lo = min(lo, close_p)
        out_candles.append(
            ReplayCandleOut(
                time=c.time,
                open=c.open,
                high=hi,
                low=lo,
                close=c.close,
                volume=c.volume,
            )
        )

    return TradeReplayResponse(
        trade_id=trade.id,
        symbol=trade.normalized_symbol,
        interval=chosen,
        source="twelvedata",
        entry_candle_time=entry_time,
        exit_candle_time=exit_time,
        candles=out_candles,
    )
