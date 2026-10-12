import { useClockSync } from '../hooks/useClockSync.js';
import { useDriftStats } from '../hooks/useDriftCorrection.js';
import { driftLog, downloadJson } from '../sync/driftLog.js';
import { useSocket } from '../context/SocketContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatTime } from '../utils/youtube.js';

/** Hidden by default; toggle with "D". Clock + sync internals and test helpers. */
export default function DebugPanel({ controller, onClose }) {
  const clock = useClockSync();
  const drift = useDriftStats();
  const { socket, connected } = useSocket();
  const toast = useToast();
  const st = controller.serverState;

  const simulateDisconnect = () => {
    socket.disconnect();
    toast.push({ text: 'Simulated disconnect: reconnecting in 5 s', type: 'info' });
    setTimeout(() => socket.connect(), 5000);
  };

  const inject = (sec) => {
    controller.injectDrift(sec);
    toast.push({ text: `Injected ${sec > 0 ? '+' : ''}${sec} s of drift (not sent to the room)`, type: 'info' });
  };

  return (
    <aside className="float-panel debug-panel" aria-label="Debug panel">
      <header>
        <strong>Debug</strong> <span className="muted small">(press D to hide)</span>
        <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close debug panel">✕</button>
      </header>
      <dl>
        <dt>Socket</dt><dd>{connected ? `connected ${socket.id}` : 'disconnected'}</dd>
        <dt>Clock offset</dt><dd>{clock.synced ? `${clock.offset.toFixed(1)} ms` : 'not synced'}</dd>
        <dt>Best RTT</dt><dd>{clock.rtt === null ? '–' : `${clock.rtt.toFixed(1)} ms`} (median {clock.medianRtt?.toFixed(1) ?? '–'})</dd>
        <dt>Last sync</dt><dd>{clock.lastSync ? new Date(clock.lastSync).toLocaleTimeString() : '–'}</dd>
        <dt>Seq</dt><dd>{controller.lastSeq}</dd>
        <dt>Server state</dt><dd>{st ? `${st.playing ? 'playing' : 'paused'} @ ${formatTime(controller.expected())}` : '–'}</dd>
        <dt>Drift</dt><dd>{(drift.drift * 1000).toFixed(0)} ms ({drift.state}, rate {drift.rate})</dd>
        <dt>Corrections</dt><dd>{drift.corrections} · fine rates: {drift.fineRates ? 'yes' : 'no'} · seek lead {drift.seekLead ?? 0} ms</dd>
      </dl>
      <div className="debug-actions">
        <button type="button" className="btn btn-small" onClick={simulateDisconnect}>Simulate disconnect (5 s)</button>
        <button type="button" className="btn btn-small" onClick={() => inject(0.5)}>Inject +0.5 s</button>
        <button type="button" className="btn btn-small" onClick={() => inject(1)}>Inject +1 s</button>
        <button type="button" className="btn btn-small" onClick={() => inject(3)}>Inject drift (+3 s)</button>
        <button type="button" className="btn btn-small" onClick={() => inject(-3)}>Inject −3 s</button>
        <button type="button" className="btn btn-small" onClick={() => downloadJson(`drift-log-${Date.now()}.json`, driftLog.toArray())}>
          Download drift log ({driftLog.length})
        </button>
      </div>
    </aside>
  );
}
