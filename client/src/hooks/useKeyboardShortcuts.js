import { useEffect, useRef } from 'react';

const isTyping = (el) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/** Global single-key shortcuts that never fire while the user is typing. */
export function useKeyboardShortcuts(map) {
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const fn = ref.current[key];
      if (!fn) return;
      // Space on a focused button should still click it.
      if (key === 'Space' && e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
