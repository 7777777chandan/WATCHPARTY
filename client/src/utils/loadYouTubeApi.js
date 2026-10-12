let promise = null;

/** Loads https://www.youtube.com/iframe_api once and resolves with window.YT. */
export function loadYouTubeApi(timeoutMs = 15000) {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => {
      promise = null;
      reject(new Error('YouTube player could not be loaded (network or blocker?)'));
    }, timeoutMs);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      if (typeof previous === 'function') previous();
      resolve(window.YT);
    };
    if (!document.querySelector('script[data-yt-api]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.dataset.ytApi = 'true';
      s.onerror = () => {
        clearTimeout(timer);
        promise = null;
        s.remove();
        reject(new Error('YouTube player could not be loaded (network or blocker?)'));
      };
      document.head.appendChild(s);
    }
  });
  return promise;
}
