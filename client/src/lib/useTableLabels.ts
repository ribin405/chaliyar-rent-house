import { useEffect } from 'react';

// On a phone every table row becomes a card of "LABEL  value" lines (see the
// "Phone usability" block in index.css), which needs each cell to know its column
// heading. Doing it here keeps every page's table markup unchanged, and it re-runs
// whenever rows are added or re-rendered (polling, filters, modals opening).
export function useTableLabels() {
  useEffect(() => {
    const apply = () => {
      document.querySelectorAll<HTMLTableElement>('table.data-table').forEach((table) => {
        const heads = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent?.trim() ?? '');
        table.querySelectorAll('tbody tr, tfoot tr').forEach((row) => {
          let column = 0;
          Array.from(row.children).forEach((child) => {
            const cell = child as HTMLTableCellElement;
            const label = cell.colSpan === 1 ? heads[column] : '';
            if (label) {
              if (cell.dataset.label !== label) cell.dataset.label = label;
            } else if (cell.dataset.label !== undefined) {
              delete cell.dataset.label;
            }
            // A bare "—" carries no information; the card layout hides those lines.
            cell.toggleAttribute('data-dash', cell.textContent?.trim() === '—');
            column += cell.colSpan || 1;
          });
        });
      });
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };

    apply();
    // childList only: setting data-label is an attribute change, so it can't retrigger itself.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
}
