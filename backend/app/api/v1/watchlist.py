from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_hub
from app.db.models.instrument import AssetClass, Instrument
from app.db.models.user import DEFAULT_USER_ID
from app.db.models.watchlist import WatchlistItem
from app.db.session import get_session
from app.schemas.watchlist import SearchResult, WatchlistAdd, WatchlistItemOut, WatchlistReorder
from app.services.market.base import ProviderError
from app.services.market.hub import QuoteHub, ref_from_instrument

router = APIRouter(tags=["watchlist"])


async def _list(session: AsyncSession) -> list[WatchlistItem]:
    res = await session.scalars(
        select(WatchlistItem)
        .where(WatchlistItem.user_id == DEFAULT_USER_ID)
        .order_by(WatchlistItem.position, WatchlistItem.added_at)
    )
    return list(res.unique())


@router.get("/watchlist", response_model=list[WatchlistItemOut])
async def list_watchlist(session: AsyncSession = Depends(get_session)):
    return await _list(session)


@router.post("/watchlist", response_model=WatchlistItemOut, status_code=201)
async def add_to_watchlist(
    body: WatchlistAdd,
    session: AsyncSession = Depends(get_session),
    hub: QuoteHub = Depends(get_hub),
):
    symbol = body.symbol.strip().upper()
    instrument = await session.scalar(select(Instrument).where(Instrument.symbol == symbol))
    if instrument is None:
        # Unknown ticker: validate it against Finnhub before creating it (US stocks/ETFs only).
        asset_class = body.asset_class or AssetClass.stock
        if asset_class not in (AssetClass.stock, AssetClass.etf):
            raise HTTPException(400, f"{symbol} isn't a known instrument; only stocks/ETFs can be added ad hoc")
        try:
            await hub.finnhub.get_quote(ref_from_instrument(Instrument(symbol=symbol, asset_class=asset_class)))
        except ProviderError as e:
            raise HTTPException(400, f"Can't add {symbol}: {e}") from e
        instrument = Instrument(symbol=symbol, name=body.name, asset_class=asset_class, currency="USD")
        session.add(instrument)
        await session.flush()

    next_pos = await session.scalar(
        select(func.coalesce(func.max(WatchlistItem.position), -1) + 1).where(
            WatchlistItem.user_id == DEFAULT_USER_ID
        )
    )
    item = WatchlistItem(user_id=DEFAULT_USER_ID, instrument_id=instrument.id, position=next_pos)
    session.add(item)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, f"{symbol} is already on the watchlist") from None
    await session.refresh(item)
    return item


@router.delete("/watchlist/{symbol}", status_code=204)
async def remove_from_watchlist(symbol: str, session: AsyncSession = Depends(get_session)):
    item = await session.scalar(
        select(WatchlistItem)
        .join(Instrument)
        .where(WatchlistItem.user_id == DEFAULT_USER_ID, Instrument.symbol == symbol.upper())
    )
    if item is None:
        raise HTTPException(404, "Not on the watchlist")
    await session.delete(item)
    await session.commit()
    return Response(status_code=204)


@router.put("/watchlist/order", response_model=list[WatchlistItemOut])
async def reorder_watchlist(body: WatchlistReorder, session: AsyncSession = Depends(get_session)):
    items = await _list(session)
    pos = {s.upper(): i for i, s in enumerate(body.symbols)}
    for item in items:
        item.position = pos.get(item.instrument.symbol, len(pos) + item.position)
    await session.commit()
    return await _list(session)


@router.get("/instruments/search", response_model=list[SearchResult])
async def search_instruments(
    q: str, session: AsyncSession = Depends(get_session), hub: QuoteHub = Depends(get_hub)
):
    q = q.strip()
    if not q:
        return []
    like = f"%{q}%"
    rows = await session.scalars(
        select(Instrument)
        .where(Instrument.symbol.ilike(like) | Instrument.name.ilike(like))
        .order_by(Instrument.symbol)
        .limit(10)
    )
    results = [SearchResult(symbol=i.symbol, name=i.name, asset_class=i.asset_class) for i in rows]
    if len(results) < 5 and hub.finnhub.configured:
        known = {r.symbol for r in results}
        try:
            for r in await hub.finnhub.search(q):
                if r["symbol"] not in known:
                    results.append(SearchResult(**r))
        except ProviderError:
            pass  # local results are still useful
    return results[:10]
