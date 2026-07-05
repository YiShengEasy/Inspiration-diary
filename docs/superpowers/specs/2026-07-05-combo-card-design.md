# 组合卡片设计

## 背景

现有系统以每日灵感卡为核心。一张卡片可以是图片、文档或视频，也可以绑定多个图片附件、多个视频附件，并保存一条整体备注。这个结构适合单条灵感，但不适合表达一个完整创作组合：多张参考图共同定义人物、场景和故事，再基于不同提示词生成多个视频版本。

本次设计新增一种“组合卡片”。组合卡片仍然是每日卡片的一种，兼容现有日期归档、灵感册、搜索、标签和自动入册能力；打开详情后，它呈现为一组参考图片和多条生成记录。

## 目标

- 用户可以在某一天创建一张组合卡片。
- 组合卡片可以包含多张参考图片。
- 每张参考图片可以标记角色：人物图、场景图、故事图、其他。
- 组合卡片可以包含多条生成记录。
- 每条生成记录包含一段备注或提示词，并绑定一个视频。
- 每条备注只对应自己的视频，避免多个备注和多个视频混在一起。
- 组合卡片在每日卡片、灵感册和搜索中作为一张卡展示，不拆成多张独立卡。
- 旧图片卡、文档卡、视频卡不迁移、不破坏。

## 非目标

- 第一版不做独立“项目/作品集”模块。
- 第一版不要求把旧的图片卡、视频卡自动合并成组合卡。
- 第一版不做复杂版本对比、时间线剪辑或视频生成任务队列。
- 第一版小程序以查看兼容为主，不优先实现完整编辑能力。

## 推荐方案

新增卡片类型 `combo`。它仍存放在 `cards` 表中，并通过新增组合表保存内部结构。

组合卡片的外层仍然参与现有列表接口：

```text
cards
- id
- user_id
- week_id
- day_index
- type = "combo"
- terms
- insight_note
- created_at
```

组合专属内容拆到两张新表：

```text
combo_images
- id
- user_id
- card_id
- role: character | scene | story | other
- storage_provider
- storage_key
- original_name
- mime_type
- size_bytes
- sort_order
- created_at
```

```text
combo_generations
- id
- user_id
- card_id
- prompt_note
- storage_provider
- storage_key
- original_name
- mime_type
- size_bytes
- duration_ms
- poster_url
- sort_order
- created_at
- updated_at
```

这样“参考图片”和“备注对应视频”有明确边界，不复用 `image_assets` 和 `video_assets` 去承载不同语义，后续也更容易扩展。

## 数据返回

每日卡片列表仍使用 `GET /api/db/cards`。组合卡片在列表中返回轻量摘要：

```json
{
  "id": "card_xxx",
  "type": "combo",
  "terms": ["人物设定", "森林场景"],
  "comboSummary": {
    "coverImageUrl": "/api/combo-images/xxx",
    "imageCount": 3,
    "generationCount": 2
  }
}
```

卡片详情使用单独接口加载完整组合结构：

```text
GET /api/db/cards/:id/combo
```

返回：

```json
{
  "card": {},
  "images": [],
  "generations": []
}
```

## 后端接口

新增组合卡片接口：

- `POST /api/db/combo-cards`：创建组合卡片，可指定 `weekId`、`dayIndex`、`bookId`。
- `GET /api/db/cards/:id/combo`：读取组合详情。
- `POST /api/db/cards/:id/combo/images`：上传参考图片。
- `PUT /api/db/cards/:id/combo/images/:imageId`：修改图片角色或排序。
- `DELETE /api/db/cards/:id/combo/images/:imageId`：删除参考图片。
- `POST /api/db/cards/:id/combo/generations`：新增一条生成记录，可带提示词和视频。
- `PUT /api/db/cards/:id/combo/generations/:generationId`：修改提示词、替换视频或排序。
- `DELETE /api/db/cards/:id/combo/generations/:generationId`：删除生成记录和对应视频对象。

所有接口沿用现有 Bearer Token 鉴权和用户隔离。文件仍走本地/OSS storage provider 抽象。

## Web 端体验

### 创建入口

在每日卡片上传入口中增加“创建组合”。用户选择后会在当天创建一张组合卡片，然后进入组合详情。

在灵感册详情页中也增加“创建组合”，创建后自动加入当前灵感册，并按今天计入日期。

### 每日卡片展示

组合卡片在每日视图中只占一张卡。封面规则：

1. 优先使用第一张人物图。
2. 没有人物图时使用第一张参考图。
3. 没有参考图时显示组合卡片占位封面。

卡片角标显示“组合”。卡片副文案显示 `3 张参考图 / 2 条视频记录`。

### 详情布局

组合详情页分为两个区域：

1. 参考图片区。
   支持多选上传图片。每张图片可以选择角色：人物、场景、故事、其他。图片可以删除和调整排序。

2. 生成记录区。
   支持新增多条记录。每条记录包含提示词/备注输入框、一个视频上传位、视频预览、下载和删除按钮。每条记录独立保存。

## 小程序体验

第一版小程序做兼容查看：

- 每日列表和灵感册列表可以展示组合卡片。
- 卡片角标显示“组合”。
- 详情页可以查看参考图、提示词和视频。
- 暂不优先提供完整编辑能力。

后续再补充小程序端创建组合、上传参考图、添加生成记录。

## 搜索和灵感册

组合卡片整体进入灵感册，不拆分参考图或生成记录。搜索命中范围包括：

- 卡片标签。
- `cards.insight_note`。
- 参考图片角色名称。
- 生成记录中的提示词/备注。
- 视频文件名。

自动入册第一版按组合卡整体匹配：组合卡标签、提示词文本、图片角色文本共同参与打分。

## 错误处理

- 上传图片超过限制时沿用图片附件大小限制提示。
- 上传视频超过限制时沿用视频大小限制提示。
- 组合卡不存在或不属于当前用户时返回 404。
- 删除组合卡时级联删除组合图片、生成记录和对应存储对象。
- 如果对象存储删除失败，数据库删除仍应避免半删除；实现时需要在事务和对象清理之间做明确顺序。

## 测试

- 创建组合卡后，`GET /api/db/cards` 能看到 `type = combo`。
- 上传多张参考图后，详情接口按角色和排序返回。
- 新增多条生成记录后，每条记录能保存自己的提示词和视频。
- 删除一条生成记录不会影响其他记录。
- 删除组合卡会清理对应图片和视频对象。
- 普通图片卡、文档卡、视频卡列表和详情不受影响。
- 灵感册中可以添加、查看组合卡。
- 小程序能展示组合卡摘要和详情。

