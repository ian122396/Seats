from datetime import datetime
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from .models import SeatStatus


class HoldInfo(BaseModel):
    client_id: str
    expires_at: datetime


class SeatOut(BaseModel):
    seat_id: str
    floor: int
    excel_row: int
    excel_col: int
    layout_row: Optional[int]
    layout_col: Optional[int]
    zone: str
    tier: Optional[str]
    price: int
    status: str
    updated_at: datetime
    hold: Optional[HoldInfo] = None

    class Config:
        orm_mode = True


class SeatsResponse(BaseModel):
    floor: int
    seats: List[SeatOut]
    generated_at: datetime


class HoldRequest(BaseModel):
    seat_ids: List[str] = Field(default_factory=list)
    client_id: str


class HoldResponse(BaseModel):
    held: List[str]
    refreshed: List[str]
    conflicts: List[str]
    expire_at: Optional[datetime]


class ReleaseRequest(BaseModel):
    seat_ids: Optional[List[str]] = None
    client_id: str


class ConfirmRequest(BaseModel):
    seat_ids: List[str]
    client_id: str
    request_id: str


class ConfirmResponse(BaseModel):
    confirmed: List[str]
    skipped: List[str]


class StatsByTier(BaseModel):
    tier: str
    available: int
    hold: int
    sold: int
    blocked: int
    revenue: int


class StatsResponse(BaseModel):
    totals: dict
    per_tier: List[StatsByTier]


class SeatUpdatePayload(BaseModel):
    seat_id: str
    from_: str = Field(alias="from")
    to: str
    by: Optional[str]
    at: datetime

    class Config:
        allow_population_by_field_name = True


class SeatUpdateEvent(BaseModel):
    event: str = "seat_update"
    payload: SeatUpdatePayload

    class Config:
        allow_population_by_field_name = True


class SeatAdminUpdate(BaseModel):
    status: Optional[SeatStatus] = None
    tier: Optional[str] = None
    price: Optional[int] = Field(default=None, ge=0)


class SeatAdminBulkUpdate(BaseModel):
    seat_ids: List[str] = Field(..., min_items=1)
    status: Optional[SeatStatus] = None
    tier: Optional[str] = None
    price: Optional[int] = Field(default=None, ge=0)


class SeatAdminBulkResponse(BaseModel):
    updated: List[SeatOut]
    missing: List[str]
