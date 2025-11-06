import { useEffect, useMemo, useReducer, useState } from 'react';
import AdminPanel from './components/AdminPanel';
import SelectionSummary from './components/SelectionSummary';
import SeatMap from './components/SeatMap';
import { adminBulkUpdateSeats, adminUpdateSeat, confirmSeats, fetchSeats, holdSeats, releaseSeats } from './lib/api';
import { subscribeSeatUpdates } from './lib/socket';
import type { AdminSeatUpdatePayload, Seat, SeatStatus } from './types';

const HOLD_TTL_SECONDS = 120;
const TIER_OPTIONS = ['VIP', 'A', 'B', 'C', 'E', 'UNKNOWN'];
const STATUS_OPTIONS: SeatStatus[] = ['AVAILABLE', 'HOLD', 'SOLD', 'BLOCKED'];
const TIER_COLORS: Record<string, string> = {
  VIP: '#e63946',
  A: '#f3722c',
  B: '#f9c74f',
  C: '#43aa8b',
  E: '#277da1',
  UNKNOWN: '#94a3b8',
};

function seatIdToFloor(seatId: string): number {
  const [floor] = seatId.split('-');
  const parsed = Number(floor);
  return Number.isFinite(parsed) ? parsed : 1;
}

type SeatState = Record<number, Record<string, Seat>>;

type SeatAction =
  | { type: 'SET_SEATS'; floor: number; seats: Seat[] }
  | {
      type: 'PATCH_SEATS';
      floor: number;
      updates: { seatId: string; patch: (seat: Seat | undefined) => Seat | undefined }[];
    };

function seatReducer(state: SeatState, action: SeatAction): SeatState {
  switch (action.type) {
    case 'SET_SEATS': {
      const map: Record<string, Seat> = {};
      action.seats.forEach((seat) => {
        map[seat.seat_id] = seat;
      });
      return { ...state, [action.floor]: map };
    }
    case 'PATCH_SEATS': {
      const currentFloorMap = state[action.floor];
      if (!currentFloorMap) {
        return state;
      }
      let changed = false;
      const nextFloorMap: Record<string, Seat> = { ...currentFloorMap };
      for (const update of action.updates) {
        const existing = currentFloorMap[update.seatId];
        const next = update.patch(existing);
        if (!next || (existing && next === existing)) {
          continue;
        }
        nextFloorMap[update.seatId] = next;
        changed = true;
      }
      if (!changed) {
        return state;
      }
      return { ...state, [action.floor]: nextFloorMap };
    }
    default:
      return state;
  }
}

function ensureClientId(): string {
  const key = 'seat-client-id';
  const stored = localStorage.getItem(key);
  if (stored) {
    return stored;
  }
  const id = self.crypto?.randomUUID ? self.crypto.randomUUID() : `client-${Date.now()}`;
  localStorage.setItem(key, id);
  return id;
}

function getExpireAtOrDefault(expireAt: string | null | undefined): string {
  if (expireAt) return expireAt;
  const fallback = new Date(Date.now() + HOLD_TTL_SECONDS * 1000).toISOString();
  return fallback;
}

const TIER_LABELS: Record<string, string> = {
  VIP: 'VIP',
  A: 'A 区',
  B: 'B 区',
  C: 'C 区',
  E: 'E 区',
  UNKNOWN: '未知票档',
};

const STATUS_LABELS: Record<SeatStatus, string> = {
  AVAILABLE: '可售',
  HOLD: '锁定',
  SOLD: '已售',
  BLOCKED: '禁售',
};

export default function App() {
  const readAdminToken = () => {
    if (typeof window === 'undefined') {
      return '';
    }
    return localStorage.getItem('seat-admin-token') ?? '';
  };

  const [seatState, dispatch] = useReducer(seatReducer, {});
  const [floor, setFloor] = useState(1);
  const [tierFilters, setTierFilters] = useState<Set<string>>(() => new Set(TIER_OPTIONS));
  const [statusFilters, setStatusFilters] = useState<Set<SeatStatus>>(() => new Set(STATUS_OPTIONS));
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'error' | 'success'>('error');
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [wsStatus, setWsStatus] = useState('connecting...');
  const [releasing, setReleasing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [holding, setHolding] = useState(false);
  const [adminToken, setAdminToken] = useState<string>(readAdminToken);
  const [adminTokenInput, setAdminTokenInput] = useState<string>(readAdminToken);
  const [adminEnabled, setAdminEnabled] = useState<boolean>(() => Boolean(readAdminToken()));
  const [adminSelectedSeatIds, setAdminSelectedSeatIds] = useState<string[]>([]);
  const [adminActiveSeatId, setAdminActiveSeatId] = useState('');
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminAuthError, setAdminAuthError] = useState<string | null>(null);

  const clientId = useMemo(() => ensureClientId(), []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchSeats(floor)
      .then((response) => {
        if (!active) return;
        dispatch({ type: 'SET_SEATS', floor, seats: response.seats });
      })
      .catch((error) => {
        if (!active) return;
        setMessage(`加载座位失败：${error.message}`);
        setMessageTone('error');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [floor]);

  useEffect(() => {
    return subscribeSeatUpdates({
      clientId,
      onStatus: (text) => setWsStatus(text),
      onUpdate: (payload) => {
        const { seat_id, to, by, at } = payload;
        const seatFloor = seatIdToFloor(seat_id);
        dispatch({
          type: 'PATCH_SEATS',
          floor: seatFloor,
          updates: [
            {
              seatId: seat_id,
              patch: (seat) => {
                if (!seat) return seat;
                const next: Seat = {
                  ...seat,
                  status: to,
                  updated_at: new Date(at).toISOString(),
                };
                if (to === 'HOLD') {
                  next.hold = {
                    client_id: by ?? (seat.hold?.client_id ?? 'unknown'),
                    expires_at:
                      by === clientId && seat.hold?.expires_at
                        ? seat.hold.expires_at
                        : getExpireAtOrDefault(undefined),
                  };
                } else {
                  next.hold = null;
                }
                if (to === 'SOLD') {
                  next.hold = null;
                }
                return next;
              },
            },
          ],
        });
      },
    });
  }, [clientId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (adminEnabled && adminToken) {
      localStorage.setItem('seat-admin-token', adminToken);
    } else if (!adminEnabled) {
      localStorage.removeItem('seat-admin-token');
    }
  }, [adminEnabled, adminToken]);

  useEffect(() => {
    if (!adminEnabled) {
      setAdminSelectedSeatIds([]);
      setAdminActiveSeatId('');
      setAdminSaving(false);
    }
  }, [adminEnabled]);

  const seatMap = seatState[floor] ?? {};
  const seats = useMemo(() => Object.values(seatMap), [seatMap]);

  const allSeats = useMemo(() => {
    const list: Seat[] = [];
    Object.values(seatState).forEach((floorMap) => {
      if (!floorMap) return;
      list.push(...Object.values(floorMap));
    });
    return list;
  }, [seatState]);

  const adminTierOptions = useMemo(() => {
    const tierSet = new Set<string>(TIER_OPTIONS);
    allSeats.forEach((seat) => {
      if (seat.tier) {
        tierSet.add(seat.tier);
      }
    });
    return Array.from(tierSet);
  }, [allSeats]);

  const heldBySelf = useMemo(
    () => seats.filter((seat) => seat.status === 'HOLD' && seat.hold?.client_id === clientId),
    [seats, clientId],
  );

  const totalAmount = heldBySelf.reduce((sum, seat) => sum + seat.price, 0);
  const nextExpire = heldBySelf.reduce((min, seat) => {
    if (!seat.hold?.expires_at) return min;
    const ts = new Date(seat.hold.expires_at).getTime();
    return Number.isNaN(ts) ? min : Math.min(min, ts);
  }, Number.POSITIVE_INFINITY);
  const remainingSeconds = Number.isFinite(nextExpire) ? Math.max(0, Math.floor((nextExpire - now) / 1000)) : 0;

  const counts = useMemo(() => {
    const result: Record<SeatStatus, number> = {
      AVAILABLE: 0,
      HOLD: 0,
      SOLD: 0,
      BLOCKED: 0,
    };
    seats.forEach((seat) => {
      result[seat.status] += 1;
    });
    return result;
  }, [seats]);

  const showMessage = (text: string, tone: 'error' | 'success' = 'error') => {
    setMessage(text);
    setMessageTone(tone);
    window.setTimeout(() => setMessage(null), 4000);
  };

  const normalizeErrorMessage = (raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string') {
        return parsed;
      }
      if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
        const detail = (parsed as { detail?: unknown }).detail;
        if (typeof detail === 'string') {
          return detail;
        }
      }
    } catch (error) {
      // ignore JSON parse issues
    }
    return raw;
  };

  const handleEnterAdmin = () => {
    const trimmed = adminTokenInput.trim();
    if (!trimmed) {
      setAdminAuthError('请输入管理员令牌');
      return;
    }
    setAdminToken(trimmed);
    setAdminEnabled(true);
    setAdminAuthError(null);
  };

  const handleExitAdmin = () => {
    setAdminEnabled(false);
    setAdminToken('');
    setAdminTokenInput('');
    setAdminAuthError(null);
    handleAdminClearSelection();
  };

  const normalizeSeatId = (seatId: string) => seatId.trim().toUpperCase();

  const handleAdminClearSelection = () => {
    setAdminSelectedSeatIds([]);
    setAdminActiveSeatId('');
  };

  const handleAdminActivateSeat = (seatId: string, options?: { replaceSelection?: boolean }) => {
    const normalized = normalizeSeatId(seatId);
    if (!normalized) {
      return;
    }
    setAdminActiveSeatId(normalized);
    setFloor(seatIdToFloor(normalized));
    setAdminSelectedSeatIds((prev) => {
      const replaceSelection = options?.replaceSelection ?? true;
      if (replaceSelection) {
        if (prev.length === 1 && prev[0] === normalized) {
          return prev;
        }
        return [normalized];
      }
      if (prev.includes(normalized)) {
        return prev;
      }
      return [...prev, normalized];
    });
  };

  const handleAdminToggleSeat = (seatId: string) => {
    const normalized = normalizeSeatId(seatId);
    if (!normalized) {
      return;
    }
    setAdminSelectedSeatIds((prev) => {
      const exists = prev.includes(normalized);
      const next = exists ? prev.filter((id) => id !== normalized) : [...prev, normalized];
      setAdminActiveSeatId((current) => {
        if (!exists) {
          return normalized;
        }
        if (current === normalized) {
          return next[next.length - 1] ?? '';
        }
        return current;
      });
      return next;
    });
    setFloor(seatIdToFloor(normalized));
  };

  const handleAdminUpdate = async (seatId: string, payload: AdminSeatUpdatePayload) => {
    if (!adminToken) {
      const error = new Error('管理员令牌缺失');
      showMessage(error.message, 'error');
      throw error;
    }
    try {
      setAdminSaving(true);
      const updated = await adminUpdateSeat(seatId, payload, adminToken);
      dispatch({
        type: 'PATCH_SEATS',
        floor: updated.floor,
        updates: [
          {
            seatId: updated.seat_id,
            patch: () => updated,
          },
        ],
      });
      setAdminActiveSeatId(updated.seat_id);
      setAdminSelectedSeatIds((prev) => (prev.includes(updated.seat_id) ? prev : [...prev, updated.seat_id]));
      showMessage('座位信息已更新', 'success');
    } catch (error) {
      const err = error as Error;
      const messageText = normalizeErrorMessage(err.message);
      showMessage(`管理员操作失败：${messageText}`);
      throw new Error(messageText);
    } finally {
      setAdminSaving(false);
    }
  };

  const handleAdminBulkUpdate = async (
    seatIds: string[],
    payload: AdminSeatUpdatePayload,
  ) => {
    if (!adminToken) {
      const error = new Error('管理员令牌缺失');
      showMessage(error.message, 'error');
      throw error;
    }

    try {
      setAdminSaving(true);
      const response = await adminBulkUpdateSeats(seatIds, payload, adminToken);

      if (response.updated.length) {
        const grouped = new Map<number, Seat[]>();
        const floorsToRefresh = new Set<number>();

        response.updated.forEach((seat) => {
          const list = grouped.get(seat.floor) ?? [];
          list.push(seat);
          grouped.set(seat.floor, list);
          if (!seatState[seat.floor]) {
            floorsToRefresh.add(seat.floor);
          }
        });

        grouped.forEach((items, seatFloor) => {
          if (!seatState[seatFloor]) {
            return;
          }
          dispatch({
            type: 'PATCH_SEATS',
            floor: seatFloor,
            updates: items.map((seat) => ({
              seatId: seat.seat_id,
              patch: () => seat,
            })),
          });
        });

        if (floorsToRefresh.size) {
          await Promise.all(
            Array.from(floorsToRefresh).map(async (targetFloor) => {
              try {
                const refreshed = await fetchSeats(targetFloor);
                dispatch({ type: 'SET_SEATS', floor: targetFloor, seats: refreshed.seats });
              } catch (error) {
                const err = error as Error;
                showMessage(`刷新第 ${targetFloor} 层失败：${err.message}`);
              }
            }),
          );
        }
      }

      if (response.updated.length) {
        let messageText = `已更新 ${response.updated.length} 个座位`;
        if (response.missing.length) {
          messageText += `；未找到：${response.missing.join(', ')}`;
        }
        showMessage(messageText, 'success');
      } else if (response.missing.length) {
        showMessage(`未找到以下座位：${response.missing.join(', ')}`);
      } else {
        showMessage('没有座位发生变化');
      }

      return response;
    } catch (error) {
      const err = error as Error;
      const messageText = normalizeErrorMessage(err.message);
      showMessage(`管理员操作失败：${messageText}`);
      throw new Error(messageText);
    } finally {
      setAdminSaving(false);
    }
  };

  const applyHoldResult = (seatIds: string[], expireAt: string | null) => {
    if (!seatIds.length) return;
    const expiry = getExpireAtOrDefault(expireAt ?? undefined);
    const grouped = new Map<number, { seatId: string; expire: string }[]>();
    seatIds.forEach((seatId) => {
      const seatFloor = seatIdToFloor(seatId);
      if (!grouped.has(seatFloor)) {
        grouped.set(seatFloor, []);
      }
      grouped.get(seatFloor)!.push({ seatId, expire: expiry });
    });
    grouped.forEach((items, seatFloor) => {
      dispatch({
        type: 'PATCH_SEATS',
        floor: seatFloor,
        updates: items.map(({ seatId, expire }) => ({
          seatId,
          patch: (seat) => {
            if (!seat) return seat;
            return {
              ...seat,
              status: 'HOLD',
              hold: { client_id: clientId, expires_at: expire },
              updated_at: new Date().toISOString(),
            };
          },
        })),
      });
    });
  };

  const applyRelease = (seatIds: string[]) => {
    if (!seatIds.length) return;
    const grouped = new Map<number, string[]>();
    seatIds.forEach((seatId) => {
      const seatFloor = seatIdToFloor(seatId);
      if (!grouped.has(seatFloor)) {
        grouped.set(seatFloor, []);
      }
      grouped.get(seatFloor)!.push(seatId);
    });
    grouped.forEach((items, seatFloor) => {
      dispatch({
        type: 'PATCH_SEATS',
        floor: seatFloor,
        updates: items.map((seatId) => ({
          seatId,
          patch: (seat) => {
            if (!seat) return seat;
            return {
              ...seat,
              status: 'AVAILABLE',
              hold: null,
              updated_at: new Date().toISOString(),
            };
          },
        })),
      });
    });
  };

  const applyConfirm = (seatIds: string[]) => {
    if (!seatIds.length) return;
    const grouped = new Map<number, string[]>();
    seatIds.forEach((seatId) => {
      const seatFloor = seatIdToFloor(seatId);
      if (!grouped.has(seatFloor)) {
        grouped.set(seatFloor, []);
      }
      grouped.get(seatFloor)!.push(seatId);
    });
    grouped.forEach((items, seatFloor) => {
      dispatch({
        type: 'PATCH_SEATS',
        floor: seatFloor,
        updates: items.map((seatId) => ({
          seatId,
          patch: (seat) => {
            if (!seat) return seat;
            return {
              ...seat,
              status: 'SOLD',
              hold: null,
              updated_at: new Date().toISOString(),
            };
          },
        })),
      });
    });
  };

  const handleSeatClick = async (seat: Seat) => {
    if (adminEnabled) {
      handleAdminToggleSeat(seat.seat_id);
      return;
    }
    if (holding) return;
    if (seat.status === 'BLOCKED' || seat.status === 'SOLD') return;

    if (seat.status === 'HOLD' && seat.hold?.client_id === clientId) {
      try {
        setReleasing(true);
        const response = await releaseSeats([seat.seat_id], clientId);
        applyRelease(response.released);
      } catch (error) {
        showMessage(`释放失败：${(error as Error).message}`);
      } finally {
        setReleasing(false);
      }
      return;
    }

    if (seat.status === 'AVAILABLE') {
      try {
        setHolding(true);
        const response = await holdSeats([seat.seat_id], clientId);
        if (response.held.length || response.refreshed.length) {
          applyHoldResult([...response.held, ...response.refreshed], response.expire_at);
        }
        if (response.conflicts.length) {
          showMessage(`部分座位锁定失败：${response.conflicts.join(', ')}`);
        }
      } catch (error) {
        showMessage(`锁定失败：${(error as Error).message}`);
      } finally {
        setHolding(false);
      }
    }
  };

  const handleBoxSelect = async (seatIds: string[]) => {
    if (adminEnabled) return;
    if (!seatIds.length) return;
    try {
      setHolding(true);
      const response = await holdSeats(seatIds, clientId);
      if (response.held.length || response.refreshed.length) {
        applyHoldResult([...response.held, ...response.refreshed], response.expire_at);
      }
      if (response.conflicts.length) {
        showMessage(`部分座位被他人占用：${response.conflicts.join(', ')}`);
      }
    } catch (error) {
      showMessage(`批量锁定失败：${(error as Error).message}`);
    } finally {
      setHolding(false);
    }
  };

  const handleReleaseAll = async () => {
    if (!heldBySelf.length) return;
    try {
      setReleasing(true);
      const response = await releaseSeats(undefined, clientId);
      applyRelease(response.released);
      showMessage('已释放全部座位', 'success');
    } catch (error) {
      showMessage(`释放失败：${(error as Error).message}`);
    } finally {
      setReleasing(false);
    }
  };

  const handleConfirm = async () => {
    if (adminEnabled) {
      showMessage('管理员模式下无法售卖座位');
      return;
    }
    if (!heldBySelf.length) return;
    try {
      setConfirming(true);
      const seatIds = heldBySelf.map((seat) => seat.seat_id);
      const requestId = `${clientId}-${Date.now()}`;
      const response = await confirmSeats(seatIds, clientId, requestId);
      if (response.confirmed.length) {
        applyConfirm(response.confirmed);
        showMessage('售卖成功', 'success');
      }
      if (response.skipped.length) {
        showMessage(`部分座位未确认成功：${response.skipped.join(', ')}`);
      }
    } catch (error) {
      showMessage(`确认失败：${(error as Error).message}`);
    } finally {
      setConfirming(false);
    }
  };

  const toggleTier = (tier: string) => {
    setTierFilters((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) {
        if (next.size === 1) return prev;
        next.delete(tier);
      } else {
        next.add(tier);
      }
      return next;
    });
  };

  const toggleStatus = (status: SeatStatus) => {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        if (next.size === 1) return prev;
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  };

  return (
    <div>
      <header className="header">
        <div>
          <h1 style={{ margin: 0 }}>歌舞青春选座系统</h1>
          <div style={{ color: '#64748b', fontSize: '0.85rem' }}>客户端 ID：{clientId} · WebSocket：{wsStatus}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'flex-end' }}>
          <div className="filters">
            <div className="filter-group">
              <label htmlFor="floor-select">楼层</label>
              <select
                id="floor-select"
                value={floor}
                onChange={(event) => setFloor(Number(event.target.value))}
              >
                <option value={1}>一层</option>
                <option value={2}>二层</option>
              </select>
            </div>

            <div className="filter-group">
              <span>票档</span>
              {TIER_OPTIONS.map((tier) => (
                <label key={tier}>
                  <input
                    type="checkbox"
                    checked={tierFilters.has(tier)}
                    onChange={() => toggleTier(tier)}
                  />
                  {TIER_LABELS[tier]}
                </label>
              ))}
            </div>

            <div className="filter-group">
              <span>状态</span>
              {STATUS_OPTIONS.map((status) => (
                <label key={status}>
                  <input
                    type="checkbox"
                    checked={statusFilters.has(status)}
                    onChange={() => toggleStatus(status)}
                  />
                  {STATUS_LABELS[status]}
                </label>
              ))}
            </div>
          </div>

          <div className="admin-controls">
            {adminEnabled ? (
              <>
                <span className="badge admin-badge">管理员模式已启用</span>
                <button className="secondary" onClick={handleExitAdmin} disabled={adminSaving}>
                  退出
                </button>
              </>
            ) : (
              <form
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleEnterAdmin();
                }}
              >
                <input
                  value={adminTokenInput}
                  onChange={(event) => {
                    setAdminTokenInput(event.target.value);
                    if (adminAuthError) setAdminAuthError(null);
                  }}
                  placeholder="管理员令牌"
                />
                <button type="submit">进入管理员模式</button>
              </form>
            )}
          </div>
          {!adminEnabled && adminAuthError && (
            <div className="admin-error">{adminAuthError}</div>
          )}
        </div>
      </header>

      <main className="layout">
        <div>
          <div className="panel" style={{ marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
            <div className="legend">
              {TIER_OPTIONS.map((tier) => (
                <div key={tier} className="legend-item">
                  <span
                    className="legend-swatch"
                    style={{ background: TIER_COLORS[tier] }}
                  />
                  {TIER_LABELS[tier]}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              {STATUS_OPTIONS.map((status) => (
                <span key={status} className="badge">
                  {STATUS_LABELS[status]}：{counts[status] ?? 0}
                </span>
              ))}
            </div>
          </div>

          <SeatMap
            seats={seats}
            clientId={clientId}
            onSeatClick={handleSeatClick}
            onBoxSelect={handleBoxSelect}
            filters={{ tiers: tierFilters, statuses: statusFilters }}
            adminEnabled={adminEnabled}
            highlightedSeatIds={adminSelectedSeatIds}
          />
          {loading && <div style={{ marginTop: '0.6rem', color: '#2563eb' }}>加载中...</div>}
          {holding && <div style={{ marginTop: '0.6rem', color: '#2563eb' }}>提交锁定请求...</div>}
        </div>

        <div className="side-column">
          <SelectionSummary
            seats={heldBySelf}
            remainingSeconds={remainingSeconds}
            totalAmount={totalAmount}
            onReleaseAll={handleReleaseAll}
            onConfirm={handleConfirm}
            releasing={releasing}
            confirming={confirming}
            confirmDisabled={adminEnabled}
          />
          {adminEnabled && (
            <AdminPanel
              seats={allSeats}
              tierOptions={adminTierOptions}
              activeSeatId={adminActiveSeatId}
              selectedSeatIds={adminSelectedSeatIds}
              onActivateSeat={handleAdminActivateSeat}
              onToggleSeat={handleAdminToggleSeat}
              onClearSelection={handleAdminClearSelection}
              onUpdate={handleAdminUpdate}
              onBulkUpdate={handleAdminBulkUpdate}
              onExit={handleExitAdmin}
              saving={adminSaving}
            />
          )}
        </div>
      </main>

      {message && (
        <div className={`message ${messageTone === 'success' ? 'success' : ''}`}>
          {message}
        </div>
      )}
    </div>
  );
}
