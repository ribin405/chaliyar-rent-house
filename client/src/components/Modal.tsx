import type { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  // Roomier card for content-heavy forms, e.g. building an order.
  wide?: boolean;
}

export function Modal({ open, title, onClose, children, wide = false }: ModalProps) {
  return (
    <div
      className={`modal-backdrop ${open ? 'open' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className={`modal-card ${wide ? 'wide' : ''}`}>
        <div className="panel-title-row">
          <h3>{title}</h3>
          <button type="button" className="text-button" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
