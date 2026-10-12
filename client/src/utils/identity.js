/**
 * Persistent identity. The userId lives in localStorage so a refresh (or reconnect) maps
 * back to the same member. A tab can opt into its own identity ("join as someone else"),
 * stored in sessionStorage, which is how you test two users in one browser profile.
 */
const ID_KEY = 'wp.userId';
const TAB_ID_KEY = 'wp.tabUserId';
const NAME_KEY = 'wp.name';

const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

const randomId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  return 'u_' + [...bytes].map((b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'[b % 64]).join('');
};

let memoryId = null;

export function getUserId() {
  const tab = safe(() => sessionStorage.getItem(TAB_ID_KEY));
  if (tab) return tab;
  let id = safe(() => localStorage.getItem(ID_KEY));
  if (!id) {
    id = memoryId || randomId();
    memoryId = id;
    safe(() => localStorage.setItem(ID_KEY, id));
  }
  return id;
}

/** Gives this tab a separate identity (kept across refreshes of this tab only). */
export function createTabIdentity() {
  const id = randomId();
  safe(() => sessionStorage.setItem(TAB_ID_KEY, id));
  return id;
}

export const getSavedName = () => safe(() => localStorage.getItem(NAME_KEY), '') || '';
export const saveName = (name) => safe(() => localStorage.setItem(NAME_KEY, name));
