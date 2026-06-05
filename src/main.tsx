import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary, RuntimeErrorWatcher } from './ErrorBoundary';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RuntimeErrorWatcher>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </RuntimeErrorWatcher>
    </ErrorBoundary>
  </React.StrictMode>,
);
