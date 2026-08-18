import { useMemo, useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { Modal } from '../components/Modal';
import type { Customer } from '../types';

const EMPTY_FORM = {
  full_name: '',
  phone_number: '',
  alternate_phone: '',
  address: '',
  status: 'active' as Customer['status'],
  notes: '',
};

export function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | Customer['status']>('All');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const hasLoadedRef = useRef(false);
  const loadCustomers = () => {
    if (!hasLoadedRef.current) setLoading(true);
    apiRequest<Customer[]>('/customers')
      .then((data) => {
        setCustomers(data);
        setError('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load customers'))
      .finally(() => {
        setLoading(false);
        hasLoadedRef.current = true;
      });
  };

  usePolling(loadCustomers);

  const filtered = useMemo(() => customers.filter((customer) => {
    const matchesSearch = `${customer.id} ${customer.full_name} ${customer.phone_number}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'All' || customer.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [customers, search, statusFilter]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditingId(customer.id);
    setForm({
      full_name: customer.full_name,
      phone_number: customer.phone_number,
      alternate_phone: customer.alternate_phone,
      address: customer.address,
      status: customer.status,
      notes: customer.notes,
    });
    setFormError('');
    setModalOpen(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.full_name.trim() || !form.phone_number.trim()) {
      setFormError('Full name and phone number are required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (editingId) {
        await apiRequest(`/customers/${editingId}`, { method: 'PUT', body: JSON.stringify(form) });
      } else {
        await apiRequest('/customers', { method: 'POST', body: JSON.stringify(form) });
      }
      setModalOpen(false);
      loadCustomers();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save customer.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (customer: Customer) => {
    if (!window.confirm(`Delete ${customer.full_name}?`)) return;
    try {
      await apiRequest(`/customers/${customer.id}`, { method: 'DELETE' });
      loadCustomers();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete customer.');
    }
  };

  return (
    <div className="module-shell">
      <div className="module-head">
        <div>
          <p className="eyebrow">Customer Directory</p>
          <h2>Manage customer records</h2>
        </div>
        <button type="button" className="primary-button" onClick={openCreate}>Add Customer</button>
      </div>

      <div className="toolbar">
        <input
          type="text"
          placeholder="Search by name, phone or ID"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
          <option value="All">All Status</option>
          <option value="active">Active</option>
          <option value="blocked">Blocked</option>
        </select>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="panel-card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer ID</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Registration</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((customer) => (
                <tr key={customer.id}>
                  <td>{customer.id}</td>
                  <td>{customer.full_name}</td>
                  <td>{customer.phone_number}</td>
                  <td><span className={`status-badge ${customer.status === 'active' ? 'available' : 'maintenance'}`}>{customer.status}</span></td>
                  <td>{customer.registration_date}</td>
                  <td>
                    <button type="button" className="text-button" onClick={() => openEdit(customer)}>Edit</button>
                    <button type="button" className="text-button danger" onClick={() => handleDelete(customer)}>Delete</button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6}>No customers found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modalOpen} title={editingId ? 'Edit Customer' : 'Add Customer'} onClose={() => setModalOpen(false)}>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            <span>Full Name</span>
            <input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} required />
          </label>
          <label>
            <span>Phone Number</span>
            <input value={form.phone_number} onChange={(event) => setForm({ ...form, phone_number: event.target.value })} required />
          </label>
          <label>
            <span>Alternate Phone</span>
            <input value={form.alternate_phone} onChange={(event) => setForm({ ...form, alternate_phone: event.target.value })} />
          </label>
          <label>
            <span>Address</span>
            <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
          </label>
          <label>
            <span>Status</span>
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Customer['status'] })}>
              <option value="active">Active</option>
              <option value="blocked">Blocked</option>
            </select>
          </label>
          <label>
            <span>Notes</span>
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <div className="modal-actions">
            {formError && <p className="form-error">{formError}</p>}
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save Customer'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
