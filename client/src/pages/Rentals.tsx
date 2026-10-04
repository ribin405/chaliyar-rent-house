import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiRequest, downloadFile } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { Modal } from '../components/Modal';
import { EquipmentPicker } from '../components/EquipmentPicker';
import { EquipmentButtons } from '../components/EquipmentButtons';
import { itemLabel } from '../lib/format';
import type { Customer, Equipment as EquipmentItem, Rental, RentalStatus } from '../types';

const today = () => new Date().toISOString().slice(0, 10);

// One line of an order: some quantity of one piece of equipment. The deposit
// follows the per-unit deposit × quantity until someone types their own.
interface RentalItemForm {
  equipment_id: string;
  quantity: string;
  daily_rate: string;
  deposit: string;
  unit_deposit: number;
  deposit_edited: boolean;
}

const orderLine = (item: Pick<EquipmentItem, 'id' | 'daily_rent' | 'security_deposit'>, quantity = 1): RentalItemForm => ({
  equipment_id: String(item.id),
  quantity: String(quantity),
  daily_rate: String(item.daily_rent),
  deposit: String(item.security_deposit * quantity),
  unit_deposit: item.security_deposit,
  deposit_edited: false,
});

const EMPTY_FORM = {
  customer_name: '',
  customer_phone: '',
  customer_address: '',
  rental_date: today(),
  expected_return_date: today(),
  expected_return_time: '18:00',
  items: [] as RentalItemForm[],
  // Only used when editing an item that has already been returned.
  actual_return_date: '',
  damage_charge: '',
  return_notes: '',
};

const EMPTY_RETURN_FORM = {
  actual_return_date: today(),
  return_notes: '',
  // Damage charge per rental item id, as typed.
  damage: {} as Record<number, string>,
};

type PresetEquipment = Pick<EquipmentItem, 'id' | 'daily_rent' | 'security_deposit'>;

// What other pages can hand over when they navigate here.
interface NavState {
  openCreate?: boolean;
  equipment?: PresetEquipment;
  search?: string;
  returnInvoice?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isOpen = (rental: Rental) => rental.status === 'active' || rental.status === 'overdue';

// Every calendar day counts as a full day, both ends included: out and back
// the same day = 1 day, back the next day = 2 days.
const calendarDays = (fromDate: string, toDate: string) => Math.round((Date.parse(toDate) - Date.parse(fromDate)) / DAY_MS) + 1;
const addDays = (date: string, days: number) => new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);

// Mirrors computeReturnCharges in rentals.routes.js so the preview matches what
// actually gets charged: every day used at the daily rate, with days past the
// expected return shown as the late fee (part of that count, not extra).
const previewReturn = (
  rental: Pick<Rental, 'rental_date' | 'expected_return_date' | 'daily_rate' | 'deposit'> & { quantity?: number },
  actualReturnDate: string,
  damageCharge: number,
) => {
  const usedDays = Math.max(1, calendarDays(rental.rental_date, actualReturnDate));
  const daysPastExpected = Math.max(0, calendarDays(rental.expected_return_date, actualReturnDate) - 1);
  const lateDays = Math.min(daysPastExpected, usedDays - 1);
  const rentalDays = usedDays - lateDays;
  const lineRate = rental.daily_rate * (rental.quantity ?? 1);
  return {
    usedDays,
    rentalDays,
    lateDays,
    totalRent: rentalDays * lineRate,
    lateFee: lateDays * lineRate,
    refund: Math.max(0, rental.deposit - damageCharge),
    finalAmount: usedDays * lineRate + damageCharge,
  };
};

// One invoice can hold several equipment items; the list shows them as a group.
interface RentalGroup {
  invoice: string;
  items: Rental[]; // items matching the current filters
  allItems: Rental[]; // every item on the invoice
  status: RentalStatus;
  total: number;
}

const groupStatus = (items: Rental[]): RentalStatus => {
  if (items.some((item) => item.status === 'overdue')) return 'overdue';
  if (items.some((item) => item.status === 'active')) return 'active';
  if (items.some((item) => item.status === 'completed')) return 'completed';
  return 'cancelled';
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
  const editingRental = editingId ? rentals.find((rental) => rental.id === editingId) : undefined;
  const isEditingReturned = editingRental?.status === 'completed';

  const [expandedInvoices, setExpandedInvoices] = useState<Set<string>>(new Set());
  // Checked items — always from a single invoice, since returns settle per invoice.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [returningItems, setReturningItems] = useState<Rental[]>([]);
  const [pendingReturnInvoice, setPendingReturnInvoice] = useState<string | null>(null);
  const [returnForm, setReturnForm] = useState(EMPTY_RETURN_FORM);
  const [returnError, setReturnError] = useState('');
  const [returning, setReturning] = useState(false);

  const openCreate = (preset?: PresetEquipment) => {
    setEditingId(null);
    setForm(preset ? { ...EMPTY_FORM, items: [orderLine(preset)] } : EMPTY_FORM);
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

  // Arrived here via a "Create Rental" / "Rent" / "Return" button elsewhere, or the calendar's "View" link.
  useEffect(() => {
    const state = location.state as NavState | null;
    if (state?.openCreate) {
      openCreate(state.equipment);
    }
    if (state?.returnInvoice) {
      setSearch(state.returnInvoice);
      setStatusFilter('All');
      setDateFilter('');
      setExpandedInvoices(new Set([state.returnInvoice]));
      setPendingReturnInvoice(state.returnInvoice);
    }
    if (state?.search) {
      setSearch(state.search);
      setStatusFilter('All');
      setDateFilter('');
      // Global search hands over an invoice number; open that group.
      setExpandedInvoices(new Set([state.search]));
    }
    if (state?.openCreate || state?.search || state?.returnInvoice) {
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // The return form needs the invoice's items, so it waits for rentals to load.
  useEffect(() => {
    if (!pendingReturnInvoice || loading) return;
    const openItems = rentals.filter((rental) => rental.invoice_number === pendingReturnInvoice && isOpen(rental));
    if (openItems.length) openReturn(openItems);
    setPendingReturnInvoice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rentals, pendingReturnInvoice, loading]);

  const filteredRentals = useMemo(() => rentals.filter((rental) => {
    const haystack = `${rental.invoice_number} ${rental.customer_name} ${rental.customer_phone} ${rental.equipment_name} ${rental.rental_date} ${rental.expected_return_date} ${rental.actual_return_date ?? ''}`.toLowerCase();
    const matchesSearch = haystack.includes(search.toLowerCase());
    const matchesDate = !dateFilter
      || rental.rental_date === dateFilter
      || rental.expected_return_date === dateFilter
      || rental.actual_return_date === dateFilter;
    const matchesStatus = statusFilter === 'All' || rental.status === statusFilter;
    return matchesSearch && matchesDate && matchesStatus;
  }), [rentals, search, dateFilter, statusFilter]);

  // Groups keep the list's newest-first order (by each invoice's first match).
  const groups = useMemo(() => {
    const allByInvoice = new Map<string, Rental[]>();
    rentals.forEach((rental) => {
      allByInvoice.set(rental.invoice_number, [...(allByInvoice.get(rental.invoice_number) ?? []), rental]);
    });
    const result = new Map<string, RentalGroup>();
    filteredRentals.forEach((rental) => {
      const existing = result.get(rental.invoice_number);
      if (existing) {
        existing.items.push(rental);
        return;
      }
      const allItems = [...(allByInvoice.get(rental.invoice_number) ?? [rental])].sort((a, b) => a.id - b.id);
      result.set(rental.invoice_number, {
        invoice: rental.invoice_number,
        items: [rental],
        allItems,
        status: groupStatus(allItems),
        total: allItems.reduce((sum, item) => sum + item.final_amount, 0),
      });
    });
    result.forEach((group) => group.items.sort((a, b) => a.id - b.id));
    return [...result.values()];
  }, [rentals, filteredRentals]);

  // Polling can close items elsewhere — drop any selection that's no longer returnable.
  useEffect(() => {
    setSelectedIds((prev) => {
      const stillOpen = new Set([...prev].filter((id) => rentals.some((rental) => rental.id === id && isOpen(rental))));
      return stillOpen.size === prev.size ? prev : stillOpen;
    });
  }, [rentals]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [search, dateFilter, statusFilter]);

  const selectedItems = rentals.filter((rental) => selectedIds.has(rental.id));
  const selectedInvoice = selectedItems[0]?.invoice_number ?? null;

  const toggleItem = (rental: Rental) => {
    setSelectedIds((prev) => {
      // Ticking an item from another invoice starts a fresh selection.
      const next = new Set(rental.invoice_number === selectedInvoice ? prev : []);
      if (next.has(rental.id)) next.delete(rental.id);
      else next.add(rental.id);
      return next;
    });
  };

  const toggleGroup = (group: RentalGroup) => {
    const openIds = group.items.filter(isOpen).map((item) => item.id);
    const allChecked = openIds.length > 0 && openIds.every((id) => selectedIds.has(id));
    setSelectedIds(allChecked ? new Set() : new Set(openIds));
  };

  const toggleExpanded = (invoice: string) => {
    setExpandedInvoices((prev) => {
      const next = new Set(prev);
      if (next.has(invoice)) next.delete(invoice);
      else next.add(invoice);
      return next;
    });
  };

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
        quantity: String(rental.quantity),
        daily_rate: String(rental.daily_rate),
        deposit: String(rental.deposit),
        unit_deposit: rental.deposit / (rental.quantity || 1),
        deposit_edited: true,
      }],
      actual_return_date: rental.actual_return_date ?? '',
      damage_charge: String(rental.damage_charge ?? 0),
      return_notes: rental.return_notes ?? '',
    });
    setFormError('');
    setModalOpen(true);
  };

  // Units of a line's equipment that can still go out. When editing an open
  // rental, its own units are already counted as out, so they're added back.
  const maxQuantity = (item: RentalItemForm) => {
    // A returned line no longer holds stock, so correcting its quantity isn't capped.
    if (editingRental && !isOpen(editingRental)) return Number.MAX_SAFE_INTEGER;
    const equipment = equipmentList.find((option) => String(option.id) === item.equipment_id);
    if (!equipment) return 1;
    const ownUnits = editingRental && isOpen(editingRental) && String(editingRental.equipment_id) === item.equipment_id
      ? editingRental.quantity
      : 0;
    return Math.max(1, equipment.available_quantity + ownUnits);
  };

  // Edit form: equipment that has a free unit, plus whatever the line holds now.
  const editEquipmentOptions = (index: number) => equipmentList.filter((item) => (
    item.available_quantity > 0 || String(item.id) === form.items[index].equipment_id
  ));

  const updateItem = (index: number, patch: Partial<RentalItemForm>) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  };

  const setQuantity = (index: number, value: string) => {
    const item = form.items[index];
    const quantity = Math.min(Math.max(1, Math.floor(Number(value)) || 1), maxQuantity(item));
    updateItem(index, {
      quantity: String(quantity),
      ...(!item.deposit_edited && { deposit: String(item.unit_deposit * quantity) }),
    });
  };

  const handleItemEquipmentChange = (index: number, equipmentId: string) => {
    const selected = equipmentList.find((item) => String(item.id) === equipmentId);
    if (!selected) return;
    updateItem(index, { ...orderLine(selected, 1), equipment_id: equipmentId });
  };

  // Tapping an equipment button adds one unit: a new line, or +1 on its line.
  const addToOrder = (equipment: EquipmentItem) => {
    const index = form.items.findIndex((item) => item.equipment_id === String(equipment.id));
    if (index >= 0) {
      setQuantity(index, String(Number(form.items[index].quantity) + 1));
    } else {
      setForm((prev) => ({ ...prev, items: [...prev.items, orderLine(equipment)] }));
    }
  };

  const removeItemRow = (index: number) => {
    setForm((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  };

  const unitsInOrder = useMemo(
    () => new Map(form.items.map((item) => [Number(item.equipment_id), Number(item.quantity) || 0])),
    [form.items],
  );

  const bookedDays = calendarDays(form.rental_date, form.expected_return_date);
  const itemsTotal = useMemo(
    () => form.items.reduce((sum, item) => sum + (Number(item.daily_rate) || 0) * (Number(item.quantity) || 1) * Math.max(0, bookedDays), 0),
    [form.items, bookedDays],
  );
  // Typing a day count moves the expected return date to match.
  const handleDaysChange = (days: string) => {
    const count = Math.floor(Number(days));
    if (count >= 1) setForm((prev) => ({ ...prev, expected_return_date: addDays(prev.rental_date, count - 1) }));
  };
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
    if (form.items.length === 0) {
      setFormError('Tap the equipment to add it to the order.');
      return;
    }
    if (form.items.some((item) => !item.equipment_id)) {
      setFormError('Select the equipment.');
      return;
    }
    if (!(bookedDays >= 1)) {
      setFormError('The expected return date cannot be before the rental date.');
      return;
    }
    if (isEditingReturned && form.actual_return_date && calendarDays(form.rental_date, form.actual_return_date) < 1) {
      setFormError('The return date cannot be before the rental date.');
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
            quantity: Number(item.quantity) || 1,
            rental_date: form.rental_date,
            expected_return_date: form.expected_return_date,
            expected_return_time: form.expected_return_time,
            daily_rate: Number(item.daily_rate) || 0,
            deposit: Number(item.deposit) || 0,
            ...(isEditingReturned && {
              actual_return_date: form.actual_return_date,
              damage_charge: Number(form.damage_charge) || 0,
              return_notes: form.return_notes,
            }),
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
              quantity: Number(item.quantity) || 1,
              daily_rate: Number(item.daily_rate) || 0,
              deposit: Number(item.deposit) || 0,
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

  const handleDelete = async (rental: Rental, isGroupItem = false) => {
    const message = isGroupItem
      ? `Delete ${rental.equipment_name} from rental ${rental.invoice_number}?`
      : `Delete rental ${rental.invoice_number}?`;
    if (!window.confirm(message)) return;
    try {
      await apiRequest(`/rentals/${rental.id}`, { method: 'DELETE' });
      loadAll();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to delete rental.');
    }
  };

  const openReturn = (items: Rental[]) => {
    setReturningItems(items);
    setReturnForm({ ...EMPTY_RETURN_FORM, actual_return_date: today(), damage: {} });
    setReturnError('');
  };

  const returnPreview = returningItems.map((rental) => {
    const damage = Number(returnForm.damage[rental.id]) || 0;
    return { rental, damage, ...previewReturn(rental, returnForm.actual_return_date, damage) };
  });
  const returnTotals = returnPreview.reduce((acc, row) => ({
    lateFee: acc.lateFee + row.lateFee,
    damage: acc.damage + row.damage,
    refund: acc.refund + row.refund,
    finalAmount: acc.finalAmount + row.finalAmount,
  }), { lateFee: 0, damage: 0, refund: 0, finalAmount: 0 });

  const handleReturnSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (returningItems.length === 0) return;
    setReturning(true);
    setReturnError('');
    try {
      await apiRequest('/rentals/return-batch', {
        method: 'POST',
        body: JSON.stringify({
          actual_return_date: returnForm.actual_return_date,
          return_notes: returnForm.return_notes,
          items: returningItems.map((rental) => ({
            id: rental.id,
            damage_charge: Number(returnForm.damage[rental.id]) || 0,
          })),
        }),
      });
      setReturningItems([]);
      setSelectedIds(new Set());
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
        <button type="button" className="primary-button" onClick={() => openCreate()}>Create Rental</button>
      </div>

      <div className="toolbar">
        <input
          type="text"
          placeholder="Search by invoice, customer, phone, or equipment"
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

      {selectedItems.length > 0 && (
        <div className="selection-bar">
          <span>
            <strong>{selectedItems.length}</strong> item{selectedItems.length > 1 ? 's' : ''} selected
            {' '}from {selectedInvoice} &middot; {selectedItems[0].customer_name}
          </span>
          <button type="button" className="primary-button" onClick={() => openReturn(selectedItems)}>Return Selected</button>
          <button type="button" className="ghost-button" onClick={() => setSelectedIds(new Set())}>Clear</button>
        </div>
      )}

      <div className="panel-card">
        <div className="table-scroll">
          <table className="data-table rentals-table">
            <thead>
              <tr>
                <th className="row-check" aria-label="Select" />
                <th>Invoice</th><th>Customer</th><th>Equipment</th><th>Registered</th><th>Expected Return</th>
                <th>Returned</th><th>Status</th><th>Payment</th><th>Amount</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const head = group.allItems[0];
                const expanded = expandedInvoices.has(group.invoice);
                const openItems = group.items.filter(isOpen);
                const checkedCount = openItems.filter((item) => selectedIds.has(item.id)).length;
                const returnedCount = group.allItems.filter((item) => item.status === 'completed').length;

                const itemRow = (rental: Rental, isChild: boolean) => (
                  <tr key={rental.id} className={`${isChild ? 'rental-child-row' : ''} ${selectedIds.has(rental.id) ? 'selected' : ''}`}>
                    <td className="row-check">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(rental.id)}
                        disabled={!isOpen(rental)}
                        onChange={() => toggleItem(rental)}
                        aria-label={`Select ${rental.equipment_name}`}
                        title={isOpen(rental) ? 'Select to return' : 'Already closed'}
                      />
                    </td>
                    <td>{isChild ? '' : rental.invoice_number}</td>
                    <td>{isChild ? '' : rental.customer_name}</td>
                    <td>{itemLabel(rental.equipment_name, rental.quantity)}</td>
                    <td>{rental.rental_date} {rental.rental_time}</td>
                    <td>{rental.expected_return_date} {rental.expected_return_time}</td>
                    <td>{rental.actual_return_date ? `${rental.actual_return_date} ${rental.actual_return_time}` : '—'}</td>
                    <td><span className={`status-badge ${rental.status}`}>{rental.status}</span></td>
                    <td>{!isChild && <span className={`status-badge ${rental.payment_status}`}>{rental.payment_status}</span>}</td>
                    <td>₹ {rental.final_amount.toLocaleString()}</td>
                    <td>
                      {isOpen(rental) && (
                        <button type="button" className="text-button" onClick={() => openReturn([rental])}>Return</button>
                      )}
                      <button type="button" className="text-button" onClick={() => openEdit(rental)}>Edit</button>
                      {!isChild && <button type="button" className="text-button" onClick={() => handleInvoiceDownload(rental)}>Invoice</button>}
                      <button type="button" className="text-button danger" onClick={() => handleDelete(rental, isChild)}>Delete</button>
                    </td>
                  </tr>
                );

                // Single-item rentals stay a plain row, exactly as before.
                if (group.allItems.length === 1) return itemRow(head, false);

                return [
                  <tr key={group.invoice} className={`rental-group-row ${expanded ? 'expanded' : ''}`}>
                    <td className="row-check">
                      <input
                        type="checkbox"
                        checked={openItems.length > 0 && checkedCount === openItems.length}
                        ref={(el) => { if (el) el.indeterminate = checkedCount > 0 && checkedCount < openItems.length; }}
                        disabled={openItems.length === 0}
                        onChange={() => toggleGroup(group)}
                        aria-label={`Select all items on ${group.invoice}`}
                        title={openItems.length ? 'Select all items still out' : 'All items returned'}
                      />
                    </td>
                    <td>
                      <button type="button" className="group-toggle" onClick={() => toggleExpanded(group.invoice)} aria-expanded={expanded}>
                        <span className="group-chevron">{expanded ? '▾' : '▸'}</span>
                        {group.invoice}
                      </button>
                    </td>
                    <td>{head.customer_name}<small className="cell-sub">{head.customer_phone}</small></td>
                    <td>
                      <button type="button" className="group-toggle" onClick={() => toggleExpanded(group.invoice)}>
                        {group.allItems.length} items
                      </button>
                      <small className="cell-sub">
                        {group.allItems.length - returnedCount} out &middot; {returnedCount} returned
                        {group.items.length < group.allItems.length && ` · ${group.items.length} match filters`}
                      </small>
                    </td>
                    <td>{head.rental_date} {head.rental_time}</td>
                    <td>{head.expected_return_date} {head.expected_return_time}</td>
                    <td>{returnedCount === group.allItems.length ? 'All returned' : returnedCount > 0 ? 'Partly' : '—'}</td>
                    <td>
                      <span className={`status-badge ${group.status}`}>{group.status}</span>
                      {returnedCount > 0 && returnedCount < group.allItems.length && <small className="cell-sub">partly returned</small>}
                    </td>
                    <td><span className={`status-badge ${head.payment_status}`}>{head.payment_status}</span></td>
                    <td>₹ {group.total.toLocaleString()}</td>
                    <td>
                      {openItems.length > 0 && (
                        <button type="button" className="text-button" onClick={() => openReturn(openItems)}>
                          {openItems.length > 1 ? `Return All (${openItems.length})` : 'Return'}
                        </button>
                      )}
                      <button type="button" className="text-button" onClick={() => handleInvoiceDownload(head)}>Invoice</button>
                    </td>
                  </tr>,
                  ...(expanded ? group.items.map((item) => itemRow(item, true)) : []),
                ];
              })}
              {!loading && groups.length === 0 && (
                <tr><td colSpan={11}>No rentals match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modalOpen} wide={isMultiItem} title={editingId ? (isEditingReturned ? 'Edit Returned Item' : 'Edit Rental Item') : 'New Order'} onClose={() => setModalOpen(false)}>
        <form className="form-grid" onSubmit={handleSubmit}>
          <section className="order-section">
            <h4>{isMultiItem && <span className="step">1</span>}Customer</h4>
            <label className="half">
              <span>Phone</span>
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
              <span>Name</span>
              <input
                value={form.customer_name}
                onChange={(event) => setForm({ ...form, customer_name: event.target.value })}
                required
              />
            </label>
            <label>
              <span>Address</span>
              <input
                value={form.customer_address}
                onChange={(event) => setForm({ ...form, customer_address: event.target.value })}
                placeholder="Optional"
              />
            </label>
            <p className="login-message order-hint">An existing phone number fills in that customer automatically.</p>
          </section>

          <section className="order-section">
            <h4>{isMultiItem && <span className="step">2</span>}Rental period</h4>
            <label className="half">
              <span>Start</span>
              <input type="date" value={form.rental_date} onChange={(event) => setForm({ ...form, rental_date: event.target.value })} required />
            </label>
            <label className="half">
              <span>Days</span>
              <input
                type="number"
                min="1"
                value={bookedDays >= 1 ? bookedDays : ''}
                onChange={(event) => handleDaysChange(event.target.value)}
                title="Each calendar day counts as one day: back the same day = 1, back the next day = 2"
              />
            </label>
            <label className="half">
              <span>Return Date</span>
              <input type="date" value={form.expected_return_date} onChange={(event) => setForm({ ...form, expected_return_date: event.target.value })} required />
            </label>
            <label className="half">
              <span>Return Time</span>
              <input type="time" value={form.expected_return_time} onChange={(event) => setForm({ ...form, expected_return_time: event.target.value })} required />
            </label>
          </section>

          {isMultiItem ? (
            <>
              <section className="order-section">
                <h4><span className="step">3</span>Tap to add equipment</h4>
                <EquipmentButtons equipment={equipmentList} inOrder={unitsInOrder} onAdd={addToOrder} />
              </section>

              <section className="order-section">
                <h4>
                  <span className="step">4</span>Order
                  {form.items.length > 0 && <span className="pill">{form.items.length} item{form.items.length > 1 ? 's' : ''}</span>}
                </h4>
                {form.items.length === 0 && <p className="order-empty">No equipment yet — tap items above to add them.</p>}
                {form.items.map((item, index) => {
                  const equipment = equipmentList.find((option) => String(option.id) === item.equipment_id);
                  const quantity = Number(item.quantity) || 1;
                  const max = maxQuantity(item);
                  const lineTotal = (Number(item.daily_rate) || 0) * quantity * Math.max(0, bookedDays);
                  return (
                    <div className="order-line" key={item.equipment_id}>
                      <div className="order-line-name">
                        <strong>{equipment?.name ?? 'Equipment'}</strong>
                        <small>{equipment?.category_name ?? 'Other'}{max > 1 && ` · up to ${max}`}</small>
                      </div>
                      <div className="qty-stepper">
                        <button type="button" onClick={() => setQuantity(index, String(quantity - 1))} disabled={quantity <= 1} aria-label="One less">−</button>
                        <input type="number" min="1" max={max} value={item.quantity} onChange={(event) => setQuantity(index, event.target.value)} aria-label="Quantity" />
                        <button type="button" onClick={() => setQuantity(index, String(quantity + 1))} disabled={quantity >= max} aria-label="One more">+</button>
                      </div>
                      <label>
                        <span>Rate/day</span>
                        <input type="number" min="0" step="0.01" value={item.daily_rate} onChange={(event) => updateItem(index, { daily_rate: event.target.value })} required />
                      </label>
                      <label>
                        <span>Deposit</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.deposit}
                          onChange={(event) => updateItem(index, { deposit: event.target.value, deposit_edited: true })}
                          required
                        />
                      </label>
                      <div className="order-line-total">₹ {lineTotal.toLocaleString()}</div>
                      <button type="button" className="order-line-remove" onClick={() => removeItemRow(index)} aria-label={`Remove ${equipment?.name ?? 'item'}`}>×</button>
                    </div>
                  );
                })}
                {form.items.length > 0 && bookedDays >= 1 && (
                  <div className="order-totals">
                    <span>{bookedDays} day{bookedDays > 1 ? 's' : ''}</span>
                    <span>Rent <strong>₹ {itemsTotal.toLocaleString()}</strong></span>
                    <span>Deposit <strong>₹ {depositTotal.toLocaleString()}</strong></span>
                    <span className="grand">Total <strong>₹ {(itemsTotal + depositTotal).toLocaleString()}</strong></span>
                  </div>
                )}
              </section>
            </>
          ) : (
            <section className="order-section">
              <h4>Equipment</h4>
              {form.items.map((item, index) => (
                <div className="edit-line" key={index}>
                  <label>
                    <span>Equipment</span>
                    <EquipmentPicker
                      options={editEquipmentOptions(index)}
                      value={item.equipment_id}
                      onChange={(equipmentId) => handleItemEquipmentChange(index, equipmentId)}
                    />
                  </label>
                  <label>
                    <span>Quantity</span>
                    <input type="number" min="1" max={maxQuantity(item)} value={item.quantity} onChange={(event) => setQuantity(index, event.target.value)} required />
                  </label>
                  <label>
                    <span>Rate/day</span>
                    <input type="number" min="0" step="0.01" value={item.daily_rate} onChange={(event) => updateItem(index, { daily_rate: event.target.value })} required />
                  </label>
                  <label>
                    <span>Deposit</span>
                    <input type="number" min="0" step="0.01" value={item.deposit} onChange={(event) => updateItem(index, { deposit: event.target.value, deposit_edited: true })} required />
                  </label>
                </div>
              ))}
            </section>
          )}

          {isEditingReturned && editingRental && (() => {
            const item = form.items[0];
            const dailyRate = Number(item.daily_rate) || 0;
            const preview = previewReturn(
              {
                rental_date: form.rental_date,
                expected_return_date: form.expected_return_date,
                daily_rate: dailyRate,
                quantity: Number(item.quantity) || 1,
                deposit: Number(item.deposit) || 0,
              },
              form.actual_return_date || editingRental.actual_return_date || today(),
              Number(form.damage_charge) || 0,
            );
            return (
              <fieldset className="return-edit">
                <legend>Return details</legend>
                <label className="half">
                  <span>Actual Return Date</span>
                  <input
                    type="date"
                    value={form.actual_return_date}
                    onChange={(event) => setForm({ ...form, actual_return_date: event.target.value })}
                    required
                  />
                </label>
                <label className="half">
                  <span>Damage Charge</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.damage_charge}
                    onChange={(event) => setForm({ ...form, damage_charge: event.target.value })}
                  />
                </label>
                <label>
                  <span>Return Notes</span>
                  <textarea value={form.return_notes} onChange={(event) => setForm({ ...form, return_notes: event.target.value })} />
                </label>
                <div className="return-summary">
                  <div><span>Days Charged</span><strong>{preview.usedDays}</strong></div>
                  <div>
                    <span>Late Fee</span>
                    <strong>₹ {preview.lateFee.toLocaleString()}{preview.lateDays > 0 && ` (${preview.lateDays} day${preview.lateDays > 1 ? 's' : ''})`}</strong>
                  </div>
                  <div><span>Deposit Refund</span><strong>₹ {preview.refund.toLocaleString()}</strong></div>
                  <div><span>New Final Amount</span><strong>₹ {preview.finalAmount.toLocaleString()}</strong></div>
                  <div><span>Was</span><strong>₹ {editingRental.final_amount.toLocaleString()}</strong></div>
                </div>
              </fieldset>
            );
          })()}

          {isEditingReturned && (
            <p className="login-message" style={{ gridColumn: '1 / -1' }}>
              This item was already returned — late fee, refund and the invoice payment status are recalculated when you save.
            </p>
          )}
          <div className="modal-actions">
            {formError && <p className="form-error">{formError}</p>}
            <button type="submit" className="primary-button" disabled={saving || (isMultiItem && form.items.length === 0)}>
              {saving ? 'Saving…' : isMultiItem ? `Create Order${form.items.length ? ` · ₹ ${(itemsTotal + depositTotal).toLocaleString()}` : ''}` : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={returningItems.length > 0}
        title={`Return Equipment — ${returningItems[0]?.invoice_number ?? ''}${returningItems.length > 1 ? ` (${returningItems.length} items)` : ''}`}
        onClose={() => setReturningItems([])}
      >
        {returningItems.length > 0 && (
          <form className="form-grid" onSubmit={handleReturnSubmit}>
            <label className="half">
              <span>Actual Return Date</span>
              <input
                type="date"
                value={returnForm.actual_return_date}
                onChange={(event) => setReturnForm({ ...returnForm, actual_return_date: event.target.value })}
                required
              />
            </label>
            <label className="half">
              <span>Customer</span>
              <input value={`${returningItems[0].customer_name} · ${returningItems[0].customer_phone}`} readOnly />
            </label>
            <div className="table-scroll" style={{ gridColumn: '1 / -1' }}>
              <table className="data-table return-items-table">
                <thead>
                  <tr>
                    <th>Equipment</th><th>Expected</th><th>Days</th><th>Rent</th><th>Late Fee</th><th>Damage</th><th>Deposit Refund</th><th>Final</th>
                  </tr>
                </thead>
                <tbody>
                  {returnPreview.map((row) => (
                    <tr key={row.rental.id}>
                      <td>{itemLabel(row.rental.equipment_name, row.rental.quantity)}</td>
                      <td>{row.rental.expected_return_date}</td>
                      <td>{row.usedDays}</td>
                      <td>₹ {row.totalRent.toLocaleString()}</td>
                      <td>
                        ₹ {row.lateFee.toLocaleString()}
                        {row.lateDays > 0 && <small className="cell-sub">{row.lateDays} day{row.lateDays > 1 ? 's' : ''} late</small>}
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="damage-input"
                          placeholder="0"
                          value={returnForm.damage[row.rental.id] ?? ''}
                          onChange={(event) => setReturnForm({
                            ...returnForm,
                            damage: { ...returnForm.damage, [row.rental.id]: event.target.value },
                          })}
                          aria-label={`Damage charge for ${row.rental.equipment_name}`}
                        />
                      </td>
                      <td>₹ {row.refund.toLocaleString()}</td>
                      <td>₹ {row.finalAmount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                {returnPreview.length > 1 && (
                  <tfoot>
                    <tr>
                      <td colSpan={4}><strong>Total</strong></td>
                      <td>₹ {returnTotals.lateFee.toLocaleString()}</td>
                      <td>₹ {returnTotals.damage.toLocaleString()}</td>
                      <td>₹ {returnTotals.refund.toLocaleString()}</td>
                      <td><strong>₹ {returnTotals.finalAmount.toLocaleString()}</strong></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <label>
              <span>Return Notes</span>
              <textarea value={returnForm.return_notes} onChange={(event) => setReturnForm({ ...returnForm, return_notes: event.target.value })} />
            </label>
            <p className="login-message" style={{ gridColumn: '1 / -1' }}>
              The return completion time is stamped automatically when you confirm. Items not listed here stay out on the invoice.
            </p>
            <div className="modal-actions">
              {returnError && <p className="form-error">{returnError}</p>}
              <button type="submit" className="primary-button" disabled={returning}>
                {returning ? 'Processing…' : returningItems.length > 1 ? `Confirm Return (${returningItems.length} items)` : 'Confirm Return'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
