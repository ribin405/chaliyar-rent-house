import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, CalendarDays, Phone, MessageCircle } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { ReturnMarker } from '../components/ReturnMarker';
import type { DashboardToday } from '../types';

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
  const [error, setError] = useState('');

  usePolling(() => {
    apiRequest<DashboardToday>('/dashboard/today')
      .then((todayData) => {
        setData(todayData);
        setError('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'));
  });

  const goCreateRental = () => navigate('/rentals', { state: { openCreate: true } });
  const goReturn = (invoice: string) => navigate('/rentals', { state: { returnInvoice: invoice } });
  const goCustomerRentals = (phone: string) => navigate('/rentals', { state: { search: phone } });

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
