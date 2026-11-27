from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.journal import Account, Deal, Trade, TradeSide
from app.schemas.analytics import (
    AnalyticsResponse,
    AnalyticsSummary,
    DailyPnlPoint,
    EquityPoint,
    HourBreakdown,
    ReasonBreakdown,
    SessionBreakdown,
    SymbolBreakdown,
    TiltAnalytics,
    TiltRuleBreakdown,
)
from app.schemas.journal import AccountOut

FIXED_TZ_FALLBACKS = {
    "Asia/Bangkok": timezone(timedelta(hours=7)),
    "Asia/Tokyo": timezone(timedelta(hours=9)),
    "Europe/London": timezone.utc,
    "America/New_York": timezone(timedelta(hours=-4)),
    "UTC": timezone.utc,
}

REASON_LABELS = {
    "tp": "Take Profit (TP)",
    "sl": "Stop Loss (SL)",
    "so": "Stop Out",
    "manual": "Manual Close",
}


def resolve_tz(tz_name: str):
    try:
        return ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, Exception):
        return FIXED_TZ_FALLBACKS.get(tz_name, timezone(timedelta(hours=7)))


def classify_session_gmt7(hour_gmt7: int) -> tuple[str, str]:
    """Classify an entry hour in GMT+7 into standard FX/Gold trading sessions."""
    if 6 <= hour_gmt7 < 14:
        return ("Asian Session", "06:00 - 14:00")
    if 14 <= hour_gmt7 < 20:
        return ("London Session", "14:00 - 20:00")
    if hour_gmt7 >= 20 or hour_gmt7 < 4:
        return ("New York Session", "20:00 - 04:00")
    return ("Rollover / Late NY", "04:00 - 06:00")


def _q2(val: Decimal | float) -> Decimal:
    return Decimal(str(val)).quantize(Decimal("0.01"))


def detect_tilt_flags(trades: list[Trade], acct: Account) -> dict[int, list[str]]:
    """Detect tilt/overtrading behaviors per trade (keyed by ticket) within the same local day."""
    tz = resolve_tz(acct.display_timezone or "Asia/Bangkok")
    revenge_sec = int(getattr(acct, "tilt_revenge_minutes", 5) or 5) * 60
    size_up_mult = Decimal(str(getattr(acct, "tilt_size_up_multiplier", Decimal("1.50")) or Decimal("1.50")))
    max_loss_streak = int(getattr(acct, "tilt_max_loss_streak", 3) or 3)

    by_open = sorted(trades, key=lambda t: (t.open_time, t.ticket))
    by_close = sorted(trades, key=lambda t: (t.close_time, t.ticket))

    # Per local-day state built only from trades that already closed before each entry opens.
    day_state: dict[str, dict] = defaultdict(
        lambda: {
            "loss_streak": 0,
            "last_closed_was_loss": False,
            "last_loss_close_time": None,
            "last_by_sym": {},
        }
    )

    flags_by_ticket: dict[int, list[str]] = {}
    c_idx = 0
    n_close = len(by_close)

    for t in by_open:
        while c_idx < n_close and by_close[c_idx].close_time <= t.open_time:
            prev = by_close[c_idx]
            c_idx += 1
            p_day = prev.close_time.astimezone(tz).strftime("%Y-%m-%d")
            p_pnl = Decimal(str(prev.net_pnl or 0))
            st = day_state[p_day]
            sym = (prev.normalized_symbol or prev.symbol).upper()
            st["last_by_sym"][sym] = (p_pnl, Decimal(str(getattr(prev, "volume", 0) or 0)))
            if p_pnl < 0:
                st["loss_streak"] += 1
                st["last_closed_was_loss"] = True
                st["last_loss_close_time"] = prev.close_time
            elif p_pnl > 0:
                st["loss_streak"] = 0
                st["last_closed_was_loss"] = False

        t_day = t.open_time.astimezone(tz).strftime("%Y-%m-%d")
        st = day_state[t_day]
        flags: list[str] = []

        if (
            st["last_closed_was_loss"]
            and st["last_loss_close_time"] is not None
            and 0 <= (t.open_time - st["last_loss_close_time"]).total_seconds() <= revenge_sec
        ):
            flags.append("revenge")

        sym = (t.normalized_symbol or t.symbol).upper()
        prev_sym = st["last_by_sym"].get(sym)
        t_vol = Decimal(str(getattr(t, "volume", 0) or 0))
        if prev_sym is not None and prev_sym[0] < 0 and prev_sym[1] > 0 and t_vol >= prev_sym[1] * size_up_mult:
            flags.append("size_up")

        if st["loss_streak"] >= max_loss_streak:
            flags.append("after_loss_streak")

        sl = getattr(t, "stop_loss", None)
        if sl is None or Decimal(str(sl)) <= 0:
            flags.append("no_sl")

        flags_by_ticket[t.ticket] = flags

    return flags_by_ticket


def _build_daily_pnl(
    trades: list[Trade],
    tz,
    tilt_flags: dict[int, list[str]],
) -> list[DailyPnlPoint]:
    daily_map: dict[str, dict] = defaultdict(
        lambda: {
            "net_pnl": Decimal("0"),
            "gross_profit": Decimal("0"),
            "gross_loss": Decimal("0"),
            "trades": 0,
            "wins": 0,
            "tilt_trades": 0,
        }
    )
    for t in trades:
        pnl = Decimal(str(t.net_pnl or 0))
        day_key = t.close_time.astimezone(tz).strftime("%Y-%m-%d")
        d = daily_map[day_key]
        d["net_pnl"] += pnl
        if pnl > 0:
            d["gross_profit"] += pnl
            d["wins"] += 1
        elif pnl < 0:
            d["gross_loss"] += pnl
        d["trades"] += 1
        if tilt_flags.get(t.ticket):
            d["tilt_trades"] += 1

    return [
        DailyPnlPoint(
            date=day,
            net_pnl=_q2(vals["net_pnl"]),
            gross_profit=_q2(vals["gross_profit"]),
            gross_loss=_q2(vals["gross_loss"]),
            trades=vals["trades"],
            wins=vals["wins"],
            win_rate=round((vals["wins"] / vals["trades"]) * 100, 1) if vals["trades"] else 0.0,
            tilt_trades=vals["tilt_trades"],
        )
        for day, vals in sorted(daily_map.items())
    ]


async def build_analytics(
    session: AsyncSession,
    acct: Account,
    days: int | None = None,
    symbol: str | None = None,
) -> AnalyticsResponse:
    all_trades_res = await session.scalars(
        select(Trade)
        .where(Trade.account_id == acct.id)
        .order_by(Trade.close_time.asc(), Trade.ticket.asc())
    )
    all_trades = list(all_trades_res.all())
    all_symbols = sorted({t.normalized_symbol for t in all_trades if t.normalized_symbol})

    # Compute tilt flags over full account history so date/symbol filters never break same-day context.
    tilt_flags = detect_tilt_flags(all_trades, acct)

    sym_filtered = all_trades
    if symbol:
        s = symbol.strip().upper()
        sym_filtered = [t for t in all_trades if t.symbol.upper() == s or t.normalized_symbol.upper() == s]

    trades = sym_filtered
    if days is not None and days > 0:
        anchor = all_trades[-1].close_time if all_trades else datetime.now(timezone.utc)
        cutoff = anchor - timedelta(days=days)
        trades = [t for t in sym_filtered if t.close_time >= cutoff]

    deals_res = await session.scalars(
        select(Deal)
        .where(Deal.account_id == acct.id, Deal.type == "balance")
        .order_by(Deal.time.asc(), Deal.deal_id.asc())
    )
    balance_deals = list(deals_res.all())

    return compute_analytics(
        acct,
        trades,
        balance_deals,
        all_symbols,
        tilt_flags=tilt_flags,
        calendar_trades=sym_filtered,
    )


def compute_analytics(
    acct: Account,
    trades: list[Trade],
    balance_deals: list[Deal],
    all_symbols: list[str],
    tilt_flags: dict[int, list[str]] | None = None,
    calendar_trades: list[Trade] | None = None,
) -> AnalyticsResponse:
    tz = resolve_tz(acct.display_timezone or "Asia/Bangkok")
    gmt7 = FIXED_TZ_FALLBACKS["Asia/Bangkok"]
    flags_map = tilt_flags if tilt_flags is not None else detect_tilt_flags(trades, acct)

    total_deposits = sum(
        (d.profit for d in balance_deals if d.profit and d.profit > 0), Decimal("0")
    )
    total_withdrawals = sum(
        (d.profit for d in balance_deals if d.profit and d.profit < 0), Decimal("0")
    )
    starting_capital = (
        acct.initial_balance
        if acct.initial_balance and acct.initial_balance > 0
        else total_deposits
    )

    total_trades = len(trades)
    wins = 0
    losses = 0
    breakevens = 0
    buy_trades = 0
    buy_wins = 0
    sell_trades = 0
    sell_wins = 0
    gross_profit = Decimal("0")
    gross_loss = Decimal("0")
    net_pnl = Decimal("0")
    best_trade = Decimal("0")
    worst_trade = Decimal("0")
    total_duration_sec = 0.0

    cur_win_streak = 0
    cur_loss_streak = 0
    max_win_streak = 0
    max_loss_streak = 0

    cum_pnl = Decimal("0")
    peak_pnl = Decimal("0")
    max_drawdown = Decimal("0")
    peak_equity = starting_capital if starting_capital > 0 else Decimal("0")
    max_drawdown_pct = 0.0

    equity_curve: list[EquityPoint] = []
    if trades:
        first_local = trades[0].open_time.astimezone(tz)
        equity_curve.append(
            EquityPoint(
                index=0,
                time=trades[0].open_time,
                date_label=first_local.strftime("%d %b %H:%M"),
                ticket=None,
                symbol=None,
                trade_pnl=Decimal("0"),
                cumulative_pnl=Decimal("0"),
                equity=_q2(starting_capital),
                drawdown=Decimal("0"),
            )
        )

    symbol_map: dict[str, dict] = defaultdict(
        lambda: {
            "trades": 0,
            "wins": 0,
            "losses": 0,
            "net_pnl": Decimal("0"),
            "gross_profit": Decimal("0"),
            "gross_loss": Decimal("0"),
        }
    )
    hour_map: dict[int, dict] = {
        h: {"trades": 0, "wins": 0, "net_pnl": Decimal("0")} for h in range(24)
    }
    session_order = [
        ("Asian Session", "06:00 - 14:00"),
        ("London Session", "14:00 - 20:00"),
        ("New York Session", "20:00 - 04:00"),
        ("Rollover / Late NY", "04:00 - 06:00"),
    ]
    session_map: dict[str, dict] = {
        name: {"hours": hrs, "trades": 0, "wins": 0, "net_pnl": Decimal("0")}
        for name, hrs in session_order
    }
    reason_map: dict[str, dict] = {
        k: {"label": lbl, "trades": 0, "wins": 0, "net_pnl": Decimal("0")}
        for k, lbl in REASON_LABELS.items()
    }

    for idx, t in enumerate(trades, start=1):
        pnl = Decimal(str(t.net_pnl or 0))
        net_pnl += pnl

        if idx == 1 or pnl > best_trade:
            best_trade = pnl
        if idx == 1 or pnl < worst_trade:
            worst_trade = pnl

        if pnl > 0:
            wins += 1
            gross_profit += pnl
            cur_win_streak += 1
            cur_loss_streak = 0
            if cur_win_streak > max_win_streak:
                max_win_streak = cur_win_streak
        elif pnl < 0:
            losses += 1
            gross_loss += pnl
            cur_loss_streak += 1
            cur_win_streak = 0
            if cur_loss_streak > max_loss_streak:
                max_loss_streak = cur_loss_streak
        else:
            breakevens += 1
            cur_win_streak = 0
            cur_loss_streak = 0

        if t.side == TradeSide.buy:
            buy_trades += 1
            if pnl > 0:
                buy_wins += 1
        else:
            sell_trades += 1
            if pnl > 0:
                sell_wins += 1

        dur = max(0.0, (t.close_time - t.open_time).total_seconds())
        total_duration_sec += dur

        # Equity & Drawdown
        cum_pnl += pnl
        if cum_pnl > peak_pnl:
            peak_pnl = cum_pnl
        dd = cum_pnl - peak_pnl  # <= 0
        if dd < max_drawdown:
            max_drawdown = dd

        cur_equity = starting_capital + cum_pnl
        if cur_equity > peak_equity:
            peak_equity = cur_equity
        if peak_equity > 0:
            dd_pct = float((peak_equity - cur_equity) / peak_equity * Decimal("100"))
            if dd_pct > max_drawdown_pct:
                max_drawdown_pct = dd_pct

        close_local = t.close_time.astimezone(tz)
        equity_curve.append(
            EquityPoint(
                index=idx,
                time=t.close_time,
                date_label=close_local.strftime("%d %b %H:%M"),
                ticket=t.ticket,
                symbol=t.normalized_symbol,
                trade_pnl=_q2(pnl),
                cumulative_pnl=_q2(cum_pnl),
                equity=_q2(cur_equity),
                drawdown=_q2(dd),
            )
        )

        # Symbol bucket
        sym_key = t.normalized_symbol or t.symbol
        s_bucket = symbol_map[sym_key]
        s_bucket["trades"] += 1
        s_bucket["net_pnl"] += pnl
        if pnl > 0:
            s_bucket["wins"] += 1
            s_bucket["gross_profit"] += pnl
        elif pnl < 0:
            s_bucket["losses"] += 1
            s_bucket["gross_loss"] += pnl

        # Hour of day bucket (entry time in user display timezone)
        open_local = t.open_time.astimezone(tz)
        h_bucket = hour_map[open_local.hour]
        h_bucket["trades"] += 1
        h_bucket["net_pnl"] += pnl
        if pnl > 0:
            h_bucket["wins"] += 1

        # Session bucket (in GMT+7)
        open_gmt7 = t.open_time.astimezone(gmt7)
        sess_name, _ = classify_session_gmt7(open_gmt7.hour)
        sess_bucket = session_map[sess_name]
        sess_bucket["trades"] += 1
        sess_bucket["net_pnl"] += pnl
        if pnl > 0:
            sess_bucket["wins"] += 1

        # Exit reason bucket
        r_key = t.close_reason if t.close_reason in reason_map else "manual"
        r_bucket = reason_map[r_key]
        r_bucket["trades"] += 1
        r_bucket["net_pnl"] += pnl
        if pnl > 0:
            r_bucket["wins"] += 1

    win_rate = round((wins / total_trades) * 100, 2) if total_trades > 0 else 0.0
    buy_win_rate = round((buy_wins / buy_trades) * 100, 2) if buy_trades > 0 else 0.0
    sell_win_rate = round((sell_wins / sell_trades) * 100, 2) if sell_trades > 0 else 0.0
    abs_gl = abs(gross_loss)
    profit_factor = round(float(gross_profit / abs_gl), 2) if abs_gl > 0 else None
    expectancy = _q2(net_pnl / total_trades) if total_trades > 0 else Decimal("0.00")
    avg_win = _q2(gross_profit / wins) if wins > 0 else Decimal("0.00")
    avg_loss = _q2(gross_loss / losses) if losses > 0 else Decimal("0.00")
    payoff_ratio = (
        round(float(avg_win / abs(avg_loss)), 2)
        if losses > 0 and abs(avg_loss) > 0
        else None
    )
    avg_duration = round(total_duration_sec / total_trades, 1) if total_trades > 0 else 0.0
    ending_balance = _q2(starting_capital + total_withdrawals + net_pnl)

    summary = AnalyticsSummary(
        total_trades=total_trades,
        wins=wins,
        losses=losses,
        breakevens=breakevens,
        win_rate=win_rate,
        buy_trades=buy_trades,
        buy_win_rate=buy_win_rate,
        sell_trades=sell_trades,
        sell_win_rate=sell_win_rate,
        net_pnl=_q2(net_pnl),
        gross_profit=_q2(gross_profit),
        gross_loss=_q2(gross_loss),
        profit_factor=profit_factor,
        expectancy=expectancy,
        avg_win=avg_win,
        avg_loss=avg_loss,
        payoff_ratio=payoff_ratio,
        best_trade=_q2(best_trade),
        worst_trade=_q2(worst_trade),
        avg_duration_seconds=avg_duration,
        max_win_streak=max_win_streak,
        max_loss_streak=max_loss_streak,
        max_drawdown=_q2(max_drawdown),
        max_drawdown_pct=round(max_drawdown_pct, 2),
        total_deposits=_q2(total_deposits),
        total_withdrawals=_q2(total_withdrawals),
        ending_balance=ending_balance,
    )

    revenge_min = int(getattr(acct, "tilt_revenge_minutes", 5) or 5)
    size_mult = Decimal(str(getattr(acct, "tilt_size_up_multiplier", Decimal("1.50")) or Decimal("1.50"))).normalize()
    max_streak = int(getattr(acct, "tilt_max_loss_streak", 3) or 3)
    tilt_rule_labels = [
        ("revenge", f"Revenge Entry (\u2264 {revenge_min}m after loss)"),
        ("size_up", f"Lot Size Up (\u2265 {size_mult}x after loss)"),
        ("after_loss_streak", f"After {max_streak}L Streak"),
        ("no_sl", "No Stop Loss"),
    ]
    tilt_rule_map: dict[str, dict] = {
        k: {"label": lbl, "trades": 0, "wins": 0, "net_pnl": Decimal("0")}
        for k, lbl in tilt_rule_labels
    }
    total_tilt_trades = 0
    tilt_net_pnl = Decimal("0")
    clean_trades = 0
    clean_net_pnl = Decimal("0")

    for t in trades:
        pnl = Decimal(str(t.net_pnl or 0))
        t_flags = flags_map.get(t.ticket, [])
        if t_flags:
            total_tilt_trades += 1
            tilt_net_pnl += pnl
            for f in t_flags:
                if f in tilt_rule_map:
                    rb = tilt_rule_map[f]
                    rb["trades"] += 1
                    rb["net_pnl"] += pnl
                    if pnl > 0:
                        rb["wins"] += 1
        else:
            clean_trades += 1
            clean_net_pnl += pnl

    daily_pnl = _build_daily_pnl(trades, tz, flags_map)
    calendar_daily_pnl = (
        daily_pnl
        if calendar_trades is None or calendar_trades is trades
        else _build_daily_pnl(calendar_trades, tz, flags_map)
    )

    tilt = TiltAnalytics(
        total_tilt_trades=total_tilt_trades,
        tilt_net_pnl=_q2(tilt_net_pnl),
        clean_trades=clean_trades,
        clean_net_pnl=_q2(clean_net_pnl),
        rules=[
            TiltRuleBreakdown(
                rule=k,
                label=vals["label"],
                trades=vals["trades"],
                wins=vals["wins"],
                win_rate=round((vals["wins"] / vals["trades"]) * 100, 1) if vals["trades"] else 0.0,
                net_pnl=_q2(vals["net_pnl"]),
            )
            for k, vals in tilt_rule_map.items()
        ],
    )

    by_symbol = []
    for sym, vals in sorted(symbol_map.items(), key=lambda kv: kv[1]["trades"], reverse=True):
        s_gl = abs(vals["gross_loss"])
        s_pf = round(float(vals["gross_profit"] / s_gl), 2) if s_gl > 0 else None
        by_symbol.append(
            SymbolBreakdown(
                symbol=sym,
                trades=vals["trades"],
                wins=vals["wins"],
                losses=vals["losses"],
                win_rate=round((vals["wins"] / vals["trades"]) * 100, 1) if vals["trades"] else 0.0,
                net_pnl=_q2(vals["net_pnl"]),
                gross_profit=_q2(vals["gross_profit"]),
                gross_loss=_q2(vals["gross_loss"]),
                profit_factor=s_pf,
            )
        )

    by_hour = [
        HourBreakdown(
            hour=h,
            label=f"{h:02d}:00",
            trades=vals["trades"],
            wins=vals["wins"],
            win_rate=round((vals["wins"] / vals["trades"]) * 100, 1) if vals["trades"] else 0.0,
            net_pnl=_q2(vals["net_pnl"]),
        )
        for h, vals in sorted(hour_map.items())
    ]

    by_session = [
        SessionBreakdown(
            session=name,
            hours_gmt7=vals["hours"],
            trades=vals["trades"],
            wins=vals["wins"],
            win_rate=round((vals["wins"] / vals["trades"]) * 100, 1) if vals["trades"] else 0.0,
            net_pnl=_q2(vals["net_pnl"]),
        )
        for name, vals in session_map.items()
    ]

    by_exit_reason = [
        ReasonBreakdown(
            reason=k,
            label=vals["label"],
            trades=vals["trades"],
            wins=vals["wins"],
            win_rate=round((vals["wins"] / vals["trades"]) * 100, 1) if vals["trades"] else 0.0,
            net_pnl=_q2(vals["net_pnl"]),
        )
        for k, vals in reason_map.items()
        if vals["trades"] > 0
    ]

    return AnalyticsResponse(
        account=AccountOut.model_validate(acct),
        symbols=all_symbols,
        summary=summary,
        equity_curve=equity_curve,
        daily_pnl=daily_pnl,
        calendar_daily_pnl=calendar_daily_pnl,
        by_symbol=by_symbol,
        by_hour=by_hour,
        by_session=by_session,
        by_exit_reason=by_exit_reason,
        tilt=tilt,
    )
