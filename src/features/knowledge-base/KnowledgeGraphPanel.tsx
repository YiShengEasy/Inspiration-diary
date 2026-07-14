import { useMemo, useState } from "react";
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { layoutKnowledgeGraph } from "./graphLayout";
import type { KnowledgeGraphResponse, KnowledgeRelationType } from "./types";

const RELATION_LABELS: Record<KnowledgeRelationType, string> = {
  mentions: "提及",
  related: "相关",
  references: "引用",
  derived_from: "衍生",
  belongs_to: "归属",
  contrasts: "对照",
  supports: "支持",
};

const KIND_COLORS: Record<string, string> = {
  image: "#e8b1c4",
  md: "#d8c2aa",
  combo: "#cbb6d7",
  video: "#abc3d3",
  book: "#afd0b5",
  concept: "#f0cf87",
};

export default function KnowledgeGraphPanel({
  graph,
  depth,
  onDepthChange,
  onSelectNode,
}: {
  graph: KnowledgeGraphResponse;
  depth: 1 | 2;
  onDepthChange(depth: 1 | 2): void;
  onSelectNode(nodeId: string): void;
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const flow = useMemo(() => {
    const visibleGraphNodes = graph.nodes.filter((node) => node.distance <= depth);
    const visibleIds = new Set(visibleGraphNodes.map((node) => node.id));
    const visibleEdges = graph.edges.filter((edge) =>
      visibleIds.has(edge.sourceNodeId) && visibleIds.has(edge.targetNodeId) && (showSuggestions || !edge.suggested));
    const laidOut = layoutKnowledgeGraph(
      visibleGraphNodes,
      visibleEdges.map((edge) => ({ ...edge, source: edge.sourceNodeId, target: edge.targetNodeId })),
    );
    const nodes: Node[] = laidOut.nodes.map((node) => {
      const sourceNode = visibleGraphNodes.find((item) => item.id === node.id);
      const contentType = sourceNode?.contentType ?? sourceNode?.entityType ?? "concept";
      return {
        id: node.id,
        position: node.position,
        data: { label: node.title },
        style: {
          width: node.distance === 0 ? 150 : 135,
          borderRadius: 14,
          border: node.distance === 0 ? "2px solid #8f5c34" : "1px solid rgba(45,35,25,.18)",
          background: node.distance === 0 ? "#302820" : KIND_COLORS[contentType] ?? "#f7f1e9",
          color: node.distance === 0 ? "#fff" : "#302820",
          opacity: node.distance === 2 ? 0.7 : 1,
          fontSize: 12,
          padding: 9,
          boxShadow: node.distance === 0 ? "0 10px 25px rgba(48,40,32,.22)" : "none",
        },
      };
    });
    const edges: Edge[] = laidOut.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      label: RELATION_LABELS[edge.relationType],
      animated: edge.suggested,
      style: { stroke: edge.suggested ? "#c18455" : "#8f8175", strokeDasharray: edge.suggested ? "6 5" : undefined },
      labelStyle: { fill: "#6c5f54", fontSize: 10 },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    }));
    return { nodes, edges };
  }, [depth, graph, showSuggestions]);

  return (
    <div className="flex h-full min-h-[420px] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <strong className="mr-auto text-sm">中心辐射图</strong>
        <button type="button" onClick={() => onDepthChange(1)} className={`rounded-full px-3 py-1 text-xs ${depth === 1 ? "bg-[#302820] text-white" : "border border-current/15"}`}>1 层</button>
        <button type="button" onClick={() => onDepthChange(2)} className={`rounded-full px-3 py-1 text-xs ${depth === 2 ? "bg-[#302820] text-white" : "border border-current/15"}`}>2 层</button>
        <label className="flex items-center gap-1.5 text-xs opacity-70"><input type="checkbox" checked={showSuggestions} onChange={(event) => setShowSuggestions(event.target.checked)} />显示候选</label>
      </div>
      <div className="min-h-0 flex-1 bg-[#fbf8f3] dark:bg-[#211b17]">
        <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView minZoom={0.25} maxZoom={1.8} onNodeClick={(_, node) => onSelectNode(node.id)}>
          <Background gap={24} size={1} color="#d8cec4" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {graph.truncated && <p className="border-t border-black/10 px-4 py-2 text-xs opacity-55 dark:border-white/10">图谱已达到当前视图上限，只显示最相关的 50 个节点和 100 条关系。</p>}
    </div>
  );
}
