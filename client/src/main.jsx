import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tokens.css';
import './styles/app.css';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';

try {
  document.documentElement.dataset.theme = localStorage.getItem('wp.theme') || 'dark';
} catch {
  document.documentElement.dataset.theme = 'dark';
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <SocketProvider>
            <App />
          </SocketProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
