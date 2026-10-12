import { useEffect, useState } from 'react';

const KEY = 'wp.theme';
const initialTheme = () => {
  try {
    return localStorage.getItem(KEY) || 'dark';
  } catch {
    return 'dark';
  }
};

/** Dark by default; light theme persisted in localStorage. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="btn btn-icon" onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
