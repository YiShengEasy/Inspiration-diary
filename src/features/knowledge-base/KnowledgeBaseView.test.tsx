import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  acceptKnowledgeCandidate,
  createKnowledgeLink,
  dismissKnowledgeCandidate,
  getKnowledgeCandidates,
  getKnowledgeGraph,
  getKnowledgeNode,
  listKnowledgeNodes,
} from "./api";
import KnowledgeBaseView from "./KnowledgeBaseView";
import type { KnowledgeNodeDetail, KnowledgeNodeSummary } from "./types";

vi.mock("./api", () => ({
  acceptKnowledgeCandidate: vi.fn(),
  createKnowledgeLink: vi.fn(),
  dismissKnowledgeCandidate: vi.fn(),
  getKnowledgeCandidates: vi.fn(),
  getKnowledgeGraph: vi.fn(),
  getKnowledgeNode: vi.fn(),
  listKnowledgeNodes: vi.fn(),
}));

const node: KnowledgeNodeSummary = {
  id: "node-1",
  entityType: "card",
  entityId: "card-1",
  slug: "knowledge-card",
  title: "知识卡片",
  tags: ["知识", "图谱"],
  snippet: "卡片摘要",
  isActive: true,
  autoAdded: true,
  revision: 1,
  createdAt: 1,
  updatedAt: 2,
};

const detail: KnowledgeNodeDetail = {
  ...node,
  properties: { status: "draft" },
  markdown: "# 知识正文",
};

describe("KnowledgeBaseView checkpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listKnowledgeNodes).mockResolvedValue({ nodes: [node], total: 1, page: 1, pageSize: 20 });
    vi.mocked(getKnowledgeNode).mockResolvedValue({ node: detail });
    vi.mocked(getKnowledgeCandidates).mockResolvedValue({
      candidates: [{
        node: { ...node, id: "node-2", title: "关联知识" },
        score: 0.7,
        evidence: {
          sharedTags: ["知识"],
          sameBook: false,
          sharedPropertyRatio: 0,
          creationProximity: 1,
        },
      }],
    });
    vi.mocked(getKnowledgeGraph).mockResolvedValue({
      nodes: [
        { ...node, distance: 0 },
        { ...node, id: "node-2", title: "关联知识", distance: 1 },
      ],
      edges: [{
        id: "edge-1",
        sourceNodeId: "node-1",
        targetNodeId: "node-2",
        relationType: "related",
        origin: "tag_suggestion",
        suggested: true,
      }],
      truncated: false,
    });
    vi.mocked(acceptKnowledgeCandidate).mockResolvedValue({
      link: {
        id: "edge-1",
        sourceNodeId: "node-1",
        targetNodeId: "node-2",
        relationType: "related",
        origin: "tag_suggestion",
        context: null,
        createdAt: 1,
        updatedAt: 1,
      },
    });
    vi.mocked(dismissKnowledgeCandidate).mockResolvedValue({ dismissed: true });
    vi.mocked(createKnowledgeLink).mockResolvedValue({
      link: {
        id: "edge-2",
        sourceNodeId: "node-1",
        targetNodeId: "node-2",
        relationType: "supports",
        origin: "manual",
        context: null,
        createdAt: 1,
        updatedAt: 1,
      },
    });
  });

  it("loads the searchable list and a read-only detail", async () => {
    render(<KnowledgeBaseView />);

    expect(await screen.findByRole("button", { name: /知识卡片/u })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /知识卡片/u }));
    expect(await screen.findByText("# 知识正文")).toBeInTheDocument();
    expect((await screen.findAllByText("关联知识")).length).toBeGreaterThan(0);
    expect(getKnowledgeNode).toHaveBeenCalledWith("node-1", expect.any(AbortSignal));
  });

  it("debounces search input before reloading", async () => {
    render(<KnowledgeBaseView />);
    await screen.findByRole("button", { name: /知识卡片/u });

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索知识" }), { target: { value: "图谱" } });
    await waitFor(() => {
      expect(listKnowledgeNodes).toHaveBeenLastCalledWith(expect.objectContaining({ query: "图谱" }));
    });
  });
});
