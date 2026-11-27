"""MT5 report database importer: deduplicates by (account_id, ticket) and (account_id, deal_id)."""
from __future__ import annotations

import asyncio
from decimal import Decimal
import hashlib
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.instrument import Instrument
from app.db.models.journal import Account, DEFAULT_ACCOUNT_ID, Deal, ImportRecord, Trade, TradeSide
from app.services.mt5.parser import ParsedReport, parse_mt5_report


async def get_or_create_default_account(session: AsyncSession) -> Account:
    acct = await session.scalar(select(Account).where(Account.id == DEFAULT_ACCOUNT_ID))
    if acct is None:
        acct = await session.scalar(select(Account).limit(1))
    if acct is None:
        raise RuntimeError("Default trading account is not seeded")
    return acct


async def import_mt5_file(
    session: AsyncSession,
    data: bytes,
    filename: str,
) -> tuple[ImportRecord, Account]:
    acct = await get_or_create_default_account(session)
    sha256 = hashlib.sha256(data).hexdigest()

    existing = await session.scalar(
        select(ImportRecord).where(
            ImportRecord.account_id == acct.id,
            ImportRecord.file_sha256 == sha256,
        )
    )
    if existing is not None:
        return existing, acct

    report: ParsedReport = await asyncio.to_thread(
        parse_mt5_report, data, filename, acct.server_utc_offset
    )

    # Update account metadata if detected in the report
    if report.currency and len(report.currency) == 3:
        acct.base_currency = report.currency.upper()
        acct.currency = report.currency.upper()
    if report.mt5_login:
        acct.mt5_login = report.mt5_login
    if report.broker:
        acct.broker = report.broker
    if report.account_name:
        acct.name = report.account_name

    # Map known instruments by canonical symbol
    known_instruments = {
        i.symbol: i.id for i in (await session.scalars(select(Instrument))).all()
    }

    parsed_net = sum(
        (p.profit + p.commission + p.swap + p.fee for p in report.positions),
        Decimal("0"),
    )

    imp_id = uuid.uuid4()
    imp = ImportRecord(
        id=imp_id,
        account_id=acct.id,
        filename=filename,
        file_sha256=sha256,
        format=report.format,
        rows_total=report.rows_total,
        rows_inserted=0,
        rows_duplicate=0,
        rows_skipped=report.rows_skipped,
        deals_inserted=0,
        reported_net_pnl=report.reported_net_pnl,
        parsed_net_pnl=parsed_net,
        errors=report.errors or None,
    )
    session.add(imp)
    await session.flush()

    inserted_trades = 0
    if report.positions:
        trade_rows = [
            {
                "account_id": acct.id,
                "import_id": imp_id,
                "ticket": p.ticket,
                "symbol": p.symbol,
                "normalized_symbol": p.normalized_symbol,
                "instrument_id": known_instruments.get(p.normalized_symbol),
                "side": TradeSide(p.side),
                "volume": p.volume,
                "open_time": p.open_time,
                "close_time": p.close_time,
                "open_price": p.open_price,
                "close_price": p.close_price,
                "stop_loss": p.stop_loss,
                "take_profit": p.take_profit,
                "commission": p.commission,
                "swap": p.swap,
                "fee": p.fee,
                "profit": p.profit,
                "close_reason": p.close_reason,
                "comment": p.comment,
            }
            for p in report.positions
        ]
        stmt = (
            insert(Trade)
            .values(trade_rows)
            .on_conflict_do_nothing(index_elements=["account_id", "ticket"])
            .returning(Trade.id)
        )
        res = await session.scalars(stmt)
        inserted_trades = len(res.all())

    inserted_deals = 0
    if report.deals:
        deal_rows = [
            {
                "account_id": acct.id,
                "import_id": imp_id,
                "deal_id": d.deal_id,
                "order_id": d.order_id,
                "position_id": None,
                "time": d.time,
                "symbol": d.symbol,
                "type": d.type,
                "direction": d.direction,
                "volume": d.volume,
                "price": d.price,
                "commission": d.commission,
                "fee": d.fee,
                "swap": d.swap,
                "profit": d.profit,
                "balance": d.balance,
                "comment": d.comment,
            }
            for d in report.deals
        ]
        d_stmt = (
            insert(Deal)
            .values(deal_rows)
            .on_conflict_do_nothing(index_elements=["account_id", "deal_id"])
            .returning(Deal.id)
        )
        d_res = await session.scalars(d_stmt)
        inserted_deals = len(d_res.all())

    imp.rows_inserted = inserted_trades
    imp.rows_duplicate = len(report.positions) - inserted_trades
    imp.deals_inserted = inserted_deals

    await session.commit()
    await session.refresh(imp)
    await session.refresh(acct)
    return imp, acct
