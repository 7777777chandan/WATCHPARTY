const ID = /^[A-Za-z0-9_-]{11}$/;

/** Extracts the 11-char id from youtube.com/watch?v=, youtu.be/, /embed/, /shorts/ URLs or a bare id. */
export function parseYouTubeId(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (ID.test(s)) return s;
  let url;
  try {
    url = new URL(s.startsWith('http') ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/)?.[2] ?? null;
  }
  return id && ID.test(id) ? id : null;
}

export const formatTime = (sec) => {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
};
