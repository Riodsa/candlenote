const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

/** Value of 1 unit of each currency in USD. Updated at runtime from /api/v1/market/fx-rates. */
const DEFAULT_USD_PER_UNIT: Record<string, number> = {
  USD: 1,
  USC: 0.01,
  THB: 1 / 34.0,
  EUR: 1 / 0.92,
};

let usdPerUnit: Record<string, number> = { ...DEFAULT_USD_PER_UNIT };

export function setFxRates(rates: Record<string, number> | null | undefined): void {
  if (!rates) return;
  usdPerUnit = { ...DEFAULT_USD_PER_UNIT, ...rates };
}

export function getUnitsPerUsd(currency: string): number {
  const rate = usdPerUnit[currency.toUpperCase()] ?? 1;
  return rate > 0 ? 1 / rate : 1;
}

export function convertCurrency(
  amount: number,
  fromCurrency = "USD",
  toCurrency = "USD",
  rates: Record<string, number> = usdPerUnit,
): number {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  if (from === to) return amount;
  const fromRate = rates[from] ?? 1;
  const toRate = rates[to] ?? 1;
  return (amount * fromRate) / toRate;
}

export function formatPrice(v: number | string | null | undefined): string {
  if (v == null || v === "") return "\u2014";
  const num = typeof v === "string" ? Number(v) : v;
  if (Number.isNaN(num)) return "\u2014";
  const digits = Math.abs(num) > 0 && Math.abs(num) < 1 ? 5 : 2;
  return num.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatPct(v: number | null | undefined): string {
  if (v == null) return "\u2014";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export function formatSigned(v: number | string | null | undefined): string {
  if (v == null || v === "") return "\u2014";
  const num = typeof v === "string" ? Number(v) : v;
  if (Number.isNaN(num)) return "\u2014";
  return `${num >= 0 ? "+" : ""}${formatPrice(num)}`;
}

export function formatCurrency(
  v: number | string | null | undefined,
  currency = "USD",
  signed = false,
  baseCurrency?: string,
): string {
  if (v == null || v === "") return "\u2014";
  const raw = typeof v === "string" ? Number(v) : v;
  if (Number.isNaN(raw)) return "\u2014";
  const num = convertCurrency(raw, baseCurrency ?? currency, currency);
  const sign = signed && num > 0 ? "+" : "";
  const formatted = num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${formatted} ${currency}`;
}

export function formatCompact(v: number | null | undefined): string {
  return v == null ? "\u2014" : compact.format(v);
}

export function changeColor(v: number | string | null | undefined): string {
  if (v == null || v === "") return "text-muted-foreground";
  const num = typeof v === "string" ? Number(v) : v;
  if (Number.isNaN(num) || num === 0) return "text-muted-foreground";
  return num > 0 ? "text-emerald-400" : "text-rose-400";
}

export function formatDateTimeTz(iso: string, timeZone = "Asia/Bangkok"): string {
  try {
    const dt = new Date(iso);
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(dt);
  } catch {
    return iso;
  }
}

// Fixed date avoids Next.js 16 prerender error on new Date(); pass atDate for exact DST offsets.
const REF_TZ_DATE = new Date(Date.UTC(2026, 0, 15));

export function getTzShortLabel(timeZone = "Asia/Bangkok", atDate: Date = REF_TZ_DATE): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(atDate);
    const tzName = parts.find((p) => p.type === "timeZoneName")?.value;
    if (!tzName || tzName === "GMT") return "UTC";
    return tzName;
  } catch {
    return timeZone;
  }
}

export function getTzOffsetSeconds(timeZone = "Asia/Bangkok", atEpochSeconds?: number): number {
  const label = getTzShortLabel(
    timeZone,
    atEpochSeconds != null ? new Date(atEpochSeconds * 1000) : REF_TZ_DATE,
  );
  if (label === "UTC" || label === "GMT") return 0;
  const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(label);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 3600 + Number(m[3] || 0) * 60);
}

export function formatSeconds(seconds: number): string {
  const sec = Math.max(0, Math.round(seconds));
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  if (mins < 60) return `${mins}m ${sec % 60}s`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

export function formatDuration(openIso: string, closeIso: string): string {
  const sec = Math.max(0, Math.round((new Date(closeIso).getTime() - new Date(openIso).getTime()) / 1000));
  return formatSeconds(sec);
}
