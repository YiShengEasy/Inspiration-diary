# Inspiration Diary — 灵感日记

一款以**拍立得风格**展示视觉灵感的周历应用。上传图片后，AI 自动提取创意关键词（风格、色调、氛围），按周 × 天格式排列在时间轴上，搭配手写周记，留存每周的创意灵感。

---

## 技术栈

| 层次        | 技术                                                      |
| ----------- | --------------------------------------------------------- |
| 前端        | React 19 + TypeScript + Vite + Tailwind CSS v4            |
| 后端        | Express + Node.js (tsx 热重载)                            |
| AI 图像分析 | Google Gemini / Anthropic Claude / 第三方 OpenAI 兼容接口 |
| 数据库      | Firebase Firestore（默认云端）或本地 PostgreSQL（可切换） |
| 动画        | Motion (Framer Motion v12)                                |

---

## 项目结构

```
├── server.ts              # Express 后端：AI 接口代理 + PostgreSQL CRUD API
├── src/
│   ├── App.tsx            # 主应用：周历视图、搜索、深色模式
│   ├── types.ts           # ImageCard / WeeklyNote 类型定义
│   ├── components/
│   │   ├── DaySlot.tsx        # 单日卡片槽位 + 上传交互
│   │   ├── PolaroidCard.tsx   # 拍立得风格图片卡片
│   │   ├── TimelineHeader.tsx # 周导航标题栏
│   │   └── SettingsModal.tsx  # AI 提供商与 API Key 配置面板
│   └── lib/
│       ├── dbClient.ts    # 数据层：自动切换 Firestore / PostgreSQL API
│       └── firebase.ts    # Firebase 初始化
├── .env.example           # 环境变量模板
└── .env.local             # 本地开发配置（不提交 Git）
```

---

## 数据库模式

### 模式一：Firebase Firestore（默认）

无需配置，使用 `firebase-applet-config.json` 中的项目凭证即可。

### 模式二：本地 PostgreSQL

在 `.env.local` 中设置：

```env
VITE_DATABASE_TYPE="postgres"
DATABASE_TYPE="postgres"
DATABASE_URL="postgresql://yisheng@localhost:5432/inspiration_diary"
DATABASE_SSL="false"
```

服务启动时会自动创建以下两张表（如不存在）：

```sql
-- 周记
CREATE TABLE notes (
  week_id    VARCHAR(50) PRIMARY KEY,
  note       TEXT,
  height     INTEGER,
  updated_at BIGINT
);

-- 灵感卡片
CREATE TABLE cards (
  id         VARCHAR(50) PRIMARY KEY,
  week_id    VARCHAR(50) NOT NULL,
  day_index  INTEGER NOT NULL,
  image_url  TEXT NOT NULL,
  terms      TEXT[] NOT NULL,
  deco_type  VARCHAR(50),
  angle      NUMERIC,
  created_at BIGINT
);
```

---

## 本地运行

**前置条件：** Node.js 18+

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填写 GEMINI_API_KEY

# 3. 启动开发服务器（前后端一体，端口 3000）
npm run dev
```

**生产构建：**

```bash
npm run build
npm start
```

---

## AI 分析提供商

在应用右上角 **Settings（齿轮图标）** 中切换：

| 提供商             | 说明                                       |
| ------------------ | ------------------------------------------ |
| Google Gemini      | 默认，需要 Gemini API Key                  |
| Anthropic Claude   | 需要 Anthropic API Key                     |
| 第三方 OpenAI 兼容 | 支持豆包、DeepSeek 等，填写自定义 Base URL |

---

## 环境变量说明

| 变量                   | 说明                                             |
| ---------------------- | ------------------------------------------------ |
| `GEMINI_API_KEY`       | Google Gemini API 密钥                           |
| `ANTHROPIC_AUTH_TOKEN` | Anthropic Claude API 密钥（可选）                |
| `VITE_DATABASE_TYPE`   | 前端数据库模式：`firestore`（默认）或 `postgres` |
| `DATABASE_TYPE`        | 后端数据库模式：`firestore`（默认）或 `postgres` |
| `DATABASE_URL`         | PostgreSQL 连接字符串                            |
| `DATABASE_SSL`         | 是否启用 SSL：`true` / `false`                   |
