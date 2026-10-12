/** Accessible tab list with unread badges. */
export default function Tabs({ tabs, active, onChange }) {
  const onKey = (e, i) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label="Room panels">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          aria-controls={`panel-${t.id}`}
          tabIndex={active === t.id ? 0 : -1}
          className={`tab ${active === t.id ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
          {t.badge > 0 && <span className="tab-badge" aria-label={`${t.badge} unread`}>{t.badge > 99 ? '99+' : t.badge}</span>}
        </button>
      ))}
    </div>
  );
}
