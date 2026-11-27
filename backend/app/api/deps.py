from fastapi import Request

from app.services.market.fx import FxRates
from app.services.market.hub import QuoteHub


def get_hub(request: Request) -> QuoteHub:
    return request.app.state.hub


def get_fx(request: Request) -> FxRates:
    return request.app.state.fx
