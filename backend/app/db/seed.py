from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.instrument import Instrument
from app.db.models.journal import Account, DEFAULT_ACCOUNT_ID
from app.db.models.user import DEFAULT_USER_ID, User

SEED_STOCKS = [
    ("AAPL", "Apple Inc.", "stock", "NASDAQ"),
    ("MSFT", "Microsoft Corp.", "stock", "NASDAQ"),
    ("NVDA", "NVIDIA Corp.", "stock", "NASDAQ"),
    ("GOOGL", "Alphabet Inc. Class A", "stock", "NASDAQ"),
    ("AMZN", "Amazon.com Inc.", "stock", "NASDAQ"),
    ("META", "Meta Platforms Inc.", "stock", "NASDAQ"),
    ("TSLA", "Tesla Inc.", "stock", "NASDAQ"),
    ("SPY", "SPDR S&P 500 ETF Trust", "etf", "NYSE Arca"),
    ("QQQ", "Invesco QQQ Trust", "etf", "NASDAQ"),
    ("VTI", "Vanguard Total Stock Market ETF", "etf", "NYSE Arca"),
    ("IWM", "iShares Russell 2000 ETF", "etf", "NYSE Arca"),
    ("DIA", "SPDR Dow Jones Industrial Average ETF", "etf", "NYSE Arca"),
    ("GLD", "SPDR Gold Shares", "etf", "NYSE Arca"),
]


async def seed(session: AsyncSession) -> None:
    """Idempotent: default single user + default account + a starter set of instruments."""
    await session.execute(insert(User).values(id=DEFAULT_USER_ID).on_conflict_do_nothing())
    await session.execute(
        insert(Account)
        .values(
            id=DEFAULT_ACCOUNT_ID,
            user_id=DEFAULT_USER_ID,
            name="Main Trading Account",
            currency="USD",
            server_utc_offset=0,
            display_timezone="Asia/Bangkok",
        )
        .on_conflict_do_nothing()
    )
    rows = [
        {"symbol": s, "name": n, "asset_class": c, "exchange": x, "currency": "USD", "provider_ref": None}
        for s, n, c, x in SEED_STOCKS
    ]
    xau_ref = {"twelvedata": "XAU/USD"}
    rows.append(
        {
            "symbol": "XAUUSD",
            "name": "Gold Spot / US Dollar",
            "asset_class": "metal",
            "exchange": "OTC",
            "currency": "USD",
            "provider_ref": xau_ref,
        }
    )
    # Every row must carry the same keys: a multi-row insert only uses the first row's columns.
    await session.execute(insert(Instrument).values(rows).on_conflict_do_nothing(index_elements=["symbol"]))
    # Backfill for databases seeded before provider_ref was included.
    await session.execute(
        update(Instrument)
        .where(Instrument.symbol == "XAUUSD", Instrument.provider_ref.is_(None))
        .values(provider_ref=xau_ref)
    )
    await session.commit()
