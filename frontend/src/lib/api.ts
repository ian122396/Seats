import type {
  AdminSeatUpdatePayload,
  AdminSeatBulkResponse,
  ConfirmResponse,
  HoldResponse,
  ReleaseResponse,
  Seat,
  SeatsResponse,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status}`);
  }
  if (response.status === 204) {
    return null as unknown as T;
  }
  return (await response.json()) as T;
}

export async function fetchSeats(floor: number): Promise<SeatsResponse> {
  return request<SeatsResponse>(`/api/seats?floor=${floor}`);
}

export async function holdSeats(seatIds: string[], clientId: string): Promise<HoldResponse> {
  return request<HoldResponse>('/api/hold', {
    method: 'POST',
    body: JSON.stringify({ seat_ids: seatIds, client_id: clientId }),
  });
}

export async function releaseSeats(
  seatIds: string[] | undefined,
  clientId: string,
): Promise<ReleaseResponse> {
  return request<ReleaseResponse>('/api/release', {
    method: 'POST',
    body: JSON.stringify({ seat_ids: seatIds, client_id: clientId }),
  });
}

export async function confirmSeats(
  seatIds: string[],
  clientId: string,
  requestId: string,
): Promise<ConfirmResponse> {
  return request<ConfirmResponse>('/api/confirm', {
    method: 'POST',
    body: JSON.stringify({ seat_ids: seatIds, client_id: clientId, request_id: requestId }),
  });
}

export async function adminUpdateSeat(
  seatId: string,
  payload: AdminSeatUpdatePayload,
  adminToken: string,
): Promise<Seat> {
  return request<Seat>(`/api/admin/seats/${seatId}`, {
    method: 'PATCH',
    headers: {
      'X-Admin-Token': adminToken,
    },
    body: JSON.stringify(payload),
  });
}

export async function adminBulkUpdateSeats(
  seatIds: string[],
  payload: AdminSeatUpdatePayload,
  adminToken: string,
): Promise<AdminSeatBulkResponse> {
  return request<AdminSeatBulkResponse>('/api/admin/seats/bulk', {
    method: 'POST',
    headers: {
      'X-Admin-Token': adminToken,
    },
    body: JSON.stringify({
      seat_ids: seatIds,
      status: payload.status,
      tier: payload.tier,
      price: payload.price,
    }),
  });
}
