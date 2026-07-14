import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import express, { type Express } from "express";

import type { AuthenticatedRequest, AuthUser } from "../src/server/auth.ts";
import type { KnowledgeLink, KnowledgeNode } from "../src/server/knowledge/repository.ts";
import { createKnowledgeRouter } from "../src/server/knowledge/router.ts";
import type { KnowledgeAiSuggestionTarget, KnowledgeNodeDetail, KnowledgeService } from "../src/server/knowledge/service.ts";

const MEMBER: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "member@example.test",
  displayName: "Member",
  role: "user",
};

function makeNode(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    userId: MEMBER.id,
    entityType: "card",
    entityId: "card-1",
    slug: "knowledge-card-1",
    title: "知识卡片",
    tags: ["知识"],
    properties: {},
    searchText: "知识卡片 正文",
    isActive: true,
    autoAdded: true,
    contentFingerprint: "fingerprint-1",
    revision: 3,
    deletedAt: null,
    createdAt: 1_784_000_000_000,
    updatedAt: 1_784_000_000_100,
    ...overrides,
  };
}

function makeDetail(node = makeNode()): KnowledgeNodeDetail {
  return { node, markdown: "知识正文" };
}

function makeSuggestionTarget(node: KnowledgeNode): KnowledgeAiSuggestionTarget {
  return {
    node,
    score: 0.72,
    evidence: {
      source: "ranked",
      sharedTags: ["知识"],
      sameBook: false,
      sharedPropertyRatio: 0,
      creationProximity: 1,
      feedbackBoost: 0,
      feedbackPenalty: 0,
    },
  };
}

function makeLink(overrides: Partial<KnowledgeLink> = {}): KnowledgeLink {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    userId: MEMBER.id,
    sourceNodeId: makeNode().id,
    targetNodeId: "44444444-4444-4444-8444-444444444444",
    relationType: "related",
    origin: "manual",
    context: null,
    createdAt: 1_784_000_000_200,
    updatedAt: 1_784_000_000_200,
    ...overrides,
  };
}

function createService(overrides: Partial<KnowledgeService> = {}): KnowledgeService {
  const node = makeNode();
  const targetNode = makeNode({
    id: "44444444-4444-4444-8444-444444444444",
    title: "关联知识",
  });
  const link = makeLink({ sourceNodeId: node.id, targetNodeId: targetNode.id });
  return {
    async isAutoAddEnabled() { return true; },
    async indexCard() { return { status: "unchanged", node }; },
    async joinEntity() { return node; },
    async leaveEntity() { return node; },
    async leaveNode() { return node; },
    async listNodes(input) {
      return { nodes: [node], total: 1, page: input.page ?? 1, pageSize: input.pageSize ?? 20 };
    },
    async getNode() { return makeDetail(node); },
    async getEntityNode() { return makeDetail(node); },
    async updateNode() { return { status: "updated", node }; },
    async syncWikilinks() {},
    async getBacklinks() { return []; },
    async listCandidates() {
      return [{
        node: targetNode,
        score: 0.72,
        evidence: {
          sharedTags: ["知识"],
          sameBook: false,
          sharedPropertyRatio: 0,
          creationProximity: 1,
        },
      }];
    },
    async acceptCandidate() { return makeLink({ ...link, origin: "tag_suggestion" }); },
    async dismissCandidate() { return true; },
    async createManualLink() { return link; },
    async deleteLink() { return true; },
    async getLocalGraph() {
      return {
        nodes: [
          { node, distance: 0 },
          { node: targetNode, distance: 1 },
        ],
        edges: [{ ...link, suggested: false }],
        truncated: false,
      };
    },
    async getAiSuggestionContext() {
      return {
        source: makeDetail(node),
        targets: [makeSuggestionTarget(targetNode)],
      };
    },
    ...overrides,
  };
}

function createDatabase(queryRows: Array<{ id: string }> = []) {
  const log: string[] = [];
  const client = {
    async query<Row = Record<string, unknown>>(text: string) {
      const command = text.trim().split(/\s+/u)[0]?.toUpperCase() ?? "";
      log.push(command);
      if (/SELECT id FROM cards/u.test(text)) {
        return { rows: queryRows as Row[], rowCount: queryRows.length };
      }
      return { rows: [] as Row[], rowCount: 0 };
    },
    release() { log.push("RELEASE"); },
  };
  return {
    log,
    database: {
      query: client.query,
      async connect() { return client; },
    },
  };
}

function createApp(input: {
  enabled: boolean;
  service: KnowledgeService;
  user?: AuthUser;
  queryRows?: Array<{ id: string }>;
  aiSuggestionGenerator?: Parameters<typeof createKnowledgeRouter>[0]["aiSuggestionGenerator"];
}): { app: Express; transactionLog: string[] } {
  const { database, log } = createDatabase(input.queryRows);
  const app = express();
  app.use(express.json({ strict: false }));
  if (input.user) {
    app.use((req, _res, next) => {
      (req as AuthenticatedRequest).user = input.user;
      next();
    });
  }
  app.use("/api/knowledge", createKnowledgeRouter({
    mode: input.enabled,
    pool: database,
    serviceFactory: () => input.service,
    aiDefaults: {
      geminiApiKey: "test-key",
      thirdPartyBaseUrl: "",
      thirdPartyApiKey: "",
      thirdPartyModel: "test-model",
      thirdPartyThinking: false,
    },
    aiSuggestionGenerator: input.aiSuggestionGenerator,
  }));
  return { app, transactionLog: log };
}

async function requestJson(
  app: Express,
  input: { method: "GET" | "POST" | "PUT" | "DELETE"; path: string; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}${input.path}`, {
      method: input.method,
      headers: input.body === undefined ? undefined : { "content-type": "application/json" },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("hides the knowledge API when disabled and rejects missing authentication", async () => {
  let calls = 0;
  const service = createService({
    async listNodes(input) {
      calls += 1;
      return { nodes: [], total: 0, page: input.page ?? 1, pageSize: input.pageSize ?? 20 };
    },
  });

  const disabled = await requestJson(
    createApp({ enabled: false, service, user: MEMBER }).app,
    { method: "GET", path: "/api/knowledge/nodes" },
  );
  assert.deepEqual(disabled, { status: 404, body: { error: "接口不存在" } });

  const unauthenticated = await requestJson(
    createApp({ enabled: true, service }).app,
    { method: "GET", path: "/api/knowledge/nodes" },
  );
  assert.deepEqual(unauthenticated, { status: 401, body: { error: "未登录" } });
  assert.equal(calls, 0);
});

test("bounds list input and always forwards the authenticated tenant", async () => {
  let received: Parameters<KnowledgeService["listNodes"]>[0] | null = null;
  const service = createService({
    async listNodes(input) {
      received = input;
      return { nodes: [], total: 0, page: input.page ?? 1, pageSize: input.pageSize ?? 20 };
    },
  });
  const response = await requestJson(
    createApp({ enabled: true, service, user: MEMBER }).app,
    { method: "GET", path: "/api/knowledge/nodes?q=graph&page=0&pageSize=999" },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(received, {
    userId: MEMBER.id,
    query: "graph",
    entityType: undefined,
    page: 1,
    pageSize: 100,
  });
});

test("updates a knowledge node and its source inside one transaction", async () => {
  let updateUserId = "";
  const service = createService({
    async updateNode(input) {
      updateUserId = input.userId;
      return { status: "updated", node: makeNode({ revision: 4 }) };
    },
    async getNode() { return makeDetail(makeNode({ revision: 4 })); },
  });
  const { app, transactionLog } = createApp({ enabled: true, service, user: MEMBER });
  const response = await requestJson(app, {
    method: "PUT",
    path: `/api/knowledge/nodes/${makeNode().id}`,
    body: { revision: 3, title: "更新标题", tags: ["知识"], properties: {}, markdown: "更新正文" },
  });

  assert.equal(response.status, 200);
  assert.equal(updateUserId, MEMBER.id);
  assert.deepEqual(transactionLog, ["BEGIN", "COMMIT", "RELEASE"]);
});

test("rolls back the knowledge transaction when a source update fails", async () => {
  const service = createService({
    async updateNode() { throw new Error("source update failed"); },
  });
  const { app, transactionLog } = createApp({ enabled: true, service, user: MEMBER });
  const response = await requestJson(app, {
    method: "PUT",
    path: `/api/knowledge/nodes/${makeNode().id}`,
    body: { revision: 3, title: "更新标题", tags: [], properties: {}, markdown: "正文" },
  });

  assert.equal(response.status, 500);
  assert.deepEqual(transactionLog, ["BEGIN", "ROLLBACK", "RELEASE"]);
});

test("joins source entities inside a transaction", async () => {
  let joinedUserId = "";
  const service = createService({
    async joinEntity(userId) {
      joinedUserId = userId;
      return makeNode();
    },
  });
  const { app, transactionLog } = createApp({ enabled: true, service, user: MEMBER });
  const response = await requestJson(app, {
    method: "POST",
    path: "/api/knowledge/entities/card/card-1/join",
  });

  assert.equal(response.status, 201);
  assert.equal(joinedUserId, MEMBER.id);
  assert.deepEqual(transactionLog, ["BEGIN", "COMMIT", "RELEASE"]);
});

test("backfill is tenant-bound, capped at 100 rows, and resumable", async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({ id: `card-${String(index).padStart(3, "0")}` }));
  const joined: string[] = [];
  const service = createService({
    async getEntityNode() { return null; },
    async joinEntity(_userId, _entityType, entityId) {
      joined.push(entityId);
      return makeNode({ entityId });
    },
  });
  const { app, transactionLog } = createApp({ enabled: true, service, user: MEMBER, queryRows: rows });
  const response = await requestJson(app, {
    method: "POST",
    path: "/api/knowledge/backfill",
    body: { cursor: null },
  });

  assert.equal(response.status, 200);
  assert.equal(joined.length, 100);
  assert.deepEqual(response.body, {
    cursor: null,
    processed: 100,
    created: 100,
    updated: 0,
    nextCursor: "card-099",
    done: false,
  });
  assert.deepEqual(transactionLog, ["BEGIN", "SELECT", "COMMIT", "RELEASE"]);
});

test("exposes candidates, graph and manual relation endpoints with tenant scope", async () => {
  const calls: string[] = [];
  const service = createService({
    async listCandidates(userId, nodeId) {
      calls.push(`candidates:${userId}:${nodeId}`);
      return [{
        node: makeNode({ id: "44444444-4444-4444-8444-444444444444", title: "关联知识" }),
        score: 0.72,
        evidence: {
          sharedTags: ["知识"],
          sameBook: false,
          sharedPropertyRatio: 0,
          creationProximity: 1,
        },
      }];
    },
    async acceptCandidate(userId, sourceNodeId, targetNodeId) {
      calls.push(`accept:${userId}:${sourceNodeId}:${targetNodeId}`);
      return makeLink({ sourceNodeId, targetNodeId, origin: "tag_suggestion" });
    },
    async dismissCandidate(userId, sourceNodeId, targetNodeId) {
      calls.push(`dismiss:${userId}:${sourceNodeId}:${targetNodeId}`);
      return true;
    },
    async getLocalGraph(userId, nodeId, depth) {
      calls.push(`graph:${userId}:${nodeId}:${depth}`);
      return {
        nodes: [
          { node: makeNode({ id: nodeId }), distance: 0 },
          { node: makeNode({ id: "44444444-4444-4444-8444-444444444444", title: "关联知识" }), distance: 1 },
        ],
        edges: [{
          id: "edge-1",
          sourceNodeId: nodeId,
          targetNodeId: "44444444-4444-4444-8444-444444444444",
          relationType: "related",
          origin: "tag_suggestion",
          suggested: true,
        }],
        truncated: false,
      };
    },
    async createManualLink(input) {
      calls.push(`link:${input.userId}:${input.sourceNodeId}:${input.targetNodeId}:${input.relationType}:${input.context}`);
      return makeLink({
        sourceNodeId: input.sourceNodeId,
        targetNodeId: input.targetNodeId,
        relationType: input.relationType,
        context: input.context ?? null,
      });
    },
    async deleteLink(userId, linkId) {
      calls.push(`delete:${userId}:${linkId}`);
      return true;
    },
  });
  const nodeId = makeNode().id;
  const targetId = "44444444-4444-4444-8444-444444444444";
  const { app, transactionLog } = createApp({ enabled: true, service, user: MEMBER });

  const candidates = await requestJson(app, {
    method: "GET",
    path: `/api/knowledge/nodes/${nodeId}/candidates`,
  });
  assert.equal(candidates.status, 200);
  assert.equal((candidates.body as { candidates: unknown[] }).candidates.length, 1);

  const accepted = await requestJson(app, {
    method: "POST",
    path: `/api/knowledge/nodes/${nodeId}/candidates/${targetId}/accept`,
  });
  assert.equal(accepted.status, 201);

  const dismissed = await requestJson(app, {
    method: "POST",
    path: `/api/knowledge/nodes/${nodeId}/candidates/${targetId}/dismiss`,
  });
  assert.deepEqual(dismissed, { status: 200, body: { dismissed: true } });

  const graph = await requestJson(app, {
    method: "GET",
    path: `/api/knowledge/nodes/${nodeId}/graph?depth=2`,
  });
  assert.equal(graph.status, 200);
  assert.equal((graph.body as { nodes: unknown[] }).nodes.length, 2);

  const linked = await requestJson(app, {
    method: "POST",
    path: "/api/knowledge/links",
    body: {
      sourceNodeId: nodeId,
      targetNodeId: targetId,
      relationType: "supports",
      context: "手工整理",
    },
  });
  assert.equal(linked.status, 201);

  const deleted = await requestJson(app, {
    method: "DELETE",
    path: "/api/knowledge/links/link-1",
  });
  assert.deepEqual(deleted, { status: 200, body: { success: true } });

  assert.deepEqual(calls, [
    `candidates:${MEMBER.id}:${nodeId}`,
    `accept:${MEMBER.id}:${nodeId}:${targetId}`,
    `dismiss:${MEMBER.id}:${nodeId}:${targetId}`,
    `graph:${MEMBER.id}:${nodeId}:2`,
    `link:${MEMBER.id}:${nodeId}:${targetId}:supports:手工整理`,
    `delete:${MEMBER.id}:link-1`,
  ]);
  assert.equal(transactionLog.filter((entry) => entry === "SELECT").length, 2);
  assert.deepEqual(transactionLog.filter((entry) => entry !== "SELECT"), [
    "BEGIN", "COMMIT", "RELEASE",
    "BEGIN", "COMMIT", "RELEASE",
    "BEGIN", "COMMIT", "RELEASE",
    "BEGIN", "COMMIT", "RELEASE",
  ]);
});

test("generates AI relation suggestions without writing links", async () => {
  const calls: string[] = [];
  const nodeId = makeNode().id;
  const targetId = "44444444-4444-4444-8444-444444444444";
  const service = createService({
    async getAiSuggestionContext(userId, receivedNodeId, limit) {
      calls.push(`context:${userId}:${receivedNodeId}:${limit}`);
      return {
        source: makeDetail(makeNode({ id: receivedNodeId })),
        targets: [makeSuggestionTarget(makeNode({ id: targetId, title: "关联知识" }))],
      };
    },
    async createManualLink() {
      throw new Error("AI suggestions must not write links");
    },
  });
  const { app, transactionLog } = createApp({
    enabled: true,
    service,
    user: MEMBER,
    aiSuggestionGenerator: async (input) => {
      calls.push(`ai:${input.source.id}:${input.targets.length}:${input.limit}`);
      return [{
        targetNodeId: targetId,
        relationType: "supports",
        confidence: 0.84,
        reason: "同一主题下的支撑材料",
      }];
    },
  });

  const response = await requestJson(app, {
    method: "POST",
    path: `/api/knowledge/nodes/${nodeId}/ai-suggestions`,
    body: { limit: 3 },
  });

  assert.deepEqual(response, {
    status: 200,
    body: {
      suggestions: [{
        targetNodeId: targetId,
        relationType: "supports",
        confidence: 0.84,
        reason: "同一主题下的支撑材料",
        localScore: 0.72,
        evidence: {
          source: "ranked",
          sharedTags: ["知识"],
          sameBook: false,
          sharedPropertyRatio: 0,
          creationProximity: 1,
          feedbackBoost: 0,
          feedbackPenalty: 0,
        },
      }],
    },
  });
  assert.deepEqual(calls, [
    `context:${MEMBER.id}:${nodeId}:50`,
    `ai:${nodeId}:1:3`,
  ]);
  assert.deepEqual(transactionLog, []);
});
