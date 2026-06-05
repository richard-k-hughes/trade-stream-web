import { Component, ErrorInfo, ReactNode, useEffect, useState } from 'react';

const dbName = 'tradingDecisionFlowJournal';

type ErrorBoundaryState = {
  error?: Error;
};

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Application render error', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return <RuntimeErrorScreen error={this.state.error} />;
    }

    return this.props.children;
  }
}

export function RuntimeErrorWatcher({ children }: { children: ReactNode }) {
  const [error, setError] = useState<Error>();

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      setError(event.error instanceof Error ? event.error : new Error(event.message));
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      setError(reason instanceof Error ? reason : new Error(String(reason)));
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  if (error) return <RuntimeErrorScreen error={error} />;
  return children;
}

function RuntimeErrorScreen({ error }: { error: Error }) {
  const resetLocalData = () => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => window.location.assign('/');
    request.onerror = () => window.location.reload();
    request.onblocked = () => window.location.reload();
  };

  return (
    <main className="page-shell">
      <section className="empty-state error-state">
        <h1>Unable to load the journal</h1>
        <p>
          The app loaded, but local browser data or a runtime exception stopped the interface from rendering.
        </p>
        <pre>{error.message}</pre>
        <div className="inline-actions">
          <button className="button primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button className="button danger" onClick={resetLocalData}>
            Reset Local Journal Data
          </button>
        </div>
      </section>
    </main>
  );
}
