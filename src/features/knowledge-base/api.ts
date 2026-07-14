import { authFetch } from "../../lib/authClient";
import type {
  CreateKnowledgeMarkdownInput,
  KnowledgeAiSuggestionsResponse,
  KnowledgeBackfillResponse,
  KnowledgeBacklinksResponse,
  KnowledgeCandidatesResponse,
  KnowledgeEntityMembershipResponse,
  KnowledgeEntityType,
  KnowledgeGraphResponse,
  KnowledgeLink,
  KnowledgeNodeListResponse,
  KnowledgeNodeResponse,
  KnowledgeRelationType,
  KnowledgeRevisionConflictResponse,
  UpdateKnowledgeNodeInput,
} from "./types";

export class KnowledgeApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "KnowledgeApiError";
    this.status = status;
  }
}

export class KnowledgeRevisionConflict extends KnowledgeApiError {
  readonly serverRevision: number;
  readonly serverNode: KnowledgeRevisionConflictResponse["serverNode"];

  constructor(conflict: KnowledgeRevisionConflictResponse) {
    super(409, "知识节点已在其他位置更新");
    this.name = "KnowledgeRevisionConflict";
    this.serverRevision = conflict.serverRevision;
    this.serverNode = conflict.serverNode;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const error = Reflect.get(body, "error");
  return typeof error === "string" && error !== "revision_conflict" ? error : fallback;
}

async function readBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authFetch(path, init);
  const body = await readBody(response);
  if (!response.ok) throw new KnowledgeApiError(response.status, errorMessage(body, response.statusText));
  return body as T;
}

function jsonRequest(method: "POST" | "PUT", body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export interface ListKnowledgeNodesInput {
  query?: string;
  entityType?: KnowledgeEntityType;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

export function listKnowledgeNodes(input: ListKnowledgeNodesInput = {}): Promise<KnowledgeNodeListResponse> {
  const search = new URLSearchParams({
    page: String(Math.max(1, input.page ?? 1)),
    pageSize: String(Math.min(100, Math.max(1, input.pageSize ?? 20))),
  });
  const query = input.query?.trim();
  if (query) search.set("q", query);
  if (input.entityType) search.set("type", input.entityType);
  return request(`/api/knowledge/nodes?${search.toString()}`, { signal: input.signal });
}

export function getKnowledgeNode(nodeId: string, signal?: AbortSignal): Promise<KnowledgeNodeResponse> {
  return request(`/api/knowledge/nodes/${encodeURIComponent(nodeId)}`, { signal });
}

export function getKnowledgeEntity(
  entityType: Exclude<KnowledgeEntityType, "concept">,
  entityId: string,
): Promise<KnowledgeEntityMembershipResponse> {
  return request(`/api/knowledge/entities/${entityType}/${encodeURIComponent(entityId)}`);
}

export function joinKnowledgeEntity(
  entityType: Exclude<KnowledgeEntityType, "concept">,
  entityId: string,
): Promise<KnowledgeNodeResponse> {
  return request(`/api/knowledge/entities/${entityType}/${encodeURIComponent(entityId)}/join`, jsonRequest("POST"));
}

export function leaveKnowledgeNode(nodeId: string): Promise<KnowledgeNodeResponse> {
  return request(`/api/knowledge/nodes/${encodeURIComponent(nodeId)}/leave`, jsonRequest("POST"));
}

export function getKnowledgeBacklinks(nodeId: string): Promise<KnowledgeBacklinksResponse> {
  return request(`/api/knowledge/nodes/${encodeURIComponent(nodeId)}/backlinks`);
}

export function getKnowledgeCandidates(nodeId: string): Promise<KnowledgeCandidatesResponse> {
  return request(`/api/knowledge/nodes/${encodeURIComponent(nodeId)}/candidates`);
}

export function generateKnowledgeAiSuggestions(
  nodeId: string,
  aiHeaders: Record<string, string> = {},
): Promise<KnowledgeAiSuggestionsResponse> {
  return request(
    `/api/knowledge/nodes/${encodeURIComponent(nodeId)}/ai-suggestions`,
    {
      ...jsonRequest("POST", { limit: 5 }),
      headers: { "Content-Type": "application/json", ...aiHeaders },
    },
  );
}

export function acceptKnowledgeCandidate(nodeId: string, targetId: string): Promise<{ link: KnowledgeLink }> {
  return request(
    `/api/knowledge/nodes/${encodeURIComponent(nodeId)}/candidates/${encodeURIComponent(targetId)}/accept`,
    jsonRequest("POST"),
  );
}

export function dismissKnowledgeCandidate(nodeId: string, targetId: string): Promise<{ dismissed: true }> {
  return request(
    `/api/knowledge/nodes/${encodeURIComponent(nodeId)}/candidates/${encodeURIComponent(targetId)}/dismiss`,
    jsonRequest("POST"),
  );
}

export function getKnowledgeGraph(nodeId: string, depth: 1 | 2 = 1): Promise<KnowledgeGraphResponse> {
  return request(`/api/knowledge/nodes/${encodeURIComponent(nodeId)}/graph?depth=${depth}`);
}

export function runKnowledgeBackfill(cursor: string | null = null): Promise<KnowledgeBackfillResponse> {
  return request("/api/knowledge/backfill", jsonRequest("POST", { cursor }));
}

export function createKnowledgeMarkdown(input: CreateKnowledgeMarkdownInput): Promise<KnowledgeNodeResponse> {
  return request("/api/knowledge/markdown", jsonRequest("POST", input));
}

export async function updateKnowledgeNode(
  nodeId: string,
  input: UpdateKnowledgeNodeInput,
): Promise<KnowledgeNodeResponse> {
  const response = await authFetch(
    `/api/knowledge/nodes/${encodeURIComponent(nodeId)}`,
    jsonRequest("PUT", input),
  );
  const body = await readBody(response);
  if (response.status === 409) {
    throw new KnowledgeRevisionConflict(body as KnowledgeRevisionConflictResponse);
  }
  if (!response.ok) throw new KnowledgeApiError(response.status, errorMessage(body, response.statusText));
  return body as KnowledgeNodeResponse;
}

export function createKnowledgeLink(input: {
  sourceNodeId: string;
  targetNodeId: string;
  relationType: KnowledgeRelationType;
  context?: string;
}): Promise<{ link: KnowledgeLink }> {
  return request("/api/knowledge/links", jsonRequest("POST", input));
}

export function deleteKnowledgeLink(linkId: string): Promise<{ success: true }> {
  return request(`/api/knowledge/links/${encodeURIComponent(linkId)}`, { method: "DELETE" });
}
