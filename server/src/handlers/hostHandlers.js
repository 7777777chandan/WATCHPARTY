import { config } from '../config.js';
import { handle, membership, NOT_IN_ROOM, HOST_ONLY } from './helpers.js';
import { validateBoolean, validateUserId } from '../utils/validate.js';
import { emitToRoom, socketById } from '../rooms/notify.js';
import { removeUserFully, setHost } from '../rooms/membership.js';
import { systemMessage } from '../rooms/chatStore.js';
import { runInRoom } from '../rooms/roomActor.js';

const SETTING_VALIDATORS = {
  controlMode: (v) =>
    v === 'everyone' || v === 'host-only'
      ? { ok: true, value: v }
      : { ok: false, error: 'controlMode must be "everyone" or "host-only"' },
  chatEnabled: (v) => validateBoolean(v, 'chatEnabled'),
  locked: (v) => validateBoolean(v, 'locked'),
};

const SETTING_LABELS = {
  controlMode: (v) => (v === 'host-only' ? 'Only the host can control playback' : 'Everyone can control playback'),
  chatEnabled: (v) => (v ? 'Chat enabled' : 'Chat disabled by the host'),
  locked: (v) => (v ? 'Room locked: no new joins' : 'Room unlocked'),
};

export function registerHostHandlers(socket) {
  /** Partial update: { controlMode?, chatEnabled?, locked? } */
  handle(socket, 'room:settings', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (!m.isHost) return HOST_ONLY;
    const updates = {};
    for (const [key, value] of Object.entries(payload)) {
      const validator = SETTING_VALIDATORS[key];
      if (!validator) return { ok: false, error: `Unknown setting "${key}"` };
      const res = validator(value);
      if (!res.ok) return res;
      updates[key] = res.value;
    }
    if (!Object.keys(updates).length) return { ok: false, error: 'No settings given' };
    return runInRoom(m.room, (room) => {
      for (const [key, value] of Object.entries(updates)) {
        if (room.settings[key] === value) continue;
        room.settings[key] = value;
        systemMessage(room, SETTING_LABELS[key](value));
      }
      emitToRoom(room, 'room:settings', { ...room.settings });
      return { ok: true, settings: { ...room.settings } };
    });
  });

  handle(socket, 'host:transfer', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (!m.isHost) return HOST_ONLY;
    const to = validateUserId(payload.toUserId);
    if (!to.ok) return to;
    const target = m.room.users.get(to.value);
    if (!target) return { ok: false, error: 'That user is not in the room' };
    if (!target.connected) return { ok: false, error: 'That user is offline' };
    if (target.userId === m.user.userId) return { ok: false, error: 'You are already the host' };
    return runInRoom(m.room, (room) => {
      setHost(room, target.userId, { reason: 'transfer' });
      return { ok: true };
    });
  });

  handle(socket, 'user:kick', (payload) => {
    const m = membership(socket);
    if (!m) return NOT_IN_ROOM;
    if (!m.isHost) return HOST_ONLY;
    const target = validateUserId(payload.userId);
    if (!target.ok) return target;
    if (target.value === m.user.userId) return { ok: false, error: 'You cannot kick yourself' };
    const user = m.room.users.get(target.value);
    if (!user) return { ok: false, error: 'That user is not in the room' };
    return runInRoom(m.room, (room) => {
      room.bans.set(user.userId, Date.now() + config.KICK_BAN_MS);
      const s = user.socketId && socketById(user.socketId);
      if (s) {
        s.emit('kicked', { code: room.code, by: m.user.name, banMinutes: Math.round(config.KICK_BAN_MS / 60000) });
        s.leave(room.code);
        s.data.roomCode = null;
      }
      removeUserFully(room, user.userId, { announce: 'was removed by the host' });
      return { ok: true };
    });
  });
}
