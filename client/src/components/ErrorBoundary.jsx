import { Component } from 'react';

/** Keeps one broken component from white-screening the app. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', this.props.name || 'app', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.compact) {
      return (
        <div className="empty error-state" role="alert">
          <p>This panel crashed: {String(this.state.error.message || this.state.error)}</p>
          <button type="button" className="btn btn-small" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return (
      <main className="center-card" role="alert">
        <h1>Something went wrong</h1>
        <p className="muted">{String(this.state.error.message || this.state.error)}</p>
        <div className="option-row">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
          <a className="btn" href="/">Home</a>
        </div>
      </main>
    );
  }
}
