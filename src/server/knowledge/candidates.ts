import type { KnowledgeProperties } from "./types.ts";

const DAY_MS = 86_400_000;
const PROXIMITY_WINDOW_MS = 365 * DAY_MS;

export interface CandidateNode {
  id: string;
  tags: string[];
  properties: KnowledgeProperties;
  createdAt: number;
  contentFingerprint: string;
  isActive?: boolean;
  bookIds?: string[];
}

export interface CandidateFeedback {
  lowerNodeId: string;
  higherNodeId: string;
  lowerFingerprint: string;
  higherFingerprint: string;
}

export interface KnowledgeCandidate {
  node: CandidateNode;
  score: number;
  evidence: {
    sharedTags: string[];
    sameBook: boolean;
    sharedPropertyRatio: number;
    creationProximity: number;
  };
}

export interface CandidateOptions {
  formalLinkedNodeIds?: Iterable<string>;
  feedback?: CandidateFeedback[];
  minScore?: number;
  limit?: number;
}

export function canonicalNodePair(firstId: string, secondId: string): {
  lowerNodeId: string;
  higherNodeId: string;
} {
  // Match PostgreSQL's canonical text ordering used by the feedback CHECK.
  return firstId <= secondId
    ? { lowerNodeId: firstId, higherNodeId: secondId }
    : { lowerNodeId: secondId, higherNodeId: firstId };
}

function normalizedSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.normalize("NFKC").trim().toLocaleLowerCase("en-US")).filter(Boolean));
}

function intersect(first: Set<string>, second: Set<string>): string[] {
  return [...first].filter((value) => second.has(value)).sort();
}

function propertyRatio(first: KnowledgeProperties, second: KnowledgeProperties): number {
  const keys = new Set([...Object.keys(first), ...Object.keys(second)]);
  if (keys.size === 0) return 0;
  let shared = 0;
  for (const key of keys) {
    if (!(key in first) || !(key in second)) continue;
    if (JSON.stringify(first[key]) === JSON.stringify(second[key])) shared += 1;
  }
  return shared / keys.size;
}

function feedbackMatches(source: CandidateNode, target: CandidateNode, feedback: CandidateFeedback): boolean {
  const pair = canonicalNodePair(source.id, target.id);
  if (pair.lowerNodeId !== feedback.lowerNodeId || pair.higherNodeId !== feedback.higherNodeId) return false;
  const lowerFingerprint = pair.lowerNodeId === source.id ? source.contentFingerprint : target.contentFingerprint;
  const higherFingerprint = pair.higherNodeId === source.id ? source.contentFingerprint : target.contentFingerprint;
  return lowerFingerprint === feedback.lowerFingerprint && higherFingerprint === feedback.higherFingerprint;
}

export function findKnowledgeCandidates(
  source: CandidateNode,
  nodes: CandidateNode[],
  options: CandidateOptions = {},
): KnowledgeCandidate[] {
  const formalLinks = new Set(options.formalLinkedNodeIds ?? []);
  const feedback = options.feedback ?? [];
  const minScore = options.minScore ?? 0.32;
  const limit = Math.min(10, Math.max(0, Math.floor(options.limit ?? 10)));
  const sourceTags = normalizedSet(source.tags);
  const sourceBooks = normalizedSet(source.bookIds ?? []);

  return nodes.flatMap((node): KnowledgeCandidate[] => {
    if (node.id === source.id || node.isActive === false || formalLinks.has(node.id)) return [];
    if (feedback.some((entry) => feedbackMatches(source, node, entry))) return [];

    const targetTags = normalizedSet(node.tags);
    const sharedTags = intersect(sourceTags, targetTags);
    const tagUnion = new Set([...sourceTags, ...targetTags]);
    const tagJaccard = tagUnion.size === 0 ? 0 : sharedTags.length / tagUnion.size;
    const sameBook = intersect(sourceBooks, normalizedSet(node.bookIds ?? [])).length > 0;
    const sharedPropertyRatio = propertyRatio(source.properties, node.properties);
    if (sharedTags.length === 0 && !(sameBook && sharedPropertyRatio > 0)) return [];

    const creationProximity = Math.max(
      0,
      1 - Math.abs(source.createdAt - node.createdAt) / PROXIMITY_WINDOW_MS,
    );
    const score =
      tagJaccard * 0.55 +
      (sameBook ? 0.2 : 0) +
      sharedPropertyRatio * 0.15 +
      creationProximity * 0.1;
    if (score < minScore) return [];
    return [{
      node,
      score,
      evidence: { sharedTags, sameBook, sharedPropertyRatio, creationProximity },
    }];
  }).sort((first, second) => second.score - first.score || (first.node.id < second.node.id ? -1 : first.node.id > second.node.id ? 1 : 0))
    .slice(0, limit);
}

export const scoreKnowledgeCandidates = findKnowledgeCandidates;
