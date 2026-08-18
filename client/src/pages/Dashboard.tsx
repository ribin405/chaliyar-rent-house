import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiRequest } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import type { DashboardStats } from '../types';

export function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState('');

  usePolling(() => {
    apiRequest<DashboardStats>('/dashboard/stats')
      .then((data) => {
        setStats(data);
        setError('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'));
  });

  const handleCreateRental = () => navigate('/rentals', { state: { openCreate: true } });

  if (error) {
    return (
      <div className="empty-state">
        <h3>Unable to load dashboard</h3>
        <p>{error}</p>
      </div>
    );
  }

  if (!stats) {
    return <div className="empty-state"><h3>Loading dashboard…</h3></div>;
  }

  const metrics = [
    { label: 'Total Customers', value: stats.totalCustomers, tone: 'blue' },
    { label: 'Available Equipment', value: stats.availableEquipment, tone: 'green' },
    { label: 'Active Rentals', value: stats.activeRentals, tone: 'amber' },
    { label: 'Overdue Rentals', value: stats.overdueRentals, tone: 'red' },
  ];

  return (
    <div className="module-shell">
      <div className="module-head">
        <div>
          <p className="eyebrow">Operations Overview</p>
          <h2>Business snapshot</h2>
        </div>
        <button type="button" className="primary-button" onClick={handleCreateRental}>Create Rental</button>
      </div>

      <div className="dashboard-grid">
        {metrics.map((metric) => (
          <article key={metric.label} className={`stat-card ${metric.tone}`}>
            <p>{metric.label}</p>
            <h3>{metric.value}</h3>
          </article>
        ))}

        <article className="panel-card wide-card">
          <div className="panel-title-row">
            <h3>Revenue Outlook</h3>
            <span className="pill">Last 6 months</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.revenueByMonth}>
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => `₹ ${Number(value).toLocaleString()}`} />
              <Bar dataKey="total" fill="#2563eb" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </article>

        <article className="panel-card">
          <div className="panel-title-row">
            <h3>Revenue Summary</h3>
          </div>
          <ul className="list-stack">
            <li>
              <span>Total Revenue</span>
              <strong>₹ {stats.totalRevenue.toLocaleString()}</strong>
            </li>
            <li>
              <span>Pending Payments</span>
              <strong>₹ {stats.pendingPayments.toLocaleString()}</strong>
            </li>
          </ul>
        </article>

        <article className="panel-card">
          <div className="panel-title-row">
            <h3>Recent Rentals</h3>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr><th>Customer</th><th>Equipment</th><th>Status</th></tr>
              </thead>
              <tbody>
                {stats.recentRentals.map((rental) => (
                  <tr key={rental.id}>
                    <td>{rental.customer_name}</td>
                    <td>{rental.equipment_name}</td>
                    <td><span className={`status-badge ${rental.status}`}>{rental.status}</span></td>
                  </tr>
                ))}
                {stats.recentRentals.length === 0 && (
                  <tr><td colSpan={3}>No rentals yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel-card">
          <div className="panel-title-row">
            <h3>Recent Payments</h3>
          </div>
          <ul className="list-stack">
            {stats.recentPayments.map((payment) => (
              <li key={payment.id}>
                <span>{payment.customer_name} &middot; {payment.invoice_number}</span>
                <strong>₹ {payment.amount.toLocaleString()}</strong>
                <small>{payment.payment_type} &middot; {payment.payment_date}</small>
              </li>
            ))}
            {stats.recentPayments.length === 0 && <li><span>No payments recorded yet.</span></li>}
          </ul>
        </article>
      </div>
    </div>
  );
}
