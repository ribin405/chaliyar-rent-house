import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { Modal } from './Modal';
import { itemLabel } from '../lib/format';
import type { Rental } from '../types';

const EMPTY_FORM = {
  invoice_number: '',
  actual_amount: '',
  discount: '',
  payment_method: 'cash' as 'cash' | 'upi',
  payment_type: 'rent' as 'rent' | 'deposit' | 'refund',
  notes: '',
};

interface InvoiceGroup {
  invoice_number: string;
  customer_name: string;
  items: Rental[];
  total: number;
  payment_status: Rental['payment_status'];
}

export interface PaymentPreset {
  invoice?: string;
  amount?: number;
}

interface RecordPaymentModalProps {
  open: boolean;
  onClose: () => void;
  // Every rental, so invoices (which can cover several items) can be listed and described.
  rentals: Rental[];
  // Invoice and amount to start from, e.g. the balance still due.
  preset?: PaymentPreset | null;
  onSaved: () => void;
}

// Shared by the Payments page and the return form ("Not paid — record payment").
export function RecordPaymentModal({ open, onClose, rentals, preset, onSaved }: RecordPaymentModalProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Start fresh (or from the preset) every time the form opens.
  useEffect(() => {
    if (!open) return;
    setForm({
      ...EMPTY_FORM,
      invoice_number: preset?.invoice ?? '',
      actual_amount: preset?.amount && preset.amount > 0 ? String(preset.amount) : '',
    });
    setFormError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  const selectedInvoiceItems = form.invoice_number
    ? rentals.filter((rental) => rental.invoice_number === form.invoice_number)
    : [];

  // The cashier types the actual amount and any discount; what actually changes
  // hands (the amount) is the difference, which is what gets recorded.
  const actualAmount = Number(form.actual_amount) || 0;
  const discount = Number(form.discount) || 0;
  const amount = Math.round((actualAmount - discount) * 100) / 100;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.invoice_number) {
      setFormError('Select an invoice.');
      return;
    }
    if (actualAmount <= 0) {
      setFormError('Enter the actual amount.');
      return;
    }
    if (discount > actualAmount) {
      setFormError('The discount cannot be more than the actual amount.');
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
      onClose();
      onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to record payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="Record Payment" onClose={onClose}>
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
            Covers: {selectedInvoiceItems.map((item) => itemLabel(item.equipment_name, item.quantity)).join(', ')}. This payment settles the whole invoice at once.
          </p>
        )}
        <label className="half">
          <span>Actual Amount</span>
          <input type="number" min="0" step="0.01" value={form.actual_amount} onChange={(event) => setForm({ ...form, actual_amount: event.target.value })} />
        </label>
        <label className="half">
          <span>Discount</span>
          <input type="number" min="0" step="0.01" value={form.discount} onChange={(event) => setForm({ ...form, discount: event.target.value })} />
        </label>
        <label>
          <span>Amount (Actual Amount − Discount)</span>
          <input type="text" value={form.actual_amount || form.discount ? `₹ ${Math.max(0, amount).toLocaleString()}` : ''} readOnly tabIndex={-1} className="computed-field" placeholder="Calculated automatically" />
        </label>
        <label className="half">
          <span>Payment Type</span>
          <select value={form.payment_type} onChange={(event) => setForm({ ...form, payment_type: event.target.value as typeof form.payment_type })}>
            <option value="rent">Rent</option>
            <option value="deposit">Deposit</option>
            <option value="refund">Refund</option>
          </select>
        </label>
        <div className="field-block half">
          <span>Paid by</span>
          <div className="segmented large" role="group" aria-label="Paid by">
            {([['cash', 'Cash'], ['upi', 'UPI']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={form.payment_method === value ? 'active' : ''}
                aria-pressed={form.payment_method === value}
                onClick={() => setForm({ ...form, payment_method: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
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
  );
}
