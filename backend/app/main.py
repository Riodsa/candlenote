import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import analytics, journal, market, watchlist
from app.core.config import settings
from app.db.seed import seed
from app.db.session import SessionLocal
from app.services.market.base import ProviderError
from app.services.market.finnhub import FinnhubProvider
from app.services.market.fx import FxRates
from app.services.market.hub import QuoteHub
from app.services.market.twelvedata import TwelveDataProvider
from app.ws import quotes

logging.basicConfig(level=logging.INFO)
# httpx logs full request URLs at INFO, which would include provider API keys.
logging.getLogger("httpx").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with httpx.AsyncClient() as client:
        hub = QuoteHub(
            FinnhubProvider(settings.finnhub_api_key, client),
            TwelveDataProvider(settings.twelvedata_api_key, client, settings.poll_interval_seconds),
        )
        app.state.hub = hub
        app.state.fx = FxRates(client)
        async with SessionLocal() as session:
            await seed(session)
        await hub.start()
        yield
        await hub.stop()


app = FastAPI(title="Investing Watchlist & Journal API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ProviderError)
async def provider_error_handler(_: Request, exc: ProviderError):
    return JSONResponse(status_code=502, content={"detail": str(exc)})


@app.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(watchlist.router, prefix="/api/v1")
app.include_router(market.router, prefix="/api/v1")
app.include_router(journal.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(quotes.router)
