import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { AppState, ArtifactKind, ScanStatus } from '../types';

interface Props {
  state: AppState;
  refresh: () => Promise<void>;
  runScan: () => Promise<void>;
  scanStatus: ScanStatus;
  scanError: string | null;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso + 'Z').getTime();
  return Math.floor((Date.now() - then) / 86_400_000);
}

// Momentum, not streaks: a pursuit that has been quiet gets a gentle nudge
// framed as an invitation. Nothing resets, nothing turns red-with-shame.
function momentumLabel(count: number, lastAt: string | null): { text: string; quiet: boolean } {
  if (count === 0) return { text: 'nothing logged yet', quiet: false };
  const days = daysSince(lastAt)!;
  if (days === 0) return { text: 'active today', quiet: false };
  if (days === 1) return { text: 'active yesterday', quiet: false };
  if (days < 7) return { text: `active ${days} days ago`, quiet: false };
  return { text: `quiet for ${days} days — it misses you`, quiet: true };
}

const KINDS: ArtifactKind[] = ['note', 'code', 'image', 'puzzle'];

export default function Ledger({ state, refresh, runScan, scanStatus, scanError }: Props) {
  const [pursuitName, setPursuitName] = useState('');
  const [pursuitDesc, setPursuitDesc] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [artPursuit, setArtPursuit] = useState<number | ''>('');
  const [artKind, setArtKind] = useState<ArtifactKind>('note');
  const [artTitle, setArtTitle] = useState('');
  const [artContent, setArtContent] = useState('');

  async function addPursuit(e: FormEvent) {
    e.preventDefault();
    if (!pursuitName.trim()) return;
    try {
      await api.createPursuit(pursuitName, pursuitDesc);
      setPursuitName('');
      setPursuitDesc('');
      setFormError(null);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create pursuit');
    }
  }

  async function addArtifact(e: FormEvent) {
    e.preventDefault();
    if (artPursuit === '' || !artTitle.trim()) return;
    try {
      await api.createArtifact(artPursuit, artKind, artTitle, artContent);
      setArtTitle('');
      setArtContent('');
      setFormError(null);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not log artifact');
    }
  }

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
    <div className="ledger">
      <main className="ledger-main">
        <section>
          <h2>
            Pursuits <span className="count">{state.pursuits.length}</span>
          </h2>
          <hr className="section-rule" />
          {state.pursuits.length === 0 && (
            <p className="empty">A polymath needs at least two. Name your first pursuit below.</p>
          )}
          <div className="pursuit-row">
            {state.pursuits.map((p) => {
              const m = momentumLabel(p.artifact_count, p.last_artifact_at);
              return (
                <div className="pursuit-card" key={p.id}>
                  <button
                    className="btn ghost delete"
                    title="Delete pursuit and its artifacts"
                    onClick={async () => {
                      if (confirm(`Delete "${p.name}" and its ${p.artifact_count} artifact(s)?`)) {
                        await api.deletePursuit(p.id);
                        await refresh();
                      }
                    }}
                  >
                    ×
                  </button>
                  <h3>{p.name}</h3>
                  {p.description && <p className="desc">{p.description}</p>}
                  <div className="meta">
                    {p.artifact_count} artifact{p.artifact_count === 1 ? '' : 's'}
                    <br />
                    <span className={m.quiet ? 'quiet' : ''}>{m.text}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <form className="inline-form" onSubmit={addPursuit}>
            <input
              placeholder="New pursuit (e.g. Chess)"
              value={pursuitName}
              onChange={(e) => setPursuitName(e.target.value)}
            />
            <input
              placeholder="What is it, briefly?"
              value={pursuitDesc}
              onChange={(e) => setPursuitDesc(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn" type="submit" disabled={!pursuitName.trim()}>
              Add pursuit
            </button>
          </form>
        </section>

        <section>
          <h2>
            Artifacts <span className="count">{state.artifacts.length}</span>
          </h2>
          <hr className="section-rule" />
          <form className="inline-form" onSubmit={addArtifact}>
            <div className="form-row">
              <select
                value={artPursuit}
                onChange={(e) => setArtPursuit(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="">Pursuit…</option>
                {state.pursuits.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select value={artKind} onChange={(e) => setArtKind(e.target.value as ArtifactKind)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <input
                name="title"
                placeholder="What did you make or figure out?"
                value={artTitle}
                onChange={(e) => setArtTitle(e.target.value)}
              />
            </div>
            <textarea
              placeholder="The artifact itself — the note, the code, the insight, the position. Specifics feed the connection engine."
              value={artContent}
              onChange={(e) => setArtContent(e.target.value)}
            />
            <button className="btn primary" type="submit" disabled={artPursuit === '' || !artTitle.trim()}>
              Log artifact
            </button>
          </form>
          {formError && <div className="notice" style={{ marginTop: 10 }}>{formError}</div>}
          {state.artifacts.length === 0 ? (
            <p className="empty">Artifacts are what you actually made — not hours, not checkboxes.</p>
          ) : (
            state.artifacts.map((a) => (
              <div className="artifact-item" key={a.id}>
                <span className="kind">{a.kind}</span>
                <div className="body">
                  <div className="meta">
                    {a.pursuit_name} · {new Date(a.created_at + 'Z').toLocaleDateString()}
                  </div>
                  <h4>{a.title}</h4>
                  {a.content && (
                    <p className={`content ${a.kind === 'code' ? 'code' : ''}`}>{a.content}</p>
                  )}
                </div>
                <button
                  className="btn ghost delete"
                  title="Delete artifact (its connections go with it)"
                  onClick={async () => {
                    if (confirm(`Delete "${a.title}"? Its connections are removed too.`)) {
                      await api.deleteArtifact(a.id);
                      await refresh();
                    }
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </section>
      </main>

      <aside className="ledger-side">
        <section>
          <h2>Connections</h2>
          <hr className="section-rule" />
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
                No LLM key configured — copy .env.example to .env, add your key, restart the server.
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
      </aside>
    </div>
  );
}
