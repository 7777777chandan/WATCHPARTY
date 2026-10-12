import { io as ioClient } from 'socket.io-client';
import { createAppServer } from '../src/app.js';
import { _resetStore } from '../src/rooms/roomStore.js';

export async function startServer() {
  const app = createAppServer({ clientOrigin: '*' });
  await new Promise((r) => app.server.listen(0, r));
  const url = `http://localhost:${app.server.address().port}`;
  const clients = [];
  return {
    url,
    connect(opts = {}) {
      const s = ioClient(url, { transports: ['websocket'], reconnection: false, ...opts });
      clients.push(s);
      return new Promise((resolve, reject) => {
        s.once('connect', () => resolve(s));
        s.once('connect_error', reject);
      });
    },
    async stop() {
      for (const c of clients) c.disconnect();
      _resetStore();
      await app.close();
      await new Promise((r) => app.server.close(r));
    },
  };
}

export const emit = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

export const waitFor = (socket, event, predicate = () => true, timeoutMs = 2000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    function handler(data) {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    }
    socket.on(event, handler);
  });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let n = 0;
export const uid = () => `user_${Date.now().toString(36)}_${(n++).toString(36)}xx`;
