import { useEffect, useState } from 'react';
import { serverNow } from '../utils/clock.js';

function Countdown({ closesAt }) {
  const [left, setLeft] = useState(() => closesAt - serverNow());
  useEffect(() => {
    const t = setInterval(() => setLeft(closesAt - serverNow()), 250);
    return () => clearInterval(t);
  }, [closesAt]);
  const s = Math.max(0, Math.ceil(left / 1000));
  return <span className="poll-timer" aria-label={`${s} seconds left`}>⏱ {s}s</span>;
}

function PollCard({ poll, you, isHost, emit, onAddWinner }) {
  const open = poll.status === 'open';
  const total = poll.totalVotes;
  const winner = poll.options.find((o) => o.id === poll.winnerId);
  const canClose = open && (isHost || poll.createdBy === you);
  return (
    <article className={`poll ${open ? '' : 'closed'} ${poll.kind === 'skip' ? 'skip' : ''}`}>
      <header>
        <strong>{poll.question}</strong>
        <span className="muted small">
          by {poll.createdBy === you ? 'you' : poll.createdByName} · {total} vote{total === 1 ? '' : 's'}
        </span>
        {open && poll.closesAt && <Countdown closesAt={poll.closesAt} />}
        {!open && <span className="badge">Closed</span>}
      </header>
      <ul className="poll-options">
        {poll.options.map((o) => {
          const pct = total ? Math.round((o.votes / total) * 100) : 0;
          const mine = poll.myVote === o.id;
          const isWinner = !open && o.id === poll.winnerId;
          return (
            <li key={o.id}>
              <button
                type="button"
                className={`poll-option ${mine ? 'mine' : ''} ${isWinner ? 'winner' : ''}`}
                disabled={!open}
                aria-pressed={mine}
                onClick={() => emit('poll:vote', { pollId: poll.id, optionId: o.id })}
              >
                <span className="poll-bar" style={{ width: `${pct}%` }} />
                <span className="poll-label">
                  {isWinner && '🏆 '}
                  {o.text}
                  {mine && <span className="small"> (your vote)</span>}
                </span>
                <span className="poll-pct">{pct}% · {o.votes}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <footer>
        {open && poll.myVote && <span className="muted small">You can change your vote while the poll is open.</span>}
        {canClose && (
          <button type="button" className="btn btn-small" onClick={() => emit('poll:close', { pollId: poll.id })}>
            Close poll
          </button>
        )}
        {!open && poll.kind !== 'skip' && (
          <span className="small">{winner ? <>Winner: <strong>{winner.text}</strong></> : 'No votes were cast'}</span>
        )}
        {!open && winner?.meta && (winner.meta.videoId || winner.meta.tmdbId) && (
          <button type="button" className="btn btn-small btn-primary" onClick={() => onAddWinner(winner)}>
            Add winner to playlist
          </button>
        )}
      </footer>
    </article>
  );
}

function NewPollForm({ emit, onDone, initial }) {
  const [question, setQuestion] = useState(initial?.question || '');
  const [options, setOptions] = useState(initial?.options || [{ text: '' }, { text: '' }]);
  const [timed, setTimed] = useState(false);
  const [duration, setDuration] = useState(60);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    const clean = options.map((o) => ({ ...o, text: o.text.trim() })).filter((o) => o.text);
    if (!question.trim()) return setError('Ask a question');
    if (clean.length < 2) return setError('Add at least two options');
    const res = await emit(
      'poll:create',
      { question: question.trim(), options: clean.map((o) => (o.meta ? { text: o.text, meta: o.meta } : o.text)), durationSec: timed ? Number(duration) : undefined },
      { quiet: true },
    );
    if (res.ok) onDone();
    else setError(res.error);
  };

  return (
    <form className="poll-form" onSubmit={submit}>
      <label htmlFor="poll-q">Question</label>
      <input id="poll-q" className="input" maxLength={120} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What should we watch next?" />
      <fieldset>
        <legend>Options (2–5)</legend>
        {options.map((o, i) => (
          <div className="option-row" key={i}>
            <label htmlFor={`poll-o-${i}`} className="sr-only">Option {i + 1}</label>
            <input
              id={`poll-o-${i}`}
              className="input"
              maxLength={60}
              value={o.text}
              placeholder={`Option ${i + 1}`}
              onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? { text: e.target.value } : x)))}
            />
            {options.length > 2 && (
              <button type="button" className="btn btn-icon" aria-label={`Remove option ${i + 1}`} onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}>
                ✕
              </button>
            )}
          </div>
        ))}
        {options.length < 5 && (
          <button type="button" className="btn btn-small" onClick={() => setOptions((list) => [...list, { text: '' }])}>
            + Add option
          </button>
        )}
      </fieldset>
      <div className="option-row">
        <label className="toggle">
          <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} /> Close automatically after
        </label>
        <label htmlFor="poll-d" className="sr-only">Duration in seconds</label>
        <select id="poll-d" className="input input-narrow" disabled={!timed} value={duration} onChange={(e) => setDuration(e.target.value)}>
          {[15, 30, 60, 120, 300, 600].map((s) => (
            <option key={s} value={s}>{s < 60 ? `${s}s` : `${s / 60} min`}</option>
          ))}
        </select>
      </div>
      {error && <p className="form-error small" role="alert">{error}</p>}
      <div className="option-row">
        <button type="submit" className="btn btn-primary">Start poll</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

export default function PollsPanel({ polls, you, isHost, emit, hasVideo, onAddWinner, draft, clearDraft }) {
  const [creating, setCreating] = useState(false);
  const showForm = creating || Boolean(draft);
  const open = polls.filter((p) => p.status === 'open');
  const closed = polls.filter((p) => p.status === 'closed').reverse();
  return (
    <section className="panel" aria-label="Polls">
      {showForm ? (
        <NewPollForm
          key={draft ? draft.question : 'new'}
          emit={emit}
          initial={draft}
          onDone={() => {
            setCreating(false);
            clearDraft?.();
          }}
        />
      ) : (
        <div className="panel-toolbar">
          <button type="button" className="btn btn-primary btn-small" onClick={() => setCreating(true)}>+ New poll</button>
          <button type="button" className="btn btn-small" disabled={!hasVideo} onClick={() => emit('poll:createSkip')} title="Yes/No vote, 30 s. A majority of connected people skips the video.">
            ⏭ Skip this video?
          </button>
        </div>
      )}
      {polls.length === 0 && !showForm && (
        <div className="empty">
          <span className="big-emoji" aria-hidden="true">🗳️</span>
          <p>No polls yet.</p>
          <p className="muted small">Ask the room anything, or start a quick skip vote.</p>
        </div>
      )}
      {open.map((p) => <PollCard key={p.id} poll={p} you={you} isHost={isHost} emit={emit} onAddWinner={onAddWinner} />)}
      {closed.length > 0 && <h3 className="section-title">Recent results</h3>}
      {closed.map((p) => <PollCard key={p.id} poll={p} you={you} isHost={isHost} emit={emit} onAddWinner={onAddWinner} />)}
    </section>
  );
}
