import assert from "node:assert/strict";
import { test } from "node:test";

import { findKnowledgeCandidates, canonicalNodePair, type CandidateNode } from "../src/server/knowledge/candidates.ts";
import { createContentFingerprint } from "../src/server/knowledge/fingerprint.ts";
import { validateKnowledgeProperties, KnowledgePropertyValidationError } from "../src/server/knowledge/properties.ts";
import { createKnowledgeSlug } from "../src/server/knowledge/slug.ts";
import { parseWikilinks } from "../src/server/knowledge/wikilinks.ts";
import { layoutKnowledgeGraph } from "../src/features/knowledge-base/graphLayout.ts";

test("stable slugs avoid collisions and fingerprints ignore property order", () => {
  const slug = createKnowledgeSlug("未来 视觉语言", "node-a");
  assert.equal(slug, createKnowledgeSlug("未来 视觉语言", "node-a"));
  assert.notEqual(slug, createKnowledgeSlug("未来 视觉语言", "node-b"));
  assert.match(slug, /^未来-视觉语言-[a-f0-9]{10}$/u);
  assert.equal(
    createContentFingerprint({ title: "A", properties: { a: 1, b: true } }),
    createContentFingerprint({ properties: { b: true, a: 1 }, title: "A" }),
  );
});

test("properties stay flat and wikilinks preserve aliases and unresolved titles", () => {
  assert.deepEqual(validateKnowledgeProperties({ status: "进行中", related: { nodeId: "node-2" } }), {
    status: "进行中",
    related: { nodeId: "node-2" },
  });
  assert.throws(
    () => validateKnowledgeProperties({ nested: { title: "bad" } }),
    (error: unknown) => error instanceof KnowledgePropertyValidationError && error.code === "invalid_property_value",
  );
  assert.throws(() => validateKnowledgeProperties({ body: "**不是元数据**" }), KnowledgePropertyValidationError);
  assert.deepEqual(
    parseWikilinks("参见 [[blue-particle-a1b2|蓝色粒子]] 与 [[未来视觉语言]]，再看 [[BLUE-PARTICLE-A1B2|重复]]"),
    [{ target: "blue-particle-a1b2", alias: "蓝色粒子" }, { target: "未来视觉语言" }],
  );
});

test("candidate rules enforce evidence, feedback fingerprints, threshold and ten-item cap", () => {
  const source: CandidateNode = {
    id: "source", tags: ["粒子", "蓝色"], properties: { mood: "冷" },
    bookIds: ["book-a"], createdAt: 1_000, contentFingerprint: "source-v1",
  };
  const nodes: CandidateNode[] = Array.from({ length: 12 }, (_, index) => ({
    id: `node-${String(index).padStart(2, "0")}`,
    tags: ["粒子", "蓝色"], properties: { mood: "冷" }, bookIds: ["book-a"],
    createdAt: 1_000 + index, contentFingerprint: `target-${index}`,
  }));
  nodes.push({ id: "weak", tags: ["粒子", "其他1", "其他2", "其他3"], properties: {}, createdAt: -400 * 86_400_000, contentFingerprint: "weak" });
  nodes.push({ id: "inactive", tags: ["粒子", "蓝色"], properties: {}, createdAt: 1_000, contentFingerprint: "inactive", isActive: false });

  const candidates = findKnowledgeCandidates(source, nodes);
  assert.equal(candidates.length, 10);
  assert.equal(candidates.some((candidate) => candidate.node.id === "weak"), false);
  assert.deepEqual(canonicalNodePair("z", "a"), { lowerNodeId: "a", higherNodeId: "z" });

  const first = nodes[0];
  const pair = canonicalNodePair(source.id, first.id);
  const filtered = findKnowledgeCandidates(source, [first], {
    feedback: [{
      ...pair,
      lowerFingerprint: pair.lowerNodeId === source.id ? source.contentFingerprint : first.contentFingerprint,
      higherFingerprint: pair.higherNodeId === source.id ? source.contentFingerprint : first.contentFingerprint,
    }],
  });
  assert.deepEqual(filtered, []);
  assert.equal(findKnowledgeCandidates({ ...source, contentFingerprint: "source-v2" }, [first], { feedback: [{
    ...pair,
    lowerFingerprint: pair.lowerNodeId === source.id ? source.contentFingerprint : first.contentFingerprint,
    higherFingerprint: pair.higherNodeId === source.id ? source.contentFingerprint : first.contentFingerprint,
  }] }).length, 1);
});

test("graph layout is deterministic and capped at 50 nodes and 100 valid edges", () => {
  const nodes = Array.from({ length: 60 }, (_, index) => ({ id: `n-${String(index).padStart(2, "0")}` }));
  const edges = Array.from({ length: 150 }, (_, index) => ({
    id: `e-${index}`, source: `n-${String(index % 40).padStart(2, "0")}`, target: `n-${String((index + 1) % 40).padStart(2, "0")}`,
  }));
  const graph = layoutKnowledgeGraph(nodes, edges);
  assert.equal(graph.nodes.length, 50);
  assert.equal(graph.edges.length, 100);
  assert.deepEqual(graph, layoutKnowledgeGraph([...nodes].reverse(), edges));
});
