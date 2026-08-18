import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiRequest, downloadFile } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { Modal } from '../components/Modal';
import type { Customer, Equipment as EquipmentItem, Rental, RentalStatus } from '../types';

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

interface RentalItemForm {
  equipment_id: string;
  daily_rate: string;
  deposit: string;
  rental_days: string;
}

const EMPTY_ITEM: RentalItemForm = { equipment_id: '', daily_rate: '', deposit: '', rental_days: '1' };

const EMPTY_FORM = {
  customer_name: '',
  customer_phone: '',
  customer_address: '',
  rental_date: today(),
  expected_return_date: inDays(1),
  expected_return_time: '18:00',
  items: [{ ...EMPTY_ITEM }] as RentalItemForm[],
};

const EMPTY_RETURN_FORM = {
  actual_return_date: today(),
  damage_charge: '0',
  return_notes: '',
};

export function Rentals() {
  const location = useLocation();
  const navigate = useNavigate();

  const [rentals, setRentals] = useState<Rental[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [equipmentList, setEquipmentList] = useState<EquipmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const hasLoadedRef = useRef(false);

  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | RentalStatus>('All');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const isMultiItem = !editingId;

  const [returningRental, setReturningRental] = useState<Rental | null>(null);
  const [returnForm, setReturnForm] = useState(EMPTY_RETURN_FORM);
  const [returnError, setReturnError] = useState('');
  const [returning, setReturning] = useState(false);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setModalOpen(true);
  };

  const loadAll = () => {
    if (!hasLoadedRef.current) setLoading(true);
    Promise.all([
      apiRequest<Rental[]>('/rentals'),
      apiRequest<Customer[]>('/customers'),
      apiRequest<EquipmentItem[]>('/equipment'),
    ])
      .then(([rentalData, customerData, equipmentData]) => {
        setRentals(rentalData);
        setCustomers(customerData);
        setEquipmentList(equipmentData);
        setError('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load rentals'))
      .finally(() => {
        setLoading(false);
        hasLoadedRef.current = true;
      });
  };

  usePolling(loadAll);

  // Arrived here via the dashboard's "Create Rental" quick action, or the calendar's "View" link.
  useEffect(() => {
    const state = location.state as { openCreate?: boolean; search?: string } | null;
    if (state?.openCreate) {
      openCreate();
    }
    if (state?.search) {
      setSearch(state.search);
    }
    if (state?.openCreate || state?.search) {
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const filteredRentals = useMemo(() => rentals.filter((rental) => {
    const haystack = `${rental.invoice_number} ${rental.customer_name} ${rental.equipment_name} ${rental.rental_date} ${rental.expected_return_date} ${rental.actual_return_date ?? ''}`.toLowerCase();
    const matchesSearch = haystack.includes(search.toLowerCase());
    const matchesDate = !dateFilter
      || rental.rental_date === dateFilter
      || rental.expected_return_date === dateFilter
      || rental.actual_return_date === dateFilter;
    const matchesStatus = statusFilter === 'All' || rental.status === statusFilter;
    return matchesSearch && matchesDate && matchesStatus;
  }), [rentals, search, dateFilter, statusFilter]);

  const openEdit = (rental: Rental) => {
    setEditingId(rental.id);
    setForm({
      customer_name: rental.customer_name,
      customer_phone: rental.customer_phone,
      customer_address: rental.customer_address ?? '',
      rental_date: rental.rental_date,
      expected_return_date: rental.expected_return_date,
      expected_return_time: rental.expected_return_time,
      items: [{
        equipment_id: String(rental.equipment_id),
        daily_rate: String(rental.daily_rate),
        deposit: String(rental.deposit),
        rental_days: String(rental.rental_days),
      }],
    });
    setFormError('');
    setModalOpen(true);
  };

  // Equipment already picked in another row of this same rental can't be picked again.
  const equipmentOptionsForRow = (index: number) => {
    const chosenElsewhere = new Set(
      form.items.filter((_, i) => i !== index).map((item) => item.equipment_id).filter(Boolean),
    );
    return equipmentList.filter((item) => (
      (item.status === 'available' && !chosenElsewhere.has(String(item.id)))
      || String(item.id) === form.items[index].equipment_id
    ));
  };

  const updateItem = (index: number, patch: Partial<RentalItemForm>) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  };

  const handleItemEquipmentChange = (index: number, equipmentId: string) => {
    const selected = equipmentList.find((item) => String(item.id) === equipmentId);
    updateItem(index, {
      equipment_id: equipmentId,
      daily_rate: selected ? String(selected.daily_rent) : form.items[index].daily_rate,
      deposit: selected ? String(selected.security_deposit) : form.items[index].deposit,
    });
  };

  const addItemRow = () => {
    setForm((prev) => ({ ...prev, items: [...prev.items, { ...EMPTY_ITEM }] }));
  };

  const removeItemRow = (index: number) => {
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  };

  const itemsTotal = useMemo(() => form.items.reduce((sum, item) => {
    const rate = Number(item.daily_rate) || 0;
    const days = Number(item.rental_days) || 0;
    return sum + rate * days;
  }, 0), [form.items]);
  const depositTotal = useMemo(
    () => form.items.reduce((sum, item) => sum + (Number(item.deposit) || 0), 0),
    [form.items],
  );

  // Phone number is the lookup key: typing a phone that already belongs to a
  // customer pulls in their saved name/address instead of creating a duplicate.
  const handlePhoneChange = (phone: string) => {
    const existing = customers.find((customer) => customer.phone_number === phone.trim());
    setForm((prev) => ({
      ...prev,
      customer_phone: phone,
      customer_name: existing ? existing.full_name : prev.customer_name,
      customer_address: existing ? existing.address : prev.customer_address,
    }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.customer_name.trim() || !form.customer_phone.trim()) {
      setFormError('Enter the customer\'s name and phone number.');
      return;
    }
    if (form.items.some((item) => !item.equipment_id)) {
      setFormError('Select equipment for every item.');
      return;
    }
    const equipmentIds = form.items.map((item) => item.equipment_id);
    if (new Set(equipmentIds).size !== equipmentIds.length) {
      setFormError('Each equipment item can only be added once.');
      return;
    }

    setSaving(true);
    setFormError('');

    try {
      if (editingId) {
        const item = form.items[0];
        await apiRequest(`/rentals/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({
            customer_name: form.customer_name.trim(),
            customer_phone: form.customer_phone.trim(),
            customer_address: form.customer_address,
            equipment_id: Number(item.equipment_id),
            rental_date: form.rental_date,
            expected_return_date: form.expected_return_date,
            expected_return_time: form.expected_return_time,
            rental_days: Number(item.rental_days) || 1,
            daily_rate: Number(item.daily_rate) || 0,
            deposit: Number(item.deposit) || 0,
          }),
        });
      } else {
        await apiRequest('/rentals', {
          method: 'POST',
          body: JSON.stringify({
            customer_name: form.customer_name.trim(),
            customer_phone: form.customer_phone.trim(),
            customer_address: form.customer_address,
            rental_date: form.rental_date,
            expected_return_date: form.expected_return_date,
            expected_return_time: form.expected_return_time,
            items: form.items.map((item) => ({
              equipment_id: Number(item.equipment_id),
              daily_rate: Number(item.daily_rate) || 0,
              deposit: Number(item.deposit) || 0,
              rental_days: Number(item.rental_days) || 1,
            })),
          }),
        });
      }
      setModalOpen(false);
      loadAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save rental.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rental: Rental) => {
    if (!window.confirm(`Delete rental ${rental.invoice_number}?`)) return;
    try {
      await apiRequest(`/rentals/${rental.id}`, { method: 'DELETE' });
      loadAll();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete rental.');
    }
  };

  const openReturn = (rental: Rental) => {
    setReturningRental(rental);
    setReturnForm({ ...EMPTY_RETURN_FORM });
    setReturnError('');
  };

  const handleReturnSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!returningRental) return;
    setReturning(true);
    setReturnError('');
    try {
      await apiRequest(`/rentals/${returningRental.id}/return`, {
        method: 'POST',
        body: JSON.stringify({
          actual_return_date: returnForm.actual_return_date,
          damage_charge: Number(returnForm.damage_charge) || 0,
          return_notes: returnForm.return_notes,
        }),
      });
      setReturningRental(null);
      loadAll();
    } catch (err) {
      setReturnError(err instanceof Error ? err.message : 'Failed to process return.');
    } finally {
      setReturning(false);
    }
  };

  const handleInvoiceDownload = async (rental: Rental) => {
    try {
      await downloadFile(`/rentals/${rental.id}/invoice`, `${rental.invoice_number}.pdf`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to download invoice.');
    }
  };

  return (
    <div className="module-shell">
      <div className="module-head">
        <div>
          <p className="eyebrow">Rental Operations</p>
          <h2>Create and monitor rentals</h2>
        </div>
        <button type="button" className="primary-button" onClick={openCreate}>Create Rental</button>
      </div>

      <div className="toolbar">
        <input
          type="text"
          placeholder="Search by invoice, customer, or equipment"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <input
          type="date"
          value={dateFilter}
          onChange={(event) => setDateFilter(event.target.value)}
          title="Filter by rental, expected, or actual return date"
        />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
          <option value="All">All Status</option>
          <option value="active">Active</option>
          <option value="overdue">Overdue</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        {(search || dateFilter || statusFilter !== 'All') && (
          <button
            type="button"
            className="ghost-button"
            onClick={() => { setSearch(''); setDateFilter(''); setStatusFilter('All'); }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="panel-card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice</th><th>Customer</th><th>Equipment</th><th>Registered</th><th>Expected Return</th>
                <th>Returned</th><th>Status</th><th>Payment</th><th>Amount</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRentals.map((rental) => (
                <tr key={rental.id}>
                  <td>{rental.invoice_number}</td>
                  <td>{rental.customer_name}</td>
                  <td>{rental.equipment_name}</td>
                  <td>{rental.rental_date} {rental.rental_time}</td>
                  <td>{rental.expected_return_date} {rental.expected_return_time}</td>
                  <td>{rental.actual_return_date ? `${rental.actual_return_date} ${rental.actual_return_time}` : '—'}</td>
                  <td><span className={`status-badge ${rental.status}`}>{rental.status}</span></td>
                  <td><span className={`status-badge ${rental.payment_status}`}>{rental.payment_status}</span></td>
                  <td>₹ {rental.final_amount.toLocaleString()}</td>
                  <td>
                    {(rental.status === 'active' || rental.status === 'overdue') && (
                      <>
                        <button type="button" className="text-button" onClick={() => openReturn(rental)}>Return</button>
                        <button type="button" className="text-button" onClick={() => openEdit(rental)}>Edit</button>
                      </>
                    )}
                    <button type="button" className="text-button" onClick={() => handleInvoiceDownload(rental)}>Invoice</button>
                    <button type="button" className="text-button danger" onClick={() => handleDelete(rental)}>Delete</button>
                  </td>
                </tr>
              ))}
              {!loading && filteredRentals.length === 0 && (
                <tr><td colSpan={10}>No rentals match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modalOpen} title={editingId ? 'Edit Rental Item' : 'Create Rental'} onClose={() => setModalOpen(false)}>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="half">
            <span>Customer Phone</span>
            <input
              list="customer-phone-options"
              value={form.customer_phone}
              onChange={(event) => handlePhoneChange(event.target.value)}
              placeholder="Type or pick an existing number"
              required
            />
            <datalist id="customer-phone-options">
              {customers.map((customer) => (
                <option key={customer.id} value={customer.phone_number}>{customer.full_name}</option>
              ))}
            </datalist>
          </label>
          <label className="half">
            <span>Customer Name</span>
            <input
              value={form.customer_name}
              onChange={(event) => setForm({ ...form, customer_name: event.target.value })}
              required
            />
          </label>
          <label>
            <span>Customer Address</span>
            <input
              value={form.customer_address}
              onChange={(event) => setForm({ ...form, customer_address: event.target.value })}
            />
          </label>
          <p className="login-message" style={{ gridColumn: '1 / -1', marginTop: -6 }}>
            Customers are matched by phone number — an existing number reuses that customer's record automatically.
          </p>

          <label>
            <span>Rental Start</span>
            <input type="date" value={form.rental_date} onChange={(event) => setForm({ ...form, rental_date: event.target.value })} required />
          </label>
          <label className="half">
            <span>Expected Return Date</span>
            <input type="date" value={form.expected_return_date} onChange={(event) => setForm({ ...form, expected_return_date: event.target.value })} required />
          </label>
          <label className="half">
            <span>Expected Return Time</span>
            <input type="time" value={form.expected_return_time} onChange={(event) => setForm({ ...form, expected_return_time: event.target.value })} required />
          </label>

          <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="panel-title-row" style={{ marginBottom: 0 }}>
              <span style={{ fontWeight: 600 }}>{isMultiItem ? 'Equipment Items' : 'Equipment'}</span>
              {isMultiItem && form.items.length > 1 && (
                <span className="pill">Total: ₹ {itemsTotal.toLocaleString()} + ₹ {depositTotal.toLocaleString()} deposit</span>
              )}
            </div>
            {form.items.map((item, index) => (
              <div
                key={index}
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMultiItem ? '2fr 1fr 1fr 1fr auto' : '2fr 1fr 1fr 1fr',
                  gap: 8,
                  alignItems: 'end',
                }}
              >
                <label style={{ gridColumn: 'span 1' }}>
                  <span>Equipment</span>
                  <select value={item.equipment_id} onChange={(event) => handleItemEquipmentChange(index, event.target.value)} required>
                    <option value="">Select available equipment</option>
                    {equipmentOptionsForRow(index).map((option) => (
                      <option key={option.id} value={option.id}>{option.name} &middot; {option.category_name ?? 'Uncategorized'}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Daily Rate</span>
                  <input type="number" min="0" step="0.01" value={item.daily_rate} onChange={(event) => updateItem(index, { daily_rate: event.target.value })} required />
                </label>
                <label>
                  <span>Deposit</span>
                  <input type="number" min="0" step="0.01" value={item.deposit} onChange={(event) => updateItem(index, { deposit: event.target.value })} required />
                </label>
                <label>
                  <span>Days</span>
                  <input type="number" min="1" value={item.rental_days} onChange={(event) => updateItem(index, { rental_days: event.target.value })} required />
                </label>
                {isMultiItem && (
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() => removeItemRow(index)}
                    disabled={form.items.length === 1}
                    style={{ marginBottom: 12 }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            {isMultiItem && (
              <button type="button" className="ghost-button" onClick={addItemRow} style={{ alignSelf: 'flex-start' }}>
                + Add Another Item
              </button>
            )}
          </div>

          <p className="login-message" style={{ gridColumn: '1 / -1' }}>
            The rental's registered time is stamped automatically when you save — only the expected return time is set by hand.
            {isMultiItem && ' All items above share a single invoice number.'}
          </p>
          <div className="modal-actions">
            {formError && <p className="form-error">{formError}</p>}
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save Rental'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!returningRental} title={`Return Equipment — ${returningRental?.invoice_number ?? ''}`} onClose={() => setReturningRental(null)}>
        {returningRental && (
          <form className="form-grid" onSubmit={handleReturnSubmit}>
            <label>
              <span>Actual Return Date</span>
              <input
                type="date"
                value={returnForm.actual_return_date}
                onChange={(event) => setReturnForm({ ...returnForm, actual_return_date: event.target.value })}
                required
              />
            </label>
            <label>
              <span>Damage Charge</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={returnForm.damage_charge}
                onChange={(event) => setReturnForm({ ...returnForm, damage_charge: event.target.value })}
              />
            </label>
            <label>
              <span>Return Notes</span>
              <textarea value={returnForm.return_notes} onChange={(event) => setReturnForm({ ...returnForm, return_notes: event.target.value })} />
            </label>
            <div className="return-summary">
              <div><span>Registered</span><strong>{returningRental.rental_date} {returningRental.rental_time}</strong></div>
              <div><span>Expected Return</span><strong>{returningRental.expected_return_date} {returningRental.expected_return_time}</strong></div>
              <div><span>Daily Rate</span><strong>₹ {returningRental.daily_rate}</strong></div>
              <div><span>Total Rent</span><strong>₹ {returningRental.total_rent}</strong></div>
              <div><span>Security Deposit</span><strong>₹ {returningRental.deposit}</strong></div>
            </div>
            <p className="login-message" style={{ gridColumn: '1 / -1' }}>
              The return completion time is stamped automatically when you confirm. Other items on the same invoice are unaffected — return each separately.
            </p>
            <div className="modal-actions">
              {returnError && <p className="form-error">{returnError}</p>}
              <button type="submit" className="primary-button" disabled={returning}>{returning ? 'Processing…' : 'Confirm Return'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
