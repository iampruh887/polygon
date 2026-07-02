import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { AppState, ScanStatus } from './types';
import Ledger from './components/Ledger';
import GraphView from './components/GraphView';

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<'ledger' | 'map'>('ledger');
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api.state());
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not reach the local server');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runScan = useCallback(async () => {
    setScanStatus('scanning');
    setScanError(null);
    const result = await api.scan();
    if (result.status === 'found' || result.status === 'none_found' || result.status === 'empty') {
      setScanStatus(result.status as ScanStatus);
    } else if (result.status === 'not_configured') {
      setScanStatus('not_configured');
      setScanError(result.error ?? null);
    } else {
      setScanStatus('failed');
      setScanError(result.error ?? 'Unknown error');
    }
    await refresh();
  }, [refresh]);

  return (
    <div className="app">
      <header className="masthead">
        <h1 className="wordmark">
          <span className="mark">⬡</span>POLYGON
        </h1>
        <span className="tagline">many sides, one mind</span>
        <nav>
          <button className={`tab ${view === 'ledger' ? 'active' : ''}`} onClick={() => setView('ledger')}>
            Ledger
          </button>
          <button className={`tab ${view === 'map' ? 'active' : ''}`} onClick={() => setView('map')}>
            Map
          </button>
        </nav>
      </header>

      {loadError && <div className="notice" style={{ margin: 16 }}>{loadError} — is the server running? (npm run dev)</div>}

      {state && view === 'ledger' && (
        <Ledger
          state={state}
          refresh={refresh}
          runScan={runScan}
          scanStatus={scanStatus}
          scanError={scanError}
        />
      )}
      {state && view === 'map' && <GraphView state={state} />}
    </div>
  );
}
