import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { syncClock } from './useClockSync.js';
import { getUserId } from '../utils/identity.js';

const HISTORY_POINTS = 60;
const MAX_CHAT = 200;

const initial = {
  status: 'connecting', // connecting | joining | joined | notfound | error | kicked | replaced | ended
  error: null,
  code: null,
  you: null,
  hostId: null,
  users: [],
  settings: { controlMode: 'everyone', chatEnabled: true, locked: false },
  playback: null,
  chat: [],
  playlist: { items: [], currentItemId: null },
  polls: [],
  reactions: [],
  drift: [],
  driftHistory: {},
  countdown: null,
  recap: null,
};

function upsertPoll(polls, poll) {
  const idx = polls.findIndex((p) => p.id === poll.id);
  if (idx < 0) return [...polls, poll].slice(-12);
  const next = [...polls];
  next[idx] = poll;
  return next;
}

function reducer(state, action) {
  switch (action.type) {
    case 'status':
      return { ...state, status: action.status, error: action.error ?? null, recap: action.recap ?? state.recap };
    case 'snapshot': {
      const r = action.room;
      return {
        ...state,
        status: 'joined',
        error: null,
        code: r.code,
        you: r.you,
        hostId: r.hostId,
        users: r.users,
        settings: r.settings,
        playback: r.playback,
        chat: r.chat,
        playlist: r.playlist ?? state.playlist,
        polls: r.polls ?? [],
        reactions: r.reactions ?? [],
        countdown: r.countdown,
      };
    }
    case 'users':
      return { ...state, users: action.users, hostId: action.users.find((u) => u.isHost)?.userId ?? state.hostId };
    case 'host':
      return { ...state, hostId: action.hostId };
    case 'settings':
      return { ...state, settings: action.settings };
    case 'playback':
      if (state.playback && action.state.seq <= state.playback.seq && !action.state.snapshot) return state;
      return { ...state, playback: action.state };
    case 'chat':
      return { ...state, chat: [...state.chat, action.message].slice(-MAX_CHAT) };
    case 'playlist':
      return { ...state, playlist: action.playlist };
    case 'poll':
      return { ...state, polls: upsertPoll(state.polls, action.poll) };
    case 'reaction':
      return action.reaction.videoId
        ? { ...state, reactions: [...state.reactions, action.reaction].slice(-500) }
        : state;
    case 'drift': {
      const history = { ...state.driftHistory };
      for (const row of action.rows) {
        const prev = history[row.userId] || [];
        history[row.userId] = [...prev, { drift: row.drift, rtt: row.rtt, at: row.at }].slice(-HISTORY_POINTS);
      }
      return { ...state, drift: action.rows, driftHistory: history };
    }
    case 'countdown':
      return { ...state, countdown: action.countdown };
    default:
      return state;
  }
}

// A pending "leave" survives React StrictMode's unmount/remount in development.
let pendingLeave = null;

/**
 * Owns the room session: join (and automatic rejoin after every reconnect, after a fresh
 * clock sync), every room event listener, and the actions components call.
 */
export function useRoom({ code, name, controller }) {
  const { socket } = useSocket();
  const toast = useToast();
  const [state, dispatch] = useReducer(reducer, initial);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!code || !name) return undefined;
    if (pendingLeave?.code === code) {
      clearTimeout(pendingLeave.timer);
      pendingLeave = null;
    }
    let active = true;

    const join = async () => {
      if (stateRef.current.status !== 'joined') dispatch({ type: 'status', status: 'joining' });
      await syncClock(socket); // fresh offset before any playback is applied
      if (!active || !socket.connected) return;
      socket.emit('room:join', { code, name, userId: getUserId() }, (res) => {
        if (!active) return;
        if (!res?.ok) {
          const status = res?.code === 'ROOM_NOT_FOUND' ? 'notfound' : res?.code === 'BANNED' ? 'kicked' : 'error';
          dispatch({ type: 'status', status, error: res?.error || 'Could not join the room' });
          return;
        }
        dispatch({ type: 'snapshot', room: res.room });
        controller.applyState(res.room.playback, { force: true });
      });
    };

    const handlers = {
      connect: join,
      'room:users': (users) => {
        const prev = stateRef.current.users;
        const you = stateRef.current.you;
        if (stateRef.current.status === 'joined') {
          for (const u of users) {
            if (u.userId !== you && !prev.some((p) => p.userId === u.userId)) toast.push({ text: `${u.name} joined`, type: 'join' });
          }
          for (const p of prev) {
            if (p.userId !== you && !users.some((u) => u.userId === p.userId)) toast.push({ text: `${p.name} left`, type: 'leave' });
          }
        }
        dispatch({ type: 'users', users });
      },
      'room:host': ({ hostId, name: hostName }) => {
        dispatch({ type: 'host', hostId });
        const you = stateRef.current.you;
        toast.push({ text: hostId === you ? 'You are now the host 👑' : `${hostName} is now the host`, type: 'host' });
      },
      'room:settings': (settings) => dispatch({ type: 'settings', settings }),
      'playback:state': (st) => {
        const applied = controller.applyState(st, { force: Boolean(st.snapshot) });
        if (applied || st.snapshot) dispatch({ type: 'playback', state: st });
        if (applied && st.stale && st.by !== stateRef.current.you) {
          toast.push({ text: `${st.byName || 'Someone'}'s action was applied`, type: 'info', key: 'stale' });
        }
      },
      'chat:message': (message) => dispatch({ type: 'chat', message }),
      'playlist:update': (playlist) => playlist && dispatch({ type: 'playlist', playlist }),
      'poll:update': (poll) => dispatch({ type: 'poll', poll }),
      'reaction:show': (reaction) => dispatch({ type: 'reaction', reaction }),
      'drift:update': (rows) => Array.isArray(rows) && dispatch({ type: 'drift', rows }),
      'countdown:show': (countdown) => dispatch({ type: 'countdown', countdown }),
      'countdown:cancel': () => dispatch({ type: 'countdown', countdown: null }),
      'room:ended': ({ recap }) => dispatch({ type: 'status', status: 'ended', recap }),
      kicked: () => dispatch({ type: 'status', status: 'kicked', error: 'The host removed you from this room.' }),
      'session:replaced': () => dispatch({ type: 'status', status: 'replaced' }),
      'action:error': ({ event, error }) => {
        toast.push({ text: error, type: 'error', key: `err-${event}` });
        if (event === 'playback:action') controller.sync('rejected');
      },
      'rate:limited': () => toast.push({ text: 'You are sending too many actions; some were dropped.', type: 'error', key: 'rate' }),
    };
    for (const [evt, fn] of Object.entries(handlers)) socket.on(evt, fn);
    if (socket.connected) join();

    return () => {
      active = false;
      for (const [evt, fn] of Object.entries(handlers)) socket.off(evt, fn);
      pendingLeave = {
        code,
        timer: setTimeout(() => {
          pendingLeave = null;
          if (socket.connected) socket.emit('room:leave');
        }, 150),
      };
    };
  }, [code, name, socket, controller, toast]);

  /** emit with a promise-based ack and an error toast. */
  const emit = useCallback(
    (event, payload = {}, { quiet = false } = {}) =>
      new Promise((resolve) => {
        if (!socket.connected) {
          if (!quiet) toast.push({ text: 'You are offline, try again in a moment', type: 'error', key: 'offline' });
          return resolve({ ok: false, error: 'offline' });
        }
        socket.timeout(5000).emit(event, payload, (err, res) => {
          const result = err ? { ok: false, error: 'The server did not respond' } : res;
          if (!result?.ok && !quiet) toast.push({ text: result?.error || 'Something went wrong', type: 'error', key: `err-${event}` });
          resolve(result || { ok: false });
        });
      }),
    [socket, toast],
  );

  const retake = useCallback(() => {
    dispatch({ type: 'status', status: 'connecting' });
    socket.connect();
  }, [socket]);

  return { state, dispatch, emit, retake };
}
