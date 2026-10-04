// Flags a customer who still has equipment to bring back.
export function ReturnMarker({ openCount, overdueCount, showClear = false }: { openCount: number; overdueCount: number; showClear?: boolean }) {
  if (overdueCount > 0) {
    return (
      <span className="status-badge overdue" title={`${openCount} item${openCount > 1 ? 's' : ''} out, ${overdueCount} overdue`}>
        {overdueCount} overdue
      </span>
    );
  }
  if (openCount > 0) {
    return <span className="status-badge active">{openCount} to return</span>;
  }
  return showClear ? <span className="status-badge completed">All returned</span> : null;
}
