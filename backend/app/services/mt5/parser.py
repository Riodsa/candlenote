"""MT5 Trade History Report parser (.html and .xlsx).

Extracts account metadata, closed positions, deals (including balance deposits/withdrawals),
and summary net profit for verification.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from io import BytesIO
import re

import openpyxl

TIME_RE = re.compile(r"^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}(:\d{2})?$")
ACCOUNT_RE = re.compile(r"(\d+)\s*\(([A-Za-z]{3})\s*,\s*([^,)]+)")


@dataclass
class ParsedPosition:
    ticket: int
    symbol: str
    normalized_symbol: str
    side: str  # 'buy' | 'sell'
    volume: Decimal
    open_time: datetime
    close_time: datetime
    open_price: Decimal
    close_price: Decimal
    stop_loss: Decimal | None
    take_profit: Decimal | None
    commission: Decimal
    swap: Decimal
    fee: Decimal
    profit: Decimal
    close_reason: str | None = None
    comment: str | None = None


@dataclass
class ParsedDeal:
    deal_id: int
    time: datetime
    type: str
    direction: str | None
    symbol: str | None
    volume: Decimal | None
    price: Decimal | None
    order_id: int | None
    commission: Decimal
    fee: Decimal
    swap: Decimal
    profit: Decimal
    balance: Decimal | None
    comment: str | None


@dataclass
class ParsedReport:
    format: str  # 'html' | 'xlsx'
    account_name: str | None = None
    mt5_login: str | None = None
    currency: str | None = None
    broker: str | None = None
    reported_net_pnl: Decimal | None = None
    positions: list[ParsedPosition] = field(default_factory=list)
    deals: list[ParsedDeal] = field(default_factory=list)
    rows_total: int = 0
    rows_skipped: int = 0
    errors: list[str] = field(default_factory=list)


class _MT5HTMLTableParser(HTMLParser):
    """Extracts non-hidden table cells while expanding colspan attributes."""

    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._cur_row: list[str] | None = None
        self._cur_cell: list[str] | None = None
        self._cur_colspan: int = 1

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._cur_row = []
        elif tag in ("td", "th") and self._cur_row is not None:
            d = dict(attrs)
            cls = (d.get("class") or "").split()
            if "hidden" in cls:
                self._cur_cell = None
                return
            self._cur_cell = []
            try:
                self._cur_colspan = int(d.get("colspan") or 1)
            except ValueError:
                self._cur_colspan = 1

    def handle_data(self, data: str) -> None:
        if self._cur_cell is not None:
            self._cur_cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._cur_cell is not None and self._cur_row is not None:
            txt = re.sub(r"\s+", " ", "".join(self._cur_cell).replace("\xa0", " ")).strip()
            self._cur_row.append(txt)
            for _ in range(self._cur_colspan - 1):
                self._cur_row.append("")
            self._cur_cell = None
        elif tag == "tr" and self._cur_row is not None:
            if any(self._cur_row):
                self.rows.append(self._cur_row)
            self._cur_row = None


def normalize_symbol(raw: str) -> str:
    """Strip common broker suffixes such as Exness 'c' / 'm' or '.a'."""
    s = raw.strip()
    s = re.sub(r"[._][a-zA-Z0-9]+$", "", s)
    if len(s) >= 6 and s[-1].islower() and s[:-1].isupper():
        return s[:-1]
    return s.upper()


def _parse_dec(val: str | None, default: Decimal | None = None) -> Decimal | None:
    if val is None:
        return default
    cleaned = val.replace(" ", "").replace("\xa0", "").replace(",", "").strip()
    if not cleaned:
        return default
    try:
        return Decimal(cleaned)
    except InvalidOperation as e:
        raise ValueError(f"Invalid number: {val!r}") from e


def _parse_time(val: str, server_utc_offset_minutes: int) -> datetime:
    s = val.strip()
    fmt = "%Y.%m.%d %H:%M:%S" if s.count(":") == 2 else "%Y.%m.%d %H:%M"
    dt = datetime.strptime(s, fmt)
    tz = timezone(timedelta(minutes=server_utc_offset_minutes))
    return dt.replace(tzinfo=tz).astimezone(timezone.utc)


def _decode_html(data: bytes) -> str:
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16")
    for enc in ("utf-8-sig", "utf-16", "cp1252", "latin-1"):
        try:
            text = data.decode(enc)
            if "<table" in text.lower() or "<tr" in text.lower():
                return text
        except UnicodeDecodeError:
            continue
    raise ValueError("Unable to decode HTML file")


def _extract_rows_xlsx(data: bytes) -> list[list[str]]:
    wb = openpyxl.load_workbook(BytesIO(data), data_only=True)
    ws = wb.active
    rows: list[list[str]] = []
    for row in ws.iter_rows(values_only=True):
        cells = []
        for c in row:
            if c is None:
                cells.append("")
            elif isinstance(c, datetime):
                cells.append(c.strftime("%Y.%m.%d %H:%M:%S"))
            else:
                cells.append(re.sub(r"\s+", " ", str(c).replace("\xa0", " ")).strip())
        if any(cells):
            rows.append(cells)
    return rows


def _infer_close_reason(
    close_price: Decimal,
    sl: Decimal | None,
    tp: Decimal | None,
    comment: str | None,
) -> str:
    c = (comment or "").lower()
    if "[so" in c or "stop out" in c:
        return "so"
    if "[sl" in c:
        return "sl"
    if "[tp" in c:
        return "tp"
    if sl is not None and close_price == sl:
        return "sl"
    if tp is not None and close_price == tp:
        return "tp"
    return "manual"


def parse_mt5_report(data: bytes, filename: str, server_utc_offset_minutes: int = 0) -> ParsedReport:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext in ("xlsx", "xlsm") or data[:4] == b"PK\x03\x04":
        fmt = "xlsx"
        rows = _extract_rows_xlsx(data)
    else:
        fmt = "html"
        tp = _MT5HTMLTableParser()
        tp.feed(_decode_html(data))
        rows = tp.rows

    report = ParsedReport(format=fmt)
    section: str | None = None
    deal_cols: dict[str, int] = {
        "time": 0,
        "deal": 1,
        "symbol": 2,
        "type": 3,
        "direction": 4,
        "volume": 5,
        "price": 6,
        "order": 7,
        "commission": 8,
        "fee": 9,
        "swap": 10,
        "profit": 11,
        "balance": 12,
        "comment": 13,
    }

    for idx, row in enumerate(rows):
        non_empty = [c for c in row if c != ""]
        if not non_empty:
            continue

        # Metadata & summary rows
        first = non_empty[0]
        if first == "Name:" and len(non_empty) >= 2:
            report.account_name = non_empty[1]
        elif first == "Account:" and len(non_empty) >= 2:
            m = ACCOUNT_RE.search(non_empty[1])
            if m:
                report.mt5_login = m.group(1)
                report.currency = m.group(2).upper()
        elif first == "Company:" and len(non_empty) >= 2:
            report.broker = non_empty[1]
        elif first == "Total Net Profit:" and len(non_empty) >= 2:
            try:
                report.reported_net_pnl = _parse_dec(non_empty[1])
            except ValueError:
                pass

        # Section headers
        if len(non_empty) == 1 and first in ("Positions", "Orders", "Deals", "Results"):
            section = first
            continue

        if section == "Positions":
            if first == "Time" and "Position" in row:
                continue
            if not TIME_RE.match(row[0]):
                continue
            report.rows_total += 1
            try:
                side = row[3].strip().lower()
                if side not in ("buy", "sell"):
                    report.rows_skipped += 1
                    continue
                open_time = _parse_time(row[0], server_utc_offset_minutes)
                ticket = int(row[1].strip())
                symbol = row[2].strip()
                volume = _parse_dec(row[4].split("/")[0])
                open_price = _parse_dec(row[5])
                sl = _parse_dec(row[6], None)
                tp_val = _parse_dec(row[7], None)
                close_time = _parse_time(row[8], server_utc_offset_minutes)
                close_price = _parse_dec(row[9])
                commission = _parse_dec(row[10], Decimal("0")) or Decimal("0")
                swap = _parse_dec(row[11], Decimal("0")) or Decimal("0")
                profit = _parse_dec(row[12])
                comment = row[13].strip() if len(row) > 13 and row[13].strip() else None

                if None in (volume, open_price, close_price, profit):
                    raise ValueError("Missing required numeric fields")

                report.positions.append(
                    ParsedPosition(
                        ticket=ticket,
                        symbol=symbol,
                        normalized_symbol=normalize_symbol(symbol),
                        side=side,
                        volume=volume,  # type: ignore[arg-type]
                        open_time=open_time,
                        close_time=close_time,
                        open_price=open_price,  # type: ignore[arg-type]
                        close_price=close_price,  # type: ignore[arg-type]
                        stop_loss=sl,
                        take_profit=tp_val,
                        commission=commission,
                        swap=swap,
                        fee=Decimal("0"),
                        profit=profit,  # type: ignore[arg-type]
                        close_reason=_infer_close_reason(close_price, sl, tp_val, comment),  # type: ignore[arg-type]
                        comment=comment,
                    )
                )
            except Exception as e:
                report.rows_skipped += 1
                report.errors.append(f"Positions row {idx}: {e}")

        elif section == "Deals":
            if first == "Time" and "Deal" in row:
                deal_cols = {c.strip().lower(): i for i, c in enumerate(row) if c.strip()}
                continue
            if not TIME_RE.match(row[0]):
                continue
            try:
                def _cell(name: str) -> str:
                    ci = deal_cols.get(name, -1)
                    return row[ci].strip() if 0 <= ci < len(row) else ""

                dt = _parse_time(_cell("time"), server_utc_offset_minutes)
                deal_id = int(_cell("deal"))
                symbol = _cell("symbol") or None
                deal_type = _cell("type").lower()
                direction = _cell("direction").lower() or None
                volume = _parse_dec(_cell("volume"), None)
                price = _parse_dec(_cell("price"), None)
                ord_str = _cell("order")
                order_id = int(ord_str) if ord_str.isdigit() else None
                commission = _parse_dec(_cell("commission"), Decimal("0")) or Decimal("0")
                fee = _parse_dec(_cell("fee"), Decimal("0")) or Decimal("0")
                swap = _parse_dec(_cell("swap"), Decimal("0")) or Decimal("0")
                profit = _parse_dec(_cell("profit"), Decimal("0")) or Decimal("0")
                balance = _parse_dec(_cell("balance"), None)
                comment = _cell("comment") or None

                report.deals.append(
                    ParsedDeal(
                        deal_id=deal_id,
                        time=dt,
                        type=deal_type,
                        direction=direction,
                        symbol=symbol,
                        volume=volume,
                        price=price,
                        order_id=order_id,
                        commission=commission,
                        fee=fee,
                        swap=swap,
                        profit=profit,
                        balance=balance,
                        comment=comment,
                    )
                )
            except Exception as e:
                report.errors.append(f"Deals row {idx}: {e}")

    # Enrich position comments / close_reason using matching 'out' deals
    out_deals_by_time_price: dict[tuple[datetime, Decimal], list[ParsedDeal]] = {}
    for d in report.deals:
        if d.direction == "out" and d.price is not None:
            out_deals_by_time_price.setdefault((d.time, d.price), []).append(d)

    for p in report.positions:
        candidates = out_deals_by_time_price.get((p.close_time, p.close_price), [])
        for d in candidates:
            if d.profit == p.profit and d.comment:
                if not p.comment:
                    p.comment = d.comment
                p.close_reason = _infer_close_reason(p.close_price, p.stop_loss, p.take_profit, p.comment)
                p.fee = d.fee
                break

    return report
