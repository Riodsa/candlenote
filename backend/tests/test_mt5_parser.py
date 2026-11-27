from datetime import datetime, timedelta, timezone
from decimal import Decimal
from io import BytesIO

import openpyxl

from app.services.mt5.parser import normalize_symbol, parse_mt5_report

SYNTHETIC_MT5_HTML = """<!DOCTYPE html>
<html><body>
<table>
  <tr><th>Name:</th><th>Demo Cent</th></tr>
  <tr><th>Account:</th><th>123456 (USC, Demo-Server, demo, Hedge)</th></tr>
  <tr><th>Company:</th><th>Demo Broker Ltd</th></tr>
  <tr><th>Positions</th></tr>
  <tr><th>Time</th><th>Position</th><th>Symbol</th><th>Type</th><th>Volume</th><th>Price</th><th>S / L</th><th>T / P</th><th>Time</th><th>Price</th><th>Commission</th><th>Swap</th><th>Profit</th></tr>
  <tr>
    <td>2026.10.06 04:24:10</td><td>100001</td><td>XAUUSDc</td><td>buy</td><td>0.50</td>
    <td>2650.00</td><td>2640.00</td><td>2670.00</td><td>2026.10.06 04:38:46</td><td>2640.00</td>
    <td>0.00</td><td>0.00</td><td>-117.30</td><td class="hidden">hidden</td>
  </tr>
  <tr>
    <td>2026.10.06 05:00:00</td><td>100002</td><td>XAUUSDc</td><td>sell</td><td>0.50</td>
    <td>2645.00</td><td>2655.00</td><td>2630.00</td><td>2026.10.06 05:25:00</td><td>2630.00</td>
    <td>-1.20</td><td>0.00</td><td>210.50</td>
  </tr>
  <tr><th>Deals</th></tr>
  <tr><th>Time</th><th>Deal</th><th>Symbol</th><th>Type</th><th>Direction</th><th>Volume</th><th>Price</th><th>Order</th><th>Commission</th><th>Fee</th><th>Swap</th><th>Profit</th><th>Balance</th><th>Comment</th></tr>
  <tr>
    <td>2026.10.05 10:00:00</td><td>500001</td><td></td><td>balance</td><td></td><td></td><td></td><td></td>
    <td>0.00</td><td>0.00</td><td>0.00</td><td>3000.00</td><td>3000.00</td><td>Deposit</td>
  </tr>
  <tr><th>Total Net Profit:</th><th>92.00</th></tr>
</table>
</body></html>
""".encode("utf-16")


def test_normalize_symbol():
    assert normalize_symbol("XAUUSDc") == "XAUUSD"
    assert normalize_symbol("BTCUSDc") == "BTCUSD"
    assert normalize_symbol("USTECc") == "USTEC"
    assert normalize_symbol("EURUSD.m") == "EURUSD"
    assert normalize_symbol("AAPL") == "AAPL"


def test_parse_utf16_mt5_html_report():
    rep = parse_mt5_report(SYNTHETIC_MT5_HTML, "report.html", server_utc_offset_minutes=0)
    assert rep.format == "html"
    assert rep.mt5_login == "123456"
    assert rep.currency == "USC"
    assert rep.broker == "Demo Broker Ltd"
    assert len(rep.positions) == 2
    assert rep.rows_skipped == 0
    assert rep.errors == []

    net = sum((p.profit + p.commission + p.swap + p.fee for p in rep.positions), Decimal("0"))
    assert net == Decimal("92.00")
    assert rep.reported_net_pnl == Decimal("92.00")

    first = rep.positions[0]
    assert first.ticket == 100001
    assert first.symbol == "XAUUSDc"
    assert first.normalized_symbol == "XAUUSD"
    assert first.side == "buy"
    assert first.volume == Decimal("0.50")
    assert first.open_time == datetime(2026, 10, 6, 4, 24, 10, tzinfo=timezone.utc)
    assert first.close_reason == "sl"
    assert first.profit == Decimal("-117.30")

    # Verify Bangkok GMT+7 conversion
    bkk = timezone(timedelta(hours=7))
    assert first.open_time.astimezone(bkk).strftime("%Y-%m-%d %H:%M:%S") == "2026-10-06 11:24:10"

    balance_deals = [d for d in rep.deals if d.type == "balance"]
    assert len(balance_deals) == 1
    assert balance_deals[0].profit == Decimal("3000.00")


def test_parse_xlsx_report_and_server_offset():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Trade History Report"])
    ws.append(["Name:", "Standard"])
    ws.append(["Account:", "999888 (USD, Broker-Server, real, Hedge)"])
    ws.append(["Total Net Profit:", "45.50"])
    ws.append(["Positions"])
    ws.append(["Time", "Position", "Symbol", "Type", "Volume", "Price", "S / L", "T / P", "Time", "Price", "Commission", "Swap", "Profit"])
    ws.append([
        "2026.10.06 10:00:00",
        "1001",
        "XAUUSD",
        "buy",
        "0.1",
        "2650.00",
        "2640.00",
        "2660.00",
        "2026.10.06 11:00:00",
        "2660.00",
        "-0.50",
        "0.00",
        "46.00",
    ])

    buf = BytesIO()
    wb.save(buf)

    # Server at UTC+3 (+180 minutes) -> 10:00 server time is 07:00 UTC
    rep = parse_mt5_report(buf.getvalue(), "report.xlsx", server_utc_offset_minutes=180)
    assert rep.format == "xlsx"
    assert rep.currency == "USD"
    assert rep.mt5_login == "999888"
    assert len(rep.positions) == 1
    p = rep.positions[0]
    assert p.open_time == datetime(2026, 10, 6, 7, 0, 0, tzinfo=timezone.utc)
    assert p.close_reason == "tp"
    assert p.profit + p.commission == Decimal("45.50")
