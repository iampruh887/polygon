import { useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import dagre from 'dagre';
import '@xyflow/react/dist/style.css';
import type { AppState, Connection } from '../types';

interface Props {
  state: AppState;
}

const NODE_W = 200;
const NODE_H = 64;

const hiddenHandle = { opacity: 0, width: 1, height: 1, minWidth: 1, minHeight: 1, border: 'none' };

function PursuitNode({ data }: NodeProps) {
  return (
    <div className="node-pursuit">
      {String((data as { label: string }).label)}
      <Handle type="source" position={Position.Bottom} style={hiddenHandle} />
    </div>
  );
}

function ArtifactNode({ data }: NodeProps) {
  const d = data as { label: string; kind: string };
  return (
    <div className="node-artifact">
      <div className="kind-dot">{d.kind}</div>
      {d.label}
      <Handle type="target" position={Position.Top} style={hiddenHandle} />
      {/* Bridge edges run artifact-to-artifact, so artifacts need a source too. */}
      <Handle type="source" position={Position.Bottom} id="bridge" style={hiddenHandle} />
    </div>
  );
}

const nodeTypes = { pursuit: PursuitNode, artifact: ArtifactNode };

// dagre computes a top-down layout from pursuits to their artifacts; bridge
// edges (connections) are drawn on top of that structure rather than
// influencing it, so the map stays readable as cross-links accumulate.
function layout(state: AppState): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const p of state.pursuits) {
    g.setNode(`p${p.id}`, { width: NODE_W, height: NODE_H });
  }
  for (const a of state.artifacts) {
    g.setNode(`a${a.id}`, { width: NODE_W, height: NODE_H });
    g.setEdge(`p${a.pursuit_id}`, `a${a.id}`);
  }
  dagre.layout(g);

  const nodes: Node[] = [
    ...state.pursuits.map((p): Node => {
      const pos = g.node(`p${p.id}`);
      return {
        id: `p${p.id}`,
        type: 'pursuit',
        position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
        data: { label: p.name },
      };
    }),
    ...state.artifacts.map((a): Node => {
      const pos = g.node(`a${a.id}`);
      return {
        id: `a${a.id}`,
        type: 'artifact',
        position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
        data: { label: a.title, kind: a.kind },
      };
    }),
  ];

  const edges: Edge[] = [
    ...state.artifacts.map(
      (a): Edge => ({
        id: `pa${a.id}`,
        source: `p${a.pursuit_id}`,
        target: `a${a.id}`,
        style: { stroke: '#c9bda9' },
      }),
    ),
    ...state.connections.map(
      (c): Edge => ({
        id: `c${c.id}`,
        source: `a${c.artifact_a_id}`,
        sourceHandle: 'bridge',
        target: `a${c.artifact_b_id}`,
        animated: true,
        style: { stroke: '#a4161a', strokeWidth: 2, strokeDasharray: '6 4' },
        label: '⟷',
        labelStyle: { fill: '#a4161a', fontWeight: 700 },
        labelBgStyle: { fill: '#f7f3ec' },
      }),
    ),
  ];

  return { nodes, edges };
}

export default function GraphView({ state }: Props) {
  const { nodes, edges } = useMemo(() => layout(state), [state]);
  const [selected, setSelected] = useState<Connection | null>(null);

  const hasContent = state.pursuits.length > 0;

  return (
    <div className="graph-wrap">
      {!hasContent && (
        <div className="graph-empty">The map draws itself as you log. Start in the Ledger.</div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: false }}
        onEdgeClick={(_e, edge) => {
          if (edge.id.startsWith('c')) {
            const conn = state.connections.find((c) => `c${c.id}` === edge.id) ?? null;
            setSelected(conn);
          } else {
            setSelected(null);
          }
        }}
        onPaneClick={() => setSelected(null)}
        nodesDraggable
        nodesConnectable={false}
        edgesFocusable
      >
        <Background color="#c9bda9" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {selected && (
        <div className="edge-detail">
          <div className="endpoints" style={{ fontFamily: 'var(--serif)', fontWeight: 700 }}>
            {selected.a_title} <span style={{ color: 'var(--red)' }}>⟷</span> {selected.b_title}
          </div>
          <p className="explanation">{selected.explanation_text}</p>
        </div>
      )}
    </div>
  );
}
