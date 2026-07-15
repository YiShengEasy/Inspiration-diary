import {
  mapKnowledgeNodeRow,
  type KnowledgeNode,
  type KnowledgeNodeRow,
  type KnowledgeQueryable,
} from "./repository.ts";
import { serializePgVector } from "./embeddings.ts";

const ALIASED_NODE_COLUMNS = `
  n.id, n.user_id, n.entity_type, n.entity_id, n.slug, n.title, n.tags,
  n.properties, n.search_text, n.is_active, n.auto_added,
  n.content_fingerprint, n.revision, n.deleted_at, n.created_at, n.updated_at
`;

export interface SimilarKnowledgeNode {
  node: KnowledgeNode;
  similarity: number;
}

export interface KnowledgeVectorStore {
  listNodesNeedingEmbedding(
    userId: string,
    sourceNodeId: string,
    model: string,
    dimensions: number,
    limit: number,
  ): Promise<KnowledgeNode[]>;
  upsertEmbedding(input: {
    userId: string;
    node: KnowledgeNode;
    model: string;
    dimensions: number;
    embedding: number[];
    now: number;
  }): Promise<void>;
  listSimilarNodes(
    userId: string,
    sourceNodeId: string,
    model: string,
    dimensions: number,
    limit: number,
  ): Promise<SimilarKnowledgeNode[]>;
}

function boundedSimilarity(value: number | string): number {
  const similarity = Number(value);
  if (!Number.isFinite(similarity)) return 0;
  return Math.max(0, Math.min(1, similarity));
}

export function createKnowledgeVectorStore(client: KnowledgeQueryable): KnowledgeVectorStore {
  return {
    async listNodesNeedingEmbedding(userId, sourceNodeId, model, dimensions, limit) {
      const result = await client.query<KnowledgeNodeRow>(
        `SELECT ${ALIASED_NODE_COLUMNS}
         FROM knowledge_nodes n
         LEFT JOIN knowledge_node_embeddings e
           ON e.user_id = n.user_id AND e.node_id = n.id
          AND e.model = $3 AND e.dimensions = $4
         WHERE n.user_id = $1 AND n.is_active = TRUE AND n.deleted_at IS NULL
           AND (e.node_id IS NULL OR e.content_fingerprint <> n.content_fingerprint)
         ORDER BY CASE WHEN n.id = $2 THEN 0 ELSE 1 END, n.updated_at DESC, n.id ASC
         LIMIT $5`,
        [userId, sourceNodeId, model, dimensions, Math.min(500, Math.max(1, limit))],
      );
      return result.rows.map(mapKnowledgeNodeRow);
    },

    async upsertEmbedding(input) {
      await client.query(
        `INSERT INTO knowledge_node_embeddings (
           user_id, node_id, model, dimensions, content_fingerprint,
           embedding, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $7)
         ON CONFLICT (user_id, node_id, model)
         DO UPDATE SET
           dimensions = EXCLUDED.dimensions,
           content_fingerprint = EXCLUDED.content_fingerprint,
           embedding = EXCLUDED.embedding,
           updated_at = EXCLUDED.updated_at`,
        [
          input.userId,
          input.node.id,
          input.model,
          input.dimensions,
          input.node.contentFingerprint,
          serializePgVector(input.embedding),
          input.now,
        ],
      );
    },

    async listSimilarNodes(userId, sourceNodeId, model, dimensions, limit) {
      const result = await client.query<KnowledgeNodeRow & { semantic_similarity: number | string }>(
        `SELECT ${ALIASED_NODE_COLUMNS},
                1 - (target_embedding.embedding <=> source_embedding.embedding) AS semantic_similarity
         FROM knowledge_node_embeddings source_embedding
         JOIN knowledge_nodes source_node
           ON source_node.id = source_embedding.node_id
          AND source_node.user_id = source_embedding.user_id
         JOIN knowledge_node_embeddings target_embedding
           ON target_embedding.user_id = source_embedding.user_id
          AND target_embedding.model = source_embedding.model
          AND target_embedding.dimensions = source_embedding.dimensions
          AND target_embedding.node_id <> source_embedding.node_id
         JOIN knowledge_nodes n
           ON n.id = target_embedding.node_id AND n.user_id = target_embedding.user_id
         WHERE source_embedding.user_id = $1
           AND source_embedding.node_id = $2
           AND source_embedding.model = $3
           AND source_embedding.dimensions = $4
           AND source_embedding.content_fingerprint = source_node.content_fingerprint
           AND source_node.is_active = TRUE AND source_node.deleted_at IS NULL
           AND target_embedding.content_fingerprint = n.content_fingerprint
           AND n.is_active = TRUE AND n.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM knowledge_links l
             WHERE l.user_id = $1
               AND ((l.source_node_id = $2 AND l.target_node_id = n.id)
                 OR (l.target_node_id = $2 AND l.source_node_id = n.id))
           )
         ORDER BY target_embedding.embedding <=> source_embedding.embedding, n.id ASC
         LIMIT $5`,
        [userId, sourceNodeId, model, dimensions, Math.min(20, Math.max(1, limit))],
      );
      return result.rows.map((row) => ({
        node: mapKnowledgeNodeRow(row),
        similarity: boundedSimilarity(row.semantic_similarity),
      }));
    },
  };
}
