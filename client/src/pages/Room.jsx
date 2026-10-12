import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSocket } from '../context/SocketContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useRoom } from '../hooks/useRoom.js';
import { useDriftCorrection } from '../hooks/useDriftCorrection.js';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts.js';
import { PlayerController } from '../sync/playerController.js';
import { getSavedName, getUserId, saveName, createTabIdentity } from '../utils/identity.js';
import { fetchTrailer } from '../utils/api.js';
import Player from '../components/Player.jsx';
import { AutoplayOverlay, HostOnlyShield, NoVideo } from '../components/PlayerOverlays.jsx';
import VideoUrlForm from '../components/VideoUrlForm.jsx';
import FloatingReactions from '../components/FloatingReactions.jsx';
import ReactionBar from '../components/ReactionBar.jsx';
import ReactionTimeline from '../components/ReactionTimeline.jsx';
import CatchUpButton from '../components/CatchUpButton.jsx';
import CountdownOverlay from '../components/CountdownOverlay.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import PlaylistPanel from '../components/PlaylistPanel.jsx';
import PollsPanel from '../components/PollsPanel.jsx';
import MoviesPanel from '../components/MoviesPanel.jsx';
import MovieModal from '../components/MovieModal.jsx';
import PeoplePanel from '../components/PeoplePanel.jsx';
import Tabs from '../components/Tabs.jsx';
import RoomHeader from '../components/RoomHeader.jsx';
import ConnectionBanner from '../components/ConnectionBanner.jsx';
import DebugPanel from '../components/DebugPanel.jsx';
import SyncHealthPanel from '../components/SyncHealthPanel.jsx';
import SyncDashboard from '../components/SyncDashboard.jsx';
import StatsRecap from '../components/StatsRecap.jsx';
import Modal from '../components/Modal.jsx';
import StatusScreen from '../components/StatusScreen.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';

const SHORTCUTS = [
  ['Space', 'Play / pause'],
  ['M', 'Mute / unmute'],
  ['R', 'Reactions (then ← → and Enter)'],
  ['D', 'Debug panel'],
  ['H', 'Sync health'],
];

function NamePrompt({ code, onSubmit }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  return (
    <main className="center-card">
      <h1>Join room {code}</h1>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n) return setError('Enter a name so others know who you are');
          if (n.length > 24) return setError('Names are at most 24 characters');
          saveName(n);
          onSubmit(n);
        }}
      >
        <label htmlFor="prompt-name">Your name</label>
        <input id="prompt-name" className="input" maxLength={24} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-large">Join the party</button>
      </form>
    </main>
  );
}

export default function Room() {
  const { code: rawCode } = useParams();
  const code = (rawCode || '').toUpperCase();
  const [name, setName] = useState(getSavedName);
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return <StatusScreen emoji="🤔" title="That is not a room link">Room codes are 6 letters or digits.</StatusScreen>;
  }
  if (!name) return <NamePrompt code={code} onSubmit={setName} />;
  return <RoomSession code={code} name={name} />;
}

function RoomSession({ code, name }) {
  const { socket } = useSocket();
  const toast = useToast();
  const navigate = useNavigate();
  const isHostRef = useRef(false);

  // One controller per room session. Its callbacks read refs so it never needs recreating.
  const controller = useMemo(
    () =>
      new PlayerController({
        emitAction: (payload) =>
          socket.emit('playback:action', payload, (res) => {
            if (res && !res.ok) {
              toast.push({ text: res.error, type: 'error', key: 'playback-error' });
              controller.sync('rejected');
            }
          }),
        onEnded: (state) => {
          // Only the host advances the playlist (the server also drops duplicates by seq).
          if (isHostRef.current && state?.videoId) socket.emit('playlist:next', { seq: state.seq }, () => {});
        },
        onBlockedAction: () => toast.push({ text: '🔒 Only the host can control playback right now', type: 'error', key: 'host-only' }),
        // Development only: a ring of controller decisions for debugging and the e2e tests.
        log: import.meta.env.DEV
          ? (entry) => {
              const buf = (window.__wpLog ||= []);
              buf.push({ t: Math.round(performance.now()), ...entry });
              if (buf.length > 300) buf.shift();
            }
          : undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [socket, toast],
  );

  const { state, dispatch, emit, retake } = useRoom({ code, name, controller });
  const { status, you, hostId, users, settings, playback, chat, playlist, polls, reactions, drift, driftHistory, countdown } = state;
  const isHost = Boolean(you) && hostId === you;
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);
  const canControl = settings.controlMode === 'everyone' || isHost;
  const hasVideo = Boolean(playback?.videoId);

  useEffect(() => controller.setCanControl(canControl), [controller, canControl]);
  useEffect(() => {
    // Development-only handle for the e2e tests (stripped from production builds).
    if (import.meta.env.DEV) window.__wpController = controller;
  }, [controller]);
  useEffect(() => {
    document.title = `Room ${code} · Watch Party`;
  }, [code]);

  useDriftCorrection({
    controller,
    socket,
    enabled: status === 'joined',
    onSuggestCatchUp: () =>
      toast.push({
        text: "You're out of sync. Catch up?",
        type: 'error',
        key: 'catchup-suggest',
        duration: 8000,
        action: { label: 'Catch up', onClick: () => controller.hardSeekToExpected() },
      }),
  });

  // ---- UI state ----
  const [tab, setTab] = useState('chat');
  const [panels, setPanels] = useState({ debug: false, health: false, dashboard: false, shortcuts: false });
  const toggle = (k) => setPanels((p) => ({ ...p, [k]: !p[k] }));
  const [movie, setMovie] = useState(null);
  const [pollDraft, setPollDraft] = useState(null);
  const [recapOpen, setRecapOpen] = useState(false);
  const [recap, setRecap] = useState(null);
  const [videoError, setVideoError] = useState(null);
  const [reactHighlight, setReactHighlight] = useState(false);
  const reactionBarRef = useRef(null);

  useEffect(() => setVideoError(null), [playback?.videoId]);

  // Unread badges: chat messages from others and polls you haven't seen while on another tab.
  const [seenChatTs, setSeenChatTs] = useState(() => Date.now());
  const [seenPolls, setSeenPolls] = useState(() => new Set());
  useEffect(() => {
    if (tab === 'chat' && chat.length) setSeenChatTs(chat[chat.length - 1].ts);
  }, [tab, chat]);
  useEffect(() => {
    if (tab === 'polls') setSeenPolls(new Set(polls.map((p) => p.id)));
  }, [tab, polls]);
  const chatBadge = tab === 'chat' ? 0 : chat.filter((m) => m.ts > seenChatTs && m.userId !== you && m.type !== 'system').length;
  const pollBadge = tab === 'polls' ? 0 : polls.filter((p) => p.status === 'open' && !seenPolls.has(p.id)).length;

  const suggestions = useMemo(() => {
    const seen = new Set();
    return chat
      .filter((m) => m.type === 'suggestion' && m.movie)
      .reverse()
      .filter((m) => !seen.has(m.movie.id) && seen.add(m.movie.id))
      .map((m) => m.movie);
  }, [chat]);

  const react = useCallback((emoji) => emit('reaction:send', { emoji }), [emit]);

  useKeyboardShortcuts({
    Space: () => controller.togglePlay(),
    m: () => {
      const p = controller.player;
      if (!p) return;
      const muted = p.isMuted();
      if (muted) p.unMute();
      else p.mute();
      toast.push({ text: muted ? '🔊 Unmuted' : '🔇 Muted', key: 'mute', duration: 1200 });
    },
    r: () => {
      reactionBarRef.current?.querySelector('button')?.focus();
      setReactHighlight(true);
      setTimeout(() => setReactHighlight(false), 1500);
    },
    d: () => toggle('debug'),
    h: () => toggle('health'),
    '?': () => toggle('shortcuts'),
  });

  const leave = () => {
    socket.emit('room:leave', { code }, () => {});
  };

  const openRecap = async () => {
    setRecap(null);
    setRecapOpen(true);
    const res = await emit('stats:get');
    if (res.ok) setRecap(res.recap);
  };

  const pollFromPlaylist = () => {
    const opts = playlist.items
      .filter((i) => i.id !== playlist.currentItemId)
      .slice(0, 5)
      .map((i) => ({ text: i.title.slice(0, 60), meta: { videoId: i.videoId } }));
    if (opts.length < 2) return toast.push({ text: 'Add at least two more videos first', type: 'error' });
    setPollDraft({ question: 'What should we watch next?', options: opts });
    setTab('polls');
  };

  const pollFromSuggestions = () => {
    const opts = suggestions.slice(0, 5).map((m) => ({ text: m.title.slice(0, 60), meta: { tmdbId: m.id } }));
    setPollDraft({ question: 'Which movie should we pick?', options: opts });
    setTab('polls');
  };

  const addWinner = async (option) => {
    const meta = option.meta || {};
    if (meta.videoId) return emit('playlist:add', { url: meta.videoId, title: option.text });
    if (meta.tmdbId) {
      try {
        const t = await fetchTrailer(meta.tmdbId);
        if (!t) return toast.push({ text: `No trailer found for ${option.text}`, type: 'error' });
        const res = await emit('playlist:add', { url: t.key, title: `${option.text}: trailer`.slice(0, 120), source: 'tmdb' });
        if (res.ok) toast.push({ text: `Added ${option.text} to the playlist`, type: 'success' });
      } catch (err) {
        toast.push({ text: err.message, type: 'error' });
      }
    }
    return null;
  };

  // ---- status screens ----
  if (status === 'notfound') {
    return (
      <StatusScreen
        emoji="🫥"
        title="This room no longer exists"
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              socket.emit('room:create', { name, userId: getUserId() }, (res) => (res?.ok ? navigate(`/room/${res.code}`) : toast.push({ text: res?.error || 'Could not create a room', type: 'error' })))
            }
          >
            Start a new room
          </button>
        }
      >
        <p>Rooms live in the server&apos;s memory: the room may have ended, everyone left more than a minute ago, or the server restarted.</p>
      </StatusScreen>
    );
  }
  if (status === 'kicked') {
    return <StatusScreen emoji="🚫" title="You were removed from this room">{state.error}</StatusScreen>;
  }
  if (status === 'replaced') {
    return (
      <StatusScreen
        emoji="🪟"
        title="You opened this room in another tab"
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={retake}>Use this tab instead</button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                createTabIdentity();
                retake();
              }}
              title="Gives this tab its own identity (handy for testing with two tabs)"
            >
              Join as another person
            </button>
          </>
        }
      >
        <p>Only one tab per person can be in a room. The other tab is now in control.</p>
      </StatusScreen>
    );
  }
  if (status === 'ended') {
    return (
      <StatusScreen emoji="🎉" title="The party is over">
        <StatsRecap recap={state.recap} isHost={false} />
      </StatusScreen>
    );
  }
  if (status === 'error') {
    return (
      <StatusScreen emoji="⚠️" title="Could not join" actions={<button type="button" className="btn btn-primary" onClick={retake}>Try again</button>}>
        {state.error}
      </StatusScreen>
    );
  }
  if (status !== 'joined') {
    return (
      <>
        <ConnectionBanner />
        <main className="center-card" aria-busy="true">
          <span className="spinner large" aria-hidden="true" />
          <h1>Joining room {code}…</h1>
          <p className="muted">Syncing clocks with the server</p>
        </main>
      </>
    );
  }

  const tabs = [
    { id: 'chat', label: '💬 Chat', badge: chatBadge },
    { id: 'playlist', label: '🎞️ Playlist', badge: 0 },
    { id: 'polls', label: '🗳️ Polls', badge: pollBadge },
    { id: 'movies', label: '🍿 Movies', badge: 0 },
    { id: 'people', label: `👥 ${users.filter((u) => u.connected).length}`, badge: 0 },
  ];

  return (
    <div className="room">
      <RoomHeader code={code} online={users.filter((u) => u.connected).length} onLeave={leave} onShortcuts={() => toggle('shortcuts')} />
      <ConnectionBanner />
      <div className="room-layout">
        <section className="stage" aria-label="Video">
          <div className="player-wrap">
            <ErrorBoundary name="player" compact>
              <Player controller={controller} onVideoError={setVideoError} />
            </ErrorBoundary>
            {!hasVideo && <NoVideo isHost={isHost} />}
            <FloatingReactions />
            <HostOnlyShield active={hasVideo && !canControl} />
            <AutoplayOverlay controller={controller} />
            <CountdownOverlay countdown={countdown} controller={controller} onDone={() => dispatch({ type: 'countdown', countdown: null })} />
            {videoError && (
              <div className="player-overlay" role="alert">
                <strong>⚠️ {videoError}</strong>
                <div className="option-row center">
                  {isHost && playlist.items.length > 0 && (
                    <button type="button" className="btn btn-primary" onClick={() => emit('playlist:next')}>Skip to next</button>
                  )}
                  <button type="button" className="btn" onClick={() => setVideoError(null)}>Dismiss</button>
                </div>
                {!isHost && <p className="muted small">The host can skip to another video.</p>}
              </div>
            )}
          </div>
          <ReactionTimeline reactions={reactions} playback={playback} controller={controller} canSeek={canControl} onSeek={(t) => controller.seekLocal(t)} />
          <div className="stage-controls">
            <ReactionBar ref={reactionBarRef} onReact={react} highlight={reactHighlight} />
            <div className="stage-buttons">
              <CatchUpButton controller={controller} disabled={!hasVideo} />
              {isHost && hasVideo && (
                countdown ? (
                  <button type="button" className="btn" onClick={() => emit('countdown:cancel')}>Cancel countdown</button>
                ) : (
                  <button type="button" className="btn" onClick={() => emit('countdown:start', { seconds: 10 })} title="Everyone sees the same 10 s countdown, then playback starts together">
                    ⏱ Countdown
                  </button>
                )
              )}
            </div>
          </div>
          {isHost && (
            <VideoUrlForm
              onPlay={(videoId) => emit('video:set', { videoId })}
              onQueue={(videoId) => emit('playlist:add', { url: videoId })}
            />
          )}
        </section>

        <aside className="sidebar" aria-label="Room panels">
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
          <div className="tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            <ErrorBoundary key={tab} name={tab} compact>
              {tab === 'chat' && <ChatPanel chat={chat} you={you} emit={emit} chatEnabled={settings.chatEnabled} isHost={isHost} onOpenMovie={setMovie} />}
              {tab === 'playlist' && <PlaylistPanel playlist={playlist} you={you} isHost={isHost} emit={emit} onPollFromPlaylist={pollFromPlaylist} />}
              {tab === 'polls' && (
                <PollsPanel polls={polls} you={you} isHost={isHost} emit={emit} hasVideo={hasVideo} onAddWinner={addWinner} draft={pollDraft} clearDraft={() => setPollDraft(null)} />
              )}
              {tab === 'movies' && <MoviesPanel onOpen={setMovie} suggestions={suggestions} onPollFromSuggestions={pollFromSuggestions} />}
              {tab === 'people' && (
                <PeoplePanel
                  users={users}
                  you={you}
                  isHost={isHost}
                  emit={emit}
                  settings={settings}
                  drift={drift}
                  onShowDashboard={() => toggle('dashboard')}
                  onShowRecap={openRecap}
                />
              )}
            </ErrorBoundary>
          </div>
        </aside>
      </div>

      {panels.debug && <DebugPanel controller={controller} onClose={() => toggle('debug')} />}
      {panels.health && <SyncHealthPanel drift={drift} onClose={() => toggle('health')} />}
      {panels.dashboard && isHost && <SyncDashboard users={users} drift={drift} history={driftHistory} onClose={() => toggle('dashboard')} />}
      {movie && <MovieModal movie={movie} onClose={() => setMovie(null)} emit={emit} isHost={isHost} />}
      {recapOpen && (
        <Modal title="📊 Watch together stats" onClose={() => setRecapOpen(false)}>
          <StatsRecap
            recap={recap}
            isHost={isHost}
            currentVideoId={playback?.videoId}
            onJump={(t) => {
              controller.seekLocal(t);
              setRecapOpen(false);
            }}
          />
        </Modal>
      )}
      {panels.shortcuts && (
        <Modal title="Keyboard shortcuts" onClose={() => toggle('shortcuts')}>
          <dl className="shortcuts">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
            ))}
          </dl>
          <p className="muted small">Shortcuts are ignored while you are typing.</p>
        </Modal>
      )}
    </div>
  );
}
