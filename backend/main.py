from __future__ import annotations

import asyncio
import contextlib
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Tuple, Union
from uuid import uuid4

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Header, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .database import SessionLocal, get_session
from .lock import SeatLockManager
from .models import Hold, Purchase, PurchaseItem, Seat, SeatStatus
from .schemas import (
    ConfirmRequest,
    ConfirmResponse,
    HoldRequest,
    HoldResponse,
    ReleaseRequest,
    SeatAdminBulkResponse,
    SeatAdminBulkUpdate,
    SeatAdminUpdate,
    SeatOut,
    SeatUpdateEvent,
    SeatUpdatePayload,
    SeatsResponse,
    StatsByTier,
    StatsResponse,
)
from .tasks import cleanup_loop

settings = get_settings()
app = FastAPI(title="Concert Seat Selection", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

try:
    app.mount("/static", StaticFiles(directory="data"), name="static")
except RuntimeError:
    pass


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: Dict[WebSocket, str] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, client_id: str) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[websocket] = client_id

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.pop(websocket, None)

    async def broadcast(self, event: dict) -> None:
        async with self._lock:
            connections = list(self._connections.items())
        stale: List[WebSocket] = []
        for websocket, _ in connections:
            try:
                await websocket.send_json(event)
            except Exception:
                stale.append(websocket)
        if stale:
            async with self._lock:
                for ws in stale:
                    self._connections.pop(ws, None)


lock_manager = SeatLockManager()
manager = ConnectionManager()
app.state.lock_manager = lock_manager
app.state.connection_manager = manager
app.state.cleanup_task = None


def _serialize_seat(seat: Seat, hold: Optional[Hold]) -> SeatOut:
    hold_info = None
    if hold:
        hold_info = {
            "client_id": hold.client_id,
            "expires_at": hold.expires_at,
        }
    return SeatOut(
        seat_id=seat.seat_id,
        floor=seat.floor,
        excel_row=seat.excel_row,
        excel_col=seat.excel_col,
        layout_row=seat.layout_row,
        layout_col=seat.layout_col,
        zone=seat.zone,
        tier=seat.tier,
        price=seat.price,
        status=seat.status.value,
        updated_at=seat.updated_at,
        hold=hold_info,
    )


def _apply_admin_update(
    session: Session,
    seat: Seat,
    update: Union[SeatAdminUpdate, SeatAdminBulkUpdate],
    now: datetime,
) -> Tuple[bool, Optional[str]]:
    status_changed = False
    previous_status_value: Optional[str] = None
    changed = False

    if update.status is not None and seat.status != update.status:
        previous_status_value = seat.status.value
        seat.status = update.status
        seat.updated_at = now
        status_changed = True
        changed = True
        if update.status != SeatStatus.HOLD:
            lock_manager.remove_holds_for_seat(session, seat.seat_id)

    if update.tier is not None:
        new_tier = update.tier or None
        if seat.tier != new_tier:
            seat.tier = new_tier
            seat.updated_at = now
            changed = True
        if update.price is None:
            calculated = settings.price_for_tier(new_tier)
            if seat.price != calculated:
                seat.price = calculated
                seat.updated_at = now
                changed = True

    if update.price is not None and seat.price != update.price:
        seat.price = update.price
        seat.updated_at = now
        changed = True

    return changed, previous_status_value


def _get_seats_by_ids(ids: Iterable[str]) -> List[Seat]:
    session = SessionLocal()
    try:
        stmt = select(Seat).where(Seat.seat_id.in_(list(ids)))
        seats = session.scalars(stmt).all()
        return seats
    finally:
        session.close()


async def broadcast_status_change(seat_ids: Iterable[str], from_status: str, to_status: str, by: Optional[str]) -> None:
    seat_list = _get_seats_by_ids(seat_ids)
    if not seat_list:
        return
    now = datetime.utcnow()
    for seat in seat_list:
        payload = SeatUpdatePayload(
            seat_id=seat.seat_id,
            from_=from_status,
            to=to_status,
            by=by,
            at=now,
        )
        event = SeatUpdateEvent(payload=payload)
        await manager.broadcast(event.dict(by_alias=True))


async def broadcast_cleanup(seat_ids: Iterable[str]) -> None:
    await broadcast_status_change(seat_ids, "HOLD", "AVAILABLE", "system")


def require_admin_token(x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token")) -> str:
    expected = settings.admin_token
    if expected:
        if x_admin_token != expected:
            raise HTTPException(status_code=403, detail="管理员令牌无效")
    else:
        if x_admin_token is None:
            raise HTTPException(status_code=403, detail="管理员令牌缺失")
    return x_admin_token or ""


@app.on_event("startup")
async def startup_event() -> None:
    task = asyncio.create_task(cleanup_loop(lock_manager, broadcast_cleanup))
    app.state.cleanup_task = task


@app.on_event("shutdown")
async def shutdown_event() -> None:
    task = app.state.cleanup_task
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


@app.get("/api/seats", response_model=SeatsResponse)
def get_seats(floor: int = Query(1, ge=1), session: Session = Depends(get_session)):
    stmt = (
        select(Seat, Hold)
        .outerjoin(Hold, Hold.seat_id == Seat.seat_id)
        .where(Seat.floor == floor)
        .order_by(Seat.excel_row, Seat.excel_col)
    )
    results = session.execute(stmt).all()
    seats = [_serialize_seat(seat, hold) for seat, hold in results]
    return SeatsResponse(floor=floor, seats=seats, generated_at=datetime.utcnow())


@app.post("/api/hold", response_model=HoldResponse)
def hold_seats(request: HoldRequest, background_tasks: BackgroundTasks, session: Session = Depends(get_session)):
    if not request.seat_ids:
        return HoldResponse(held=[], refreshed=[], conflicts=[], expire_at=None)
    newly_held, refreshed, conflicts, expire_at = lock_manager.hold_many(
        session, request.seat_ids, request.client_id
    )
    session.commit()
    if newly_held:
        background_tasks.add_task(broadcast_status_change, newly_held, "AVAILABLE", "HOLD", request.client_id)
    return HoldResponse(
        held=newly_held,
        refreshed=refreshed,
        conflicts=conflicts,
        expire_at=expire_at,
    )


@app.post("/api/release")
def release_seats(request: ReleaseRequest, background_tasks: BackgroundTasks, session: Session = Depends(get_session)):
    released = lock_manager.release_by_client(session, request.client_id, request.seat_ids)
    session.commit()
    if released:
        background_tasks.add_task(broadcast_status_change, released, "HOLD", "AVAILABLE", request.client_id)
    return {"released": released}


@app.post("/api/confirm", response_model=ConfirmResponse)
def confirm(request: ConfirmRequest, background_tasks: BackgroundTasks, session: Session = Depends(get_session)):
    if not request.seat_ids:
        raise HTTPException(status_code=400, detail="seat_ids 不能为空")

    existing = session.get(Purchase, request.request_id)
    if existing:
        if existing.client_id != request.client_id:
            raise HTTPException(status_code=400, detail="request_id 已被其他客户端使用")
        confirmed_ids = [item.seat_id for item in existing.items]
        return ConfirmResponse(confirmed=confirmed_ids, skipped=[])

    newly_confirmed, skipped = lock_manager.confirm(session, request.seat_ids, request.client_id)
    if not newly_confirmed:
        session.commit()
        return ConfirmResponse(confirmed=[], skipped=skipped)

    purchase = Purchase(request_id=request.request_id, client_id=request.client_id)
    session.add(purchase)
    for seat_id in newly_confirmed:
        seat = session.get(Seat, seat_id)
        if seat is None:
            continue
        item = PurchaseItem(request_id=request.request_id, seat_id=seat_id, price=seat.price)
        session.add(item)
    session.commit()

    background_tasks.add_task(broadcast_status_change, newly_confirmed, "HOLD", "SOLD", request.client_id)
    return ConfirmResponse(confirmed=newly_confirmed, skipped=skipped)


@app.patch("/api/admin/seats/{seat_id}", response_model=SeatOut)
def admin_update_seat(
    seat_id: str,
    update: SeatAdminUpdate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    _: str = Depends(require_admin_token),
):
    seat = session.get(Seat, seat_id)
    if seat is None:
        raise HTTPException(status_code=404, detail="座位不存在")

    now = datetime.utcnow()
    changed, previous_status = _apply_admin_update(session, seat, update, now)

    if not changed:
        hold = session.scalar(select(Hold).where(Hold.seat_id == seat.seat_id))
        return _serialize_seat(seat, hold)

    session.commit()
    session.refresh(seat)

    hold = session.scalar(select(Hold).where(Hold.seat_id == seat.seat_id))

    if previous_status is not None:
        background_tasks.add_task(
            broadcast_status_change,
            [seat.seat_id],
            previous_status,
            seat.status.value,
            "admin",
        )

    return _serialize_seat(seat, hold)


@app.post("/api/admin/seats/bulk", response_model=SeatAdminBulkResponse)
def admin_bulk_update_seats(
    request: SeatAdminBulkUpdate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    _: str = Depends(require_admin_token),
):
    if (
        request.status is None
        and request.tier is None
        and request.price is None
    ):
        raise HTTPException(status_code=400, detail="至少需要提供一个可更新字段")

    ids = list(dict.fromkeys(request.seat_ids))
    seats = session.scalars(select(Seat).where(Seat.seat_id.in_(ids))).all()
    found = {seat.seat_id: seat for seat in seats}
    missing = [seat_id for seat_id in ids if seat_id not in found]

    if not seats:
        return SeatAdminBulkResponse(updated=[], missing=missing)

    now = datetime.utcnow()
    status_changes: List[Tuple[str, str, str]] = []
    changed_seats: List[Seat] = []

    for seat in seats:
        changed, previous_status = _apply_admin_update(session, seat, request, now)
        if changed:
            changed_seats.append(seat)
            if previous_status is not None:
                status_changes.append((seat.seat_id, previous_status, seat.status.value))

    if not changed_seats:
        return SeatAdminBulkResponse(updated=[], missing=missing)

    session.commit()

    seat_ids = [seat.seat_id for seat in changed_seats]
    holds = session.scalars(select(Hold).where(Hold.seat_id.in_(seat_ids))).all()
    hold_by_id = {hold.seat_id: hold for hold in holds}

    serialized = [_serialize_seat(seat, hold_by_id.get(seat.seat_id)) for seat in changed_seats]

    for seat_id, previous, current in status_changes:
        background_tasks.add_task(
            broadcast_status_change,
            [seat_id],
            previous,
            current,
            "admin",
        )

    return SeatAdminBulkResponse(updated=serialized, missing=missing)


@app.get("/api/stats", response_model=StatsResponse)
def stats(session: Session = Depends(get_session)):
    seats = session.scalars(select(Seat)).all()
    totals = {
        "AVAILABLE": 0,
        "HOLD": 0,
        "SOLD": 0,
        "BLOCKED": 0,
    }
    per_tier: Dict[str, StatsByTier] = {}
    for seat in seats:
        totals[seat.status.value] += 1
        tier = seat.tier or "UNKNOWN"
        stats_row = per_tier.get(tier)
        if not stats_row:
            stats_row = StatsByTier(tier=tier, available=0, hold=0, sold=0, blocked=0, revenue=0)
            per_tier[tier] = stats_row
        if seat.status == SeatStatus.AVAILABLE:
            stats_row.available += 1
        elif seat.status == SeatStatus.HOLD:
            stats_row.hold += 1
        elif seat.status == SeatStatus.SOLD:
            stats_row.sold += 1
            stats_row.revenue += seat.price
        elif seat.status == SeatStatus.BLOCKED:
            stats_row.blocked += 1
    return StatsResponse(totals=totals, per_tier=list(per_tier.values()))


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    client_id = websocket.query_params.get("client_id") or str(uuid4())
    await manager.connect(websocket, client_id)
    try:
        await websocket.send_json({"event": "connected", "client_id": client_id})
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception:
        await manager.disconnect(websocket)


@app.get("/seats.json")
def seats_json():
    path = settings.seats_json_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="seats.json 尚未生成，请先运行 make init")
    return FileResponse(path)
