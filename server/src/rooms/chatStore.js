import { config } from '../config.js';
import { newId } from '../utils/ids.js';
import { emitToRoom } from './notify.js';

/** Appends a message to the room history (bounded) and broadcasts it. */
export function pushChatMessage(room, message) {
  const msg = { id: newId(), ts: Date.now(), ...message };
  room.chat.push(msg);
  if (room.chat.length > config.CHAT_HISTORY) room.chat.splice(0, room.chat.length - config.CHAT_HISTORY);
  emitToRoom(room, 'chat:message', msg);
  return msg;
}

export function systemMessage(room, text, extra = {}) {
  return pushChatMessage(room, { type: 'system', userId: null, name: 'System', text, ...extra });
}
