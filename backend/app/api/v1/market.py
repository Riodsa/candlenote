from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_fx, get_hub
from app.db.models.instrument import Instrument
from app.db.session import get_session
from app.services.market.fx import FxRates
from app.services.market.hub import QuoteHub, ref_from_instrument
from app.services.market.twelvedata import INTERVALS

router = APIRouter(prefix="/market", tags=["market"])


async def _ref(session: AsyncSession, symbol: str):
    instrument = await session.scalar(select(Instrument).where(Instrument.symbol == symbol.upper()))
    if instrument is None:
        raise HTTPException(404, f"Unknown symbol: {symbol}")
    return ref_from_instrument(instrument)


@router.get("/status")
async def status(hub: QuoteHub = Depends(get_hub)):
    """Which providers have API keys configured (lets the UI show a setup hint)."""
    return {"finnhub": hub.finnhub.configured, "twelvedata": hub.twelvedata.configured}


@router.get("/fx-rates")
async def fx_rates(fx: FxRates = Depends(get_fx)):
    """Cached USD-per-unit conversion rates for display currencies."""
    return await fx.get_rates()


@router.get("/quote/{symbol}")
async def quote(symbol: str, session: AsyncSession = Depends(get_session), hub: QuoteHub = Depends(get_hub)):
    return (await hub.get_quote(await _ref(session, symbol))).to_dict()


@router.get("/candles/{symbol}")
async def candles(
    symbol: str,
    interval: str = Query("1day"),
    limit: int = Query(300, ge=1, le=2000),
    session: AsyncSession = Depends(get_session),
    hub: QuoteHub = Depends(get_hub),
):
    if interval not in INTERVALS:
        raise HTTPException(400, f"interval must be one of {sorted(INTERVALS)}")
    data = await hub.get_candles(await _ref(session, symbol), interval, limit)
    return [asdict(c) for c in data]


@router.get("/stats/{symbol}")
async def stats(symbol: str, session: AsyncSession = Depends(get_session), hub: QuoteHub = Depends(get_hub)):
    ref = await _ref(session, symbol)
    quote = await hub.get_quote(ref)
    return {"symbol": ref.symbol, "volume": quote.volume, **await hub.get_stats(ref)}
