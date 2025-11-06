export type SeatStatus = 'AVAILABLE' | 'HOLD' | 'SOLD' | 'BLOCKED';

export interface SeatHoldInfo {
  client_id: string;
  expires_at: string;
}

export interface Seat {
  seat_id: string;
  floor: number;
  excel_row: number;
  excel_col: number;
  layout_row: number | null;
  layout_col: number | null;
  zone: string;
  tier: string | null;
  price: number;
  status: SeatStatus;
  updated_at: string;
  hold?: SeatHoldInfo | null;
}

export interface AdminSeatUpdatePayload {
  status?: SeatStatus;
  tier?: string | null;
  price?: number | null;
}

export interface AdminSeatBulkResponse {
  updated: Seat[];
  missing: string[];
}

export interface SeatsResponse {
  floor: number;
  seats: Seat[];
  generated_at: string;
}

export interface HoldResponse {
  held: string[];
  refreshed: string[];
  conflicts: string[];
  expire_at: string | null;
}

export interface ReleaseResponse {
  released: string[];
}

export interface ConfirmResponse {
  confirmed: string[];
  skipped: string[];
}

export interface SeatUpdateEvent {
  event: string;
  payload?: {
    seat_id: string;
    from: SeatStatus;
    to: SeatStatus;
    by?: string;
    at: string;
  };
  client_id?: string;
}
