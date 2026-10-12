import { useState } from 'react';

function driftClass(ms) {
  if (ms === undefined || ms === null) return '';
  const a = Math.abs(ms);
  return a < 150 ? 'good' : a < 500 ? 'warn' : 'bad';
}

function UserRow({ user, you, isHost, emit, drift }) {
  const [menu, setMenu] = useState(false);
  const isYou = user.userId === you;
  return (
    <li className={`user ${user.connected ? '' : 'offline'}`}>
      <span className="avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
      <span className="user-name">
        {user.name}
        {isYou && <span className="muted"> (you)</span>}
        {user.isHost && <span className="crown" title="Host" aria-label="host"> 👑</span>}
        {!user.connected && <span className="muted small"> · reconnecting…</span>}
      </span>
      {drift && user.connected && (
        <span className={`drift-pill ${driftClass(drift.drift)}`} title="Playback drift from the room">
          {drift.drift > 0 ? '+' : ''}{drift.drift} ms
        </span>
      )}
      {isHost && !isYou && (
        <span className="user-menu">
          <button type="button" className="btn btn-icon" aria-haspopup="menu" aria-expanded={menu} aria-label={`Actions for ${user.name}`} onClick={() => setMenu((m) => !m)}>
            ⋯
          </button>
          {menu && (
            <span className="menu" role="menu">
              <button type="button" role="menuitem" disabled={!user.connected} onClick={() => { setMenu(false); emit('host:transfer', { toUserId: user.userId }); }}>
                👑 Make host
              </button>
              <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(false); emit('user:kick', { userId: user.userId }); }}>
                🚫 Kick (10 min)
              </button>
            </span>
          )}
        </span>
      )}
    </li>
  );
}

export default function PeoplePanel({ users, you, isHost, emit, settings, drift, onShowDashboard, onShowRecap }) {
  const driftBy = Object.fromEntries(drift.map((d) => [d.userId, d]));
  const online = users.filter((u) => u.connected).length;
  return (
    <section className="panel" aria-label="People">
      <p className="muted small">{online} online · {users.length} in room</p>
      <ul className="user-list">
        {users.map((u) => (
          <UserRow key={u.userId} user={u} you={you} isHost={isHost} emit={emit} drift={driftBy[u.userId]} />
        ))}
      </ul>

      <div className="panel-toolbar">
        <button type="button" className="btn btn-small" onClick={onShowRecap}>📊 Watch stats</button>
        {isHost && <button type="button" className="btn btn-small" onClick={onShowDashboard}>📈 Sync dashboard</button>}
      </div>

      {isHost ? (
        <fieldset className="settings">
          <legend>Room settings (host)</legend>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.controlMode === 'host-only'}
              onChange={(e) => emit('room:settings', { controlMode: e.target.checked ? 'host-only' : 'everyone' })}
            />
            Only the host controls playback
          </label>
          <label className="toggle">
            <input type="checkbox" checked={settings.chatEnabled} onChange={(e) => emit('room:settings', { chatEnabled: e.target.checked })} />
            Chat enabled
          </label>
          <label className="toggle">
            <input type="checkbox" checked={settings.locked} onChange={(e) => emit('room:settings', { locked: e.target.checked })} />
            Lock room (no new joins, people can still reconnect)
          </label>
          <button
            type="button"
            className="btn btn-small danger"
            onClick={() => window.confirm('End the party for everyone and show the recap?') && emit('room:end')}
          >
            End party
          </button>
        </fieldset>
      ) : (
        <p className="muted small">
          {settings.controlMode === 'host-only' ? '🔒 Only the host controls playback.' : 'Everyone can control playback.'}
          {settings.locked ? ' The room is locked.' : ''}
        </p>
      )}
    </section>
  );
}
