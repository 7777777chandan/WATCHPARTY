import Sparkline from './Sparkline.jsx';

function quality(row) {
  const rtt = row.rtt ?? 0;
  const drift = Math.abs(row.drift ?? 0);
  if (rtt < 80 && drift < 150) return { label: 'Excellent', cls: 'good' };
  if (rtt < 200 && drift < 500) return { label: 'OK', cls: 'warn' };
  return { label: 'Poor', cls: 'bad' };
}

/**
 * Feature C (host): live drift sparkline (last 60 reports), RTT and connection quality per
 * person; the worst-synced person is highlighted.
 */
export default function SyncDashboard({ users, drift, history, onClose }) {
  const rows = users
    .filter((u) => u.connected)
    .map((u) => ({ ...u, ...(drift.find((d) => d.userId === u.userId) || {}), series: (history[u.userId] || []).map((p) => p.drift) }));
  const worst = rows.reduce((w, r) => (r.drift !== undefined && (!w || Math.abs(r.drift) > Math.abs(w.drift)) ? r : w), null);
  return (
    <aside className="float-panel dashboard-panel" aria-label="Live sync dashboard">
      <header>
        <strong>Live sync dashboard</strong>
        <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close dashboard">✕</button>
      </header>
      <table>
        <thead>
          <tr><th scope="col">Person</th><th scope="col">Drift (last 60)</th><th scope="col">Now</th><th scope="col">RTT</th><th scope="col">Quality</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = r.drift === undefined ? null : quality(r);
            return (
              <tr key={r.userId} className={worst && worst.userId === r.userId && Math.abs(worst.drift) >= 150 ? 'worst' : ''}>
                <td>{r.name}{r.isHost ? ' 👑' : ''}</td>
                <td><Sparkline values={r.series} /></td>
                <td>{r.drift === undefined ? '–' : `${r.drift} ms`}</td>
                <td>{r.rtt ?? '–'}{r.rtt !== null && r.rtt !== undefined ? ' ms' : ''}</td>
                <td>{q ? <span className={`quality ${q.cls}`}>{q.label}</span> : <span className="muted">waiting</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Updated every 5 s from each client&apos;s drift report. The shaded band is the ±500 ms target.</p>
    </aside>
  );
}
