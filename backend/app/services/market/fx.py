"""Cached FX rates from Frankfurter (ECB) with static fallback when offline."""
from __future__ import annotations

from datetime import datetime, timezone
import logging
import time

import httpx

log = logging.getLogger(__name__)

FRANKFURTER_URL = "https://api.frankfurter.app/latest"
FALLBACK_USD_PER_UNIT: dict[str, float] = {
    "USD": 1.0,
    "USC": 0.01,
    "THB": round(1.0 / 34.0, 8),
    "EUR": round(1.0 / 0.92, 8),
}


class FxRates:
    TTL = 3600.0  # seconds

    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client
        self._cached: dict | None = None
        self._fetched_at: float = 0.0

    async def get_rates(self) -> dict:
        now = time.monotonic()
        if self._cached is not None and (now - self._fetched_at) < self.TTL:
            return self._cached

        try:
            resp = await self._client.get(
                FRANKFURTER_URL,
                params={"from": "USD", "to": "THB,EUR"},
                timeout=5.0,
            )
            resp.raise_for_status()
            rates = resp.json().get("rates") or {}
            thb = float(rates["THB"])
            eur = float(rates["EUR"])
            if thb <= 0 or eur <= 0:
                raise ValueError("Non-positive FX rate")
            self._cached = {
                "source": "frankfurter",
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "usd_per_unit": {
                    "USD": 1.0,
                    "USC": 0.01,
                    "THB": round(1.0 / thb, 8),
                    "EUR": round(1.0 / eur, 8),
                },
            }
            self._fetched_at = now
            return self._cached
        except Exception as exc:
            log.warning("FX fetch failed, using %s: %s", "cached" if self._cached else "fallback", exc)
            if self._cached is not None:
                return self._cached
            return {
                "source": "fallback",
                "updated_at": None,
                "usd_per_unit": dict(FALLBACK_USD_PER_UNIT),
            }
