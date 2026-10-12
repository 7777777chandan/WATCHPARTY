import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);
const MAX_TOASTS = 4;

/** Tiny toast system: push({ text, type, action?, duration? }). */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    ({ text, type = 'info', action = null, duration = 3500, key = null }) => {
      const id = key || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((t) => [...t.filter((x) => x.id !== id), { id, text, type, action }].slice(-MAX_TOASTS));
      clearTimeout(timers.current.get(id));
      timers.current.set(id, setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="btn btn-small"
                onClick={() => {
                  t.action.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  return useContext(ToastContext);
}
