import enum

from sqlalchemy import CHAR, Enum as SAEnum, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AssetClass(str, enum.Enum):
    stock = "stock"
    etf = "etf"
    forex = "forex"
    metal = "metal"
    crypto = "crypto"
    index = "index"


class Instrument(Base):
    __tablename__ = "instruments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(Text)
    asset_class: Mapped[AssetClass] = mapped_column(
        SAEnum(AssetClass, name="asset_class", values_callable=lambda e: [x.value for x in e]),
        nullable=False,
    )
    exchange: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str | None] = mapped_column(CHAR(3))
    # Per-provider symbol mapping, e.g. {"twelvedata": "XAU/USD"}
    provider_ref: Mapped[dict | None] = mapped_column(JSONB)
