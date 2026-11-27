from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.db.models.instrument import AssetClass


class InstrumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    symbol: str
    name: str | None = None
    asset_class: AssetClass
    exchange: str | None = None
    currency: str | None = None


class WatchlistItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    instrument: InstrumentOut
    position: int
    notes: str | None = None
    added_at: datetime


class WatchlistAdd(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    name: str | None = None
    asset_class: AssetClass | None = None  # only needed for symbols not already known


class WatchlistReorder(BaseModel):
    symbols: list[str]


class SearchResult(BaseModel):
    symbol: str
    name: str | None = None
    asset_class: AssetClass
