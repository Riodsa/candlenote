from datetime import datetime
from decimal import Decimal
import hashlib
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_hub
from app.db.models.journal import ImportRecord, Trade, TradeSide
from app.db.session import get_session
from app.schemas.journal import (
    AccountOut,
    AccountUpdate,
    ImportRecordOut,
    ImportResponse,
    TradeJournalPatch,
    TradeOut,
    TradeReplayResponse,
    TradesListResponse,
)
from app.services.analytics.engine import detect_tilt_flags, resolve_tz
from app.services.market.hub import QuoteHub
from app.services.mt5.importer import get_or_create_default_account, import_mt5_file
from app.services.mt5.replay import build_trade_replay

router = APIRouter(tags=["journal"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


@router.get("/account", response_model=AccountOut)
async def get_account(session: AsyncSession = Depends(get_session)):
    return await get_or_create_default_account(session)


@router.put("/account", response_model=AccountOut)
async def update_account(body: AccountUpdate, session: AsyncSession = Depends(get_session)):
    acct = await get_or_create_default_account(session)
    if body.name is not None:
        acct.name = body.name.strip() or acct.name
    if body.currency is not None:
        acct.currency = body.currency.strip().upper()
    if body.server_utc_offset is not None:
        acct.server_utc_offset = body.server_utc_offset
    if body.display_timezone is not None:
        acct.display_timezone = body.display_timezone.strip()
    if body.initial_balance is not None:
        acct.initial_balance = body.initial_balance
    if body.tilt_revenge_minutes is not None:
        acct.tilt_revenge_minutes = body.tilt_revenge_minutes
    if body.tilt_size_up_multiplier is not None:
        acct.tilt_size_up_multiplier = body.tilt_size_up_multiplier
    if body.tilt_max_loss_streak is not None:
        acct.tilt_max_loss_streak = body.tilt_max_loss_streak
    await session.commit()
    await session.refresh(acct)
    return acct


@router.get("/imports", response_model=list[ImportRecordOut])
async def list_imports(session: AsyncSession = Depends(get_session)):
    acct = await get_or_create_default_account(session)
    rows = await session.scalars(
        select(ImportRecord)
        .where(ImportRecord.account_id == acct.id)
        .order_by(ImportRecord.imported_at.desc())
    )
    return list(rows.all())


@router.post("/imports", response_model=ImportResponse)
async def upload_mt5_report(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
):
    filename = file.filename or "report.html"
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext not in ("html", "htm", "xlsx", "xlsm"):
        raise HTTPException(400, "Unsupported file format. Please upload an MT5 .html or .xlsx report.")

    data = await file.read()
    if not data:
        raise HTTPException(400, "Uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File exceeds the 10 MB limit.")

    acct = await get_or_create_default_account(session)
    sha256 = hashlib.sha256(data).hexdigest()
    existed_before = (
        await session.scalar(
            select(ImportRecord.id).where(
                ImportRecord.account_id == acct.id,
                ImportRecord.file_sha256 == sha256,
            )
        )
    ) is not None

    try:
        imp, acct = await import_mt5_file(session, data, filename)
    except Exception as e:
        raise HTTPException(400, f"Could not parse MT5 report: {e}") from e

    return ImportResponse(
        import_record=ImportRecordOut.model_validate(imp),
        account=AccountOut.model_validate(acct),
        already_imported=existed_before,
    )


@router.get("/trades", response_model=TradesListResponse)
async def list_trades(
    symbol: str | None = Query(default=None),
    side: TradeSide | None = Query(default=None),
    outcome: str | None = Query(default=None, pattern="^(win|loss|breakeven)$"),
    tag: str | None = Query(default=None),
    tilt: str | None = Query(default=None, pattern="^(any|revenge|size_up|after_loss_streak|no_sl)$"),
    date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    session: AsyncSession = Depends(get_session),
):
    acct = await get_or_create_default_account(session)
    all_res = await session.scalars(
        select(Trade)
        .where(Trade.account_id == acct.id)
        .order_by(Trade.close_time.desc(), Trade.ticket.desc())
    )
    all_trades = list(all_res.all())
    tilt_map = detect_tilt_flags(all_trades, acct)
    tz = resolve_tz(acct.display_timezone or "Asia/Bangkok")

    symbols = sorted({t.symbol for t in all_trades})
    tags = sorted({t.setup_tag for t in all_trades if t.setup_tag})

    filtered: list[Trade] = []
    sym_upper = symbol.strip().upper() if symbol else None
    tag_clean = tag.strip() if tag else None
    for t in all_trades:
        if sym_upper and t.symbol.upper() != sym_upper and t.normalized_symbol.upper() != sym_upper:
            continue
        if side and t.side != side:
            continue
        pnl = Decimal(str(t.net_pnl or 0))
        if outcome == "win" and pnl <= 0:
            continue
        if outcome == "loss" and pnl >= 0:
            continue
        if outcome == "breakeven" and pnl != 0:
            continue
        if tag_clean and t.setup_tag != tag_clean:
            continue
        flags = tilt_map.get(t.ticket, [])
        if tilt == "any" and not flags:
            continue
        if tilt and tilt != "any" and tilt not in flags:
            continue
        if date and t.close_time.astimezone(tz).strftime("%Y-%m-%d") != date:
            continue
        if date_from and t.close_time < date_from:
            continue
        if date_to and t.close_time > date_to:
            continue
        filtered.append(t)

    wins = sum(1 for t in filtered if (t.net_pnl or 0) > 0)
    losses = sum(1 for t in filtered if (t.net_pnl or 0) < 0)
    net_pnl = sum((Decimal(str(t.net_pnl or 0)) for t in filtered), Decimal("0"))
    gross_profit = sum((Decimal(str(t.net_pnl)) for t in filtered if (t.net_pnl or 0) > 0), Decimal("0"))
    gross_loss = sum((Decimal(str(t.net_pnl)) for t in filtered if (t.net_pnl or 0) < 0), Decimal("0"))

    page = filtered[offset : offset + limit]
    items = [
        TradeOut.model_validate(t).model_copy(update={"tilt_flags": tilt_map.get(t.ticket, [])})
        for t in page
    ]

    return TradesListResponse(
        account=AccountOut.model_validate(acct),
        total=len(filtered),
        wins=wins,
        losses=losses,
        net_pnl=net_pnl,
        gross_profit=gross_profit,
        gross_loss=gross_loss,
        symbols=symbols,
        tags=tags,
        items=items,
    )


@router.patch("/trades/{trade_id}", response_model=TradeOut)
async def update_trade_journal(
    trade_id: uuid.UUID,
    body: TradeJournalPatch,
    session: AsyncSession = Depends(get_session),
):
    acct = await get_or_create_default_account(session)
    trade = await session.scalar(
        select(Trade).where(Trade.id == trade_id, Trade.account_id == acct.id)
    )
    if trade is None:
        raise HTTPException(404, "Trade not found")

    fields_set = body.model_fields_set
    if "setup_tag" in fields_set:
        trade.setup_tag = (body.setup_tag or "").strip() or None
    if "notes" in fields_set:
        trade.notes = (body.notes or "").strip() or None
    if "rating" in fields_set:
        trade.rating = body.rating

    await session.commit()
    await session.refresh(trade)
    return trade


@router.get("/trades/{trade_id}/replay", response_model=TradeReplayResponse)
async def get_trade_replay(
    trade_id: uuid.UUID,
    interval: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    hub: QuoteHub = Depends(get_hub),
):
    acct = await get_or_create_default_account(session)
    trade = await session.scalar(
        select(Trade).where(Trade.id == trade_id, Trade.account_id == acct.id)
    )
    if trade is None:
        raise HTTPException(404, "Trade not found")
    return await build_trade_replay(session, hub, trade, interval=interval)

