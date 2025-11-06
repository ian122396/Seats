from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import Column, DateTime, Enum as SqlEnum, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import relationship

from .database import Base


class SeatStatus(str, Enum):
    AVAILABLE = "AVAILABLE"
    HOLD = "HOLD"
    SOLD = "SOLD"
    BLOCKED = "BLOCKED"


class Seat(Base):
    __tablename__ = "seats"

    seat_id = Column(String, primary_key=True)
    floor = Column(Integer, nullable=False, index=True)
    excel_row = Column(Integer, nullable=False)
    excel_col = Column(Integer, nullable=False)
    layout_row = Column(Integer, nullable=True)
    layout_col = Column(Integer, nullable=True)
    zone = Column(String, nullable=False)
    tier = Column(String, nullable=True)
    price = Column(Integer, nullable=False, default=0)
    status = Column(SqlEnum(SeatStatus, name="seat_status"), nullable=False, default=SeatStatus.AVAILABLE)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    holds = relationship("Hold", back_populates="seat", cascade="all, delete-orphan")
    purchase_items = relationship("PurchaseItem", back_populates="seat")


class Hold(Base):
    __tablename__ = "holds"
    __table_args__ = (UniqueConstraint("seat_id", name="uq_hold_seat"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    seat_id = Column(String, ForeignKey("seats.seat_id", ondelete="CASCADE"), nullable=False)
    client_id = Column(String, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    seat = relationship("Seat", back_populates="holds")


class Purchase(Base):
    __tablename__ = "purchases"

    request_id = Column(String, primary_key=True)
    client_id = Column(String, nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    items = relationship("PurchaseItem", back_populates="purchase", cascade="all, delete-orphan")


class PurchaseItem(Base):
    __tablename__ = "purchase_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    request_id = Column(String, ForeignKey("purchases.request_id", ondelete="CASCADE"), nullable=False, index=True)
    seat_id = Column(String, ForeignKey("seats.seat_id", ondelete="CASCADE"), nullable=False, index=True)
    price = Column(Integer, nullable=False)

    purchase = relationship("Purchase", back_populates="items")
    seat = relationship("Seat", back_populates="purchase_items")
