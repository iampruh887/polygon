import { useMemo } from 'react';
import { ReactFlow, Background, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { AtlasNode } from './types';

interface Props {
  nodes: AtlasNode[];
  onSelect: (norm: string) => void;
}

function AtlasPursuitNode({ data }: NodeProps) {
  const d = data as { label: string; members: number; active: boolean; scale: number };
  return (
    <div
      className={`atlas-node ${d.active ? 'pulse' : ''}`}
      style={{ fontSize: `${13 + d.scale * 9}px`, padding: `${8 + d.scale * 10}px ${14 + d.scale * 14}px` }}
    >
      {d.label}
      <span className="atlas-node-sub">
        {d.members} {d.members === 1 ? 'polymath' : 'polymaths'}
      </span>
    </div>
  );
}

const nodeTypes = { atlasPursuit: AtlasPursuitNode };

// Phyllotaxis layout: golden-angle spiral, most active pursuits at the center.
// Deterministic, dependency-free, organic-looking — and it reads as one world,
// not a chart. Re-evaluate with d3-force only if this stops reading well.
const GOLDEN_ANGLE = 2.399963229728653;

function layout(atlas: AtlasNode[]): Node[] {
  const maxMembers = Math.max(1, ...atlas.map((n) => n.member_count));
  return atlas.map((n, i): Node => {
    const r = 130 * Math.sqrt(i + 0.4);
    const theta = i * GOLDEN_ANGLE;
    return {
      id: n.norm,
      type: 'atlasPursuit',
      position: { x: r * Math.cos(theta), y: r * Math.sin(theta) },
      data: {
        label: n.display_name,
        members: n.member_count,
        active: n.active24h > 0,
        scale: n.member_count / maxMembers,
      },
    };
  });
}

export default function AtlasGraph({ nodes, onSelect }: Props) {
  const rfNodes = useMemo(() => layout(nodes), [nodes]);
  return (
    <ReactFlow
      nodes={rfNodes}
      edges={[]}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
      zoomOnDoubleClick={false}
      nodesDraggable={false}
      nodesConnectable={false}
      onNodeClick={(_e, node) => onSelect(node.id)}
      proOptions={{ hideAttribution: false }}
    >
      <Background color="#c9bda9" gap={28} />
    </ReactFlow>
  );
}
