import { formatTime } from '../utils/youtube.js';

const dur = (sec) => {
  if (!sec) return '0 min';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : sec < 60 ? `${sec} s` : `${m} min`;
};

/** Feature D: "Watch together" recap. */
export default function StatsRecap({ recap, isHost, currentVideoId, onJump }) {
  if (!recap) return <p className="muted">Loading stats…</p>;
  const mr = recap.mostReacted;
  return (
    <div className="recap">
      <div className="recap-grid">
        <div className="stat"><span className="stat-value">{dur(recap.watchTimeSec)}</span><span className="stat-label">watched together</span></div>
        <div className="stat"><span className="stat-value">{recap.videosPlayed}</span><span className="stat-label">videos played</span></div>
        <div className="stat"><span className="stat-value">{recap.reactionCount}</span><span className="stat-label">reactions</span></div>
        <div className="stat"><span className="stat-value">{recap.chatCount}</span><span className="stat-label">chat messages</span></div>
      </div>
      <h3>🔥 Most reacted moment</h3>
      {mr ? (
        <p>
          <strong>{mr.topEmoji} {mr.count} reactions</strong> around <strong>{formatTime(mr.time)}</strong>
          {mr.videoId !== currentVideoId && <span className="muted"> (in an earlier video)</span>}
          {isHost && mr.videoId === currentVideoId && (
            <button type="button" className="btn btn-small" onClick={() => onJump(mr.time)}>Jump the room there</button>
          )}
        </p>
      ) : (
        <p className="muted">No reactions yet.</p>
      )}
      <h3>💬 Most active chatter</h3>
      <p>{recap.topChatter ? <><strong>{recap.topChatter.name}</strong> with {recap.topChatter.count} messages</> : <span className="muted">Nobody has chatted yet.</span>}</p>
      <h3>🗳️ Poll results</h3>
      {recap.polls.length ? (
        <ul className="recap-polls">
          {recap.polls.map((p, i) => (
            <li key={i}>{p.question}: <strong>{p.winner ?? 'no votes'}</strong> <span className="muted small">({p.totalVotes} votes)</span></li>
          ))}
        </ul>
      ) : (
        <p className="muted">No polls closed yet.</p>
      )}
      <p className="muted small">Party length {dur(recap.durationSec)} · {recap.peopleNow} online now</p>
    </div>
  );
}
