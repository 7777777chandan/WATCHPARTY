import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext.jsx';
import { getSavedName, getUserId, saveName } from '../utils/identity.js';
import ThemeToggle from '../components/ThemeToggle.jsx';

const FEATURES = [
  ['🎬', 'Watch in sync', 'Play, pause and seek land on every screen within a blink. Drift is corrected automatically.'],
  ['💬', 'Talk & react', 'Live chat, spoiler-safe messages and floating emoji that stay pinned to the moment.'],
  ['🗳️', 'Decide together', 'Shared playlist with votes, quick polls, and a "skip this?" vote.'],
  ['🍿', 'Find something', 'Browse trending movies with typo-tolerant search and queue trailers.'],
];

export default function Landing() {
  const { socket, connected } = useSocket();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState(getSavedName);
  const [code, setCode] = useState('');
  const [error, setError] = useState(location.state?.message || null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    document.title = 'Watch Party';
  }, []);

  const validName = () => {
    const n = name.trim();
    if (!n) {
      setError('Enter your name first');
      document.getElementById('name-input')?.focus();
      return null;
    }
    if (n.length > 24) {
      setError('Names are at most 24 characters');
      return null;
    }
    saveName(n);
    return n;
  };

  const request = (event, payload) =>
    new Promise((resolve) => {
      if (!socket.connected) return resolve({ ok: false, error: 'Not connected to the server yet. Is it running?' });
      socket.timeout(5000).emit(event, payload, (err, res) => resolve(err ? { ok: false, error: 'The server did not respond' } : res));
    });

  const create = async () => {
    const n = validName();
    if (!n) return;
    setBusy('create');
    const res = await request('room:create', { name: n, userId: getUserId() });
    setBusy(null);
    if (res.ok) navigate(`/room/${res.code}`);
    else setError(res.error);
  };

  const join = async (e) => {
    e.preventDefault();
    const n = validName();
    if (!n) return;
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(c)) return setError('Room codes are 6 letters or digits');
    setBusy('join');
    const res = await request('room:join', { code: c, name: n, userId: getUserId() });
    setBusy(null);
    if (res.ok) navigate(`/room/${c}`);
    else setError(res.error);
  };

  return (
    <main className="landing">
      <div className="landing-top"><ThemeToggle /></div>
      <section className="hero">
        <h1>🍿 Watch Party</h1>
        <p className="pitch">Watch YouTube together in perfect sync, with friends anywhere. No accounts, just a link.</p>
      </section>

      <section className="landing-card" aria-label="Start or join a party">
        <label htmlFor="name-input">Your name</label>
        <input
          id="name-input"
          className="input"
          maxLength={24}
          value={name}
          autoComplete="nickname"
          placeholder="e.g. Sam"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="button" className="btn btn-primary btn-large" onClick={create} disabled={busy !== null}>
          {busy === 'create' ? 'Creating…' : 'Create a room'}
        </button>
        <div className="divider"><span>or join one</span></div>
        <form className="inline-form" onSubmit={join}>
          <label htmlFor="code-input" className="sr-only">Room code</label>
          <input
            id="code-input"
            className="input code-input"
            maxLength={6}
            placeholder="ROOM CODE"
            value={code}
            autoCapitalize="characters"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
          <button type="submit" className="btn" disabled={busy !== null}>{busy === 'join' ? 'Joining…' : 'Join'}</button>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!connected && <p className="muted small" role="status"><span className="spinner" aria-hidden="true" /> Connecting to the server…</p>}
      </section>

      <section className="features" aria-label="Features">
        {FEATURES.map(([icon, title, text]) => (
          <article key={title} className="feature">
            <span className="big-emoji" aria-hidden="true">{icon}</span>
            <h2>{title}</h2>
            <p className="muted">{text}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
