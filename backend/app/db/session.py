from collections.abc import AsyncIterator
import os

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import normalize_asyncpg_url, settings


def make_async_engine(raw_url: str | None = None) -> AsyncEngine:
    url, connect_args = normalize_asyncpg_url(raw_url or settings.effective_database_url)
    if os.getenv("VERCEL"):
        return create_async_engine(url, connect_args=connect_args, poolclass=NullPool)
    return create_async_engine(url, connect_args=connect_args, pool_pre_ping=True)


engine = make_async_engine()
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
