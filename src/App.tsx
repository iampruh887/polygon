import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { AppState, ScanStatus } from './types';
import Home from './components/Home';
import Pursuits from './components/Pursuits';
import ArtifactEditor from './components/ArtifactEditor';
import Connections from './components/Connections';
import GraphView from './components/GraphView';

export type View = 'home' | 'pursuits' | 'artifacts' | 'connections' | 'map';

// Double-clicks on anything interactive must never trigger the collapse-to-home
// gesture — text selection, form fiddling and graph dragging all live here.
const INTERACTIVE =
  'input, textarea, select, button, a, label, [contenteditable], .react-flow__node, .react-flow__edge, .react-flow__controls, .edge-detail, .menu-sheet';

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<View>('home');
  const [collapsing, setCollapsing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    return () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    };
  }, [refresh]);

  const goHome = useCallback(() => {
    if (collapseTimer.current) return; // collapse already in flight
    setMenuOpen(false);
    setCollapsing(true);
    collapseTimer.current = setTimeout(() => {
      setView('home');
      setCollapsing(false);
      collapseTimer.current = null;
    }, 340);
  }, []);

  const navigate = useCallback((v: View) => {
    setMenuOpen(false);
    setView(v);
  }, []);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (view === 'home') return;
      const target = e.target as HTMLElement;
      if (target.closest(INTERACTIVE)) return;
      goHome();
    },
    [view, goHome],
  );

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

  const PAGE_TITLES: Record<View, string> = {
    home: '',
    pursuits: 'Pursuits',
    artifacts: 'Artifacts',
    connections: 'Connections',
    map: 'Map',
  };

  return (
    <div className="app" onDoubleClick={onDoubleClick}>
      {view !== 'home' && (
        <header className="masthead slim">
          <button className="wordmark-btn" onClick={goHome} title="Home (or double-click anywhere)">
            <span className="mark">⬡</span>
            <span className="wordmark-text">POLYGON</span>
          </button>
          <span className="page-title">{PAGE_TITLES[view]}</span>
          <span className="dblclick-hint">double-click empty space to fold home</span>
        </header>
      )}

      <button className="hamburger" title="Menu" onClick={() => setMenuOpen((o) => !o)}>
        ☰
      </button>
      {menuOpen && (
        <nav className="menu-sheet">
          {(['home', 'pursuits', 'artifacts', 'connections', 'map'] as View[]).map((v) => (
            <button
              key={v}
              className={`menu-item ${view === v ? 'active' : ''}`}
              onClick={() => navigate(v)}
            >
              {v === 'home' ? '⬡ home' : v}
            </button>
          ))}
        </nav>
      )}

      {loadError && (
        <div className="notice" style={{ margin: 16 }}>
          {loadError} — is the server running? (npm run dev)
        </div>
      )}

      {state && (
        <div key={view} className={`page-wrap ${collapsing ? 'collapsing' : ''}`}>
          {view === 'home' && <Home state={state} navigate={navigate} />}
          {view === 'pursuits' && <Pursuits state={state} refresh={refresh} />}
          {view === 'artifacts' && <ArtifactEditor state={state} refresh={refresh} />}
          {view === 'connections' && (
            <Connections state={state} refresh={refresh} runScan={runScan} scanStatus={scanStatus} scanError={scanError} />
          )}
          {view === 'map' && <GraphView state={state} />}
        </div>
      )}
    </div>
  );
}
