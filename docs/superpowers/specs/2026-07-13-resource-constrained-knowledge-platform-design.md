# 2核2G条件下的知识平台改造设计

**状态：** 已完成对话确认，等待书面规格审阅  
**日期：** 2026-07-13  
**适用项目：** Inspiration Diary Web、Express API、PostgreSQL 与阿里云 OSS 生产环境

## 1. 背景

当前生产目标为杭州阿里云 ECS：2 vCPU、2 GiB RAM、40 GiB 系统盘和 3 Mbps 固定带宽。生产主机只运行 Node/Express 应用、PostgreSQL 与宿主机反向代理；图片、视频和附件使用私有 OSS，AI 使用外部兼容接口，PhotoPrism 只用于本地开发。

项目已经具备图片、视频、Markdown、组合卡片、周记、灵感册、标签、AI 摘要和感悟备注等能力。当前主要约束是：

- Web 大文件上传仍经过 Express 的 `multer.memoryStorage()`，单个视频默认允许 100 MiB，存在并发上传导致 2 GiB 主机 OOM 的风险。
- 当前内容组织以周、卡片、灵感册和标签为主，缺少稳定知识节点、双向链接、反向链接、结构化属性和局部关系图。
- AI 关联如果按打开页面或全库扫描触发，会造成不可控的额外调用量。
- 新能力必须兼容现有 Web、小程序、PostgreSQL 账号隔离和 OSS 媒体交付，不引入新的常驻服务。

## 2. 目标

本改造分为三个独立子项目，按“稳定性优先”顺序交付：

1. 加固 2核2G 基础设施：Web 私有 OSS 直传、服务端验证、上传会话、清理、限流和轻量监控。
2. 建立无新增 AI 调用的知识库核心：统一节点、自动入库开关、Markdown、Wikilink、反向链接、属性、全文搜索、标签候选关系和局部图谱。
3. 增加默认关闭、按需触发、可缓存、可限额的 AI 深度关联。

每个子项目都必须独立上线、独立验收、可通过功能开关回滚，并保持原有灵感日记功能可用。

## 3. 非目标

本轮明确不实现：

- 本地 Markdown Vault 作为数据源或数据库与 Vault 双向同步。
- 桌面文件监听、离线冲突合并和多人实时协作编辑。
- Obsidian 插件系统。
- 完整 Canvas 编辑器和全库超大图谱。
- 本地大模型、常驻 Embedding 模型、`pgvector` 和后台全库 AI 扫描。
- 在生产 ECS 运行 PhotoPrism、重型 FFmpeg 转码或服务端粒子渲染。
- 第一阶段改造微信小程序上传协议；小程序继续使用兼容接口。

数据模型保留 Markdown 与 JSON Canvas 导出边界，但完整 Canvas 编辑器不属于本轮交付。

## 4. 总体架构

PostgreSQL 继续作为唯一业务数据源：

```text
浏览器 / 微信小程序
        ↓
Express API
        ↓
PostgreSQL：账号、卡片、上传会话、知识节点、关系、设置、AI用量
        ↓
私有 OSS：图片、视频和附件
        ↓
外部 AI API：现有摘要分析与可选深度关联
```

媒体正文不进入知识节点表。知识节点引用现有卡片、灵感册和周记；图谱布局在浏览器端完成；服务端只负责权限、查询、关系计算和持久化。

## 5. 子项目一：私有 OSS 直传与 2核2G 加固

### 5.1 上传会话

新增 `upload_sessions` 表：

```text
id                    UUID primary key
user_id               UUID not null references users(id)
media_kind            text not null
original_name         text not null
declared_mime_type    text not null
declared_size         bigint not null
pending_object_key    text not null unique
final_object_key      text
status                text not null
expires_at            bigint not null
claimed_at            bigint
failure_code          text
created_at            bigint not null
updated_at            bigint not null
```

允许的状态转换：

```text
authorized → uploaded → finalized → claimed
authorized/uploaded/finalized → failed
authorized/uploaded/finalized → expired
```

`complete` 与 `claim` 操作必须幂等。`finalized` 表示对象已通过校验并进入正式 OSS 路径但尚未绑定业务记录；`claimed` 表示对象已经绑定卡片、视频或附件记录。

### 5.2 授权与上传流程

图片和普通附件使用服务端生成的单对象 Post Policy 或签名上传地址：

```text
浏览器本地校验
  → POST /api/uploads/authorize
  → ECS创建upload_session并返回短时上传授权
  → 浏览器直传OSS pending对象
  → POST /api/uploads/:id/complete
  → ECS验证OSS对象
  → OSS内部复制到正式路径并删除pending对象
  → 创建业务记录并claim上传会话
```

临时对象路径只能由服务端生成：

```text
pending/{userId}/{uploadId}/{randomUuid}.{safeExtension}
```

大视频使用有效期不超过 15 分钟的受限 STS 凭证，支持分片和断点续传。临时策略只允许本次对象的分片初始化、上传、完成和终止操作，不授予 Bucket 列表、其他对象读取、任意路径写入或删除权限。

### 5.3 图片 AI 分析副本

浏览器在本地生成最大边 1280 像素、最大 5 MiB 的 JPEG 或 WebP 分析副本，再调用现有图片分析接口。原始大图直接上传 OSS，不进入 Node 内存。

### 5.4 服务端验证

`complete` 接口不得信任浏览器声明。服务端必须验证：

- 上传会话属于当前登录用户且状态允许完成。
- OSS 对象路径与数据库中的 `pending_object_key` 完全一致。
- OSS 实际大小与授权申请一致且未超过类型上限。
- 读取前 4–16 KiB 并校验真实文件签名。
- 图片仅接受 JPEG、PNG、WebP、GIF。
- 视频仅接受 MP4、MOV、WebM。
- 文档仅接受现有文档提取链路明确支持的类型。
- SVG、HTML、脚本和可执行文件一律拒绝。

### 5.5 私有访问基线

- OSS Bucket 保持私有并开启“阻止公共访问”。
- 浏览器永远不接收长期 AccessKey。
- CORS 只允许正式站点和明确列出的本地开发地址。
- 正式资源通过短期签名 GET URL 读取，默认 15 分钟过期。
- ECS 鉴权后返回签名地址或 302，不代理图片、视频和附件正文。
- 缩略图、详情图和视频海报继续使用 OSS 处理参数。
- 长期凭证只保存在服务端环境或由 ECS RAM 角色替代。

### 5.6 限制与清理

默认限制：

- 每用户最多 5 个活动上传会话。
- 每用户每分钟最多 20 次上传授权请求。
- 图片 25 MiB、文档 20 MiB、视频 100 MiB、分析副本 5 MiB。

限制值从环境变量读取。清理任务不引入常驻队列，使用系统定时任务：

- 每 15 分钟标记过期会话。
- 删除超过 24 小时的 pending 对象。
- 删除超过 24 小时仍为 `finalized` 且未被业务记录引用的对象。
- `claimed` 对象只能经业务删除流程移除。

### 5.7 轻量监控

不在 2 GiB 主机增加 Prometheus 等常驻服务。记录并检查：

- Node RSS 与 Heap。
- PostgreSQL 连接数。
- 活动、失败、过期上传会话数。
- 待清理对象数和清理失败数。
- AI 请求、缓存命中和失败次数。
- 磁盘使用率与应用进程重启次数。

默认警戒线：Node RSS 650 MiB、PostgreSQL 连接数 40、整机内存 80%、磁盘 75%。生产主机配置 2–4 GiB Swap 作为 OOM 应急保护，不将 Swap 作为正常运行内存。

## 6. 子项目二：无新增 AI 调用的知识库核心

### 6.1 统一知识节点

新增 `knowledge_nodes`：

```text
id                    UUID primary key
user_id               UUID not null references users(id)
entity_type           text not null
entity_id             text
slug                  text not null
title                 text not null
tags                  text[] not null default '{}'
properties            jsonb not null default '{}'
search_text           text not null default ''
is_active             boolean not null default true
auto_added            boolean not null default false
content_fingerprint   text not null
revision              integer not null default 1
deleted_at            bigint
created_at            bigint not null
updated_at            bigint not null
```

约束：

- `entity_type` 允许 `card`、`book`、`weekly_note`、`concept`。
- `(user_id, entity_type, entity_id)` 在 `entity_id` 非空时唯一。
- `(user_id, slug)` 唯一。
- 所有读写查询必须带 `user_id`。
- `tags` 和 `search_text` 是便于搜索和候选计算的派生字段，来源内容仍以现有卡片、灵感册和周记记录为准。

移出知识库只设置 `is_active=false`，保留关系；重新加入后恢复。原始业务实体永久删除时，节点和关系才级联清理。Markdown 笔记使用软删除。

### 6.2 自动入库

现有 `settings` 表增加用户可编辑设置：

```text
knowledge_auto_add=true
```

规则：

- 未设置时按开启处理。
- 顶层图片、视频、Markdown 和组合卡片创建成功后，由服务端在同一事务中 `upsert knowledge_nodes`。
- 卡片内部附件默认归属于父节点，不自动制造独立节点。
- 灵感册和周记在知识库首次引用时按需创建节点。
- 关闭开关只影响之后创建的内容，不停用已有节点。
- 详情页始终提供加入和移出知识库操作。
- 历史内容每批最多加入 100 条，前端逐批调用，可暂停和继续。

重要附件以后可以被提升为独立节点，但不作为首版默认行为。

### 6.3 稳定 Wikilink

每个节点具有用户内唯一的稳定 `slug`。编辑器通过自动补全插入：

```md
[[blue-particle-portrait-a1b2|蓝色粒子人像]]
```

Slug 不随显示标题改变。导出时可以转换为普通标题链接。无法解析的 `[[未来视觉语言]]` 创建 `concept` 占位节点；以后创建同名笔记时合并占位节点，保留已有关系。

### 6.4 正式关系与反向链接

新增 `knowledge_links`：

```text
id                UUID primary key
user_id           UUID not null references users(id)
source_node_id    UUID not null references knowledge_nodes(id)
target_node_id    UUID not null references knowledge_nodes(id)
relation_type     text not null
origin            text not null
context           text
created_at        bigint not null
updated_at        bigint not null
```

`origin` 允许 `manual`、`wikilink`、`tag_suggestion`、`ai`。首版关系类型固定为 `mentions`、`related`、`references`、`derived_from`、`belongs_to`、`contrasts`、`supports`，界面显示对应中文名称。

关系有方向。表约束禁止节点链接自身，并以 `(user_id, source_node_id, target_node_id, relation_type, origin)` 唯一约束避免同来源重复写入。不同来源指向同一目标时可以保留独立记录，图谱查询负责合并视觉上重复的边。反向链接通过 `target_node_id` 查询，不重复保存。Markdown 保存时只同步 `origin=wikilink` 的关系，不影响手工、标签建议或 AI 来源的关系。

### 6.5 属性

属性支持单行文本、多值文本、日期、数字、布尔值和节点链接。预置属性为：

```text
status, project, people, scene, source, mood, created
```

允许自定义属性，不允许嵌套 JSON 或属性内 Markdown。

### 6.6 搜索

`search_text` 汇总标题、标签、Markdown 正文、AI 摘要、感悟、属性值、原始文件名和灵感册名称。PostgreSQL 使用 `pg_trgm` GIN 索引；短中文关键词使用受限 `ILIKE` 回退。每页 20 条，单次最多返回 100 条，不引入 Elasticsearch。

### 6.7 标签候选关系

标签候选实时计算，不直接写入正式关系：

```text
标签 Jaccard 相似度             55%
同属灵感册                     20%
共享 project/people 等属性     15%
创建时间接近度                 10%
```

候选必须满足：

- 排除自身、停用节点和已有正式关系。
- 至少共享一个标签，或同时满足同灵感册与共享属性。
- 综合分数不低于 0.32。
- 每个节点最多返回 10 条。

新增 `knowledge_suggestion_feedback`：

```text
source_node_id
target_node_id
action
source_fingerprint
target_fingerprint
created_at
```

`action` 允许 `dismissed`、`accepted`。拒绝只对双方当前内容指纹有效；内容变化后可以重新成为候选。接受候选会创建 `origin=tag_suggestion` 的正式关系。图谱以虚线显示未确认候选。

标签相似关系按无方向候选处理。写入反馈时按节点 UUID 排序为规范化节点对，确保从任一节点打开时都不会重复展示已经拒绝的相同建议。

### 6.8 Markdown 编辑与并发

- 知识库支持新建和编辑 Markdown 笔记。
- Wikilink 自动补全只查询当前用户活跃节点。
- 自动保存防抖为 800 毫秒。
- 更新请求携带当前 `revision`，服务端使用乐观锁。
- 版本冲突返回 409，前端保留本地文本并提供复制或重新加载操作，不静默覆盖其他设备更新。

### 6.9 局部图谱

- 默认展示当前节点一层正式关系，可展开至两层。
- 最多 50 个节点和 100 条边。
- 正式关系使用实线，候选关系使用虚线。
- 节点按图片、视频、Markdown、组合卡片、灵感册、周记和概念区分颜色。
- 布局和交互在浏览器执行。
- 服务端只返回当前用户可访问的节点与边。
- 图谱失败时回退到关系列表，不影响编辑、搜索和反向链接。

## 7. 子项目三：可选 AI 深度关联

### 7.1 默认关闭

用户设置提供：

```text
off       关闭，默认
economy   节省
precise   精细
```

标签候选在三种模式下都可用且不调用 AI。AI 深度关联只在用户点击后执行，不因上传、打开节点、搜索、图谱、属性编辑或历史入库自动触发。

### 7.2 请求范围

节省模式：最多 5 个确定性候选，发送标题、标签、摘要、属性、感悟和最多 1000 字 Markdown。精细模式：最多 10 个候选、最多 3000 字 Markdown，并包含已有关系和灵感册上下文。图片和视频二进制不再次发送给 AI。

单次请求合并全部候选。AI 返回结构化关系：目标节点、允许的关系类型、0–1 置信度和简短理由。服务端必须验证目标属于候选集合、关系类型合法、置信度合法；低于 0.75 的结果不展示。AI 结果永远只是候选，用户接受后才写入 `origin=ai` 的正式关系。

### 7.3 缓存

缓存键包含当前节点指纹、候选节点指纹集合、模式、模型和提示词版本。相同输入直接返回缓存。内容变化后旧结果标记过期，不自动重新调用。

新增 `knowledge_ai_relation_cache`：

```text
id
user_id
source_node_id
cache_key
mode
provider
model
prompt_version
result_json
created_at
expires_at
```

`(user_id, source_node_id, cache_key)` 唯一。缓存只保存通过服务端结构校验的完整结果；非法或部分结果不得写入。

### 7.4 用量事件

新增 `ai_usage_events`：

```text
id
user_id
purpose
provider
model
prompt_tokens
completion_tokens
estimated_tokens
duration_ms
success
cache_hit
error_code
created_at
```

`purpose` 至少区分 `image_analysis`、`markdown_summary`、`knowledge_relation`。提供方返回 token 时保存真实值；否则保存估算值并在界面标记。设置页显示今日调用、知识关联调用、输入输出 token、缓存命中和最近失败。

### 7.5 默认限额与指定账号不限量

系统默认：

- 每用户每天 20 次知识关联调用。
- 每用户同时最多 1 次。
- 全服务器同时最多 2 次。
- 单次超时 45 秒。
- 失败不自动重试。
- 缓存命中不计入调用次数。

环境变量：

```env
KNOWLEDGE_AI_DAILY_CALL_LIMIT=20
KNOWLEDGE_AI_GLOBAL_CONCURRENCY=2
KNOWLEDGE_AI_TIMEOUT_MS=45000
KNOWLEDGE_AI_UNLIMITED_USER_IDS=user-uuid-1,user-uuid-2
```

在 `users` 增加管理员管理字段 `knowledge_ai_daily_limit_override`：

- `NULL` 使用系统默认值。
- 正整数使用账号专属每日额度。
- `-1` 表示每日不限量。

只有 `role=admin` 的账号可以通过管理接口修改。环境变量用于首次部署时初始化指定用户 ID。不限量只取消每日次数上限，仍遵守单用户并发、全局并发、超时、缓存、安全验证和用量记录。

### 7.6 故障降级

- AI 超时或不可用时保留确定性候选。
- 非法结构化输出全部拒绝，不保存部分关系。
- 内容在分析期间变化时，结果标记过期。
- 服务重启导致请求失败时不自动重试。
- 达到限额后，上传、编辑、搜索、链接、标签候选和图谱继续正常运行。

## 8. 数据库迁移

新表不继续堆入 `server.ts` 的启动 DDL。引入轻量迁移机制：

```text
schema_migrations
database/migrations/*.sql
scripts/migrate-database.ts
```

每个迁移只执行一次。发布前先备份 PostgreSQL；迁移失败立即停止发布。新表、新列和关闭状态的代码先上线，不在首版删除旧列、旧接口或旧上传链路。大索引使用低锁方式创建。

## 9. 测试设计

### 9.1 单元测试

覆盖：

- 服务端对象路径、授权范围、文件头、大小和 MIME 校验。
- 上传状态机、幂等 complete/claim、过期和清理选择。
- 跨用户上传会话访问拒绝。
- Slug、Wikilink、占位概念、属性和内容指纹。
- 候选评分、阈值、反馈指纹和图谱上限。
- 自动入库默认值与乐观锁冲突。
- AI 输出白名单、缓存键、限额、并发和不限量账号策略。

### 9.2 API 集成测试

使用测试 PostgreSQL 与假的 OSS 适配器验证：

- 授权、完成、正式化和认领全流程。
- 私有资源签名读取。
- 创建卡片自动创建知识节点，关闭开关后不创建。
- 手动加入、移出和历史分批加入。
- Wikilink、正式关系、反向链接、候选接受和拒绝。
- 用户 A 无法读取或修改用户 B 的上传会话、节点、关系与 AI 策略。
- 管理员可设置默认、自定义和不限量额度，普通用户不能修改。

### 9.3 前端测试

覆盖自动入库开关、上传进度与恢复、知识搜索、Markdown 自动补全、属性编辑、候选操作、图谱回退、409 冲突保留本地内容和 AI 用量显示。

### 9.4 性能验收

在接近生产配置的环境验证：

- 三个并发 100 MiB 视频直传时，ECS 不接收视频正文。
- 上传期间 Node RSS 增长不超过 100 MiB。
- 1 万知识节点下普通搜索 P95 低于 500 ms。
- 单节点候选计算 P95 低于 300 ms。
- 50 节点局部图谱 API P95 低于 300 ms。
- 历史入库每批 100 条，事务时间低于 2 秒。
- AI 模式关闭时，知识库操作产生 0 次新增 AI 请求。

若不达标，先检查查询计划、索引和媒体路径，不直接以升级服务器代替诊断。

## 10. 上线、观察与回滚

### 10.1 功能开关

```env
WEB_DIRECT_OSS_UPLOAD_MODE=off
KNOWLEDGE_BASE_ENABLED=false
KNOWLEDGE_AI_RELATIONS_ENABLED=false
```

`WEB_DIRECT_OSS_UPLOAD_MODE` 允许 `off`、`admin`、`all`，分别表示关闭、只对 `role=admin` 开启和对全部用户开启。

### 10.2 上线顺序

1. 备份数据库，部署迁移和默认关闭的代码。
2. 设置 `WEB_DIRECT_OSS_UPLOAD_MODE=admin`，只对管理员启用 Web OSS 直传并观察 24 小时。
3. 设置 `WEB_DIRECT_OSS_UPLOAD_MODE=all`，全量启用 Web 直传，保留小程序和旧 Web 兼容接口。
4. 启用知识库核心。
5. 用户主动执行历史分批入库。
6. 开放 AI 关联入口，用户默认模式仍为关闭。

### 10.3 回滚

- 关闭 Web 直传开关后，Web 恢复旧上传链路；未完成会话由清理任务回收。
- 关闭知识库开关后，原有灵感日记、灵感册和上传功能继续工作；节点和关系数据保留。
- 关闭 AI 关联开关后，标签候选和正式关系继续工作；缓存和用量记录保留。
- 回滚不删除新表，不对已完成 OSS 对象执行批量破坏性操作。

## 11. 运维与文档交付

每个子项目同步更新：

- 环境变量模板和生产发布说明。
- 私有 Bucket、阻止公共访问、CORS、RAM/STS 最小权限配置。
- 数据库迁移、备份、恢复和回滚命令。
- 上传会话与孤儿对象清理任务。
- 2核2G监控命令和告警阈值。
- 故障排查清单和功能开关处置顺序。

## 12. 计划拆分

书面规格通过后生成四份计划：

1. 总体路线图：交付顺序、依赖、门禁和跨子项目验收。
2. 基础设施计划：迁移机制、Web 私有 OSS 直传、验证、清理、限流、监控和灰度。
3. 知识库核心计划：节点、设置、Wikilink、属性、搜索、候选、局部图谱和历史入库。
4. 可选 AI 关联计划：缓存、结构化输出、用量、限额、指定账号不限量、降级和管理入口。

每份实施计划必须使用测试驱动的小步骤、精确文件路径、明确命令与预期结果，并在独立任务完成后提交。
