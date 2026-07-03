import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react';
import { api } from './api';
import type { AppState, ScanStatus } from './types';
import Home from './components/Home';
import Pursuits from './components/Pursuits';
import ArtifactEditor from './components/ArtifactEditor';
import Connections from './components/Connections';
import Commons from './components/Commons';
import GraphView from './components/GraphView';
import WelcomeGuide from './components/WelcomeGuide';
import OpenAiKeySettings from './components/OpenAiKeySettings';
import FeedbackButton from './components/FeedbackButton';

// The social module ships as its own chunk — the core app never loads Atlas
// code unless the Discover vertex is visited.
const Discover = lazy(() => import('./social/Discover'));

export type View = 'home' | 'pursuits' | 'artifacts' | 'connections' | 'commons' | 'map' | 'discover';

// Double-clicks on anything interactive must never trigger the collapse-to-home
// gesture — text selection, form fiddling and graph dragging all live here.
const INTERACTIVE =
  'input, textarea, select, button, a, label, [contenteditable], .react-flow__node, .react-flow__edge, .react-flow__controls, .edge-detail, .menu-sheet';

interface Props {
  clerkEnabled: boolean;
}

function PolygonApp({ clerkEnabled }: Props) {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<View>('home');
  const [collapsing, setCollapsing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [transferNote, setTransferNote] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('polygon-theme') === 'dark' ? 'dark' : 'light'),
  );
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('polygon-theme', theme);
  }, [theme]);

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

  const onImportPicked = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const sure = confirm(
        `Import "${file.name}"? This REPLACES all of your current pursuits, artifacts, and connections with the file's contents.`,
      );
      if (!sure) return;
      try {
        const r = await api.importJson(file);
        setTransferNote(
          `Imported ${r.pursuits} pursuit(s), ${r.artifacts} artifact(s), ${r.connections} connection(s).`,
        );
        await refresh();
      } catch (e) {
        setTransferNote(e instanceof Error ? e.message : 'Import failed');
      }
      setMenuOpen(false);
    },
    [refresh],
  );

  const PAGE_TITLES: Record<View, string> = {
    home: '',
    pursuits: 'Pursuits',
    artifacts: 'Artifacts',
    connections: 'Connections',
    commons: 'Commons',
    map: 'Map',
    discover: 'Discover — The Atlas',
  };

  return (
    <div className="app" onDoubleClick={onDoubleClick}>
      {view !== 'home' && (
        <header className="masthead slim">
          <button className="wordmark-btn" onClick={goHome} title="Home — or double-click any empty space">
            <span className="mark">⬡</span>
            <span className="wordmark-text">POLYGON</span>
          </button>
          <span className="page-title">{PAGE_TITLES[view]}</span>
        </header>
      )}

      <div className="top-actions">
        {clerkEnabled && <UserButton />}
        <button
          className="hamburger"
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <button className="hamburger" title="Menu" onClick={() => setMenuOpen((o) => !o)}>
          ☰
        </button>
      </div>
      {menuOpen && (
        <nav className="menu-sheet">
          {(['home', 'pursuits', 'artifacts', 'connections', 'commons', 'map', 'discover'] as View[]).map((v) => (
            <button
              key={v}
              className={`menu-item ${view === v ? 'active' : ''}`}
              onClick={() => navigate(v)}
            >
              {v === 'home' ? '⬡ home' : v}
            </button>
          ))}
          <div className="menu-rule" />
          <a className="menu-item" href="/api/export" onClick={() => setMenuOpen(false)}>
            ⬇ export .json
          </a>
          <button className="menu-item" onClick={() => importInput.current?.click()}>
            ⬆ import .json
          </button>
          {state && (
            <>
              <div className="menu-rule" />
              <OpenAiKeySettings
                configured={state.openai_api_key_configured}
                serverConfigured={state.server_llm_configured}
                refresh={refresh}
              />
            </>
          )}
        </nav>
      )}
      <input
        ref={importInput}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          void onImportPicked(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {loadError && (
        <div className="notice" style={{ margin: 16 }}>
          {loadError} — is the server running? (npm run dev)
        </div>
      )}
      {transferNote && (
        <div className="notice" style={{ margin: 16 }}>
          {transferNote}{' '}
          <button className="btn ghost" onClick={() => setTransferNote(null)}>
            ×
          </button>
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
          {view === 'commons' && <Commons state={state} />}
          {view === 'map' && <GraphView state={state} />}
          {view === 'discover' && (
            <Suspense fallback={<div className="graph-empty">Unrolling the Atlas…</div>}>
              <Discover state={state} />
            </Suspense>
          )}
        </div>
      )}
      {state && <WelcomeGuide state={state} view={view} navigate={navigate} />}
      {state && <FeedbackButton />}
    </div>
  );
}

export default function App({ clerkEnabled }: Props) {
  if (!clerkEnabled) return <PolygonApp clerkEnabled={false} />;
  return (
    <>
      <SignedOut>
        <div className="landing">
          <svg viewBox="-8 -8 416 362" className="hex-svg landing-hex">
            <polygon points="100,0 300,0 400,173 300,346 100,346 0,173" className="hex-shape" />
          </svg>
          <div className="landing-inner">
            <div className="hex-wordmark">POLYGON</div>
            <div className="hex-tagline">many sides, one mind</div>
            <SignInButton mode="modal">
              <button className="btn primary" style={{ marginTop: 22 }}>
                Sign in to enter
              </button>
            </SignInButton>
          </div>
        </div>
      </SignedOut>
      <SignedIn>
        <PolygonApp clerkEnabled />
      </SignedIn>
    </>
  );
}
