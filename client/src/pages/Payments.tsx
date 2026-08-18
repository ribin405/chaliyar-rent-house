import { useMemo, useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { Modal } from '../components/Modal';
import type { Payment, Rental } from '../types';

const EMPTY_FORM = {
  invoice_number: '',
  amount: '',
  discount: '',
  payment_method: 'cash' as const,
  payment_type: 'rent' as const,
  notes: '',
};

interface InvoiceGroup {
  invoice_number: string;
  customer_name: string;
  items: Rental[];
  total: number;
  payment_status: Rental['payment_status'];
}

export function Payments() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

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

  // A rental can cover several equipment items sharing one invoice number, and
  // a customer typically pays for the whole invoice at once — so payments are
  // recorded against the invoice, not against a single equipment line.
  const invoiceGroups = useMemo(() => {
    const map = new Map<string, InvoiceGroup>();
    rentals.forEach((rental) => {
      const group = map.get(rental.invoice_number) ?? {
        invoice_number: rental.invoice_number,
        customer_name: rental.customer_name,
        items: [],
        total: 0,
        payment_status: rental.payment_status,
      };
      group.items.push(rental);
      group.total += rental.final_amount;
      map.set(rental.invoice_number, group);
    });
    return Array.from(map.values()).sort((a, b) => b.invoice_number.localeCompare(a.invoice_number));
  }, [rentals]);

  const itemsByInvoice = (invoiceNumber: string) => rentals.filter((rental) => rental.invoice_number === invoiceNumber);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormError('');
    setModalOpen(true);
  };

  const selectedInvoiceItems = form.invoice_number ? itemsByInvoice(form.invoice_number) : [];

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(form.amount) || 0;
    const discount = Number(form.discount) || 0;
    if (!form.invoice_number) {
      setFormError('Select an invoice.');
      return;
    }
    if (amount <= 0 && discount <= 0) {
      setFormError('Enter a payment amount or a discount.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await apiRequest('/payments', {
        method: 'POST',
        body: JSON.stringify({
          invoice_number: form.invoice_number,
          amount,
          discount,
          payment_method: form.payment_method,
          payment_type: form.payment_type,
          notes: form.notes,
        }),
      });
      setModalOpen(false);
      loadAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to record payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="module-shell">
      <div className="module-head">
        <div>
          <p className="eyebrow">Payments</p>
          <h2>Collect rent, deposits, and refunds</h2>
        </div>
        <button type="button" className="primary-button" onClick={openCreate}>Record Payment</button>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="panel-card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Items</th><th>Type</th><th>Method</th><th>Amount</th><th>Discount</th></tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{payment.payment_date}</td>
                  <td>{payment.invoice_number}</td>
                  <td>{payment.customer_name}</td>
                  <td>{itemsByInvoice(payment.invoice_number).map((item) => item.equipment_name).join(', ') || '—'}</td>
                  <td style={{ textTransform: 'capitalize' }}>{payment.payment_type}</td>
                  <td style={{ textTransform: 'capitalize' }}>{payment.payment_method.replace('_', ' ')}</td>
                  <td>₹ {payment.amount.toLocaleString()}</td>
                  <td>{payment.discount > 0 ? `₹ ${payment.discount.toLocaleString()}` : '—'}</td>
                </tr>
              ))}
              {!loading && payments.length === 0 && (
                <tr><td colSpan={8}>No payments recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modalOpen} title="Record Payment" onClose={() => setModalOpen(false)}>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            <span>Invoice</span>
            <select value={form.invoice_number} onChange={(event) => setForm({ ...form, invoice_number: event.target.value })} required>
              <option value="">Select invoice</option>
              {invoiceGroups.map((group) => (
                <option key={group.invoice_number} value={group.invoice_number}>
                  {group.invoice_number} &middot; {group.customer_name} &middot; {group.items.length} item{group.items.length > 1 ? 's' : ''} &middot; ₹{group.total} ({group.payment_status})
                </option>
              ))}
            </select>
          </label>
          {selectedInvoiceItems.length > 0 && (
            <p className="login-message" style={{ gridColumn: '1 / -1', marginTop: -6 }}>
              Covers: {selectedInvoiceItems.map((item) => item.equipment_name).join(', ')}. This payment settles the whole invoice at once.
            </p>
          )}
          <label className="half">
            <span>Amount</span>
            <input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
          </label>
          <label className="half">
            <span>Discount</span>
            <input type="number" min="0" step="0.01" value={form.discount} onChange={(event) => setForm({ ...form, discount: event.target.value })} />
          </label>
          <label className="half">
            <span>Payment Type</span>
            <select value={form.payment_type} onChange={(event) => setForm({ ...form, payment_type: event.target.value as typeof form.payment_type })}>
              <option value="rent">Rent</option>
              <option value="deposit">Deposit</option>
              <option value="refund">Refund</option>
            </select>
          </label>
          <label className="half">
            <span>Payment Method</span>
            <select value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value as typeof form.payment_method })}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="upi">UPI</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            <span>Notes</span>
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <div className="modal-actions">
            {formError && <p className="form-error">{formError}</p>}
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Record Payment'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
