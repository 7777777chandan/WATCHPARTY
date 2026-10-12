import { io } from 'socket.io-client';

/**
 * Server URL resolution:
 * 1. VITE_SERVER_URL if it points somewhere other than localhost, or the page itself is on localhost.
 * 2. Otherwise the same hostname the page was loaded from, on port 3001, so opening
 *    http://<LAN-IP>:5173 from a phone talks to http://<LAN-IP>:3001 with no env edits.
 */
function resolveServerUrl() {
  const envUrl = import.meta.env.VITE_SERVER_URL;
  const host = window.location.hostname;
  const pageIsLocal = host === 'localhost' || host === '127.0.0.1';
  if (envUrl) {
    const envIsLocal = /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(envUrl);
    if (!envIsLocal || pageIsLocal) return envUrl;
  }
  return `${window.location.protocol}//${host}:3001`;
}

export const SERVER_URL = resolveServerUrl();

export const socket = io(SERVER_URL, { autoConnect: false });
