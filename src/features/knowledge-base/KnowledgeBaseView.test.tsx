import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getKnowledgeNode, listKnowledgeNodes } from "./api";
import KnowledgeBaseView from "./KnowledgeBaseView";
import type { KnowledgeNodeDetail, KnowledgeNodeSummary } from "./types";

vi.mock("./api", () => ({
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
  });

  it("loads the searchable list and a read-only detail", async () => {
    render(<KnowledgeBaseView />);

    expect(await screen.findByRole("button", { name: /知识卡片/u })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /知识卡片/u }));
    expect(await screen.findByText("# 知识正文")).toBeInTheDocument();
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
