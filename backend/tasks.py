import asyncio
from typing import Awaitable, Callable, Iterable

from sqlalchemy.orm import Session

from .config import get_settings
from .database import SessionLocal
from .lock import SeatLockManager

Broadcaster = Callable[[Iterable[str]], Awaitable[None]]


def _cleanup_once(lock_manager: SeatLockManager) -> Iterable[str]:
    session: Session = SessionLocal()
    try:
        expired_ids = lock_manager.cleanup_expired(session)
        session.commit()
        return expired_ids
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


async def cleanup_loop(lock_manager: SeatLockManager, broadcaster: Broadcaster) -> None:
    settings = get_settings()
    interval = max(1, settings.cleanup_interval_seconds)
    while True:
        await asyncio.sleep(interval)
        expired_ids = _cleanup_once(lock_manager)
        if expired_ids:
            await broadcaster(expired_ids)
