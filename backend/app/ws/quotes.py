import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.db.models.instrument import Instrument
from app.db.session import SessionLocal
from app.services.market.hub import Client, ref_from_instrument

log = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws/quotes")
async def quotes_ws(ws: WebSocket):
    """Protocol (JSON):
    client -> {"action": "subscribe"|"unsubscribe", "symbols": ["AAPL", ...]} | {"action": "ping"}
    server -> {"type": "quote", "data": {...}} | {"type": "error", "symbol", "message"} | {"type": "pong"}
    """
    await ws.accept()
    hub = ws.app.state.hub
    client = Client()

    async def sender() -> None:
        while True:
            await ws.send_json(await client.queue.get())

    send_task = asyncio.create_task(sender())
    try:
        while True:
            msg = await ws.receive_json()
            action = msg.get("action")
            symbols = [str(s).upper() for s in msg.get("symbols", [])][:100]
            if action == "subscribe":
                async with SessionLocal() as session:
                    rows = await session.scalars(select(Instrument).where(Instrument.symbol.in_(symbols)))
                    instruments = list(rows)
                for missing in set(symbols) - {i.symbol for i in instruments}:
                    client.push({"type": "error", "symbol": missing, "message": "Unknown symbol"})
                await hub.subscribe(client, [ref_from_instrument(i) for i in instruments])
            elif action == "unsubscribe":
                await hub.unsubscribe(client, symbols)
            elif action == "ping":
                client.push({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("quotes websocket error")
    finally:
        send_task.cancel()
        await hub.disconnect(client)
