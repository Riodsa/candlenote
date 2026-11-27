from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel

from app.schemas.journal import AccountOut


class AnalyticsSummary(BaseModel):
    total_trades: int
    wins: int
    losses: int
    breakevens: int
    win_rate: float
    buy_trades: int
    buy_win_rate: float
    sell_trades: int
    sell_win_rate: float
    net_pnl: Decimal
    gross_profit: Decimal
    gross_loss: Decimal
    profit_factor: float | None
    expectancy: Decimal
    avg_win: Decimal
    avg_loss: Decimal
    payoff_ratio: float | None
    best_trade: Decimal
    worst_trade: Decimal
    avg_duration_seconds: float
    max_win_streak: int
    max_loss_streak: int
    max_drawdown: Decimal
    max_drawdown_pct: float
    total_deposits: Decimal
    total_withdrawals: Decimal
    ending_balance: Decimal


class EquityPoint(BaseModel):
    index: int
    time: datetime
    date_label: str
    ticket: int | None = None
    symbol: str | None = None
    trade_pnl: Decimal
    cumulative_pnl: Decimal
    equity: Decimal
    drawdown: Decimal


class DailyPnlPoint(BaseModel):
    date: str
    net_pnl: Decimal
    gross_profit: Decimal
    gross_loss: Decimal
    trades: int
    wins: int
    win_rate: float
    tilt_trades: int = 0


class SymbolBreakdown(BaseModel):
    symbol: str
    trades: int
    wins: int
    losses: int
    win_rate: float
    net_pnl: Decimal
    gross_profit: Decimal
    gross_loss: Decimal
    profit_factor: float | None


class HourBreakdown(BaseModel):
    hour: int
    label: str
    trades: int
    wins: int
    win_rate: float
    net_pnl: Decimal


class SessionBreakdown(BaseModel):
    session: str
    hours_gmt7: str
    trades: int
    wins: int
    win_rate: float
    net_pnl: Decimal


class ReasonBreakdown(BaseModel):
    reason: str
    label: str
    trades: int
    wins: int
    win_rate: float
    net_pnl: Decimal


class TiltRuleBreakdown(BaseModel):
    rule: str
    label: str
    trades: int
    wins: int
    win_rate: float
    net_pnl: Decimal


class TiltAnalytics(BaseModel):
    total_tilt_trades: int
    tilt_net_pnl: Decimal
    clean_trades: int
    clean_net_pnl: Decimal
    rules: list[TiltRuleBreakdown]


class AnalyticsResponse(BaseModel):
    account: AccountOut
    symbols: list[str]
    summary: AnalyticsSummary
    equity_curve: list[EquityPoint]
    daily_pnl: list[DailyPnlPoint]
    calendar_daily_pnl: list[DailyPnlPoint]
    by_symbol: list[SymbolBreakdown]
    by_hour: list[HourBreakdown]
    by_session: list[SessionBreakdown]
    by_exit_reason: list[ReasonBreakdown]
    tilt: TiltAnalytics
