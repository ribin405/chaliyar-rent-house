import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, RotateCcw, Wallet, UserPlus, PackagePlus, CalendarDays, Phone, MessageCircle, Search,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { ReturnMarker } from '../components/ReturnMarker';
import { itemLabel } from '../lib/format';
import type { DashboardOpenItem, DashboardToday, Equipment } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const AVAILABILITY_LIMIT = 8;

type ReturnTab = 'overdue' | 'today' | 'upcoming';

// Several items rented together share an invoice; the desk handles them as one return.
interface ReturnGroup {
  invoice: string;
  customer_name: string;
  customer_phone: string;
  items: DashboardOpenItem[];
  expected: string;
  bucket: ReturnTab;
  daysLate: number;
}

const daysBetween = (from: string, to: string) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS);

const money = (value: number) => `₹ ${Number(value).toLocaleString()}`;

// Phone numbers are stored as typed; assume India (+91) for bare 10-digit numbers.
const whatsappLink = (phone: string, message: string) => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const international = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${international}?text=${encodeURIComponent(message)}`;
};

function ContactLinks({ name, phone, message }: { name: string; phone: string; message: string }) {
  const wa = whatsappLink(phone, message);
  return (
    <span className="contact-links">
      <a href={`tel:${phone}`} className="icon-link" title={`Call ${name}`} aria-label={`Call ${name}`}><Phone size={15} /></a>
      {wa && (
        <a href={wa} target="_blank" rel="noreferrer" className="icon-link whatsapp" title={`WhatsApp ${name}`} aria-label={`WhatsApp ${name}`}>
          <MessageCircle size={15} />
        </a>
      )}
    </span>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardToday | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [error, setError] = useState('');
  const [returnTab, setReturnTab] = useState<ReturnTab | null>(null);
  const [equipmentQuery, setEquipmentQuery] = useState('');
  const returnsRef = useRef<HTMLElement>(null);

  usePolling(() => {
    Promise.all([
      apiRequest<DashboardToday>('/dashboard/today'),
      apiRequest<Equipment[]>('/equipment'),
    ])
      .then(([todayData, equipmentData]) => {
        setData(todayData);
        setEquipment(equipmentData);
        setError('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'));
  });

  const returnGroups = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, ReturnGroup>();
    data.openItems.forEach((item) => {
      const group = map.get(item.invoice_number);
      if (group) {
        group.items.push(item);
        if (item.expected_return_date < group.expected) group.expected = item.expected_return_date;
        return;
      }
      map.set(item.invoice_number, {
        invoice: item.invoice_number,
        customer_name: item.customer_name,
        customer_phone: item.customer_phone,
        items: [item],
        expected: item.expected_return_date,
        bucket: 'upcoming',
        daysLate: 0,
      });
    });
    const groups = [...map.values()];
    groups.forEach((group) => {
      group.daysLate = Math.max(0, daysBetween(group.expected, data.today));
      group.bucket = group.expected < data.today ? 'overdue' : group.expected === data.today ? 'today' : 'upcoming';
    });
    return groups.sort((a, b) => a.expected.localeCompare(b.expected));
  }, [data]);

  const bucketCounts = useMemo(() => ({
    overdue: returnGroups.filter((group) => group.bucket === 'overdue').length,
    today: returnGroups.filter((group) => group.bucket === 'today').length,
    upcoming: returnGroups.filter((group) => group.bucket === 'upcoming').length,
  }), [returnGroups]);

  // Open on whichever list needs attention first, unless the user picked a tab.
  const activeTab: ReturnTab = returnTab
    ?? (bucketCounts.overdue ? 'overdue' : bucketCounts.today ? 'today' : 'upcoming');
  const visibleReturns = returnGroups.filter((group) => group.bucket === activeTab);

  // Who has each rented-out piece, so the availability check can say when it's back.
  const outByEquipment = useMemo(() => {
    const map = new Map<number, DashboardOpenItem>();
    data?.openItems.forEach((item) => map.set(item.equipment_id, item));
    return map;
  }, [data]);

  const availabilityResults = useMemo(() => {
    const term = equipmentQuery.trim().toLowerCase();
    if (!term) return equipment.filter((item) => item.available_quantity > 0).slice(0, AVAILABILITY_LIMIT);
    return equipment
      .filter((item) => `${item.name} ${item.category_name ?? ''} ${item.location ?? ''}`.toLowerCase().includes(term))
      .sort((a, b) => Number(b.available_quantity > 0) - Number(a.available_quantity > 0))
      .slice(0, AVAILABILITY_LIMIT * 2);
  }, [equipment, equipmentQuery]);

  const availableCount = equipment.filter((item) => item.available_quantity > 0).length;
  const outstandingTotal = data?.unpaidInvoices.reduce((sum, invoice) => sum + invoice.balance, 0) ?? 0;

  const goCreateRental = (item?: Equipment) => navigate('/rentals', {
    state: { openCreate: true, equipment: item ? { id: item.id, daily_rent: item.daily_rent, security_deposit: item.security_deposit } : undefined },
  });
  const goReturn = (invoice: string) => navigate('/rentals', { state: { returnInvoice: invoice } });
  const goCustomerRentals = (phone: string) => navigate('/rentals', { state: { search: phone } });
  const goCollect = (invoice: string, balance: number) => navigate('/payments', { state: { openCreate: true, invoice, amount: balance } });

  if (error && !data) {
    return (
      <div className="empty-state">
        <h3>Unable to load dashboard</h3>
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return <div className="empty-state"><h3>Loading dashboard…</h3></div>;
  }

  const todayLabel = new Date(`${data.today}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  const quickActions = [
    { label: 'New Rental', hint: 'Rent out equipment', icon: Plus, onClick: () => goCreateRental(), primary: true },
    {
      label: 'Receive Return',
      hint: `${bucketCounts.overdue + bucketCounts.today} due now`,
      icon: RotateCcw,
      onClick: () => returnsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    },
    { label: 'Record Payment', hint: `${data.unpaidInvoices.length} unpaid invoices`, icon: Wallet, onClick: () => navigate('/payments', { state: { openCreate: true } }) },
    { label: 'Add Customer', hint: 'New customer record', icon: UserPlus, onClick: () => navigate('/customers', { state: { openCreate: true } }) },
    { label: 'Add Equipment', hint: 'New item to rent', icon: PackagePlus, onClick: () => navigate('/equipment', { state: { openCreate: true } }) },
    { label: 'Calendar', hint: 'Bookings by date', icon: CalendarDays, onClick: () => navigate('/calendar') },
  ];

  return (
    <div className="module-shell">
      <div className="module-head">
        <div>
          <p className="eyebrow">Today &middot; {todayLabel}</p>
          <h2>Front desk</h2>
        </div>
        <div className="summary-card">
          <span className="summary-pill">{data.summary.rentalsStarted} rented out today</span>
          <span className="summary-pill">{data.summary.itemsReturned} returned today</span>
          <span className="summary-pill success">{money(data.summary.collected)} collected</span>
          {data.summary.refunded > 0 && <span className="summary-pill warning">{money(data.summary.refunded)} refunded</span>}
        </div>
      </div>

      {error && <p className="form-error">Couldn’t refresh: {error}</p>}

      <div className="quick-actions">
        {quickActions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={`quick-action ${action.primary ? 'primary' : ''}`}
            onClick={action.onClick}
          >
            <action.icon size={22} />
            <span>
              <strong>{action.label}</strong>
              <small>{action.hint}</small>
            </span>
          </button>
        ))}
      </div>

      <div className="desk-grid">
        <section className="panel-card" ref={returnsRef}>
          <div className="panel-title-row">
            <h3>Returns to receive</h3>
            <div className="segmented" role="tablist">
              {([
                ['overdue', 'Overdue'],
                ['today', 'Due today'],
                ['upcoming', 'Upcoming'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === key}
                  className={`${activeTab === key ? 'active' : ''} ${key === 'overdue' && bucketCounts.overdue ? 'alert' : ''}`}
                  onClick={() => setReturnTab(key)}
                >
                  {label} <span className="count">{bucketCounts[key]}</span>
                </button>
              ))}
            </div>
          </div>
          <ul className="desk-list">
            {visibleReturns.map((group) => {
              const itemNames = group.items.map((item) => itemLabel(item.equipment_name, item.quantity)).join(', ');
              const reminder = group.bucket === 'overdue'
                ? `Hello ${group.customer_name}, your rental (${itemNames}, invoice ${group.invoice}) was due back on ${group.expected}. Please return it at the earliest.`
                : `Hello ${group.customer_name}, a reminder that your rental (${itemNames}, invoice ${group.invoice}) is due back on ${group.expected}.`;
              return (
                <li key={group.invoice}>
                  <div className="desk-main">
                    <strong>{group.customer_name}</strong>
                    <small>{group.customer_phone} &middot; {group.invoice}</small>
                    <small className="desk-items">{group.items.length > 1 ? `${group.items.length} items: ` : ''}{itemNames}</small>
                  </div>
                  <div className="desk-meta">
                    {group.bucket === 'overdue'
                      ? <span className="status-badge overdue">{group.daysLate} day{group.daysLate > 1 ? 's' : ''} late</span>
                      : <span className="status-badge active">{group.bucket === 'today' ? `Today ${group.items[0].expected_return_time}` : group.expected}</span>}
                  </div>
                  <div className="desk-actions">
                    <ContactLinks name={group.customer_name} phone={group.customer_phone} message={reminder} />
                    <button type="button" className="primary-button small" onClick={() => goReturn(group.invoice)}>Return</button>
                  </div>
                </li>
              );
            })}
            {visibleReturns.length === 0 && (
              <li className="desk-empty">
                {activeTab === 'overdue' ? 'Nothing overdue. 🎉' : activeTab === 'today' ? 'No returns due today.' : 'No upcoming returns.'}
              </li>
            )}
          </ul>
        </section>

        <section className="panel-card">
          <div className="panel-title-row">
            <h3>Payments to collect</h3>
            <span className="pill">{money(outstandingTotal)} due</span>
          </div>
          <ul className="desk-list">
            {data.unpaidInvoices.map((invoice) => (
              <li key={invoice.invoice_number}>
                <div className="desk-main">
                  <strong>{invoice.customer_name}</strong>
                  <small>{invoice.customer_phone} &middot; {invoice.invoice_number}</small>
                  <small>
                    {invoice.open_count === 0 ? 'Returned' : `${invoice.open_count} of ${invoice.item_count} still out`}
                    {invoice.paid > 0 && ` · paid ${money(invoice.paid)} of ${money(invoice.total)}`}
                  </small>
                </div>
                <div className="desk-meta">
                  <strong className="desk-amount">{money(invoice.balance)}</strong>
                  <span className={`status-badge ${invoice.payment_status}`}>{invoice.payment_status}</span>
                </div>
                <div className="desk-actions">
                  <ContactLinks
                    name={invoice.customer_name}
                    phone={invoice.customer_phone}
                    message={`Hello ${invoice.customer_name}, a balance of ${money(invoice.balance)} is pending on invoice ${invoice.invoice_number}. Thank you.`}
                  />
                  <button type="button" className="primary-button small" onClick={() => goCollect(invoice.invoice_number, invoice.balance)}>Collect</button>
                </div>
              </li>
            ))}
            {data.unpaidInvoices.length === 0 && <li className="desk-empty">All invoices are settled.</li>}
          </ul>
        </section>

        <section className="panel-card">
          <div className="panel-title-row">
            <h3>Recent customers</h3>
            <span className="pill">{data.recentCustomers.filter((customer) => customer.open_count > 0).length} with items out</span>
          </div>
          <ul className="desk-list">
            {data.recentCustomers.map((customer) => (
              <li key={customer.id} className={customer.overdue_count ? 'flag-overdue' : customer.open_count ? 'flag-open' : ''}>
                <div className="desk-main">
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => goCustomerRentals(customer.phone_number)}
                    title="View this customer's rentals"
                  >
                    {customer.full_name}
                  </button>
                  <small>{customer.phone_number} &middot; last rented {customer.last_rental_date}</small>
                </div>
                <div className="desk-meta">
                  <ReturnMarker openCount={customer.open_count} overdueCount={customer.overdue_count} showClear />
                </div>
                <div className="desk-actions">
                  <ContactLinks
                    name={customer.full_name}
                    phone={customer.phone_number}
                    message={`Hello ${customer.full_name}, this is a reminder about your equipment rental.`}
                  />
                  {customer.open_count > 0 && (
                    <button
                      type="button"
                      className="primary-button small"
                      // One open invoice opens its return form; several go to the filtered list to pick from.
                      onClick={() => (customer.open_invoices.length === 1
                        ? goReturn(customer.open_invoices[0])
                        : goCustomerRentals(customer.phone_number))}
                    >
                      Return
                    </button>
                  )}
                </div>
              </li>
            ))}
            {data.recentCustomers.length === 0 && <li className="desk-empty">No rentals yet.</li>}
          </ul>
        </section>

        <section className="panel-card">
          <div className="panel-title-row">
            <h3>Check availability</h3>
            <span className="pill">{availableCount} available now</span>
          </div>
          <label className="desk-search">
            <Search size={16} />
            <input
              type="search"
              placeholder="Search equipment by name, category or location…"
              value={equipmentQuery}
              onChange={(event) => setEquipmentQuery(event.target.value)}
            />
          </label>
          <ul className="desk-list compact">
            {availabilityResults.map((item) => {
              const out = outByEquipment.get(item.id);
              return (
                <li key={item.id}>
                  <div className="desk-main">
                    <strong>{item.name}</strong>
                    <small>
                      {item.category_name ?? 'Uncategorized'} &middot; {money(item.daily_rent)}/day
                      {out && ` · with ${out.customer_name}, due ${out.expected_return_date}`}
                    </small>
                  </div>
                  <div className="desk-actions">
                    {item.stock_quantity > 1 && item.available_quantity > 0
                      ? <span className="status-badge available">{item.available_quantity} of {item.stock_quantity} free</span>
                      : <span className={`status-badge ${item.status}`}>{item.status}</span>}
                    {item.available_quantity > 0 && (
                      <button type="button" className="ghost-button small" onClick={() => goCreateRental(item)}>Rent</button>
                    )}
                  </div>
                </li>
              );
            })}
            {availabilityResults.length === 0 && (
              <li className="desk-empty">{equipmentQuery ? `No equipment matches “${equipmentQuery.trim()}”.` : 'No equipment is available right now.'}</li>
            )}
          </ul>
        </section>

        <section className="panel-card">
          <div className="panel-title-row">
            <h3>Today’s payments</h3>
            <span className="pill">{data.todayPayments.length}</span>
          </div>
          <ul className="desk-list compact">
            {data.todayPayments.map((payment) => (
              <li key={payment.id}>
                <div className="desk-main">
                  <strong>{payment.customer_name}</strong>
                  <small>{payment.invoice_number} &middot; {payment.payment_type} &middot; {payment.payment_method}</small>
                </div>
                <strong className={`desk-amount ${payment.payment_type === 'refund' ? 'refund' : ''}`}>
                  {payment.payment_type === 'refund' ? '−' : ''}{money(payment.amount)}
                </strong>
              </li>
            ))}
            {data.todayPayments.length === 0 && <li className="desk-empty">No payments recorded today.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
