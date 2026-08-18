import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import type { Payment, Rental } from '../types';

type EventType = 'start' | 'due' | 'returned' | 'payment';

interface CalendarEvent {
  type: EventType;
  rental?: Rental;
  payment?: Payment;
}

const toDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const buildMonthGrid = (monthDate: Date) => {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  return Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
};

const eventLabel = (event: CalendarEvent) => {
  if (event.type === 'start') return 'Rental Started';
  if (event.type === 'due') return event.rental?.status === 'overdue' ? 'Overdue' : 'Return Due';
  if (event.type === 'returned') return 'Returned';
  return 'Payment';
};

const eventTime = (event: CalendarEvent) => {
  if (event.type === 'start') return event.rental?.rental_time;
  if (event.type === 'due') return event.rental?.expected_return_time;
  if (event.type === 'returned') return event.rental?.actual_return_time;
  return undefined;
};

const eventMatchesSearch = (event: CalendarEvent, query: string) => {
  if (!query) return true;
  const q = query.toLowerCase();
  if (event.type === 'payment' && event.payment) {
    return `${event.payment.invoice_number} ${event.payment.customer_name} ${event.payment.payment_type} ${event.payment.payment_method}`.toLowerCase().includes(q);
  }
  if (event.rental) {
    return `${event.rental.invoice_number} ${event.rental.customer_name} ${event.rental.equipment_name}`.toLowerCase().includes(q);
  }
  return false;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarPage() {
  const navigate = useNavigate();
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState('');
  const hasLoadedRef = useRef(false);

  const today = useMemo(() => new Date(), []);
  const [monthCursor, setMonthCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(toDateKey(today));
  const [search, setSearch] = useState('');

  const loadAll = () => {
    Promise.all([
      apiRequest<Rental[]>('/rentals'),
      apiRequest<Payment[]>('/payments'),
    ])
      .then(([rentalData, paymentData]) => {
        setRentals(rentalData);
        setPayments(paymentData);
        setError('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load calendar data'))
      .finally(() => { hasLoadedRef.current = true; });
  };

  usePolling(loadAll);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    const push = (date: string | null | undefined, event: CalendarEvent) => {
      if (!date) return;
      const list = map.get(date) ?? [];
      list.push(event);
      map.set(date, list);
    };
    rentals.forEach((rental) => {
      push(rental.rental_date, { type: 'start', rental });
      push(rental.expected_return_date, { type: 'due', rental });
      if (rental.actual_return_date) push(rental.actual_return_date, { type: 'returned', rental });
    });
    payments.forEach((payment) => {
      push(payment.payment_date, { type: 'payment', payment });
    });
    return map;
  }, [rentals, payments]);

  const datesWithMatch = useMemo(() => {
    if (!search) return null;
    const matches = new Set<string>();
    eventsByDate.forEach((events, date) => {
      if (events.some((event) => eventMatchesSearch(event, search))) {
        matches.add(date);
      }
    });
    return matches;
  }, [eventsByDate, search]);

  const monthGrid = useMemo(() => buildMonthGrid(monthCursor), [monthCursor]);
  const todayKey = toDateKey(today);

  const goToMonth = (delta: number) => {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const goToToday = () => {
    setMonthCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(todayKey);
  };

  const selectedEvents = (eventsByDate.get(selectedDate) ?? []).filter((event) => eventMatchesSearch(event, search));

  const selectedDateLabel = useMemo(() => {
    const [year, month, day] = selectedDate.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }, [selectedDate]);

  const viewRentalInRentals = (rental: Rental) => {
    navigate('/rentals', { state: { search: rental.invoice_number } });
  };

  return (
    <div className="module-shell">
      <div className="module-head">
        <div>
          <p className="eyebrow">Activity Calendar</p>
          <h2>Rentals and payments, day by day</h2>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="text"
          placeholder="Search by invoice, customer, or equipment"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="calendar-nav">
          <button type="button" className="ghost-button" onClick={() => goToMonth(-1)} aria-label="Previous month">
            <ChevronLeft size={16} />
          </button>
          <span className="calendar-month-label">{monthCursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
          <button type="button" className="ghost-button" onClick={() => goToMonth(1)} aria-label="Next month">
            <ChevronRight size={16} />
          </button>
          <button type="button" className="text-button" onClick={goToToday}>Today</button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="calendar-layout">
        <article className="panel-card">
          <div className="calendar-weekdays">
            {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="calendar-grid">
            {monthGrid.map((date) => {
              const dateKey = toDateKey(date);
              const events = eventsByDate.get(dateKey) ?? [];
              const isOtherMonth = date.getMonth() !== monthCursor.getMonth();
              const isToday = dateKey === todayKey;
              const isSelected = dateKey === selectedDate;
              const hasMatch = datesWithMatch ? datesWithMatch.has(dateKey) : false;
              const eventTypesPresent = Array.from(new Set(events.map((event) => event.type)));

              const classNames = [
                'calendar-cell',
                isOtherMonth ? 'other-month' : '',
                isToday ? 'today' : '',
                isSelected ? 'selected' : '',
                hasMatch ? 'has-match' : '',
              ].filter(Boolean).join(' ');

              return (
                <button
                  key={dateKey}
                  type="button"
                  className={classNames}
                  onClick={() => setSelectedDate(dateKey)}
                >
                  <span className="calendar-day-number">{date.getDate()}</span>
                  {eventTypesPresent.length > 0 && (
                    <div className="calendar-dots">
                      {eventTypesPresent.map((type) => {
                        const isOverdue = type === 'due' && events.some((event) => event.type === 'due' && event.rental?.status === 'overdue');
                        return <span key={type} className={`calendar-dot ${type} ${isOverdue ? 'overdue' : ''}`} />;
                      })}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <div className="calendar-legend" style={{ marginTop: 12 }}>
            <span><span className="calendar-dot start" /> Rental Started</span>
            <span><span className="calendar-dot due" /> Return Due</span>
            <span><span className="calendar-dot due overdue" /> Overdue</span>
            <span><span className="calendar-dot returned" /> Returned</span>
            <span><span className="calendar-dot payment" /> Payment</span>
          </div>
        </article>

        <article className="panel-card">
          <div className="panel-title-row">
            <h3>{selectedDateLabel}</h3>
          </div>
          <ul className="day-detail-list">
            {selectedEvents.map((event, index) => (
              <li key={index} className="day-detail-item">
                <div className="item-row">
                  <span className={`event-type-badge ${event.type} ${event.type === 'due' && event.rental?.status === 'overdue' ? 'overdue' : ''}`}>
                    {eventLabel(event)}{eventTime(event) ? ` · ${eventTime(event)}` : ''}
                  </span>
                  {event.rental && (
                    <button type="button" className="text-button" onClick={() => viewRentalInRentals(event.rental!)}>View</button>
                  )}
                </div>
                {event.rental && (
                  <>
                    <strong>{event.rental.invoice_number}</strong>
                    <span>{event.rental.customer_name} &middot; {event.rental.equipment_name}</span>
                    <span>₹ {event.rental.final_amount.toLocaleString()}</span>
                  </>
                )}
                {event.payment && (
                  <>
                    <strong>{event.payment.invoice_number}</strong>
                    <span>{event.payment.customer_name} &middot; {event.payment.payment_type} via {event.payment.payment_method.replace('_', ' ')}</span>
                    <span>₹ {event.payment.amount.toLocaleString()}</span>
                  </>
                )}
              </li>
            ))}
            {selectedEvents.length === 0 && (
              <li className="day-detail-item">
                <span>{search ? 'No matching activity on this day.' : 'No activity recorded on this day.'}</span>
              </li>
            )}
          </ul>
        </article>
      </div>
    </div>
  );
}
