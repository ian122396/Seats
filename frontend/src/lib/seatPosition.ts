import type { Seat } from '../types';

type SeatPosition = {
  row: number;
  column: number;
  floorLabel: string;
  rowLabel: string;
  columnLabel: string;
  text: string;
};

function getAdjustedSecondFloorRow(seat: Seat, fallback: number): number {
  const idParts = seat.seat_id.split('-');
  if (idParts.length < 2) return fallback;

  const maybeRow = Number(idParts[1]);
  if (Number.isNaN(maybeRow)) return fallback;

  if (maybeRow >= 1 && maybeRow <= 4) {
    return 5 - maybeRow;
  }

  return maybeRow > 0 ? maybeRow : fallback;
}

export function getSeatDisplayPosition(seat: Seat): SeatPosition | null {
  const { layout_row: layoutRow, layout_col: layoutCol, floor } = seat;
  if (layoutRow == null || layoutCol == null) {
    return null;
  }

  let displayRow = layoutRow;
  let displayColumn = layoutCol;

  if (floor === 2) {
    displayRow = getAdjustedSecondFloorRow(seat, layoutRow);
    const walkwayLeftCol = 21;
    const walkwayRightCol = 22;

    if (layoutCol <= walkwayLeftCol) {
      const offset = walkwayLeftCol - layoutCol;
      displayColumn = offset * 2 + 1;
    } else if (layoutCol >= walkwayRightCol) {
      const offset = layoutCol - walkwayRightCol;
      displayColumn = offset * 2 + 2;
    }
  }

  const floorLabel = `${floor}层`;
  const rowLabel = `${displayRow}排`;
  const columnLabel = `${displayColumn}列`;

  return {
    row: displayRow,
    column: displayColumn,
    floorLabel,
    rowLabel,
    columnLabel,
    text: `${floorLabel}${rowLabel}${columnLabel}`,
  };
}
