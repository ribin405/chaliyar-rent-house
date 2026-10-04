import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  stock_quantity: '1',
  status: 'available' as EquipmentItem['status'],
  location: '',
  notes: '',
};

export function Equipment() {
  const location = useLocation();
  const navigate = useNavigate();
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
  const [newCategory, setNewCategory] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [stockNote, setStockNote] = useState('');
  const addAnotherRef = useRef(false);

  // Arrived here from the global search, or a dashboard quick action.
  useEffect(() => {
    const state = location.state as { search?: string; openCreate?: boolean } | null;
    if (state?.search) {
      setSearch(state.search);
      setStatusFilter('All');
    }
    if (state?.openCreate) {
      openCreate();
    }
    if (state?.search || state?.openCreate) {
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

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

  const totalCount = equipment.reduce((sum, item) => sum + item.stock_quantity, 0);
  const availableCount = equipment.reduce((sum, item) => sum + item.available_quantity, 0);

  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { available: number; reserved: number; rented: number; maintenance: number; total: number }>();
    equipment.forEach((item) => {
      const key = item.category_name ?? 'Uncategorized';
      const entry = map.get(key) ?? { available: 0, reserved: 0, rented: 0, maintenance: 0, total: 0 };
      // Counted in units: 20 belt sheets with 5 out = 15 available + 5 rented.
      if (item.status === 'maintenance' || item.status === 'reserved') {
        entry[item.status] += item.stock_quantity;
      } else {
        entry.rented += item.units_out;
        entry.available += item.available_quantity;
      }
      entry.total += item.stock_quantity;
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

  const resetFormHints = () => {
    setFormError('');
    setSavedMessage('');
    setStockNote('');
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setNewCategory(false);
    resetFormHints();
    setModalOpen(true);
  };

  const openEdit = (item: EquipmentItem) => {
    setEditingId(item.id);
    setNewCategory(false);
    resetFormHints();
    setForm({
      name: item.name,
      category: item.category_name ?? '',
      daily_rent: String(item.daily_rent),
      security_deposit: String(item.security_deposit),
      stock_quantity: String(item.stock_quantity),
      status: item.status,
      location: item.location,
      notes: item.notes,
    });
    setFormError('');
    setModalOpen(true);
  };

  const editingItem = editingId ? equipment.find((item) => item.id === editingId) : undefined;
  // Every unit is out on rent: status follows the returns, not the form.
  const fullyOut = !!editingItem && editingItem.units_out > 0 && editingItem.units_out >= editingItem.stock_quantity;
  const minStock = Math.max(1, editingItem?.units_out ?? 0);
  const stockValue = Number(form.stock_quantity) || minStock;
  const setStock = (value: number) => setForm((prev) => ({ ...prev, stock_quantity: String(Math.max(minStock, value)) }));

  // Typing a name that's already in the list: more of the same item usually
  // means more stock, not a second entry.
  const duplicate = !editingId && form.name.trim()
    ? equipment.find((item) => item.name.trim().toLowerCase() === form.name.trim().toLowerCase())
    : undefined;

  const addStockTo = (item: EquipmentItem) => {
    const extra = Number(form.stock_quantity) || 1;
    openEdit(item);
    setForm((prev) => ({ ...prev, stock_quantity: String(item.stock_quantity + extra) }));
    setStockNote(`Stock raised from ${item.stock_quantity} to ${item.stock_quantity + extra} — save to confirm.`);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const dailyRent = Number(form.daily_rent);
    const securityDeposit = Number(form.security_deposit);
    const stockQuantity = Number(form.stock_quantity);
    if (!form.name.trim() || !Number.isFinite(dailyRent) || dailyRent < 0 || !Number.isFinite(securityDeposit) || securityDeposit < 0) {
      setFormError('Enter an equipment name and valid non-negative rent and deposit amounts.');
      return;
    }
    if (!Number.isInteger(stockQuantity) || stockQuantity < minStock) {
      setFormError(minStock > 1 ? `Stock must be at least ${minStock} — that many are out on rent.` : 'Stock must be a whole number of at least 1.');
      return;
    }

    setSaving(true);
    setFormError('');
    const payload = {
      name: form.name,
      category: form.category,
      daily_rent: dailyRent,
      security_deposit: securityDeposit,
      stock_quantity: stockQuantity,
      // While every unit is out the server keeps it "rented"; send that back unchanged.
      status: fullyOut ? 'rented' as const : form.status,
      location: form.location,
      notes: form.notes,
    };

    try {
      if (editingId) {
        await apiRequest(`/equipment/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiRequest('/equipment', { method: 'POST', body: JSON.stringify(payload) });
      }
      loadEquipment();
      // A typed-in category is created on save; refresh so it shows as a button.
      apiRequest<Category[]>('/categories').then(setCategories).catch(() => {});
      if (addAnotherRef.current && !editingId) {
        // Keep the category and rates for the next, likely similar, item.
        setForm({ ...EMPTY_FORM, category: form.category, daily_rent: form.daily_rent, security_deposit: form.security_deposit });
        setNewCategory(false);
        setFormError('');
        setStockNote('');
        setSavedMessage(`Saved “${form.name.trim()}”. Add the next one.`);
      } else {
        setModalOpen(false);
      }
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
        <div className="summary-pill">{equipment.length} items &middot; {totalCount} units</div>
        <div className="summary-pill success">Available: {availableCount}</div>
        <div className="summary-pill warning">Out / unavailable: {totalCount - availableCount}</div>
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
                <th>ID</th><th>Name</th><th>Category</th><th>Daily Rent</th><th>Stock</th><th>Status</th><th>Location</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.name}</td>
                  <td>{item.category_name ?? '—'}</td>
                  <td>₹ {item.daily_rent}</td>
                  <td>{item.stock_quantity > 1 ? `${item.available_quantity} of ${item.stock_quantity} free` : '1'}</td>
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
                <tr><td colSpan={8}>No equipment found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modalOpen} title={editingId ? 'Edit Equipment' : 'Add Equipment'} onClose={() => setModalOpen(false)}>
        <form className="form-grid" onSubmit={handleSubmit}>
          {savedMessage && <p className="form-success">{savedMessage}</p>}
          {stockNote && <p className="form-success">{stockNote}</p>}
          <label>
            <span>Name</span>
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required autoFocus />
          </label>
          {duplicate && (
            <div className="duplicate-hint">
              <span>
                <strong>{duplicate.name}</strong> already exists
                {' '}({duplicate.stock_quantity} in stock{duplicate.category_name ? ` · ${duplicate.category_name}` : ''}).
              </span>
              <button type="button" className="ghost-button small" onClick={() => addStockTo(duplicate)}>
                Add {Number(form.stock_quantity) || 1} to its stock instead
              </button>
            </div>
          )}

          <div className="field-block">
            <span className="field-label">Category</span>
            {/* New category comes first; the existing ones follow to pick from. */}
            <div className="new-category-row">
              <button
                type="button"
                className={`new-category-button ${newCategory ? 'active' : ''}`}
                onClick={() => { setNewCategory(true); setForm({ ...form, category: '' }); }}
              >
                + New Category
              </button>
              {newCategory && (
                <input
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                  placeholder="Category name, e.g. Scaffold"
                  autoFocus
                />
              )}
            </div>
            {categories.length > 0 && <small className="cell-sub">or pick an existing one:</small>}
            <div className="category-tabs wrap">
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={!newCategory && form.category === category.name ? 'active' : ''}
                  onClick={() => { setNewCategory(false); setForm({ ...form, category: category.name }); }}
                >
                  {category.name}
                </button>
              ))}
              {form.category && !newCategory && (
                <button type="button" className="clear-chip" onClick={() => setForm({ ...form, category: '' })}>No category</button>
              )}
            </div>
            {!form.category && !newCategory && (
              <small className="cell-sub">Pick a category so it shows under the right tab when creating an order.</small>
            )}
          </div>

          <label className="half">
            <span>Daily Rent (per unit)</span>
            <input type="number" min="0" step="0.01" value={form.daily_rent} onChange={(event) => setForm({ ...form, daily_rent: event.target.value })} required />
          </label>
          <label className="half">
            <span>Deposit (per unit)</span>
            <input type="number" min="0" step="0.01" value={form.security_deposit} onChange={(event) => setForm({ ...form, security_deposit: event.target.value })} required />
          </label>

          <div className="field-block half">
            <span className="field-label">Stock (units held)</span>
            <div className="qty-stepper">
              <button type="button" onClick={() => setStock(stockValue - 1)} disabled={stockValue <= minStock} aria-label="One less">−</button>
              <input
                type="number"
                min={minStock}
                step="1"
                value={form.stock_quantity}
                onChange={(event) => setForm({ ...form, stock_quantity: event.target.value })}
                aria-label="Stock"
                required
              />
              <button type="button" onClick={() => setStock(stockValue + 1)} aria-label="One more">+</button>
            </div>
            <small className="cell-sub">
              {editingItem && editingItem.units_out > 0
                ? `${editingItem.units_out} out on rent now, so at least ${editingItem.units_out}.`
                : '1 for a single machine; more for identical items rented in quantity (sheets, scaffolding…).'}
            </small>
          </div>

          <label className="half">
            <span>Status</span>
            {fullyOut ? (
              <>
                <input value="Rented — all units out" readOnly />
                <small className="cell-sub">Becomes available automatically when a unit is returned.</small>
              </>
            ) : (
              <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as EquipmentItem['status'] })}>
                <option value="available">Available</option>
                <option value="maintenance">Maintenance</option>
                <option value="reserved">Reserved</option>
              </select>
            )}
          </label>

          <label>
            <span>Location</span>
            <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Optional" />
          </label>
          <label>
            <span>Notes</span>
            <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Optional" />
          </label>
          <div className="modal-actions">
            {formError && <p className="form-error">{formError}</p>}
            {!editingId && (
              <button type="submit" className="ghost-button" disabled={saving} onClick={() => { addAnotherRef.current = true; }}>
                Save &amp; Add Another
              </button>
            )}
            <button type="submit" className="primary-button" disabled={saving} onClick={() => { addAnotherRef.current = false; }}>
              {saving ? 'Saving…' : 'Save Equipment'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
