import { Link } from 'react-router-dom';

/** Full-page card for "room not found", "kicked", "replaced", errors. */
export default function StatusScreen({ emoji, title, children, actions }) {
  return (
    <main className="center-card">
      <span className="big-emoji" aria-hidden="true">{emoji}</span>
      <h1>{title}</h1>
      <div className="muted">{children}</div>
      <div className="option-row center">
        {actions}
        <Link className="btn" to="/">Back home</Link>
      </div>
    </main>
  );
}
