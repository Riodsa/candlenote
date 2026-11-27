import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://investing:investing@localhost:5432/investing"
    postgres_url: str = ""
    finnhub_api_key: str = ""
    twelvedata_api_key: str = ""
    cors_origins: str = "http://localhost:3000"
    # Seconds between REST polls for symbols without a streaming feed (e.g. XAUUSD on free tier)
    poll_interval_seconds: float = 10.0

    @property
    def effective_database_url(self) -> str:
        # Vercel Marketplace Postgres integrations may expose POSTGRES_URL or DATABASE_URL.
        if self.postgres_url and "localhost" in self.database_url:
            return self.postgres_url
        return self.database_url

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


def normalize_asyncpg_url(raw_url: str) -> tuple[str, dict]:
    """Convert standard postgres:// or postgresql:// URLs (e.g. Neon) for SQLAlchemy asyncpg."""
    url = raw_url.strip()
    if url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://") :]

    parts = urlsplit(url)
    connect_args: dict = {}
    kept_params: list[tuple[str, str]] = []
    for k, v in parse_qsl(parts.query, keep_blank_values=True):
        kl = k.lower()
        if kl == "sslmode":
            if v.lower() != "disable":
                connect_args["ssl"] = "require"
        elif kl == "channel_binding":
            continue  # libpq-only param rejected by asyncpg
        else:
            kept_params.append((k, v))

    if os.getenv("VERCEL") or "-pooler." in (parts.hostname or ""):
        connect_args["statement_cache_size"] = 0

    clean_url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(kept_params), parts.fragment))
    return clean_url, connect_args


settings = Settings()
