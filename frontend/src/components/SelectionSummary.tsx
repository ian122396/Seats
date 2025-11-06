import type { Seat } from '../types';
import { getSeatDisplayPosition } from '../lib/seatPosition';

type SelectionSummaryProps = {
  seats: Seat[];
  remainingSeconds: number;
  totalAmount: number;
  onReleaseAll: () => void;
  onConfirm: () => void;
  releasing: boolean;
  confirming: boolean;
  confirmDisabled?: boolean;
};

function formatSeconds(seconds: number): string {
  if (seconds <= 0) return '已过期';
  const mm = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const ss = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function SelectionSummary({
  seats,
  remainingSeconds,
  totalAmount,
  onReleaseAll,
  onConfirm,
  releasing,
  confirming,
  confirmDisabled = false,
}: SelectionSummaryProps) {
  const confirmButtonDisabled = confirming || seats.length === 0 || confirmDisabled;

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>已锁定座位</h2>
        <p style={{ margin: '0.25rem 0 0', color: '#475569', fontSize: '0.85rem' }}>
          还有 <strong>{formatSeconds(remainingSeconds)}</strong> 完成确认
        </p>
      </div>

      <div className="summary-list">
        {seats.length === 0 && <span style={{ color: '#64748b' }}>尚未选择任何座位</span>}
        {seats.map((seat) => {
          const position = getSeatDisplayPosition(seat);
          const positionLabel = position?.text ?? null;

          return (
            <div key={seat.seat_id} className="summary-item">
              <div>
                {positionLabel && (
                  <div style={{ fontSize: '0.85rem', color: '#0f172a' }}>
                    <strong>{positionLabel}</strong>
                  </div>
                )}
                <div style={{ fontSize: '0.85rem', color: '#334155', marginTop: positionLabel ? '0.15rem' : 0 }}>
                  {seat.seat_id}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.15rem' }}>
                  {seat.tier ?? '未知票级'} · ￥{seat.price}
                </div>
              </div>
              <span className="status-pill">HOLD</span>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '0.85rem', color: '#475569' }}>合计金额</div>
          <strong style={{ fontSize: '1.4rem' }}>￥{totalAmount}</strong>
        </div>
        <div className="controls">
          <button className="secondary" onClick={onReleaseAll} disabled={releasing || seats.length === 0}>
            释放全部
          </button>
          <button onClick={onConfirm} disabled={confirmButtonDisabled}>
            确认购票
          </button>
        </div>
      </div>

      {confirmDisabled && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#ef4444' }}>
          管理员模式下已禁用售卖操作
        </div>
      )}
    </div>
  );
}
