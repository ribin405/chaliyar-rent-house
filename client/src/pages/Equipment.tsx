import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { apiRequest } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { Modal } from '../components/Modal';
import { useAuth } from '../context/AuthContext';
import type { Category, Equipment as EquipmentItem } from '../types';

const EMPTY_FORM = {
  name: '',
  category: '',
  daily_rent: '',
  security_deposit: '',
  status: 'available' as EquipmentItem['status'],
  location: '',
  notes: '',
};

export function Equipment() {
  const { user } = useAuth();
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | EquipmentItem['status']>('All');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const hasLoadedRef = useRef(false);
  const loadEquipment = () => {
    if (!hasLoadedRef.current) setLoading(true);
    apiRequest<EquipmentItem[]>('/equipment')
      .then((data) => {
        setEquipment(data);
        setError('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load equipment'))
      .finally(() => {
        setLoading(false);
        hasLoadedRef.current = true;
      });
  };

  usePolling(loadEquipment);

  useEffect(() => {
    apiRequest<Category[]>('/categories').then(setCategories).catch(() => setCategories([]));
  }, []);

  const filtered = useMemo(() => equipment.filter((item) => {
    const matchesSearch = `${item.id} ${item.name} ${item.category_name ?? ''}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'All' || item.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [equipment, search, statusFilter]);

  const totalCount = equipment.length;
  const availableCount = equipment.filter((item) => item.status === 'available').length;

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { available: number; reserved: number; rented: number; maintenance: number; total: number }>();
    equipment.forEach((item) => {
      const key = item.category_name ?? 'Uncategorized';
      const entry = map.get(key) ?? { available: 0, reserved: 0, rented: 0, maintenance: 0, total: 0 };
      entry[item.status] += 1;
      entry.total += 1;
      map.set(key, entry);
    });
    return Array.from(map.entries())
      .map(([category, counts]) => ({ category, ...counts }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [equipment]);

  const categoryTotals = categoryBreakdown.reduce(
    (acc, row) => ({
      available: acc.available + row.available,
      reserved: acc.reserved + row.reserved,
      rented: acc.rented + row.rented,
      maintenance: acc.maintenance + row.maintenance,
      total: acc.total + row.total,
    }),
    { available: 0, reserved: 0, rented: 0, maintenance: 0, total: 0 },
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (item: EquipmentItem) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      category: item.category_name ?? '',
      daily_rent: String(item.daily_rent),
      security_deposit: String(item.security_deposit),
      status: item.status,
      location: item.location,
      notes: item.notes,
    });
    setFormError('');
    setModalOpen(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const dailyRent = Number(form.daily_rent);
    const securityDeposit = Number(form.security_deposit);
    if (!form.name.trim() || !Number.isFinite(dailyRent) || dailyRent < 0 || !Number.isFinite(securityDeposit) || securityDeposit < 0) {
      setFormError('Enter an equipment name and valid non-negative rent and deposit amounts.');
      return;
    }

    setSaving(true);
    setFormError('');
    const payload = {
      name: form.name,
      category: form.category,
      daily_rent: dailyRent,
      security_deposit: securityDeposit,
      status: form.status,
      location: form.location,
      notes: form.notes,
    };

    try {
      if (editingId) {
        await apiRequest(`/equipment/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiRequest('/equipment', { method: 'POST', body: JSON.stringify(payload) });
      }
      setModalOpen(false);
      loadEquipment();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save equipment.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: EquipmentItem) => {
    if (!window.confirm(`Delete ${item.name}?`)) return;
    try {
      await apiRequest(`/equipment/${item.id}`, { method: 'DELETE' });
      loadEquipment();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete equipment.');
    }
  };

  return (
    <div className="module-shell">
      <div className="module-head">
        <div>
          <p className="eyebrow">Equipment Inventory</p>
          <h2>Track equipment and availability</h2>
        </div>
        <button type="button" className="primary-button" onClick={openCreate}>Add Equipment</button>
      </div>

      <div className="panel-card summary-card">
        <div className="summary-pill">Total: {totalCount}</div>
        <div className="summary-pill success">Available: {availableCount}</div>
        <div className="summary-pill warning">Unavailable: {totalCount - availableCount}</div>
      </div>

      <div className="panel-card">
        <div className="panel-title-row">
          <h3>Inventory by Category</h3>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Available</th>
                <th>Reserved</th>
                <th>Rented</th>
                <th>Maintenance</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {categoryBreakdown.map((row) => (
                <tr key={row.category}>
                  <td>{row.category}</td>
                  <td><span className="status-badge available">{row.available}</span></td>
                  <td><span className="status-badge reserved">{row.reserved}</span></td>
                  <td><span className="status-badge rented">{row.rented}</span></td>
                  <td><span className="status-badge maintenance">{row.maintenance}</span></td>
                  <td><strong>{row.total}</strong></td>
                </tr>
              ))}
              {categoryBreakdown.length === 0 && (
                <tr><td colSpan={6}>No equipment found.</td></tr>
              )}
            </tbody>
            {categoryBreakdown.length > 0 && (
              <tfoot>
                <tr>
                  <td><strong>All Categories</strong></td>
                  <td><strong>{categoryTotals.available}</strong></td>
                  <td><strong>{categoryTotals.reserved}</strong></td>
                  <td><strong>{categoryTotals.rented}</strong></td>
                  <td><strong>{categoryTotals.maintenance}</strong></td>
                  <td><strong>{categoryTotals.total}</strong></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="toolbar">
        <input type="text" placeholder="Search by name or category" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
          <option value="All">All Status</option>
          <option value="available">Available</option>
          <option value="reserved">Reserved</option>
          <option value="rented">Rented</option>
          <option value="maintenance">Maintenance</option>
        </select>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="panel-card">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th><th>Name</th><th>Category</th><th>Daily Rent</th><th>Status</th><th>Location</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.name}</td>
                  <td>{item.category_name ?? '—'}</td>
                  <td>₹ {item.daily_rent}</td>
                  <td><span className={`status-badge ${item.status}`}>{item.status}</span></td>
                  <td>{item.location}</td>
                  <td>
                    <button type="button" className="text-button" onClick={() => openEdit(item)}>Edit</button>
                    {user?.role === 'owner' && (
                      <button type="button" className="text-button danger" onClick={() => handleDelete(item)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7}>No equipment found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modalOpen} title={editingId ? 'Edit Equipment' : 'Add Equipment'} onClose={() => setModalOpen(false)}>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            <span>Name</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </label>
          <label>
            <span>Category</span>
            <input
              list="category-options"
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
              placeholder="Select or type a new category"
            />
            <datalist id="category-options">
              {categories.map((category) => <option key={category.id} value={category.name} />)}
            </datalist>
          </label>
          <label>
            <span>Daily Rent</span>
            <input type="number" min="0" step="0.01" value={form.daily_rent} onChange={(event) => setForm({ ...form, daily_rent: event.target.value })} required />
          </label>
          <label>
            <span>Security Deposit</span>
            <input type="number" min="0" step="0.01" value={form.security_deposit} onChange={(event) => setForm({ ...form, security_deposit: event.target.value })} required />
          </label>
          <label>
            <span>Status</span>
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as EquipmentItem['status'] })}>
              <option value="available">Available</option>
              <option value="reserved">Reserved</option>
              <option value="rented">Rented</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </label>
          <label>
            <span>Location</span>
            <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} />
          </label>
          <label>
            <span>Notes</span>
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <div className="modal-actions">
            {formError && <p className="form-error">{formError}</p>}
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save Equipment'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
