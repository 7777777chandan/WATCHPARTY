import { driftLog, downloadJson } from '../sync/driftLog.js';

const cls = (ms) => (Math.abs(ms) < 150 ? 'good' : Math.abs(ms) < 500 ? 'warn' : 'bad');

/** Toggle with "H": every member's latest reported drift (server broadcasts every 5 s). */
export default function SyncHealthPanel({ drift, onClose }) {
  return (
    <aside className="float-panel health-panel" aria-label="Sync health">
      <header>
        <strong>Sync health</strong> <span className="muted small">(press H to hide)</span>
        <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close sync health">✕</button>
      </header>
      {drift.length === 0 ? (
        <p className="muted small">No reports yet. Reports arrive every 5 s while a video is playing.</p>
      ) : (
        <table>
          <thead>
            <tr><th scope="col">User</th><th scope="col">Drift</th><th scope="col">RTT</th><th scope="col">Fixes</th></tr>
          </thead>
          <tbody>
            {drift.map((d) => (
              <tr key={d.userId}>
                <td>{d.name}</td>
                <td className={`drift-cell ${cls(d.drift)}`}>{d.drift > 0 ? '+' : ''}{d.drift} ms</td>
                <td>{d.rtt ?? '–'}{d.rtt !== null && d.rtt !== undefined ? ' ms' : ''}</td>
                <td>{d.corrections}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="legend small"><span className="good">● &lt;150 ms</span> <span className="warn">● &lt;500 ms</span> <span className="bad">● ≥500 ms</span></p>
      <button type="button" className="btn btn-small" onClick={() => downloadJson(`drift-log-${Date.now()}.json`, driftLog.toArray())}>
        Download drift log
      </button>
    </aside>
  );
}
