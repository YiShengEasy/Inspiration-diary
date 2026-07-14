# 知识资源管理器与局部图谱重构设计

**状态：** 已确认，进入实施  
**日期：** 2026-07-14  
**适用范围：** Inspiration Diary Web、Express API、PostgreSQL、私有阿里云 OSS

## 1. 背景

现有知识库已具备节点、搜索、候选关系、手工关系、AI 手动建议、历史回填和局部图谱，但页面仍是一个无限向下增长的单列列表。图片、Markdown、组合灵感、视频、灵感册和概念节点缺少明确的视觉区分；候选关系重复且缺少目标内容上下文；局部图谱仅渲染标题胶囊和 UUID 边列表，不能表达真实关系。

本次重构把知识库定位为“知识资源管理器”：先让用户看清内容是什么、位于哪里，再提供关系确认和局部探索。

## 2. 目标

1. 用三栏资源管理器替代无限单列页面。
2. 建立可展开的多级知识目录，并兼容现有灵感册。
3. 让图片、文字、组合内容、视频、灵感册和概念一眼可辨。
4. 关系建议按目标去重，并解释推荐依据。
5. 使用中心辐射图显示可读的局部关系图谱。
6. 在 2 vCPU、2 GiB RAM 条件下支持至少 10 万知识节点和百万级关联数据。

## 3. 非目标

- 不实现类似桌面文件系统的真实文件移动和磁盘同步。
- 不复制 OSS 图片、视频、Markdown 正文或卡片数据。
- 不实现无限深目录；首版目录深度最多 8 层。
- 不实现全库无上限图谱。
- 不自动触发 AI，也不允许 AI 建议直接写入正式关系。
- 不引入 Elasticsearch、图数据库、Redis 或新的常驻服务。

## 4. 信息架构

### 4.1 三栏资源管理器

桌面端采用固定视口三栏结构：

```text
┌────────────────┬──────────────────────┬────────────────────────┐
│ 知识目录树      │ 当前目录内容          │ 当前知识详情            │
│ 灵感册          │ 搜索 / 排序 / 视图     │ 内容预览                │
│ 手工文件夹      │ 类型清晰的内容列表      │ 已建立关系              │
│ 未归档          │ 游标分页              │ 待确认建议（最多 3 条）   │
│ 智能类型筛选    │                      │ 打开局部图谱            │
└────────────────┴──────────────────────┴────────────────────────┘
```

三栏分别滚动，页面本身不随数据量无限增长。中栏默认每批 30 条，通过“加载更多”或上一页／下一页继续读取。窄屏依次收起目录树和详情栏；手机端改为目录、列表、详情三级页面导航。

### 4.2 混合知识树

左侧真实目录树包含：

- 现有灵感册映射形成的目录。
- 用户手工创建的多级知识文件夹。
- 虚拟的“未归档”。
- 图片、文字、组合、视频、灵感册、概念等智能筛选。

标签只用于搜索和关系计算，不自动生成目录。目录按需展开，只请求当前父目录的直接子目录。同一知识可以属于多个目录，但底层只有一个知识节点；从一个目录移除只删除目录引用，不删除知识。

### 4.3 内容视觉类型

- 图片：小缩略图、标题、标签数量。
- Markdown／文字：文档图标、标题、两行摘要。
- 组合灵感：2×2 微型拼图、媒体数量。
- 视频：小海报、播放标识、时长（可用时）。
- 灵感册：封面、标题、内容数量。
- 概念：概念图标、标题、关联数量。

所有内容显示明确的类型标签和目录上下文，不再统一显示为“灵感卡片”。

## 5. 数据模型

### 5.1 知识目录

新增 `knowledge_folders`：

```text
id                 UUID primary key
user_id            UUID not null
parent_id          UUID nullable
name               TEXT not null
source_type        TEXT not null: manual | inspiration_book
source_entity_id   TEXT nullable
sort_order         BIGINT not null
created_at         BIGINT not null
updated_at         BIGINT not null
```

约束：

- 目录必须与父目录属于同一用户。
- 目录最多 8 层，移动目录前使用有界递归查询阻止环。
- `(user_id, source_type, source_entity_id)` 在来源实体存在时唯一。
- 同一父目录下规范化名称唯一。
- 删除非空目录前必须由用户选择仅删除目录或同时移除引用；默认仅删除目录引用。

### 5.2 目录成员

新增 `knowledge_folder_nodes`：

```text
user_id       UUID not null
folder_id     UUID not null
node_id       UUID not null
sort_order    BIGINT not null
added_at      BIGINT not null
PRIMARY KEY (user_id, folder_id, node_id)
```

目录、节点和关联表均使用包含 `user_id` 的复合约束，数据库层阻止跨租户关联。

索引：

```text
knowledge_folders(user_id, parent_id, sort_order, id)
knowledge_folder_nodes(user_id, folder_id, sort_order, node_id)
knowledge_folder_nodes(user_id, node_id, folder_id)
```

现有灵感册及 `inspiration_book_cards` 分批迁移到目录模型。迁移期间所有灵感册增删成员操作通过统一服务在同一事务内同步；完成数量与抽样校验后，新关联表成为知识树读取来源，旧接口保持兼容。

## 6. 查询与扩展性

- 目录树按父节点懒加载，不把知识节点放入递归目录查询。
- 当前目录内容使用 `(sort_order, node_id)` 或 `(updated_at, node_id)` 游标分页，不使用深 `OFFSET`。
- “未归档”使用带反向索引的 `NOT EXISTS` 查询。
- 目录、列表、详情、候选和图谱使用独立接口，不构造目录×节点×关系的大联表。
- 搜索保留 PostgreSQL trigram／GIN 索引，改用游标翻页；总数作为可选字段，避免每页 `count(*) over()`。
- 图谱深度最多 2，节点最多 50，边最多 100；响应带 `truncated`。
- 候选关系分别从共同标签、同目录、反馈模式和少量探索中限量取数，再在内存中合并评分，不扫描全库。

## 7. 缩略图与媒体

知识列表只加载识别所需的小图：

- CSS 展示尺寸约 56×56 px。
- OSS 返回最大 112×112 px 的 WebP，质量约 55%，兼顾双倍像素密度。
- 组合灵感最多请求四张同规格小图。
- 视频只请求海报，不预加载视频正文。
- 右侧详情才加载中等尺寸预览；用户主动打开时才请求原图签名地址。
- 缩略图使用懒加载、可见区域请求和类型占位图降级。

知识摘要接口返回稳定的 `preview` 元数据，不返回长期 OSS URL。服务端仅为当前页可见媒体生成短期签名缩略图地址。

## 8. 关系建议

候选关系按目标节点 ID 去重，每次最多展示 3 条。每条包含：

- 目标标题、内容类型、小缩略图和所在目录。
- 建议关系类型及中文名称。
- 共同标签、同目录、历史反馈影响和最终分数。
- 建立与忽略操作。

AI 建议仍由用户手动触发，默认不写库。AI 结果进入同一个待确认区，点击建立后才创建正式关系并记录接受反馈。

## 9. 局部图谱

图谱采用中心辐射布局：

- 当前知识固定居中。
- 一层关系完整显示，二层节点降权、淡化并远离中心。
- 节点显示标题、内容类型和目录；不显示 UUID。
- 边显示引用、相关、衍生、归属、支持、对照、提及等中文关系。
- 默认仅显示正式关系，候选通过开关临时叠加。
- 点击节点切换中心，支持缩放、平移和回到当前节点。
- 同一对节点的多来源同类型关系在视觉上合并，详情中保留真实来源。

前端使用现有 `@xyflow/react` 渲染；服务端只返回节点、边和距离，布局在浏览器完成。

## 10. 接口边界

新增或调整以下接口：

```text
GET    /api/knowledge/folders?parentId=&cursor=&pageSize=
POST   /api/knowledge/folders
PATCH  /api/knowledge/folders/:folderId
DELETE /api/knowledge/folders/:folderId
GET    /api/knowledge/folders/:folderId/nodes?cursor=&pageSize=&type=&q=
POST   /api/knowledge/folders/:folderId/nodes
DELETE /api/knowledge/folders/:folderId/nodes/:nodeId
GET    /api/knowledge/unfiled?cursor=&pageSize=&type=&q=
GET    /api/knowledge/nodes/:nodeId/graph?depth=1|2&includeSuggestions=false
```

节点列表响应增加 `preview`、`folderSummary` 和游标信息。所有接口必须鉴权并在查询中带 `user_id`。

## 11. 错误处理

- 目录重名、移动形成环、超过深度、跨用户引用返回明确的 4xx 错误。
- 乐观更新继续使用节点 `revision`；目录更新也增加版本或基于 `updated_at` 检测冲突。
- 缩略图签名失败只降级当前缩略图，不阻断列表。
- 图谱或候选被截断时在界面解释上限，而不是静默遗漏。
- 灵感册同步失败时事务回滚，避免双表部分成功。

## 12. 测试与验收

必须覆盖：

- 目录创建、重命名、移动、循环阻止、深度限制和租户隔离。
- 同一节点多目录、单目录移除、未归档恢复和灵感册迁移幂等。
- 游标分页无重复、无遗漏，新增内容时仍保持稳定。
- 类型预览、缩略图降级、组合拼图和视频海报。
- 候选去重、最多三条、手动 AI 不自动写库。
- 图谱中心节点、中文边、深度切换、候选开关和截断提示。
- 10 万节点、100 万目录成员、100 万关系的 SQL 基准；目录列表和一层图谱目标为本机 PostgreSQL 亚秒级。
- `npm run lint`、`npm run test:knowledge`、`npm run test:ui` 和 `npm run build` 全部通过。

## 13. 发布与回滚

数据库迁移前先备份。新页面仍受 `KNOWLEDGE_BASE_ENABLED` 控制；目录迁移可重复执行并输出计数。若新版页面异常，可切回旧列表路由，保留新目录数据。AI 开关与手动确认规则不变。
