export const KNOWLEDGE_GRAPH_MAX_NODES = 50;
export const KNOWLEDGE_GRAPH_MAX_EDGES = 100;

export interface KnowledgeGraphNode {
  id: string;
  [key: string]: unknown;
}

export interface KnowledgeGraphEdge {
  id?: string;
  source: string;
  target: string;
  [key: string]: unknown;
}

export interface PositionedKnowledgeGraphNode extends KnowledgeGraphNode {
  position: { x: number; y: number };
}

export function layoutKnowledgeGraph<
  Node extends KnowledgeGraphNode,
  Edge extends KnowledgeGraphEdge,
>(nodes: Node[], edges: Edge[]): { nodes: (Node & PositionedKnowledgeGraphNode)[]; edges: Edge[] } {
  const selectedNodes = [...nodes]
    .sort((first, second) => first.id.localeCompare(second.id))
    .slice(0, KNOWLEDGE_GRAPH_MAX_NODES);
  const nodeIds = new Set(selectedNodes.map((node) => node.id));
  const selectedEdges = edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .slice(0, KNOWLEDGE_GRAPH_MAX_EDGES);

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const positioned = selectedNodes.map((node, index) => {
    const radius = index === 0 ? 0 : 90 * Math.sqrt(index);
    return {
      ...node,
      position: {
        x: Math.round(Math.cos(index * goldenAngle) * radius),
        y: Math.round(Math.sin(index * goldenAngle) * radius),
      },
    };
  });
  return { nodes: positioned, edges: selectedEdges };
}

export const capAndLayoutKnowledgeGraph = layoutKnowledgeGraph;
