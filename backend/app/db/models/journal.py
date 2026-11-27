import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CHAR,
    CheckConstraint,
     Computed,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

DEFAULT_ACCOUNT_ID = uuid.UUID("00000000-0000-0000-0000-000000000002")


class TradeSide(str, enum.Enum):
    buy = "buy"
    sell = "sell"


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("user_id", "mt5_login"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False, default="Main Trading Account")
    broker: Mapped[str | None] = mapped_column(Text)
    mt5_login: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(CHAR(3), nullable=False, default="USD")
    base_currency: Mapped[str] = mapped_column(CHAR(3), nullable=False, default="USD")
    server_utc_offset: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)  # minutes
    display_timezone: Mapped[str] = mapped_column(Text, nullable=False, default="Asia/Bangkok")
    initial_balance: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    tilt_revenge_minutes: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=5)
    tilt_size_up_multiplier: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=Decimal("1.50"))
    tilt_max_loss_streak: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=3)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ImportRecord(Base):
    __tablename__ = "imports"
    __table_args__ = (
        UniqueConstraint("account_id", "file_sha256"),
        CheckConstraint("format IN ('html', 'xlsx')", name="imports_format_check"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    file_sha256: Mapped[str] = mapped_column(CHAR(64), nullable=False)
    format: Mapped[str] = mapped_column(Text, nullable=False)
    rows_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_inserted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_duplicate: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deals_inserted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reported_net_pnl: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    parsed_net_pnl: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    errors: Mapped[list | None] = mapped_column(JSONB)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Trade(Base):
    __tablename__ = "trades"
    __table_args__ = (
        UniqueConstraint("account_id", "ticket"),
        CheckConstraint("rating IS NULL OR (rating BETWEEN 1 AND 5)", name="trades_rating_check"),
        Index("trades_acct_close", "account_id", "close_time"),
        Index("trades_acct_symbol", "account_id", "symbol"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )
    import_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("imports.id", ondelete="SET NULL")
    )
    ticket: Mapped[int] = mapped_column(BigInteger, nullable=False)
    symbol: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_symbol: Mapped[str] = mapped_column(Text, nullable=False)
    instrument_id: Mapped[int | None] = mapped_column(ForeignKey("instruments.id"))
    side: Mapped[TradeSide] = mapped_column(
        SAEnum(TradeSide, name="trade_side", values_callable=lambda e: [x.value for x in e]),
        nullable=False,
    )
    volume: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False)
    open_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    close_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    open_price: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    close_price: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    stop_loss: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    take_profit: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    commission: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    swap: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    fee: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    profit: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    net_pnl: Mapped[Decimal] = mapped_column(
        Numeric(18, 2), Computed("profit + commission + swap + fee", persisted=True)
    )
    close_reason: Mapped[str | None] = mapped_column(Text)  # tp | sl | so | manual
    comment: Mapped[str | None] = mapped_column(Text)
    setup_tag: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    rating: Mapped[int | None] = mapped_column(SmallInteger)


class Deal(Base):
    __tablename__ = "deals"
    __table_args__ = (UniqueConstraint("account_id", "deal_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )
    import_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("imports.id", ondelete="SET NULL")
    )
    deal_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    order_id: Mapped[int | None] = mapped_column(BigInteger)
    position_id: Mapped[int | None] = mapped_column(BigInteger)
    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    symbol: Mapped[str | None] = mapped_column(Text)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    direction: Mapped[str | None] = mapped_column(Text)
    volume: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    price: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    commission: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    fee: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    swap: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    profit: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=Decimal("0"))
    balance: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    comment: Mapped[str | None] = mapped_column(Text)
