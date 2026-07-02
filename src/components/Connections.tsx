import { api } from '../api';
import type { AppState, ScanStatus } from '../types';

interface Props {
  state: AppState;
  refresh: () => Promise<void>;
  runScan: () => Promise<void>;
  scanStatus: ScanStatus;
  scanError: string | null;
}

export default function Connections({ state, refresh, runScan, scanStatus, scanError }: Props) {
  const scanMessage: Record<ScanStatus, string | null> = {
    idle: null,
    scanning: 'Reading your artifacts…',
    found: 'New connections found — see below.',
    none_found: 'Scan complete. No new connections found this scan — that honesty is the point.',
    empty: 'Every pair has already been scanned. Log something new first.',
    failed: `Scan failed, try again. ${scanError ?? ''}`,
    not_configured: scanError ?? 'No LLM key configured.',
  };

  return (
    <div className="page narrow">
      <section>
        <div className="scan-box">
          <button
            className="btn primary"
            onClick={() => void runScan()}
            disabled={scanStatus === 'scanning' || state.unscanned_pair_count === 0}
          >
            {scanStatus === 'scanning'
              ? 'Scanning…'
              : `Scan for connections (${state.unscanned_pair_count} new pair${state.unscanned_pair_count === 1 ? '' : 's'})`}
          </button>
          {!state.llm_configured && (
            <p className="status error">
              No LLM key configured — add your OpenAI key from the menu before scanning.
            </p>
          )}
          {scanMessage[scanStatus] && (
            <p className={`status ${scanStatus === 'failed' || scanStatus === 'not_configured' ? 'error' : ''}`}>
              {scanMessage[scanStatus]}
            </p>
          )}
        </div>

        {state.connections.length === 0 ? (
          <p className="empty">
            Log artifacts from at least two pursuits, then scan. Polygon only reports links that
            reference specifics from both sides — silence beats platitudes.
          </p>
        ) : (
          state.connections.map((c) => (
            <div className="connection-card" key={c.id}>
              <button
                className="btn ghost delete"
                title="Dismiss connection"
                onClick={async () => {
                  await api.deleteConnection(c.id);
                  await refresh();
                }}
              >
                ×
              </button>
              <div className="endpoints">
                <span>{c.a_title}</span>
                <span className="pursuit-tag">{c.a_pursuit}</span>
                <span className="link-mark">⟷</span>
                <span>{c.b_title}</span>
                <span className="pursuit-tag">{c.b_pursuit}</span>
              </div>
              <p className="explanation">{c.explanation_text}</p>
              <div className="when">{new Date(c.created_at + 'Z').toLocaleString()}</div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
