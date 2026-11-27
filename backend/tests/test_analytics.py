from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
import uuid

from app.core.config import normalize_asyncpg_url
from app.db.models.journal import TradeSide
from app.services.analytics.engine import classify_session_gmt7, compute_analytics, detect_tilt_flags
from app.services.mt5.parser import parse_mt5_report
from tests.test_mt5_parser import SYNTHETIC_MT5_HTML


def _make_account(**overrides):
    defaults = dict(
        id=uuid.UUID("00000000-0000-0000-0000-000000000002"),
        name="Main Trading Account",
        broker="Demo Broker Ltd",
        mt5_login="123456",
        currency="USC",
        base_currency="USC",
        server_utc_offset=0,
        display_timezone="Asia/Bangkok",
        initial_balance=Decimal("0"),
        tilt_revenge_minutes=5,
        tilt_size_up_multiplier=Decimal("1.50"),
        tilt_max_loss_streak=3,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_classify_session_gmt7():
    assert classify_session_gmt7(8)[0] == "Asian Session"
    assert classify_session_gmt7(15)[0] == "London Session"
    assert classify_session_gmt7(21)[0] == "New York Session"
    assert classify_session_gmt7(2)[0] == "New York Session"
    assert classify_session_gmt7(5)[0] == "Rollover / Late NY"


def test_compute_analytics_on_parsed_mt5_report():
    rep = parse_mt5_report(SYNTHETIC_MT5_HTML, "report.html", server_utc_offset_minutes=0)
    acct = _make_account(currency=rep.currency, base_currency=rep.currency, broker=rep.broker, mt5_login=rep.mt5_login)
    trades = [
        SimpleNamespace(
            ticket=p.ticket,
            symbol=p.symbol,
            normalized_symbol=p.normalized_symbol,
            side=TradeSide(p.side),
            volume=p.volume,
            stop_loss=p.stop_loss,
            open_time=p.open_time,
            close_time=p.close_time,
            net_pnl=p.profit + p.commission + p.swap + p.fee,
            close_reason=p.close_reason,
        )
        for p in sorted(rep.positions, key=lambda x: (x.close_time, x.ticket))
    ]
    balance_deals = [SimpleNamespace(profit=d.profit) for d in rep.deals if d.type == "balance"]
    symbols = sorted({t.normalized_symbol for t in trades})

    res = compute_analytics(acct, trades, balance_deals, symbols)
    assert res.summary.total_trades == 2
    assert res.summary.net_pnl == Decimal("92.00")
    assert len(res.equity_curve) == 3
    assert len(res.by_hour) == 24
    assert len(res.by_session) == 4
    assert res.summary.max_drawdown == Decimal("-117.30")
    assert res.summary.total_deposits == Decimal("3000.00")
    assert res.tilt.total_tilt_trades + res.tilt.clean_trades == 2
    assert res.tilt.tilt_net_pnl + res.tilt.clean_net_pnl == res.summary.net_pnl
    assert len(res.calendar_daily_pnl) == len(res.daily_pnl)


def test_compute_analytics_empty_and_initial_balance_override():
    acct = _make_account(currency="USD", base_currency="USD", initial_balance=Decimal("1000.00"))
    empty = compute_analytics(acct, [], [], [])
    assert empty.summary.total_trades == 0
    assert empty.summary.ending_balance == Decimal("1000.00")

    t1 = SimpleNamespace(
        ticket=1,
        symbol="XAUUSD",
        normalized_symbol="XAUUSD",
        side=TradeSide.buy,
        volume=Decimal("0.10"),
        stop_loss=Decimal("2500"),
        open_time=datetime(2026, 10, 1, 7, 0, tzinfo=timezone.utc),
        close_time=datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc),
        net_pnl=Decimal("200.00"),
        close_reason="tp",
    )
    t2 = SimpleNamespace(
        ticket=2,
        symbol="XAUUSD",
        normalized_symbol="XAUUSD",
        side=TradeSide.sell,
        volume=Decimal("0.10"),
        stop_loss=Decimal("2550"),
        open_time=datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc),
        close_time=datetime(2026, 10, 1, 10, 0, tzinfo=timezone.utc),
        net_pnl=Decimal("-150.00"),
        close_reason="sl",
    )
    res = compute_analytics(acct, [t1, t2], [], ["XAUUSD"])
    assert res.summary.ending_balance == Decimal("1050.00")
    assert res.summary.max_drawdown == Decimal("-150.00")
    assert res.summary.max_drawdown_pct == 12.5
    assert res.summary.profit_factor == 1.33


def test_normalize_asyncpg_url_for_neon():
    url, args = normalize_asyncpg_url(
        "postgresql://u:p@ep-cool-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
    )
    assert url == "postgresql+asyncpg://u:p@ep-cool-pooler.ap-southeast-1.aws.neon.tech/neondb"
    assert args == {"ssl": "require", "statement_cache_size": 0}


def test_detect_tilt_flags_rules_and_edge_cases():
    acct = _make_account(display_timezone="UTC")

    def mk(ticket, open_h, open_m, close_h, close_m, pnl, vol="0.10", sym="XAUUSD", sl="2500", day=1):
        return SimpleNamespace(
            ticket=ticket,
            symbol=sym,
            normalized_symbol=sym,
            side=TradeSide.buy,
            volume=Decimal(vol),
            stop_loss=Decimal(sl) if sl is not None else None,
            open_time=datetime(2026, 10, day, open_h, open_m, tzinfo=timezone.utc),
            close_time=datetime(2026, 10, day, close_h, close_m, tzinfo=timezone.utc),
            net_pnl=Decimal(pnl),
            close_reason="sl" if Decimal(pnl) < 0 else "tp",
        )

    trades = [
        # 1: initial loss on XAUUSD 0.10 lots (08:00 -> 08:10)
        mk(1, 8, 0, 8, 10, "-50"),
        # 2: overlapping trade already open at 08:05 BEFORE #1 closed -> must NOT be revenge/size_up
        mk(2, 8, 5, 8, 20, "-40", vol="0.30"),
        # 3: opened 2 min after #2 closed with 1.5x vol (0.45) and no SL -> revenge + size_up + no_sl
        mk(3, 8, 22, 8, 30, "-60", vol="0.45", sl=None),
        # 4: opened 30 min later on DIFFERENT symbol (EURUSD) after 3 losses -> after_loss_streak only
        mk(4, 9, 0, 9, 10, "100", vol="1.00", sym="EURUSD"),
        # 5: opened 1 min after #4 WIN -> clean (win reset streak and revenge)
        mk(5, 9, 11, 9, 20, "20", vol="1.00", sym="EURUSD"),
        # 6: next day after loss on day 1 -> clean (new day resets everything)
        mk(6, 0, 1, 0, 10, "10", vol="2.00", sym="XAUUSD", day=2),
    ]

    flags = detect_tilt_flags(trades, acct)
    assert flags[1] == []
    assert flags[2] == []
    assert set(flags[3]) == {"revenge", "size_up", "no_sl"}
    assert flags[4] == ["after_loss_streak"]
    assert flags[5] == []
    assert flags[6] == []
