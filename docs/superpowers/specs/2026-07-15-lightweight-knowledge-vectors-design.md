# 轻量知识向量检索设计

## 目标

在现有 PostgreSQL 中增加 pgvector，为手动触发的 AI 关系建议提供语义候选。系统继续保留现有标签、灵感册、属性和反馈评分；向量服务不可用时无感回退，不影响知识库读写。

## 已确认边界

- 使用现有 PostgreSQL 与 pgvector，不部署 Milvus、Qdrant 等独立服务。
- Embedding 由 OpenAI 兼容的外部 API 生成，服务器不常驻模型。
- 当前规模使用精确余弦距离，不创建 HNSW/IVFFlat 索引。
- 只在用户手动触发 AI 关系建议时补齐过期或缺失的向量。
- 向量只用于候选召回，不自动创建 `knowledge_links`。
- 普通知识候选、图谱和编辑流程不主动调用 Embedding API。
- 第一阶段只索引正式落库的知识节点；标准标签后端落库后复用同一客户端和版本策略。

## 数据结构

`knowledge_node_embeddings` 以 `(user_id, node_id, model)` 为主键，保存模型、维度、内容指纹、向量和时间戳。查询时必须同时匹配用户、模型、维度和知识节点当前内容指纹，旧向量不会参与召回。

向量列使用不限定维度的 `vector` 类型，避免把供应商维度写死在迁移中。所有距离查询通过配置的 `model + dimensions` 隔离。

## 请求流程

1. 用户点击“AI 深度关联”。
2. 服务加载当前用户最多 500 个活跃知识节点。
3. 只对缺失或内容指纹已变化的节点分批请求 Embedding。
4. 向量写入缓存表后执行精确余弦检索。
5. 语义候选与现有规则候选去重合并，最多给关系模型 8 个目标。
6. 关系模型只返回建议；用户点击接受后才创建关系。

若 pgvector、Embedding 配置或远端 API 不可用，记录不含密钥的警告并继续使用现有规则候选和文本探索。

## 配置

- `KNOWLEDGE_VECTOR_ENABLED`
- `KNOWLEDGE_EMBEDDING_BASE_URL`
- `KNOWLEDGE_EMBEDDING_API_KEY`
- `KNOWLEDGE_EMBEDDING_MODEL`
- `KNOWLEDGE_EMBEDDING_DIMENSIONS`

Base URL 与 API Key 可回退到现有第三方 AI 配置；模型必须显式配置，避免误用聊天模型。

## 验收

- 未启用向量时现有知识库测试和行为不变。
- 启用但 API 失败时仍能返回规则候选。
- 相同内容不会重复请求 Embedding，内容指纹变化后会重新生成。
- 距离查询严格隔离用户、模型和维度。
- AI 建议请求仍不写入正式关系表。
