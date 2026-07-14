export const KNOWLEDGE_GRAPH_MAX_NODES = 50;
export const KNOWLEDGE_GRAPH_MAX_EDGES = 100;

export interface KnowledgeGraphNode {
  id: string;
  title?: string;
  distance?: 0 | 1 | 2;
}

export interface KnowledgeGraphEdge {
  id?: string;
  source: string;
  target: string;
}

export interface PositionedKnowledgeGraphNode extends KnowledgeGraphNode {
  position: { x: number; y: number };
}

export function layoutKnowledgeGraph<
  Node extends KnowledgeGraphNode,
  Edge extends KnowledgeGraphEdge,
>(nodes: Node[], edges: Edge[]): { nodes: (Node & PositionedKnowledgeGraphNode)[]; edges: Edge[] } {
  const selectedNodes = [...nodes]
    .sort((first, second) =>
      (first.distance ?? 1) - (second.distance ?? 1) ||
      String(first.title ?? "").localeCompare(String(second.title ?? ""), "zh-CN") ||
      first.id.localeCompare(second.id))
    .slice(0, KNOWLEDGE_GRAPH_MAX_NODES);
  const nodeIds = new Set(selectedNodes.map((node) => node.id));
  const selectedEdges = edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .slice(0, KNOWLEDGE_GRAPH_MAX_EDGES);

  const rings = new Map<number, typeof selectedNodes>();
  for (const node of selectedNodes) {
    const distance = node.distance ?? (rings.size === 0 ? 0 : 1);
    const ring = rings.get(distance) ?? [];
    ring.push(node);
    rings.set(distance, ring);
  }
  const positioned = selectedNodes.map((node) => {
    const distance = node.distance ?? (node === selectedNodes[0] ? 0 : 1);
    const ring = rings.get(distance) ?? [node];
    const index = ring.indexOf(node);
    const radius = distance === 0 ? 0 : distance === 1 ? 190 : 330;
    const angle = ring.length === 1 ? -Math.PI / 2 : (index / ring.length) * Math.PI * 2 - Math.PI / 2;
    return {
      ...node,
      position: {
        x: Math.round(Math.cos(angle) * radius),
        y: Math.round(Math.sin(angle) * radius),
      },
    };
  });
  return { nodes: positioned, edges: selectedEdges };
}

export const capAndLayoutKnowledgeGraph = layoutKnowledgeGraph;
