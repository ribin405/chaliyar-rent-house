import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { RecordPaymentModal, type PaymentPreset } from '../components/RecordPaymentModal';
import { itemLabel } from '../lib/format';
import type { Payment, Rental } from '../types';

export function Payments() {
  const location = useLocation();
  const navigate = useNavigate();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [preset, setPreset] = useState<PaymentPreset | null>(null);

  const hasLoadedRef = useRef(false);
  const loadAll = () => {
    if (!hasLoadedRef.current) setLoading(true);
    Promise.all([
      apiRequest<Payment[]>('/payments'),
      apiRequest<Rental[]>('/rentals'),
    ])
      .then(([paymentData, rentalData]) => {
        setPayments(paymentData);
        setRentals(rentalData);
        setError('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load payments'))
      .finally(() => {
        setLoading(false);
        hasLoadedRef.current = true;
      });
  };

  usePolling(loadAll);

  const itemsByInvoice = (invoiceNumber: string) => rentals.filter((rental) => rental.invoice_number === invoiceNumber);

  const openCreate = (nextPreset?: PaymentPreset) => {
    setPreset(nextPreset ?? null);
    setModalOpen(true);
  };

  // Arrived here from a "Record Payment" / "Collect" button elsewhere.
  useEffect(() => {
    const state = location.state as { openCreate?: boolean; invoice?: string; amount?: number } | null;
    if (state?.openCreate) {
      openCreate({ invoice: state.invoice, amount: state.amount });
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  return (
    <div className="module-shell">
      <div className="module-head">
        <div>
          <p className="eyebrow">Payments</p>
          <h2>Collect rent, deposits, and refunds</h2>
        </div>
        <button type="button" className="primary-button" onClick={() => openCreate()}>Record Payment</button>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="panel-card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Items</th><th>Type</th><th>Method</th><th>Amount</th><th>Discount</th><th>Actual Amount</th></tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{payment.payment_date}</td>
                  <td>{payment.invoice_number}</td>
                  <td>{payment.customer_name}</td>
                  <td>{itemsByInvoice(payment.invoice_number).map((item) => itemLabel(item.equipment_name, item.quantity)).join(', ') || '—'}</td>
                  <td style={{ textTransform: 'capitalize' }}>{payment.payment_type}</td>
                  <td style={{ textTransform: 'capitalize' }}>{payment.payment_method.replace('_', ' ')}</td>
                  <td><strong>₹ {payment.amount.toLocaleString()}</strong></td>
                  <td>{payment.discount > 0 ? `₹ ${payment.discount.toLocaleString()}` : '—'}</td>
                  {/* Stored as amount (received) + discount, so the actual amount is their sum. */}
                  <td>₹ {(payment.amount + payment.discount).toLocaleString()}</td>
                </tr>
              ))}
              {!loading && payments.length === 0 && (
                <tr><td colSpan={9}>No payments recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <RecordPaymentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        rentals={rentals}
        preset={preset}
        onSaved={loadAll}
      />
    </div>
  );
}
