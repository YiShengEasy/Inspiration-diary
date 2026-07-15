import { useMemo, useState } from "react";
import {
  Archive,
  ArrowRight,
  CaretDown,
  CaretRight,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  Copy,
  FileText,
  GearSix,
  GitMerge,
  ImageSquare,
  Info,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  Tray,
  User,
  VideoCamera,
  X,
} from "@phosphor-icons/react";

const PACKS = [
  {
    id: "common",
    label: "通用核心",
    count: 1248,
    kind: "系统",
    icon: Tag,
    children: ["主题", "情绪", "场景", "风格", "构图"],
  },
  {
    id: "image",
    label: "图片视觉",
    count: 1876,
    kind: "系统",
    icon: ImageSquare,
    children: ["主体", "环境与背景", "色彩", "光影", "构图与视角", "材质"],
  },
  {
    id: "video",
    label: "视频内容",
    count: 932,
    kind: "系统",
    icon: VideoCamera,
    children: ["题材", "镜头语言", "运镜", "剪辑", "节奏", "声音"],
  },
  {
    id: "document",
    label: "知识文档",
    count: 512,
    kind: "系统",
    icon: FileText,
    children: ["学科领域", "文档类型", "知识形式", "证据类型", "可执行性"],
  },
  {
    id: "private",
    label: "我的扩展",
    count: 238,
    kind: "私有",
    icon: User,
    children: ["个人偏好", "项目专用", "待整理"],
  },
];

const INITIAL_TAGS = [
  { id: "color.saturation.low", label: "低饱和", aliases: ["低饱和度", "柔和低彩"], media: ["图片", "视频"], usage: 12842, rate: 89, status: "启用", owner: "系统", description: "整体颜色饱和度较低，色彩克制、柔和且不鲜艳。", path: "图片视觉 / 色彩 / 饱和度" },
  { id: "color.saturation.high", label: "高饱和", aliases: ["鲜艳", "高彩度"], media: ["图片", "视频"], usage: 9761, rate: 87, status: "启用", owner: "系统", description: "整体色彩鲜艳，具有较强的视觉刺激与识别度。", path: "图片视觉 / 色彩 / 饱和度" },
  { id: "color.saturation.soft", label: "柔和色", aliases: ["柔色", "淡彩"], media: ["图片", "视频"], usage: 6432, rate: 83, status: "启用", owner: "系统", description: "对比温和、明度舒适的柔性色彩表达。", path: "图片视觉 / 色彩 / 饱和度" },
  { id: "color.saturation.gray", label: "灰调", aliases: ["灰色调", "去色"], media: ["图片", "视频"], usage: 3205, rate: 81, status: "启用", owner: "系统", description: "颜色中混入灰度，形成含蓄、安静的综合色调。", path: "图片视觉 / 色彩 / 饱和度" },
  { id: "private.project.mist", label: "雾感留白", aliases: ["雾白空间"], media: ["图片"], usage: 84, rate: 92, status: "启用", owner: "私有", description: "为个人项目创建的雾化留白视觉标签。", path: "我的扩展 / 项目专用 / 摄影" },
];

const REVIEW_ITEMS = [
  {
    id: "lake",
    title: "雾景湖面：清晨低饱和摄影",
    type: "图片 · JPG",
    source: "灵感日记 / 摄影参考",
    image: "/lake.jpg",
    confidence: 92,
    evidence: "画面整体偏冷色，饱和度较低；湖面有薄雾，主体位于中心区域。",
    tags: [
      ["色彩", "冷色调", 92],
      ["色彩", "低饱和", 89],
      ["天气/氛围", "薄雾", 86],
      ["构图", "中心构图", 64],
    ],
  },
  {
    id: "character",
    title: "银长直 JK 少女写真",
    type: "图片 · JPG",
    source: "灵感日记 / 参考图集",
    image: "/character.jpg",
    confidence: 91,
    evidence: "人物为少女，穿着学院制服；银色长直发是高识别度主体特征。",
    unmatched: "银长直 JK 少女",
    tags: [
      ["主体", "少女", 94],
      ["服饰", "JK 制服", 91],
      ["发色", "银发", 78],
      ["发型", "长直发", 87],
    ],
  },
  {
    id: "city",
    title: "赛博城市夜景",
    type: "图片 · JPG",
    source: "灵感日记 / 概念参考",
    image: "/city.jpg",
    confidence: 93,
    evidence: "夜晚城市环境，霓虹灯形成高对比照明，视觉语言接近赛博朋克。",
    tags: [["风格", "赛博朋克", 93], ["时间", "夜晚", 88], ["场景", "城市", 96]],
  },
  {
    id: "notes",
    title: "设计思维课堂笔记",
    type: "文档 · PDF",
    source: "灵感日记 / 学习笔记",
    image: "/notes.jpg",
    confidence: 85,
    evidence: "内容涉及设计思维教学、课堂笔记结构，并包含实践记录。",
    tags: [["学科领域", "设计", 90], ["用途", "教育", 70], ["文档类型", "课堂笔记", 85]],
  },
  {
    id: "mountain",
    title: "山间峡谷远景",
    type: "图片 · JPG",
    source: "灵感日记 / 旅行素材",
    image: "/mountain.jpg",
    confidence: 90,
    evidence: "山谷轮廓清晰，自然风景占据画面主体，视野开阔。",
    tags: [["场景", "山谷", 90], ["主题", "自然", 94], ["天气", "晴天", 86], ["景别", "远景", 82]],
  },
  {
    id: "ramen",
    title: "日式拉面特写",
    type: "图片 · JPG",
    source: "灵感日记 / 美食参考",
    image: "/ramen.jpg",
    confidence: 95,
    evidence: "画面为拉面特写，餐具与食材清晰，整体呈现日式饮食风格。",
    tags: [["食物", "拉面", 95], ["菜系", "日式", 92], ["构图", "特写", 88]],
  },
];

const CANDIDATES = [
  { id: "silver-jk", label: "银长直 JK 少女", facet: "主体", media: "图片", occurrences: 128, accepted: 37, rate: 28.9, aliases: ["银发 JK 少女", "银长发 JK", "JK 银发少女"], suggestedPath: "图片视觉 / 主体 / 人物设定", lastSeen: "今天 09:22" },
  { id: "mist-space", label: "雾感空间", facet: "环境", media: "图片", occurrences: 76, accepted: 31, rate: 40.8, aliases: ["雾化空间", "薄雾场景"], suggestedPath: "图片视觉 / 环境与背景 / 天气", lastSeen: "昨天 18:40" },
  { id: "quiet-ui", label: "安静工具感", facet: "风格", media: "图片", occurrences: 54, accepted: 18, rate: 33.3, aliases: ["安静工具风", "克制工具感"], suggestedPath: "通用核心 / 风格 / 产品气质", lastSeen: "7 月 13 日" },
  { id: "process-note", label: "过程型笔记", facet: "知识形式", media: "文档", occurrences: 43, accepted: 25, rate: 58.1, aliases: ["过程记录", "过程文档"], suggestedPath: "知识文档 / 知识形式 / 过程", lastSeen: "7 月 12 日" },
];

const AUDIT_EVENTS = [
  { time: "今天 10:32", action: "晋升标准标签", subject: "薄雾", detail: "候选词晋升至 图片视觉 / 环境与背景 / 天气", actor: "管理员" },
  { time: "今天 09:18", action: "合并别名", subject: "低彩度", detail: "合并到标准标签“低饱和”", actor: "管理员" },
  { time: "昨天 16:45", action: "用户确认", subject: "中心构图", detail: "AI 未确认状态转为人工确认", actor: "当前用户" },
  { time: "7 月 13 日", action: "停用标签", subject: "图片灵感", detail: "泛化标签停用，不再参与关系评分", actor: "管理员" },
  { time: "7 月 12 日", action: "更新别名", subject: "赛博朋克", detail: "新增别名“Cyberpunk”", actor: "管理员" },
];

const TABS = [
  ["library", "标签库"],
  ["review", "AI 待确认"],
  ["candidates", "候选词"],
  ["audit", "变更记录"],
];

function formatCount(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function MediaBadge({ label }) {
  const Icon = label === "图片" ? ImageSquare : label === "视频" ? VideoCamera : FileText;
  return <span className="media-badge"><Icon size={14} />{label}</span>;
}

function Sidebar({ activePath, onSelectPath }) {
  const [openGroups, setOpenGroups] = useState({ common: true, image: true, video: true, document: true, private: true });

  return (
    <aside className="taxonomy-sidebar" aria-label="标准标签树">
      <div className="sidebar-heading">
        <div>
          <span className="eyebrow">标签体系</span>
          <strong>标准标签库</strong>
        </div>
        <button className="icon-button" aria-label="标签库设置"><GearSix size={18} /></button>
      </div>
      <div className="tree-scroll">
        {PACKS.map((pack) => {
          const Icon = pack.icon;
          const isOpen = openGroups[pack.id];
          return (
            <section className="tree-pack" key={pack.id}>
              <button className="tree-pack-button" onClick={() => setOpenGroups((current) => ({ ...current, [pack.id]: !isOpen }))}>
                {isOpen ? <CaretDown size={14} /> : <CaretRight size={14} />}
                <Icon size={17} />
                <span>{pack.label}</span>
                <small className={pack.kind === "私有" ? "private-label" : "system-label"}>{pack.kind}</small>
                <em>{formatCount(pack.count)}</em>
              </button>
              {isOpen && (
                <div className="tree-children">
                  {pack.children.map((child) => {
                    const path = `${pack.label} / ${child}`;
                    const selected = activePath.startsWith(path);
                    return (
                      <button key={child} className={selected ? "tree-child is-selected" : "tree-child"} onClick={() => onSelectPath(path)}>
                        <span>{child}</span>
                        <em>{Math.max(24, Math.round(pack.count / (pack.children.length + child.length)))}</em>
                      </button>
                    );
                  })}
                  {pack.id === "image" && activePath.includes("色彩") && (
                    <div className="tree-grandchildren">
                      {["色相", "饱和度", "明度", "对比度"].map((child) => {
                        const path = `图片视觉 / 色彩 / ${child}`;
                        return (
                          <button key={child} className={activePath === path ? "tree-child is-selected" : "tree-child"} onClick={() => onSelectPath(path)}>
                            <span>{child}</span><em>{child === "饱和度" ? 68 : 96}</em>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="sidebar-footer"><span>共 4,806 个标准标签</span><button>管理标签包</button></div>
    </aside>
  );
}

function Header({ search, setSearch, onCreate }) {
  return (
    <header className="app-header">
      <div className="brand-lockup">
        <img src="/inspiration-diary-icon.png" alt="灵感日记" />
        <strong>灵感日记</strong><span>/</span><b>标签工作台</b>
      </div>
      <div className="header-actions">
        <label className="global-search">
          <MagnifyingGlass size={17} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索知识、标签、别名…" />
          <kbd>⌘ K</kbd>
        </label>
        <button className="primary-button" onClick={onCreate}><Plus size={17} />新建私有标签</button>
      </div>
    </header>
  );
}

function TabBar({ activeTab, setActiveTab, pendingCount }) {
  return (
    <nav className="tab-bar" aria-label="标签工作台页面">
      {TABS.map(([id, label]) => (
        <button key={id} className={activeTab === id ? "tab-button is-active" : "tab-button"} onClick={() => setActiveTab(id)}>
          {label}
          {id === "review" && <span>{pendingCount}</span>}
          {id === "candidates" && <span>26</span>}
        </button>
      ))}
    </nav>
  );
}

function LibraryView({ activePath, tags, search, selectedTagId, setSelectedTagId, onCreate }) {
  const normalized = search.trim().toLowerCase();
  const visibleTags = tags.filter((tagItem) => !normalized || [tagItem.label, ...tagItem.aliases, tagItem.path].join(" ").toLowerCase().includes(normalized));
  const selected = tags.find((tagItem) => tagItem.id === selectedTagId) ?? visibleTags[0];

  return (
    <>
      <main className="main-panel library-panel">
        <div className="panel-header">
          <div>
            <span className="breadcrumb">{activePath}</span>
            <div className="title-line"><h1>{activePath.split(" / ").at(-1)}</h1><span className="system-label">系统分类</span><Info size={16} /></div>
            <p>维护可供图片、视频与文档分析使用的标准标签。</p>
          </div>
          <button className="secondary-button" onClick={onCreate}><Plus size={16} />添加标签</button>
        </div>
        <div className="toolbar-row">
          <label className="local-search"><MagnifyingGlass size={16} /><input placeholder="搜索本级标签" value={search} readOnly /></label>
          <button className="filter-button"><SlidersHorizontal size={16} />状态：全部</button>
          <button className="filter-button">适用媒介：全部<CaretDown size={13} /></button>
          <span className="result-count">共 {visibleTags.length} 个标签</span>
        </div>
        <div className="tag-table" role="table" aria-label="标准标签列表">
          <div className="tag-table-head" role="row">
            <span>标签名称</span><span>状态</span><span>别名</span><span>适用媒介</span><span>使用次数</span><span>AI 采纳率</span>
          </div>
          {visibleTags.map((tagItem) => (
            <button role="row" key={tagItem.id} className={selected?.id === tagItem.id ? "tag-table-row is-selected" : "tag-table-row"} onClick={() => setSelectedTagId(tagItem.id)}>
              <span className="tag-name"><Tag size={16} />{tagItem.label}<small className={tagItem.owner === "私有" ? "private-label" : "system-label"}>{tagItem.owner}</small></span>
              <span className="status-text"><i />{tagItem.status}</span>
              <span className="alias-cell">{tagItem.aliases.join("、")}</span>
              <span className="media-cell">{tagItem.media.map((medium) => <MediaBadge label={medium} key={medium} />)}</span>
              <span>{formatCount(tagItem.usage)}</span>
              <span>{tagItem.rate}%</span>
            </button>
          ))}
          {visibleTags.length === 0 && <div className="empty-state"><MagnifyingGlass size={28} /><strong>没有匹配的标签</strong><span>尝试搜索其他名称或别名。</span></div>}
        </div>
      </main>
      <aside className="inspector-panel">
        {selected && <TagInspector tagItem={selected} />}
      </aside>
    </>
  );
}

function DefinitionRow({ label, children }) {
  return <div className="definition-row"><dt>{label}</dt><dd>{children}</dd></div>;
}

function TagInspector({ tagItem }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="inspector-scroll">
      <div className="inspector-title"><div><span className="eyebrow">标准标签</span><h2>{tagItem.label}</h2></div><button className="icon-button" aria-label="编辑标签"><PencilSimple size={18} /></button></div>
      <div className="inspector-section">
        <h3>基础信息</h3>
        <dl>
          <DefinitionRow label="规范 ID"><button className="inline-copy" onClick={() => { navigator.clipboard?.writeText(tagItem.id); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }}>{tagItem.id}{copied ? <Check size={13} /> : <Copy size={13} />}</button></DefinitionRow>
          <DefinitionRow label="完整路径"><span>{tagItem.path}</span></DefinitionRow>
          <DefinitionRow label="别名"><span>{tagItem.aliases.join("、")}</span></DefinitionRow>
          <DefinitionRow label="适用媒介"><span className="media-cell">{tagItem.media.map((medium) => <MediaBadge key={medium} label={medium} />)}</span></DefinitionRow>
          <DefinitionRow label="描述"><span>{tagItem.description}</span></DefinitionRow>
          <DefinitionRow label="创建方式"><span>{tagItem.owner === "系统" ? "系统内置" : "用户扩展"}</span></DefinitionRow>
        </dl>
      </div>
      <div className="inspector-section stat-section">
        <h3>使用统计</h3>
        <div className="stat-grid"><div><strong>{formatCount(tagItem.usage)}</strong><span>使用次数</span></div><div><strong>{tagItem.rate}%</strong><span>AI 采纳率</span></div><div><strong>0.86</strong><span>关系权重</span></div></div>
      </div>
      <div className="inspector-section">
        <div className="section-title-row"><h3>AI 待确认知识</h3><button>全部查看<ArrowRight size={14} /></button></div>
        <div className="mini-review"><img src={REVIEW_ITEMS[0].image} alt="雾景湖面" /><div><strong>雾景湖面：清晨摄影</strong><span>置信度 89%</span></div><button>确认</button></div>
        <div className="mini-review"><img src={REVIEW_ITEMS[1].image} alt="人物摄影" /><div><strong>极简室内人物摄影</strong><span>置信度 84%</span></div><button>确认</button></div>
      </div>
      <div className="inspector-note"><ShieldCheck size={17} /><span>系统标签只读。你可以隐藏它，或在当前分类下补充私有标签。</span></div>
    </div>
  );
}

function ReviewView({ search, statuses, onAction, onConfirmAll, selectedId, setSelectedId, promoted, onPromote, onMerge, onViewTag }) {
  const normalized = search.trim().toLowerCase();
  const items = REVIEW_ITEMS.filter((item) => !normalized || [item.title, item.type, ...item.tags.flat()].join(" ").toLowerCase().includes(normalized));
  const selected = REVIEW_ITEMS.find((item) => item.id === selectedId) ?? REVIEW_ITEMS[0];
  return (
    <>
      <main className="main-panel review-panel">
        <div className="panel-header compact-header">
          <div><span className="eyebrow">内容标签审核</span><div className="title-line"><h1>AI 待确认</h1><span className="count-badge">12</span></div><p>AI 已为内容匹配标准标签，确认后才进入正式标签集。</p></div>
          <div className="header-button-row"><button className="filter-button">全部类型<CaretDown size={13} /></button><button className="filter-button">按置信度<CaretDown size={13} /></button><button className="primary-button" onClick={onConfirmAll}><Check size={16} />全部确认</button></div>
        </div>
        <div className="review-table-head"><span>内容与来源</span><span>AI 建议的标准标签</span><span>置信度</span><span>AI 依据</span><span>操作</span></div>
        <div className="review-list">
          {items.map((item) => {
            const status = statuses[item.id];
            return (
              <article key={item.id} className={`${selected.id === item.id ? "review-row is-selected" : "review-row"} ${status ? `is-${status}` : ""}`} onClick={() => setSelectedId(item.id)}>
                <div className="content-summary"><button className="row-radio" aria-label={`选择 ${item.title}`}><span /></button><img src={item.image} alt={item.title} /><div><strong>{item.title}</strong><span>{item.type}</span><small>来自：{item.source}</small></div></div>
                <div className="suggested-tags">{item.tags.map(([facet, label, confidence]) => <span key={`${facet}-${label}`}><small>{facet}</small><b>{label}</b><em>{confidence}%</em></span>)}</div>
                <strong className="confidence-number">{item.confidence}%</strong>
                <p className="evidence-copy">{item.evidence}</p>
                <div className="review-actions">
                  {status ? <span className={`decision-state ${status}`}><CheckCircle size={18} />{status === "confirmed" ? "已确认" : "已忽略"}</span> : <><button aria-label="确认" onClick={(event) => { event.stopPropagation(); onAction(item.id, "confirmed"); }}><Check size={17} /></button><button aria-label="忽略" onClick={(event) => { event.stopPropagation(); onAction(item.id, "ignored"); }}><X size={17} /></button></>}
                </div>
              </article>
            );
          })}
        </div>
        <div className="pagination"><span>共 12 条待确认</span><div><button disabled>上一页</button><strong>1 / 3</strong><button>下一页</button></div></div>
      </main>
      <aside className="inspector-panel candidate-inspector"><CandidateInspector candidate={CANDIDATES[0]} isPromoted={promoted[CANDIDATES[0].id]} onPromote={() => onPromote(CANDIDATES[0])} onMerge={() => onMerge(CANDIDATES[0])} onViewTag={() => onViewTag(CANDIDATES[0])} /></aside>
    </>
  );
}

function CandidateView({ selectedId, setSelectedId, promoted, onPromote, onMerge, onViewTag }) {
  const selected = CANDIDATES.find((candidate) => candidate.id === selectedId) ?? CANDIDATES[0];
  return (
    <>
      <main className="main-panel candidates-panel">
        <div className="panel-header compact-header"><div><span className="eyebrow">词库治理</span><div className="title-line"><h1>候选词</h1><span className="count-badge">26</span></div><p>合并 AI 未命中新概念，审核后再进入标准标签库。</p></div><div className="header-button-row"><button className="filter-button">全部媒介<CaretDown size={13} /></button><button className="filter-button">按出现次数<CaretDown size={13} /></button></div></div>
        <div className="candidate-list">
          {CANDIDATES.map((candidate) => (
            <button key={candidate.id} className={selected.id === candidate.id ? "candidate-row is-selected" : "candidate-row"} onClick={() => setSelectedId(candidate.id)}>
              <div><strong>{candidate.label}</strong><span>{candidate.suggestedPath}</span></div>
              <span><b>{candidate.occurrences}</b><small>出现次数</small></span>
              <span><b>{candidate.accepted}</b><small>人工采纳</small></span>
              <span><b>{candidate.rate}%</b><small>采纳率</small></span>
              <span className="candidate-media"><MediaBadge label={candidate.media} /></span>
              <ArrowRight size={18} />
            </button>
          ))}
        </div>
        <div className="candidate-guidance"><Info size={17} /><span>候选词不会自动进入系统词库。管理员需要确认标准名称、父级、别名和适用媒介。</span></div>
      </main>
      <aside className="inspector-panel candidate-inspector"><CandidateInspector candidate={selected} isPromoted={promoted[selected.id]} onPromote={() => onPromote(selected)} onMerge={() => onMerge(selected)} onViewTag={() => onViewTag(selected)} /></aside>
    </>
  );
}

function CandidateInspector({ candidate, isPromoted, onPromote, onMerge, onViewTag }) {
  const [name, setName] = useState(candidate.label);
  const [path, setPath] = useState(candidate.suggestedPath);
  const [aliases, setAliases] = useState(candidate.aliases.join("，"));
  return (
    <div className="inspector-scroll" key={candidate.id}>
      <div className="inspector-title"><div><span className="eyebrow">候选词晋升</span><h2>{candidate.label}</h2></div><Tray size={22} /></div>
      <div className="candidate-stats"><div><strong>{candidate.occurrences}</strong><span>出现次数</span></div><div><strong>{candidate.accepted}</strong><span>采纳次数</span></div><div><strong>{candidate.rate}%</strong><span>采纳率</span></div></div>
      <div className="inspector-section"><h3>可能的重复或别名</h3><div className="alias-pills">{candidate.aliases.map((alias) => <span key={alias}>{alias}</span>)}</div></div>
      <div className="promotion-form">
        <label><span>上级分类</span><select value={path} onChange={(event) => setPath(event.target.value)}><option>{candidate.suggestedPath}</option><option>我的扩展 / 待整理</option></select></label>
        <label><span>标准标签名</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label><span>别名</span><input value={aliases} onChange={(event) => setAliases(event.target.value)} /></label>
        <fieldset><legend>适用媒介</legend><label><input type="checkbox" defaultChecked={candidate.media === "图片"} />图片</label><label><input type="checkbox" defaultChecked={candidate.media === "视频"} />视频</label><label><input type="checkbox" defaultChecked={candidate.media === "文档"} />文档</label></fieldset>
      </div>
      <div className="inspector-note"><ShieldCheck size={17} /><span>晋升需要管理员审核，不会由 AI 自动执行；操作会写入词库审计记录。</span></div>
      {isPromoted ? <div className="promotion-success"><CheckCircle size={22} /><div><strong>已晋升为标准标签</strong><span>{path} / {name}</span></div><button onClick={onViewTag}>在标签库查看<ArrowRight size={15} /></button></div> : <div className="sticky-actions stacked-actions"><button className="secondary-button" onClick={onMerge}><GitMerge size={16} />合并为别名</button><button className="primary-button" onClick={onPromote}><ShieldCheck size={16} />晋升为标准标签</button></div>}
    </div>
  );
}

function AuditView() {
  return (
    <>
      <main className="main-panel audit-panel">
        <div className="panel-header compact-header"><div><span className="eyebrow">可追溯治理</span><div className="title-line"><h1>变更记录</h1></div><p>查看标签晋升、合并、停用与人工确认的完整历史。</p></div><button className="secondary-button"><Archive size={16} />导出记录</button></div>
        <div className="audit-list">{AUDIT_EVENTS.map((event, index) => <article key={`${event.time}-${event.subject}`}><div className="audit-marker"><span /><i /></div><time>{event.time}</time><div><strong>{event.action} · {event.subject}</strong><p>{event.detail}</p><span>操作人：{event.actor}</span></div>{index === 0 && <small>最新</small>}</article>)}</div>
      </main>
      <aside className="inspector-panel"><div className="inspector-scroll"><div className="inspector-title"><div><span className="eyebrow">词库版本</span><h2>v1.8.0</h2></div><ClockCounterClockwise size={22} /></div><div className="inspector-section"><h3>本次版本摘要</h3><ul className="summary-list"><li>新增 12 个标准标签</li><li>合并 8 组同义词</li><li>停用 3 个宽泛标签</li><li>回填 286 个历史知识节点</li></ul></div><div className="inspector-section"><h3>发布状态</h3><div className="release-status"><CheckCircle size={18} /><div><strong>已生效</strong><span>今天 10:35 发布</span></div></div></div><div className="inspector-note"><Info size={17} /><span>旧版本标签仍保留替代关系，历史知识节点不会丢失。</span></div></div></aside>
    </>
  );
}

function NewPrivateTagModal({ onClose, onSave }) {
  const [label, setLabel] = useState("");
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="new-tag-title">
        <div className="modal-header"><div><span className="eyebrow">我的扩展</span><h2 id="new-tag-title">新建私有标签</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div>
        <p>私有标签只属于当前用户，也可以添加到系统分类之下。</p>
        <div className="promotion-form">
          <label><span>标准标签名</span><input autoFocus value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：雾感留白" /></label>
          <label><span>所属分类</span><select defaultValue="图片视觉 / 色彩 / 饱和度"><option>图片视觉 / 色彩 / 饱和度</option><option>图片视觉 / 风格 / 视觉语言</option><option>我的扩展 / 项目专用</option></select></label>
          <label><span>别名</span><input placeholder="使用中文逗号分隔" /></label>
          <label><span>描述</span><textarea placeholder="说明这个标签应该在什么情况下使用" /></label>
          <fieldset><legend>适用媒介</legend><label><input type="checkbox" defaultChecked />图片</label><label><input type="checkbox" />视频</label><label><input type="checkbox" />文档</label></fieldset>
        </div>
        <div className="modal-actions"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!label.trim()} onClick={() => onSave(label.trim())}><Plus size={16} />创建标签</button></div>
      </section>
    </div>
  );
}

export function App() {
  const [activeTab, setActiveTab] = useState("review");
  const [search, setSearch] = useState("");
  const [activePath, setActivePath] = useState("图片视觉 / 色彩 / 饱和度");
  const [tags, setTags] = useState(INITIAL_TAGS);
  const [selectedTagId, setSelectedTagId] = useState("color.saturation.low");
  const [selectedReviewId, setSelectedReviewId] = useState("lake");
  const [selectedCandidateId, setSelectedCandidateId] = useState("silver-jk");
  const [pendingCount, setPendingCount] = useState(12);
  const [reviewStatuses, setReviewStatuses] = useState({});
  const [promoted, setPromoted] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState("");

  const flash = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  const handleReviewAction = (id, action) => {
    if (!reviewStatuses[id]) setPendingCount((count) => Math.max(0, count - 1));
    setReviewStatuses((current) => ({ ...current, [id]: action }));
    flash(action === "confirmed" ? "已确认 AI 标签，正式写入知识内容" : "已忽略这条标签建议");
  };

  const confirmAll = () => {
    const remaining = REVIEW_ITEMS.filter((item) => !reviewStatuses[item.id]);
    setReviewStatuses((current) => ({ ...current, ...Object.fromEntries(remaining.map((item) => [item.id, "confirmed"])) }));
    setPendingCount((count) => Math.max(0, count - remaining.length));
    flash(`已确认当前页 ${remaining.length} 条标签建议`);
  };

  const promoteCandidate = (candidate) => {
    setPromoted((current) => ({ ...current, [candidate.id]: true }));
    setTags((current) => current.some((tagItem) => tagItem.label === candidate.label) ? current : [...current, {
      id: `promoted.${candidate.id}`,
      label: candidate.label,
      aliases: candidate.aliases,
      media: [candidate.media],
      usage: candidate.occurrences,
      rate: Math.round(candidate.rate),
      status: "启用",
      owner: "系统",
      description: "由候选词池经管理员审核晋升的标准标签。",
      path: candidate.suggestedPath,
    }]);
    flash(`“${candidate.label}”已晋升为标准标签`);
  };

  const viewPromotedTag = (candidate) => {
    setSelectedTagId(`promoted.${candidate.id}`);
    setActivePath(candidate.suggestedPath);
    setActiveTab("library");
  };

  const createPrivateTag = (label) => {
    const id = `private.${Date.now()}`;
    setTags((current) => [...current, { id, label, aliases: [], media: ["图片"], usage: 0, rate: 0, status: "启用", owner: "私有", description: "用户创建的私有标准标签。", path: activePath }]);
    setSelectedTagId(id);
    setActiveTab("library");
    setModalOpen(false);
    flash(`私有标签“${label}”已创建`);
  };

  const content = useMemo(() => {
    if (activeTab === "library") return <LibraryView activePath={activePath} tags={tags} search={search} selectedTagId={selectedTagId} setSelectedTagId={setSelectedTagId} onCreate={() => setModalOpen(true)} />;
    if (activeTab === "review") return <ReviewView search={search} statuses={reviewStatuses} onAction={handleReviewAction} onConfirmAll={confirmAll} selectedId={selectedReviewId} setSelectedId={setSelectedReviewId} promoted={promoted} onPromote={promoteCandidate} onMerge={(candidate) => flash(`已将“${candidate.label}”加入待合并别名队列`)} onViewTag={viewPromotedTag} />;
    if (activeTab === "candidates") return <CandidateView selectedId={selectedCandidateId} setSelectedId={setSelectedCandidateId} promoted={promoted} onPromote={promoteCandidate} onMerge={(candidate) => flash(`已将“${candidate.label}”加入待合并别名队列`)} onViewTag={viewPromotedTag} />;
    return <AuditView />;
  }, [activeTab, activePath, tags, search, selectedTagId, reviewStatuses, selectedReviewId, selectedCandidateId, promoted]);

  return (
    <div className="app-shell">
      <Header search={search} setSearch={setSearch} onCreate={() => setModalOpen(true)} />
      <TabBar activeTab={activeTab} setActiveTab={setActiveTab} pendingCount={pendingCount} />
      <div className="workbench-grid">
        <Sidebar activePath={activePath} onSelectPath={(path) => { setActivePath(path); setActiveTab("library"); }} />
        {content}
      </div>
      {modalOpen && <NewPrivateTagModal onClose={() => setModalOpen(false)} onSave={createPrivateTag} />}
      {toast && <div className="toast-message" role="status"><CheckCircle size={18} />{toast}</div>}
    </div>
  );
}
