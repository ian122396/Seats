import { useMemo, useRef, useState } from 'react';
import type { Seat, SeatStatus } from '../types';

const SEAT_SIZE = 20;
const GAP = 6;

const TIER_COLORS: Record<string, string> = {
  VIP: '#e63946',
  A: '#f3722c',
  B: '#f9c74f',
  C: '#43aa8b',
  E: '#277da1',
  UNKNOWN: '#94a3b8',
};

const STATUS_LABELS: Record<SeatStatus, string> = {
  AVAILABLE: '可售',
  HOLD: '锁定',
  SOLD: '已售',
  BLOCKED: '不可售',
};

type Filters = {
  tiers: Set<string>;
  statuses: Set<SeatStatus>;
};

type SeatMapProps = {
  seats: Seat[];
  clientId: string;
  onSeatClick: (seat: Seat) => void;
  onBoxSelect: (seatIds: string[]) => void;
  filters: Filters;
  adminEnabled: boolean;
  highlightedSeatIds?: string[];
};

type PositionedSeat = {
  seat: Seat;
  x: number;
  y: number;
  isVisible: boolean;
};

type Rect = { x: number; y: number; width: number; height: number };

function normalizeRect(start: { x: number; y: number }, current: { x: number; y: number }): Rect {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const width = Math.abs(start.x - current.x);
  const height = Math.abs(start.y - current.y);
  return { x, y, width, height };
}

export default function SeatMap({ seats, clientId, onSeatClick, onBoxSelect, filters, adminEnabled, highlightedSeatIds }: SeatMapProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const highlightedSet = useMemo(() => new Set(highlightedSeatIds ?? []), [highlightedSeatIds]);

  const positioned = useMemo<PositionedSeat[]>(() => {
    if (!seats.length) return [];
    const minRow = Math.min(...seats.map((seat) => seat.excel_row));
    const minCol = Math.min(...seats.map((seat) => seat.excel_col));

    return seats.map((seat) => {
      const tierKey = seat.tier ?? 'UNKNOWN';
      const isVisible = filters.tiers.has(tierKey) && filters.statuses.has(seat.status);
      return {
        seat,
        x: (seat.excel_col - minCol) * (SEAT_SIZE + GAP),
        y: (seat.excel_row - minRow) * (SEAT_SIZE + GAP),
        isVisible,
      };
    });
  }, [seats, filters]);

  const bounds = useMemo(() => {
    if (!positioned.length) return { width: 600, height: 400 };
    const maxX = Math.max(...positioned.map((item) => item.x));
    const maxY = Math.max(...positioned.map((item) => item.y));
    return {
      width: maxX + SEAT_SIZE + GAP,
      height: maxY + SEAT_SIZE + GAP,
    };
  }, [positioned]);

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if (adminEnabled) return;
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const start = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    const handleMove = (moveEvent: PointerEvent) => {
      const current = {
        x: moveEvent.clientX - rect.left,
        y: moveEvent.clientY - rect.top,
      };
      setSelection(normalizeRect(start, current));
    };

    const handleUp = (upEvent: PointerEvent) => {
      const current = {
        x: upEvent.clientX - rect.left,
        y: upEvent.clientY - rect.top,
      };
      const rectSelection = normalizeRect(start, current);
      setSelection(null);

      const selectedSeats = positioned
        .filter((item) => item.isVisible)
        .filter((item) => {
          if (item.seat.status !== 'AVAILABLE') return false;
          const centerX = item.x + SEAT_SIZE / 2;
          const centerY = item.y + SEAT_SIZE / 2;
          return (
            centerX >= rectSelection.x &&
            centerX <= rectSelection.x + rectSelection.width &&
            centerY >= rectSelection.y &&
            centerY <= rectSelection.y + rectSelection.height
          );
        })
        .map((item) => item.seat.seat_id);

      if (selectedSeats.length) {
        onBoxSelect(selectedSeats);
      }

      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
  };

  const renderSeat = (item: PositionedSeat) => {
    const { seat, x, y, isVisible } = item;
    const tierKey = seat.tier ?? 'UNKNOWN';
    const baseColor = TIER_COLORS[tierKey] ?? TIER_COLORS.UNKNOWN;
    const isHeldBySelf = seat.status === 'HOLD' && seat.hold?.client_id === clientId;
    const isBlockedOrSold = seat.status === 'BLOCKED' || seat.status === 'SOLD';
    const clickDisabled = !adminEnabled && isBlockedOrSold;
    const isHighlighted = adminEnabled && highlightedSet.has(seat.seat_id);

    let fill = baseColor;
    let opacity = isVisible ? 1 : 0.2;
    let stroke = 'rgba(15,23,42,0.15)';
    let strokeWidth = 1;

    if (seat.status === 'HOLD' && !isHeldBySelf) {
      fill = '#94a3b8';
      opacity = isVisible ? 0.75 : 0.2;
    }
    if (seat.status === 'SOLD') {
      fill = '#475569';
      opacity = isVisible ? 0.8 : 0.2;
    }
    if (seat.status === 'BLOCKED') {
      fill = '#1f2937';
      opacity = isVisible ? 0.5 : 0.2;
    }
    if (isHeldBySelf) {
      stroke = '#1d4ed8';
      strokeWidth = 2;
    }
    if (isHighlighted && !isHeldBySelf) {
      stroke = '#f97316';
      strokeWidth = 2;
    }

    const statusLabel = STATUS_LABELS[seat.status] ?? seat.status;
    const layoutLabel =
      seat.layout_row != null && seat.layout_col != null ? `${seat.layout_row}排${seat.layout_col}列` : null;
    const titleSegments = [seat.seat_id];
    if (layoutLabel) {
      titleSegments.push(layoutLabel);
    }
    titleSegments.push(seat.tier ?? '未知票级', `￥${seat.price}`, `状态：${statusLabel}`);
    const title = titleSegments.join(' | ');

    const handleSeatSelection = () => {
      if (clickDisabled) {
        return;
      }
      onSeatClick(seat);
    };

    return (
      <g key={seat.seat_id} transform={`translate(${x}, ${y})`}>
        <rect
          x={0}
          y={0}
          width={SEAT_SIZE}
          height={SEAT_SIZE}
          rx={4}
          fill={fill}
          opacity={opacity}
          stroke={stroke}
          strokeWidth={strokeWidth}
          onClick={handleSeatSelection}
          style={{ cursor: clickDisabled ? 'not-allowed' : 'pointer' }}
        />
        <title>{title}</title>
        {isHeldBySelf ? (
          <text
            x={SEAT_SIZE / 2}
            y={SEAT_SIZE / 2 + 4}
            textAnchor="middle"
            fontSize={10}
            fill="#fff"
          >
            已选
          </text>
        ) : (
          isHighlighted && (
            <text
              x={SEAT_SIZE / 2}
              y={SEAT_SIZE / 2 + 4}
              textAnchor="middle"
              fontSize={10}
              fill="#fff"
            >
              编辑
            </text>
          )
        )}
      </g>
    );
  };


  return (
    <div className="panel" style={{ height: '100%', overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        style={{ background: '#eef2ff', borderRadius: '12px' }}
        onPointerDown={handlePointerDown}
      >
        <rect x={0} y={0} width={bounds.width} height={bounds.height} fill="transparent" />
        {positioned.map(renderSeat)}
        {selection && (
          <rect
            x={selection.x}
            y={selection.y}
            width={selection.width}
            height={selection.height}
            fill="rgba(37, 99, 235, 0.15)"
            stroke="#2563eb"
            strokeDasharray="6 4"
          />
        )}
      </svg>
    </div>
  );
}
