import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type { AdminSeatBulkResponse, AdminSeatUpdatePayload, Seat, SeatStatus } from '../types';

const STATUS_OPTIONS: SeatStatus[] = ['AVAILABLE', 'HOLD', 'SOLD', 'BLOCKED'];
const STATUS_LABELS: Record<SeatStatus, string> = {
  AVAILABLE: '可售',
  HOLD: '锁定',
  SOLD: '已售',
  BLOCKED: '不可售',
};

type AdminPanelProps = {
  seats: Seat[];
  tierOptions: string[];
  activeSeatId: string;
  selectedSeatIds: string[];
  onActivateSeat: (seatId: string, options?: { replaceSelection?: boolean }) => void;
  onToggleSeat: (seatId: string) => void;
  onClearSelection: () => void;
  onUpdate: (seatId: string, payload: AdminSeatUpdatePayload) => Promise<void>;
  onBulkUpdate: (seatIds: string[], payload: AdminSeatUpdatePayload) => Promise<AdminSeatBulkResponse>;
  onExit: () => void;
  saving: boolean;
};

function normalizeSeatId(value: string): string {
  return value.trim().toUpperCase();
}

function parseSeatIds(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,，、]+/)
        .map((value) => normalizeSeatId(value))
        .filter(Boolean),
    ),
  );
}

export default function AdminPanel({
  seats,
  tierOptions,
  activeSeatId,
  selectedSeatIds,
  onActivateSeat,
  onToggleSeat,
  onClearSelection,
  onUpdate,
  onBulkUpdate,
  onExit,
  saving,
}: AdminPanelProps) {
  const [draftSeatId, setDraftSeatId] = useState(activeSeatId);
  const [status, setStatus] = useState<SeatStatus>('AVAILABLE');
  const [tier, setTier] = useState('');
  const [price, setPrice] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [bulkSeatInput, setBulkSeatInput] = useState('');
  const [bulkApplyStatus, setBulkApplyStatus] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<SeatStatus>('AVAILABLE');
  const [bulkApplyTier, setBulkApplyTier] = useState(false);
  const [bulkTier, setBulkTier] = useState('');
  const [bulkApplyPrice, setBulkApplyPrice] = useState(false);
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  const seatMap = useMemo(() => {
    const map = new Map<string, Seat>();
    seats.forEach((seat) => {
      map.set(seat.seat_id, seat);
    });
    return map;
  }, [seats]);

  const seatOptions = useMemo(() => {
    return seats
      .map((seat) => seat.seat_id)
      .sort((a, b) => a.localeCompare(b));
  }, [seats]);

  const selectedSeat = activeSeatId ? seatMap.get(activeSeatId) : undefined;
  const hasSelection = selectedSeatIds.length > 0;

  const handleFillSelectionIntoBulk = () => {
    if (!selectedSeatIds.length) return;
    setBulkSeatInput(selectedSeatIds.join(', '));
    setBulkError(null);
    setBulkMessage(null);
  };

  useEffect(() => {
    setDraftSeatId(activeSeatId);
  }, [activeSeatId]);

  useEffect(() => {
    if (!selectedSeat) {
      setStatus('AVAILABLE');
      setTier('');
      setPrice('');
      setFormError(null);
      return;
    }
    setStatus(selectedSeat.status);
    setTier(selectedSeat.tier ?? '');
    setPrice(selectedSeat.price.toString());
    setFormError(null);
  }, [selectedSeat]);

  const handleLoadSeat = () => {
    const normalized = normalizeSeatId(draftSeatId);
    if (!normalized) {
      setFormError('请输入座位编号');
      return;
    }
    setFormError(null);
    onActivateSeat(normalized, { replaceSelection: true });
  };

  const handleAppendSeat = () => {
    const normalized = normalizeSeatId(draftSeatId);
    if (!normalized) {
      setFormError('请输入座位编号');
      return;
    }
    setFormError(null);
    onActivateSeat(normalized, { replaceSelection: false });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedSeat) {
      setFormError('请先加载座位');
      return;
    }

    const payload: AdminSeatUpdatePayload = {};
    let hasChange = false;

    if (status !== selectedSeat.status) {
      payload.status = status;
      hasChange = true;
    }

    const normalizedTier = tier.trim();
    const currentTier = selectedSeat.tier ?? '';
    if (normalizedTier !== currentTier) {
      payload.tier = normalizedTier !== '' ? normalizedTier : null;
      hasChange = true;
    }

    const trimmedPrice = price.trim();
    if (trimmedPrice !== '') {
      const parsed = Number(trimmedPrice);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setFormError('票价必须为非负数字');
        return;
      }
      if (parsed !== selectedSeat.price) {
        payload.price = parsed;
        hasChange = true;
      }
    }

    if (!hasChange) {
      setFormError('未检测到任何需要保存的改动');
      return;
    }

    setFormError(null);
    try {
      await onUpdate(selectedSeat.seat_id, payload);
    } catch (error) {
      const err = error as Error;
      setFormError(err.message || '保存失败');
    }
  };

  const handleBulkSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBulkError(null);
    setBulkMessage(null);

    let seatIds = parseSeatIds(bulkSeatInput);
    if (!seatIds.length && selectedSeatIds.length) {
      seatIds = Array.from(new Set(selectedSeatIds.map((id) => normalizeSeatId(id))));
    }

    if (!seatIds.length) {
      setBulkError('请先输入或选择至少一个座位编号');
      return;
    }

    const payload: AdminSeatUpdatePayload = {};
    let hasChange = false;

    if (bulkApplyStatus) {
      payload.status = bulkStatus;
      hasChange = true;
    }

    if (bulkApplyTier) {
      const normalizedTier = bulkTier.trim();
      payload.tier = normalizedTier !== '' ? normalizedTier : null;
      hasChange = true;
    }

    if (bulkApplyPrice) {
      const trimmed = bulkPrice.trim();
      if (!trimmed) {
        setBulkError('请输入批量票价，或取消勾选票价选项');
        return;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setBulkError('票价必须为非负数字');
        return;
      }
      payload.price = parsed;
      hasChange = true;
    }

    if (!hasChange) {
      setBulkError('请选择至少一项需要调整的字段');
      return;
    }

    try {
      const result = await onBulkUpdate(seatIds, payload);
      if (result.updated.length) {
        const summary = `已更新 ${result.updated.length} 个座位`;
        if (result.missing.length) {
          setBulkMessage(`${summary}，未找到：${result.missing.join(', ')}`);
        } else {
          setBulkMessage(summary);
        }
      } else if (result.missing.length) {
        setBulkError(`未找到任何匹配的座位：${result.missing.join(', ')}`);
      } else {
        setBulkMessage('没有座位发生变化');
      }
    } catch (error) {
      const err = error as Error;
      setBulkError(err.message || '批量更新失败');
    }
  };

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>管理员模式</h2>
        <button className="secondary" onClick={onExit} disabled={saving}>
          退出
        </button>
      </div>

      {hasSelection && (
        <section
          style={{
            marginTop: '0.5rem',
            background: '#f8fafc',
            borderRadius: '8px',
            padding: '0.75rem',
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
            <strong style={{ fontSize: '0.95rem' }}>当前选中 {selectedSeatIds.length} 个座位</strong>
            <button type="button" className="secondary" onClick={onClearSelection} disabled={saving} style={{ fontSize: '0.8rem' }}>
              清空选择
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.6rem' }}>
            {selectedSeatIds.map((seatId) => (
              <div
                key={seatId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  background: seatId === activeSeatId ? '#dbeafe' : '#e2e8f0',
                  color: seatId === activeSeatId ? '#1d4ed8' : '#0f172a',
                  borderRadius: '999px',
                  padding: '0.2rem 0.5rem',
                }}
              >
                <button
                  type="button"
                  onClick={() => onActivateSeat(seatId, { replaceSelection: false })}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: seatId === activeSeatId ? 600 : 500,
                    color: 'inherit',
                  }}
                >
                  {seatId}
                </button>
                <button
                  type="button"
                  onClick={() => onToggleSeat(seatId)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'inherit',
                    padding: 0,
                    fontSize: '0.85rem',
                    lineHeight: 1,
                  }}
                  aria-label={`移除 ${seatId}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <button type="button" className="secondary" onClick={handleFillSelectionIntoBulk} disabled={saving}>
              填入批量表单
            </button>
          </div>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            若批量输入框留空，系统将默认对当前选中的座位应用更改。
          </p>
        </section>
      )}

      <div style={{ marginTop: '0.8rem' }}>
        <label style={{ width: '100%' }}>
          座位编号
          <input
            list="admin-seat-ids"
            value={draftSeatId}
            onChange={(event) => setDraftSeatId(event.target.value)}
            placeholder="例如 1-001"
            style={{ width: '100%', marginTop: '0.3rem' }}
            disabled={saving}
          />
        </label>
        <datalist id="admin-seat-ids">
          {seatOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
          <button className="secondary" type="button" onClick={handleLoadSeat} disabled={saving}>
            定位座位
          </button>
          <button className="secondary" type="button" onClick={handleAppendSeat} disabled={saving}>
            加入选择
          </button>
        </div>
      </div>

      {selectedSeat ? (
        <form onSubmit={handleSubmit} style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div style={{ fontSize: '0.85rem', color: '#475569' }}>
            当前状态：<strong>{STATUS_LABELS[selectedSeat.status]}</strong> · 票级：<strong>{selectedSeat.tier ?? '未设置'}</strong> · 票价：<strong>￥{selectedSeat.price}</strong>
          </div>

          <label>
            状态
            <select value={status} onChange={(event) => setStatus(event.target.value as SeatStatus)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {STATUS_LABELS[option]}
                </option>
              ))}
            </select>
          </label>

          <label>
            票级
            <input
              value={tier}
              onChange={(event) => setTier(event.target.value)}
              list="admin-tier-options"
              placeholder="可留空表示清除"
              style={{ borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0.4rem' }}
            />
          </label>

          <datalist id="admin-tier-options">
            {tierOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>

          <label>
            票价
            <input
              type="number"
              min={0}
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="仅在修改时填写"
              style={{ borderRadius: '6px', border: '1px solid #cbd5e1', padding: '0.4rem' }}
            />
          </label>

          {formError && (
            <div className="message" style={{ margin: 0 }}>
              {formError}
            </div>
          )}

          <button type="submit" disabled={saving}>
            {saving ? '保存中...' : '保存修改'}
          </button>
        </form>
      ) : (
        <div style={{ marginTop: '1rem', color: '#64748b', fontSize: '0.9rem' }}>
          请选择或输入座位编号以查看详情。
        </div>
      )}

      <div className="admin-divider" />

      <section className="admin-bulk-section">
        <h3 style={{ margin: 0, fontSize: '1rem' }}>批量调整</h3>
        <p className="admin-hint">使用逗号、空格或换行分隔多个座位编号。</p>

        <form className="admin-bulk-form" onSubmit={handleBulkSubmit}>
          <textarea
            className="admin-textarea"
            rows={4}
            value={bulkSeatInput}
            onChange={(event) => setBulkSeatInput(event.target.value)}
            placeholder="例如：1-1-A, 1-1-B 或换行粘贴"
            disabled={saving}
          />

          <div className="admin-bulk-grid">
            <div className="admin-bulk-field">
              <label className="admin-checkbox">
                <input
                  type="checkbox"
                  checked={bulkApplyStatus}
                  onChange={(event) => setBulkApplyStatus(event.target.checked)}
                />
                <span>状态</span>
              </label>
              <select
                value={bulkStatus}
                onChange={(event) => setBulkStatus(event.target.value as SeatStatus)}
                disabled={!bulkApplyStatus || saving}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {STATUS_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>

            <div className="admin-bulk-field">
              <label className="admin-checkbox">
                <input
                  type="checkbox"
                  checked={bulkApplyTier}
                  onChange={(event) => setBulkApplyTier(event.target.checked)}
                />
                <span>票级</span>
              </label>
              <input
                value={bulkTier}
                onChange={(event) => setBulkTier(event.target.value)}
                list="admin-tier-options-bulk"
                placeholder="可留空表示清除"
                disabled={!bulkApplyTier || saving}
              />
            </div>

            <div className="admin-bulk-field">
              <label className="admin-checkbox">
                <input
                  type="checkbox"
                  checked={bulkApplyPrice}
                  onChange={(event) => setBulkApplyPrice(event.target.checked)}
                />
                <span>票价</span>
              </label>
              <input
                type="number"
                min={0}
                value={bulkPrice}
                onChange={(event) => setBulkPrice(event.target.value)}
                placeholder="请输入票价"
                disabled={!bulkApplyPrice || saving}
              />
            </div>
          </div>

          {bulkError && (
            <div className="message" style={{ margin: 0 }}>
              {bulkError}
            </div>
          )}
          {bulkMessage && (
            <div className="message success" style={{ margin: 0 }}>
              {bulkMessage}
            </div>
          )}

          <button type="submit" disabled={saving}>
            {saving ? '提交中...' : '应用批量修改'}
          </button>
        </form>

        <datalist id="admin-tier-options-bulk">
          {tierOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </section>
    </div>
  );
}
