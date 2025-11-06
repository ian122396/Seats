from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import Hold, Seat, SeatStatus


class _RedisHelper:
    def __init__(self, url: str):
        import redis  # type: ignore

        self._client = redis.Redis.from_url(url, decode_responses=True)

    def acquire(self, seat_id: str, client_id: str, ttl: int) -> bool:
        key = f"lock:seat:{seat_id}"
        return bool(self._client.set(name=key, value=client_id, nx=True, ex=ttl))

    def release(self, seat_id: str, client_id: str) -> None:
        key = f"lock:seat:{seat_id}"
        with self._client.pipeline() as pipe:  # type: ignore[attr-defined]
            while True:
                try:
                    pipe.watch(key)
                    current = pipe.get(key)
                    if current != client_id:
                        pipe.unwatch()
                        return
                    pipe.multi()
                    pipe.delete(key)
                    pipe.execute()
                    return
                except Exception:  # redis.WatchError and others
                    continue

    def refresh(self, seat_id: str, client_id: str, ttl: int) -> None:
        key = f"lock:seat:{seat_id}"
        stored = self._client.get(key)
        if stored == client_id:
            self._client.expire(key, ttl)

    def cleanup(self, _: Iterable[str]) -> None:  # pragma: no cover
        return


class SeatLockManager:
    def __init__(self) -> None:
        settings = get_settings()
        self.ttl_seconds = settings.hold_ttl_seconds
        self._redis = None
        if settings.allow_redis and settings.redis_url:
            try:
                self._redis = _RedisHelper(settings.redis_url)
            except Exception:
                self._redis = None

    def hold_many(
        self, session: Session, seat_ids: Iterable[str], client_id: str
    ) -> Tuple[List[str], List[str], List[str], Optional[datetime]]:
        newly_held: List[str] = []
        refreshed: List[str] = []
        conflicts: List[str] = []
        now = datetime.utcnow()
        expire_at = now + timedelta(seconds=self.ttl_seconds)

        for seat_id in seat_ids:
            seat = session.get(Seat, seat_id)
            if seat is None:
                conflicts.append(seat_id)
                continue
            if seat.status in {SeatStatus.SOLD, SeatStatus.BLOCKED}:
                conflicts.append(seat_id)
                continue

            existing_hold: Optional[Hold] = session.scalar(
                select(Hold).where(Hold.seat_id == seat_id)
            )
            if existing_hold:
                if existing_hold.client_id != client_id:
                    conflicts.append(seat_id)
                    continue
                existing_hold.expires_at = expire_at
                refreshed.append(seat_id)
                if self._redis:
                    self._redis.refresh(seat_id, client_id, self.ttl_seconds)
            else:
                if self._redis and not self._redis.acquire(seat_id, client_id, self.ttl_seconds):
                    conflicts.append(seat_id)
                    continue
                hold = Hold(seat_id=seat_id, client_id=client_id, expires_at=expire_at)
                session.add(hold)
                newly_held.append(seat_id)

            seat.status = SeatStatus.HOLD
            seat.updated_at = now

        bucket = newly_held if newly_held else refreshed
        return newly_held, refreshed, conflicts, expire_at if bucket else None

    def release_by_client(self, session: Session, client_id: str, seat_ids: Optional[Iterable[str]] = None) -> List[str]:
        query = select(Hold).where(Hold.client_id == client_id)
        if seat_ids is not None:
            ids = list(seat_ids)
            if not ids:
                return []
            query = query.where(Hold.seat_id.in_(ids))
        holds = session.scalars(query).all()
        released: List[str] = []
        now = datetime.utcnow()
        for hold in holds:
            seat = session.get(Seat, hold.seat_id)
            if seat and seat.status == SeatStatus.HOLD:
                seat.status = SeatStatus.AVAILABLE
                seat.updated_at = now
                released.append(seat.seat_id)
            if self._redis:
                self._redis.release(hold.seat_id, hold.client_id)
            session.delete(hold)
        return released

    def confirm(self, session: Session, seat_ids: Iterable[str], client_id: str) -> Tuple[List[str], List[str]]:
        confirmed: List[str] = []
        skipped: List[str] = []
        now = datetime.utcnow()
        ids = list(seat_ids)
        if not ids:
            return confirmed, skipped

        holds = session.scalars(
            select(Hold).where(Hold.seat_id.in_(ids))
        ).all()
        holds_by_id: Dict[str, Hold] = {h.seat_id: h for h in holds}

        for seat_id in ids:
            seat = session.get(Seat, seat_id)
            hold = holds_by_id.get(seat_id)
            if seat is None or seat.status == SeatStatus.SOLD:
                skipped.append(seat_id)
                continue
            if not hold or hold.client_id != client_id or hold.expires_at <= now:
                skipped.append(seat_id)
                continue
            seat.status = SeatStatus.SOLD
            seat.updated_at = now
            confirmed.append(seat_id)
            session.delete(hold)
            if self._redis:
                self._redis.release(seat_id, client_id)
        return confirmed, skipped

    def remove_holds_for_seat(self, session: Session, seat_id: str) -> bool:
        holds = session.scalars(select(Hold).where(Hold.seat_id == seat_id)).all()
        if not holds:
            return False
        for hold in holds:
            if self._redis:
                self._redis.release(hold.seat_id, hold.client_id)
            session.delete(hold)
        return True

    def cleanup_expired(self, session: Session) -> List[str]:
        now = datetime.utcnow()
        expired_holds = session.scalars(
            select(Hold).where(Hold.expires_at <= now)
        ).all()
        expired_ids: List[str] = []
        for hold in expired_holds:
            seat = session.get(Seat, hold.seat_id)
            if seat and seat.status == SeatStatus.HOLD:
                seat.status = SeatStatus.AVAILABLE
                seat.updated_at = now
                expired_ids.append(seat.seat_id)
            if self._redis:
                self._redis.release(hold.seat_id, hold.client_id)
            session.delete(hold)
        return expired_ids
