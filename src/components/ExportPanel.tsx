/**
 * Export (KAN-63), on History: download budget, portfolio / assets and KiwiSaver as CSV (one
 * section or all), or a summary PDF, for a range of months. Files come straight from the server.
 */
import { useState } from 'react';
import { api } from '../api/client';

const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' }).slice(0, 7);

export function ExportPanel() {
  const [from, setFrom] = useState(() => `${thisMonth().slice(0, 4)}-01`);
  const [to, setTo] = useState(thisMonth);
  const [section, setSection] = useState<'budget' | 'assets' | 'kiwisaver' | 'all'>('all');
  const bad = !from || !to || from > to;
  return (
    <section className="panel export-panel" aria-labelledby="export-title">
      <h3 id="export-title">Export</h3>
      <p className="muted small">Your budget, portfolio and assets, and KiwiSaver, as a spreadsheet (CSV) or a summary PDF.</p>
      <div className="form-grid">
        <label>
          From
          <input type="month" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="month" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          CSV of
          <select value={section} onChange={(e) => setSection(e.target.value as typeof section)}>
            <option value="all">Everything</option>
            <option value="budget">Budget</option>
            <option value="assets">Portfolio and assets</option>
            <option value="kiwisaver">KiwiSaver</option>
          </select>
        </label>
      </div>
      <div className="row gap">
        <a className={`btn small primary${bad ? ' disabled' : ''}`} aria-disabled={bad} href={bad ? undefined : api.exports.csvUrl(section, from, to)} download>
          Download CSV
        </a>
        <a className={`btn small${bad ? ' disabled' : ''}`} aria-disabled={bad} href={bad ? undefined : api.exports.pdfUrl(from, to)} download>
          Download summary PDF
        </a>
      </div>
      <p className="muted small">Portfolio values are as of today; budget and KiwiSaver history follow the months you pick.</p>
    </section>
  );
}
