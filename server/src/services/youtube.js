import { config } from '../config.js';

const ID = /^[A-Za-z0-9_-]{11}$/;

/** Extracts an 11-char video id from watch?v=, youtu.be/, /embed/, /shorts/ URLs or a bare id. */
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
    else {
      const m = url.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/);
      if (m) id = m[2];
    }
  }
  return id && ID.test(id) ? id : null;
}

export const thumbnailFor = (videoId) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

/** Fetches the public oEmbed title. Resolves to null on any failure or after the timeout. */
export async function fetchOEmbed(videoId, timeoutMs = config.OEMBED_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data?.title !== 'string') return null;
    return { title: data.title.slice(0, 120), thumbnail: thumbnailFor(videoId) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
