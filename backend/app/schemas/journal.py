from datetime import datetime
from decimal import Decimal
import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.db.models.journal import TradeSide


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    broker: str | None = None
    mt5_login: str | None = None
    currency: str
    base_currency: str
    server_utc_offset: int
    display_timezone: str
    initial_balance: Decimal
    tilt_revenge_minutes: int = 5
    tilt_size_up_multiplier: Decimal = Decimal("1.50")
    tilt_max_loss_streak: int = 3


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    server_utc_offset: int | None = Field(default=None, ge=-720, le=840)
    display_timezone: str | None = Field(default=None, max_length=64)
    initial_balance: Decimal | None = None
    tilt_revenge_minutes: int | None = Field(default=None, ge=1, le=240)
    tilt_size_up_multiplier: Decimal | None = Field(default=None, ge=Decimal("1.05"), le=Decimal("10.00"))
    tilt_max_loss_streak: int | None = Field(default=None, ge=1, le=20)


class ImportRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    file_sha256: str
    format: str
    rows_total: int
    rows_inserted: int
    rows_duplicate: int
    rows_skipped: int
    deals_inserted: int
    reported_net_pnl: Decimal | None = None
    parsed_net_pnl: Decimal | None = None
    errors: list[str] | None = None
    imported_at: datetime


class ImportResponse(BaseModel):
    import_record: ImportRecordOut
    account: AccountOut
    already_imported: bool = False


class TradeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticket: int
    symbol: str
    normalized_symbol: str
    side: TradeSide
    volume: Decimal
    open_time: datetime
    close_time: datetime
    open_price: Decimal
    close_price: Decimal
    stop_loss: Decimal | None = None
    take_profit: Decimal | None = None
    commission: Decimal
    swap: Decimal
    fee: Decimal
    profit: Decimal
    net_pnl: Decimal
    close_reason: str | None = None
    comment: str | None = None
    setup_tag: str | None = None
    notes: str | None = None
    rating: int | None = None
    tilt_flags: list[str] = Field(default_factory=list)


class TradeJournalPatch(BaseModel):
    setup_tag: str | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=4000)
    rating: int | None = Field(default=None, ge=1, le=5)


class TradesListResponse(BaseModel):
    account: AccountOut
    total: int
    wins: int
    losses: int
    net_pnl: Decimal
    gross_profit: Decimal
    gross_loss: Decimal
    symbols: list[str]
    tags: list[str]
    items: list[TradeOut]


class ReplayCandleOut(BaseModel):
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None


class TradeReplayResponse(BaseModel):
    trade_id: uuid.UUID
    symbol: str
    interval: str
    source: str  # "twelvedata" | "synthetic"
    entry_candle_time: int
    exit_candle_time: int
    candles: list[ReplayCandleOut]

