import { useEffect, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiRequest, downloadFile } from '../lib/api';
import type { Rental } from '../types';

interface RevenueReport {
  byDate: Array<{ payment_date: string; total: number }>;
  total: number;
  count: number;
}

const firstOfMonth = () => {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10);
};
const todayStr = () => new Date().toISOString().slice(0, 10);

export function Reports() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayStr());
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const loadReport = () => {
    const params = new URLSearchParams({ from, to }).toString();
    apiRequest<RevenueReport>(`/reports/revenue?${params}`)
      .then(setReport)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load report'));
  };

  useEffect(loadReport, [from, to]);
  useEffect(() => {
    apiRequest<Rental[]>('/rentals').then(setRentals).catch(() => setRentals([]));
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadFile('/reports/rentals/export', 'rentals-report.xlsx');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to export report.');
    } finally {
      setExporting(false);
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
          <p className="eyebrow">Reports</p>
          <h2>Revenue and rental history</h2>
        </div>
        <button type="button" className="primary-button" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export to Excel'}
        </button>
      </div>

      <div className="toolbar">
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', color: '#334155' }}>
          From
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', color: '#334155' }}>
          To
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="dashboard-grid">
        <article className="stat-card blue">
          <p>Total Revenue (range)</p>
          <h3>₹ {(report?.total ?? 0).toLocaleString()}</h3>
        </article>
        <article className="stat-card green">
          <p>Payments Recorded</p>
          <h3>{report?.count ?? 0}</h3>
        </article>

        <article className="panel-card wide-card" style={{ gridColumn: 'span 12' }}>
          <div className="panel-title-row">
            <h3>Revenue by Day</h3>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={report?.byDate ?? []}>
              <XAxis dataKey="payment_date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => `₹ ${Number(value).toLocaleString()}`} />
              <Bar dataKey="total" fill="#14b8a6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </article>
      </div>

      <div className="panel-card">
        <div className="panel-title-row">
          <h3>Rental Invoices</h3>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Amount</th><th>Download</th></tr>
            </thead>
            <tbody>
              {rentals.map((rental) => (
                <tr key={rental.id}>
                  <td>{rental.invoice_number}</td>
                  <td>{rental.customer_name}</td>
                  <td><span className={`status-badge ${rental.status}`}>{rental.status}</span></td>
                  <td>₹ {rental.final_amount.toLocaleString()}</td>
                  <td><button type="button" className="text-button" onClick={() => handleInvoiceDownload(rental)}>PDF</button></td>
                </tr>
              ))}
              {rentals.length === 0 && <tr><td colSpan={5}>No rentals yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
