from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.analytics import AnalyticsResponse
from app.services.analytics.engine import build_analytics
from app.services.mt5.importer import get_or_create_default_account

router = APIRouter(tags=["analytics"])


@router.get("/analytics", response_model=AnalyticsResponse)
async def get_analytics(
    days: int | None = Query(default=None, ge=1, le=3650),
    symbol: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    acct = await get_or_create_default_account(session)
    return await build_analytics(session, acct, days=days, symbol=symbol)
