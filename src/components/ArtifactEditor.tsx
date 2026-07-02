import { useState } from 'react';
import { api } from '../api';
import type { AppState, ArtifactKind } from '../types';

interface Props {
  state: AppState;
  refresh: () => Promise<void>;
}

const KINDS: ArtifactKind[] = ['note', 'code', 'image', 'puzzle'];

// Obsidian-Polygon mix: a file-list rail on the left, a quiet full-height
// writing surface on the right. The editor is the page; chrome stays out of
// the way of the words.
export default function ArtifactEditor({ state, refresh }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pursuitId, setPursuitId] = useState<number | ''>('');
  const [kind, setKind] = useState<ArtifactKind>('note');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  function loadArtifact(id: number) {
    const a = state.artifacts.find((x) => x.id === id);
    if (!a) return;
    setSelectedId(a.id);
    setPursuitId(a.pursuit_id);
    setKind(a.kind);
    setTitle(a.title);
    setContent(a.content);
    setStatus(null);
    setDirty(false);
  }

  function startNew() {
    setSelectedId(null);
    setTitle('');
    setContent('');
    setStatus(null);
    setDirty(false);
    // keep pursuit + kind — logging several artifacts in a row usually stays
    // within the same pursuit, and re-picking every time is friction.
  }

  async function save() {
    if (pursuitId === '' || !title.trim()) return;
    try {
      if (selectedId === null) {
        const created = (await api.createArtifact(pursuitId, kind, title, content)) as { id: number };
        setSelectedId(created.id);
        setStatus('Logged.');
      } else {
        await api.updateArtifact(selectedId, kind, title, content);
        setStatus('Saved.');
      }
      setDirty(false);
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not save');
    }
  }

  const selected = selectedId !== null ? state.artifacts.find((a) => a.id === selectedId) : null;

  return (
    <div className="editor-layout">
      <aside className="editor-rail">
        <button className="btn primary" style={{ width: '100%' }} onClick={startNew}>
          + New artifact
        </button>
        <div className="rail-list">
          {state.artifacts.length === 0 && (
            <p className="empty">Nothing logged yet. The first artifact starts the map.</p>
          )}
          {state.artifacts.map((a) => (
            <div
              key={a.id}
              className={`rail-item ${a.id === selectedId ? 'active' : ''}`}
              onClick={() => loadArtifact(a.id)}
            >
              <div className="rail-title">{a.title}</div>
              <div className="rail-meta">
                {a.pursuit_name} · {a.kind} · {new Date(a.created_at + 'Z').toLocaleDateString()}
              </div>
              <button
                className="btn ghost delete"
                title="Delete artifact (its connections go with it)"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${a.title}"? Its connections are removed too.`)) {
                    await api.deleteArtifact(a.id);
                    if (a.id === selectedId) startNew();
                    await refresh();
                  }
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      <main className="editor-pane">
        <input
          className="editor-title"
          placeholder="What did you make or figure out?"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
        />
        <div className="editor-meta">
          <select
            value={pursuitId}
            onChange={(e) => {
              setPursuitId(e.target.value === '' ? '' : Number(e.target.value));
              setDirty(true);
            }}
          >
            <option value="">Pursuit…</option>
            {state.pursuits.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ArtifactKind);
              setDirty(true);
            }}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {selected && <span className="editor-when">logged {new Date(selected.created_at + 'Z').toLocaleString()}</span>}
          <span className="editor-status">{dirty ? 'unsaved' : status}</span>
          <button className="btn primary" onClick={() => void save()} disabled={pursuitId === '' || !title.trim()}>
            {selectedId === null ? 'Log artifact' : 'Save'}
          </button>
        </div>
        {state.pursuits.length === 0 && (
          <div className="notice" style={{ marginBottom: 12 }}>
            No pursuits yet — create one on the Pursuits page first.
          </div>
        )}
        <textarea
          className={`editor-body ${kind === 'code' ? 'code' : ''}`}
          placeholder="The artifact itself — the note, the code, the insight, the position. Specifics feed the connection engine."
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
              e.preventDefault();
              void save();
            }
          }}
        />
      </main>
    </div>
  );
}
