import { useMemo, useState, type FormEvent } from 'react';
import { ReactFlow, Background, Handle, Position, type Node, type Edge, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from '../api';
import type { AppState } from '../types';

interface Props {
  state: AppState;
  refresh: () => Promise<void>;
}

const hidden = { opacity: 0, width: 1, height: 1, minWidth: 1, minHeight: 1, border: 'none' };

function PursuitCircleNode({ data }: NodeProps) {
  const d = data as { label: string; count: number };
  return (
    <div className="node-pursuit round">
      {d.label}
      <span className="node-sub">
        {d.count} artifact{d.count === 1 ? '' : 's'}
      </span>
      <Handle type="source" position={Position.Bottom} style={hidden} />
      <Handle type="target" position={Position.Top} style={hidden} />
    </div>
  );
}

const nodeTypes = { pursuitCircle: PursuitCircleNode };

// Pursuits arranged as the vertices of a regular polygon (of course), with
// edges weighted by how many artifact-level connections cross each pair.
function buildGraph(state: AppState, radius: number): { nodes: Node[]; edges: Edge[] } {
  const n = state.pursuits.length;
  const cx = 0;
  const cy = 0;
  const nodes: Node[] = state.pursuits.map((p, i): Node => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1);
    return {
      id: `p${p.id}`,
      type: 'pursuitCircle',
      position: { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) },
      data: { label: p.name, count: p.artifact_count },
    };
  });

  const artifactPursuit = new Map(state.artifacts.map((a) => [a.id, a.pursuit_id]));
  const linkCounts = new Map<string, number>();
  for (const c of state.connections) {
    const pa = artifactPursuit.get(c.artifact_a_id);
    const pb = artifactPursuit.get(c.artifact_b_id);
    if (pa === undefined || pb === undefined || pa === pb) continue;
    const key = pa < pb ? `${pa}:${pb}` : `${pb}:${pa}`;
    linkCounts.set(key, (linkCounts.get(key) ?? 0) + 1);
  }

  const edges: Edge[] = [...linkCounts.entries()].map(([key, count]): Edge => {
    const [a, b] = key.split(':');
    return {
      id: `pl${key}`,
      source: `p${a}`,
      target: `p${b}`,
      type: 'straight',
      label: `${count} link${count === 1 ? '' : 's'}`,
      animated: true,
      style: { stroke: '#a4161a', strokeWidth: Math.min(1.5 + count, 5), strokeDasharray: '6 4' },
      labelStyle: { fill: '#6e0e12', fontWeight: 700, fontSize: 11 },
      labelBgStyle: { fill: '#f7f3ec' },
    };
  });

  return { nodes, edges };
}

export default function Pursuits({ state, refresh }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  async function saveEdit(id: number, isPublic: boolean) {
    try {
      await api.updatePursuit(id, editName, editDesc, isPublic);
      setEditingId(null);
      setFormError(null);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save pursuit');
    }
  }

  async function togglePublic(id: number) {
    const p = state.pursuits.find((x) => x.id === id);
    if (!p) return;
    await api.updatePursuit(id, p.name, p.description, !p.is_public);
    await refresh();
  }

  const { nodes, edges } = useMemo(
    () => buildGraph(state, expanded ? 260 : 150),
    [state, expanded],
  );

  async function addPursuit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.createPursuit(name, desc);
      setName('');
      setDesc('');
      setFormError(null);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create pursuit');
    }
  }

  function daysSince(iso: string | null): number | null {
    if (!iso) return null;
    return Math.floor((Date.now() - new Date(iso + 'Z').getTime()) / 86_400_000);
  }

  return (
    <div className="page">
      <section>
        <div className={`pursuit-graph ${expanded ? 'expanded' : ''}`}>
          {state.pursuits.length === 0 ? (
            <div className="graph-empty">Your polygon has no vertices yet. Add the first pursuit below.</div>
          ) : (
            <ReactFlow
              key={expanded ? 'x' : 'c'}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.25 }}
              zoomOnDoubleClick={false}
              nodesConnectable={false}
              proOptions={{ hideAttribution: false }}
            >
              <Background color="#c9bda9" gap={24} />
            </ReactFlow>
          )}
          <button className="btn ghost expand-toggle" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '⌃ collapse' : '⌄ expand'}
          </button>
        </div>

        <form className="inline-form" onSubmit={addPursuit}>
          <input placeholder="New pursuit (e.g. Chess)" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            placeholder="What is it, briefly?"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn" type="submit" disabled={!name.trim()}>
            Add pursuit
          </button>
        </form>
        {formError && <div className="notice" style={{ marginTop: 10 }}>{formError}</div>}

        {/* Logged results live BELOW the entry bar, never above it. */}
        {state.pursuits.length > 0 && (
          <div className="pursuit-row" style={{ marginTop: 18 }}>
            {state.pursuits.map((p) => {
              const days = daysSince(p.last_artifact_at);
              const quiet = p.artifact_count > 0 && days !== null && days >= 7;
              if (p.id === editingId) {
                return (
                  <div className="pursuit-card editing" key={p.id}>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Pursuit name"
                      className="edit-field"
                    />
                    <input
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="What is it, briefly?"
                      className="edit-field"
                    />
                    <div className="edit-actions">
                      <button
                        className="btn primary"
                        disabled={!editName.trim()}
                        onClick={() => void saveEdit(p.id, Boolean(p.is_public))}
                      >
                        Save
                      </button>
                      <button className="btn" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div className="pursuit-card" key={p.id}>
                  <div className="card-actions">
                    <button
                      className="btn ghost"
                      title="Edit pursuit"
                      onClick={() => {
                        setEditingId(p.id);
                        setEditName(p.name);
                        setEditDesc(p.description);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="btn ghost"
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
                  </div>
                  <h3>{p.name}</h3>
                  {p.description && <p className="desc">{p.description}</p>}
                  <div className="meta">
                    {p.artifact_count} artifact{p.artifact_count === 1 ? '' : 's'}
                    <br />
                    <span className={quiet ? 'quiet' : ''}>
                      {p.artifact_count === 0
                        ? 'nothing logged yet'
                        : days === 0
                          ? 'active today'
                          : days === 1
                            ? 'active yesterday'
                            : days! < 7
                              ? `active ${days} days ago`
                              : `quiet for ${days} days — it misses you`}
                    </span>
                  </div>
                  <button
                    className={`visibility-toggle ${p.is_public ? 'public' : ''}`}
                    title={
                      p.is_public
                        ? 'Public — visible in the Commons. Click to make private.'
                        : 'Private — only you. Click to share in the Commons.'
                    }
                    onClick={() => void togglePublic(p.id)}
                  >
                    {p.is_public ? '◉ public' : '○ private'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
