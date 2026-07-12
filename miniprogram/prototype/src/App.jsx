import { useMemo, useState } from "react";
import {
  Bell,
  BookOpen,
  CalendarDays,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Crop,
  Droplets,
  Download,
  Edit3,
  FileText,
  Grid3X3,
  Home,
  Image,
  Layers,
  Lock,
  LogIn,
  Maximize2,
  Palette,
  PenLine,
  Plus,
  Search,
  Settings,
  Sparkles,
  Star,
  Copy,
  Trash2,
  UserRound,
  Wand2,
  X,
} from "lucide-react";

const photoA = "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=900&q=80";
const photoB = "https://images.unsplash.com/photo-1493612276216-ee3925520721?auto=format&fit=crop&w=900&q=80";
const photoC = "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80";
const photoD = "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=900&q=80";
const photoE = "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80";
const avatar = "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=320&q=80";

const tabs = [
  { id: "diary", label: "灵感", icon: BookOpen },
  { id: "toolbox", label: "工具箱", icon: Wand2 },
  { id: "me", label: "我的", icon: UserRound },
];

const tools = [
  { id: "crop", name: "图片裁剪", desc: "比例、自由裁切", icon: Crop, category: "常用", accent: "green" },
  { id: "colorPick", name: "图片取色", desc: "提取主色和辅助色", icon: Palette, category: "色彩", accent: "lime" },
  { id: "pixel", name: "像素风", desc: "本地风格转化", icon: Grid3X3, category: "风格", accent: "lime" },
  { id: "filter", name: "滤镜风格", desc: "胶片、漫画、低饱和", icon: Palette, category: "风格", accent: "mint" },
  { id: "palette", name: "色卡配色", desc: "生成灵感色卡", icon: Sparkles, category: "色彩", accent: "color" },
  { id: "gradient", name: "渐变色卡", desc: "封面渐变方案", icon: Droplets, category: "色彩", accent: "color" },
  { id: "contrast", name: "对比度检测", desc: "检查文字可读性", icon: Check, category: "色彩", accent: "plain" },
  { id: "rgbhex", name: "RGB 转 HEX", desc: "颜色格式转换", icon: FileText, category: "色彩", accent: "plain" },
  { id: "watermark", name: "加水印", desc: "文字和日期印记", icon: PenLine, category: "常用", accent: "ink" },
  { id: "film", name: "胶片感", desc: "暖色颗粒", icon: Droplets, category: "风格", accent: "soft" },
  { id: "ai", name: "AI 高级风格", desc: "登录后开放", icon: Sparkles, category: "AI", accent: "locked", locked: true },
  { id: "more", name: "所有工具", desc: "扩展入口", icon: Layers, category: "更多", accent: "plain" },
];

const featuredToolIds = ["colorPick", "pixel", "filter"];

const colorSwatches = [
  { name: "雾面绿", hex: "#B7FF38" },
  { name: "纸张白", hex: "#FFFAF1" },
  { name: "墨黑", hex: "#111111" },
  { name: "雾蓝", hex: "#C8E8FF" },
  { name: "木质棕", hex: "#9A8064" },
];

const diaryCards = [
  { id: "1", day: "周一", title: "雾气山谷色彩", type: "image", image: photoA, tags: ["雾面绿", "自然层次", "留白"], time: "09:42" },
  { id: "2", day: "周一", title: "午后海报草图", type: "image", image: photoB, tags: ["版式", "柔光", "纸感"], time: "11:25" },
  {
    id: "3",
    day: "周二",
    title: "产品海报手稿",
    type: "md",
    image: photoB,
    tags: ["手稿", "文案方向"],
    time: "14:18",
    summary: "围绕工具箱首屏和灵感日记转化路径，整理 banner 文案、入口层级和保存到每日灵感的交互。",
    md: [
      { kind: "h1", text: "产品海报手稿" },
      { kind: "p", text: "目标是让未登录用户先被工具箱吸引，同时明确知道这个小程序真正沉淀的是灵感日记。" },
      { kind: "h2", text: "首屏结构" },
      { kind: "li", text: "顶部推广图展示灵感日记价值，不使用纯会员广告位。" },
      { kind: "li", text: "重点工具做成异形入口，普通能力进入可扩展网格。" },
      { kind: "li", text: "工具卡片支持扩展，不把首页写死为四个功能。" },
      { kind: "quote", text: "处理后的图片不是结束点，而是进入每日灵感的入口。" },
      { kind: "h2", text: "保存流程" },
      { kind: "p", text: "点击保存到灵感册后，选择日期，填写备注，再调用 Web 后端上传原图、生成缩略图 URL 和 AI 标签。" },
      { kind: "code", text: "tool result -> choose day -> PhotoPrism -> AI tags -> daily card" },
    ],
  },
  { id: "4", day: "周四", title: "像素风灵感", type: "image", image: photoD, tags: ["像素风", "复古", "霓虹"], time: "20:07" },
  { id: "5", day: "周四", title: "黑白漫画滤镜", type: "image", image: photoC, tags: ["漫画", "高对比"], time: "18:30" },
  { id: "6", day: "周四", title: "水印版式测试", type: "image", image: photoA, tags: ["水印", "留白"], time: "12:06" },
  { id: "7", day: "周末", title: "周末拼贴参考", type: "image", image: photoE, tags: ["拼贴", "旅行", "轻盈"], time: "16:33" },
];

const recommendCards = [
  { title: "像素头像", image: photoD },
  { title: "周记封面", image: photoC },
  { title: "胶片水印", image: photoE },
];

const collections = [
  { id: "ui", name: "UI 参考", desc: "界面、入口和组件灵感", count: 8, cover: photoA, tags: ["界面", "入口"] },
  { id: "poster", name: "海报文案", desc: "活动图、标题和转化文案", count: 5, cover: photoB, tags: ["文案", "版式"] },
  { id: "pixel", name: "像素风", desc: "复古、霓虹和头像方向", count: 4, cover: photoD, tags: ["像素", "风格"] },
];

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function AppChrome({ activeTab, setActiveTab, children }) {
  return (
    <div className="stage">
      <div className={cx("phone", activeTab === "toolbox" && "promo-phone")}>
        <div className="status">
          <span>17:42</span>
          <div className="pill">灵感日记</div>
          <span>5G 93</span>
        </div>
        <div className="screen">{children}</div>
        <nav className="tabbar">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={cx("tab", activeTab === tab.id && "active")}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={22} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

function PromoBanner({ compact = false, onLogin }) {
  return (
    <section className={cx("promo", compact && "compact")}>
      <div>
        <div className="promo-eyebrow">
          <Sparkles size={16} />
          Inspiration Diary
        </div>
        <h1>AI 灵感册</h1>
        <p>图片、手稿、标签，一键整理成每周记录。</p>
      </div>
      <div className="promo-card-stack" aria-hidden="true">
        <img src={photoA} alt="" />
        <img src={photoB} alt="" />
        <img src={photoD} alt="" />
      </div>
    </section>
  );
}

function Toolbox({ loggedIn, setLoggedIn, openTool, setActiveTab }) {
  const [category, setCategory] = useState("常用");
  const featuredTools = tools.filter((tool) => featuredToolIds.includes(tool.id));
  const visibleTools = useMemo(() => {
    const regularTools = tools.filter((tool) => !featuredToolIds.includes(tool.id));
    if (category === "常用") return regularTools.filter((tool) => ["图片裁剪", "加水印", "胶片感", "所有工具"].includes(tool.name));
    return regularTools.filter((tool) => tool.category === category);
  }, [category]);

  return (
    <div className="page toolbox">
      <section className="toolbox-hero">
        <PromoBanner compact={loggedIn} onLogin={() => setLoggedIn(true)} />
      </section>

      <section className="featured-tools">
        {featuredTools.map((tool, index) => {
          const Icon = tool.icon;
          return (
            <button
              type="button"
              key={tool.id}
              className={cx("featured-tool", index === 0 ? "main-feature" : "side-feature")}
              onClick={() => openTool(tool.id)}
            >
              <span>{index === 0 ? "色彩灵感" : "重点工具"}</span>
              <Icon size={index === 0 ? 38 : 30} />
              <strong>{tool.name}</strong>
              <em>{tool.desc}</em>
            </button>
          );
        })}
      </section>

      <div className="category-tabs">
        {["常用", "色彩", "风格", "AI", "更多"].map((item) => (
          <button
            type="button"
            key={item}
            className={category === item ? "selected" : ""}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="tool-grid">
        {visibleTools.map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              type="button"
              key={tool.id}
              className={cx("tool-tile", tool.accent)}
              onClick={() => (tool.locked && !loggedIn ? setLoggedIn(true) : openTool(tool.id))}
            >
              {tool.locked && !loggedIn ? <Lock size={18} className="lock" /> : null}
              <Icon size={28} />
              <strong>{tool.name}</strong>
              <span>{tool.desc}</span>
            </button>
          );
        })}
      </div>

      <section className="recommend">
        <div className="section-head">
          <h2>为你推荐</h2>
          <button type="button" onClick={() => setActiveTab("diary")}>
            看灵感册
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="rec-strip">
          {recommendCards.map((card) => (
            <article key={card.title} className="rec-card">
              <img src={card.image} alt={card.title} />
              <span>{card.title}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Diary({
  loggedIn,
  setLoggedIn,
  openDetail,
  openUploadSheet,
  openDay,
  openSearch,
  openWeekPicker,
  openSummary,
  openCollections,
}) {
  if (!loggedIn) {
    return (
      <div className="page diary logged-out">
        <section className="diary-preview">
          <div className="logged-out-hero">
            <div>
              <span className="hero-kicker">
                <BookOpen size={15} />
                Inspiration Diary
              </span>
              <h1>把每天的视觉灵感整理成册</h1>
              <p>图片、Markdown、色卡和标签会按日期沉淀，也能收录进不同灵感册。</p>
              <button type="button" className="primary" onClick={() => setLoggedIn(true)}>
                <LogIn size={16} />
                登录查看
              </button>
            </div>
            <div className="preview-book-stack" aria-hidden="true">
              <img src={photoA} alt="" />
              <img src={photoB} alt="" />
              <img src={photoD} alt="" />
            </div>
          </div>

          <div className="preview-capabilities">
            {[
              { label: "图片", value: "原图 / 缩略图", icon: Image },
              { label: "文档", value: "MD 摘要", icon: FileText },
              { label: "色卡", value: "图片取色", icon: Palette },
              { label: "总结", value: "每周整理", icon: Sparkles },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.label}>
                  <Icon size={18} />
                  <strong>{item.label}</strong>
                  <span>{item.value}</span>
                </article>
              );
            })}
          </div>

          <div className="mini-week">
            {["周一", "周二", "周三", "周四"].map((day, index) => (
              <div key={day} className="mini-day">
                <span>{day}</span>
                <img src={[photoA, photoB, photoD, photoE][index]} alt="" />
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page diary">
      <header className="diary-header">
        <div>
          <span className="caption">本周灵感</span>
          <h1>Jun 22 - Jun 28</h1>
        </div>
        <div className="header-actions">
          <button type="button" className="icon-btn" onClick={openSearch}>
            <Search size={21} />
          </button>
          <button type="button" className="icon-btn" onClick={openWeekPicker}>
            <CalendarDays size={21} />
          </button>
        </div>
      </header>

      <div className="week-switcher">
        <button type="button">
          <ChevronLeft size={16} />
        </button>
        <span>第 26 周</span>
        <button type="button">
          <ChevronRight size={16} />
        </button>
      </div>

      <button type="button" className="weekly-summary-card" onClick={openSummary}>
        <div>
          <span className="summary-label">本周总结</span>
          <strong>7 条灵感 · 1 篇手稿 · 12 个标签</strong>
          <p>AI 已整理本周风格：自然层次、纸感版式、像素复古。</p>
        </div>
        <span className="summary-action">查看</span>
      </button>

      <section className="collection-strip">
        <div className="section-head compact">
          <h2>我的灵感册</h2>
          <button type="button" onClick={openCollections}>
            管理
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="collection-row">
          {collections.slice(0, 3).map((collection) => (
            <button type="button" key={collection.id} onClick={openCollections}>
              <img src={collection.cover} alt="" />
              <strong>{collection.name}</strong>
              <span>{collection.count} 条</span>
            </button>
          ))}
          <button type="button" className="new-collection-card" onClick={openCollections}>
            <Plus size={22} />
            <strong>新增</strong>
            <span>创建册子</span>
          </button>
        </div>
      </section>

      <section className="day-list">
        {["周一", "周二", "周三", "周四", "周五", "周末"].map((day) => {
          const cards = diaryCards.filter((card) => card.day === day);
          const coverCard = cards[0];
          return (
            <article key={day} className="day-section">
              <div className="day-title">
                <strong>{day}</strong>
                <span>{cards.length ? `${cards.length} 条灵感` : "等待记录"}</span>
              </div>
              {cards.length ? (
                <button type="button" className="day-cover-card" onClick={() => openDay(day)}>
                  <div className="cover-stack">
                    {cards.slice(0, 3).map((card, index) => (
                      <img key={card.id} src={card.image} alt="" style={{ "--stack": index }} />
                    ))}
                    {cards.length > 1 && <span>+{cards.length}</span>}
                  </div>
                  <div>
                    <span className="type-pill">{coverCard.type === "md" ? "MD" : "IMG"}</span>
                    <h3>{coverCard.title}</h3>
                    <p>{coverCard.tags.slice(0, 3).join(" / ")}</p>
                  </div>
                  <ChevronRight size={19} />
                </button>
              ) : (
                <button type="button" className="empty-day" onClick={openUploadSheet}>
                  <Plus size={18} />
                  添加今天的灵感
                </button>
              )}
            </article>
          );
        })}
      </section>

      <button type="button" className="floating-add" onClick={openUploadSheet}>
        <Plus size={28} />
      </button>
    </div>
  );
}

function Me({ loggedIn, setLoggedIn }) {
  return (
    <div className="page me">
      <header className="me-top">
        <button type="button" className="icon-btn">
          <Layers size={24} />
        </button>
        <button type="button" className="icon-btn">
          <Bell size={22} />
        </button>
      </header>

      <section className="profile">
        <img src={avatar} alt="用户头像" />
        <div>
          <h1>{loggedIn ? "星璇" : "未登录"}</h1>
          <p>{loggedIn ? "把每天的视觉灵感留成一本册子" : "登录后保存灵感、同步作品和原图"}</p>
        </div>
      </section>

      <div className="stats">
        <div><strong>{loggedIn ? 42 : 0}</strong><span>灵感数</span></div>
        <div><strong>{loggedIn ? 7 : 0}</strong><span>本周记录</span></div>
        <div><strong>{loggedIn ? 18 : 0}</strong><span>工具使用</span></div>
      </div>

      <div className="me-cards">
        <button type="button">
          <FileText size={26} />
          <strong>我的草稿</strong>
          <span>工具处理未保存内容</span>
        </button>
        <button type="button">
          <Download size={26} />
          <strong>本地缓存</strong>
          <span>清理预览和临时图</span>
        </button>
      </div>

      <div className="profile-tabs">
        <button className="active" type="button">灵感册</button>
        <button type="button">工具作品</button>
        <button type="button">收藏</button>
      </div>

      <div className="work-grid">
        {[photoA, photoB, photoD].map((photo, index) => (
          <div key={photo}>
            <img src={photo} alt="" />
            {index === 1 ? <span>草稿</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolEditor({ toolId, closeEditor, openSaveSheet }) {
  const tool = tools.find((item) => item.id === toolId) || tools[0];
  const Icon = tool.icon;
  const isColorTool = tool.category === "色彩";
  return (
    <div className="overlay">
      <div className="editor">
        <header>
          <button type="button" onClick={closeEditor}>
            <ChevronLeft size={22} />
          </button>
          <strong>{tool.name}</strong>
          <button type="button">重置</button>
        </header>

        <div className={cx("editor-canvas", tool.id === "pixel" && "pixelated", isColorTool && "color-canvas")}>
          <img src={photoC} alt="编辑预览" />
          <div className="canvas-badge">
            <Icon size={16} />
            {tool.name}
          </div>
          {isColorTool && (
            <div className="color-result-card">
              <span>从图片提取</span>
              <strong>自然雾面色卡</strong>
              <div className="picked-colors">
                {colorSwatches.map((color) => (
                  <button type="button" key={color.hex} style={{ "--swatch": color.hex }}>
                    <i />
                    <b>{color.hex}</b>
                    <em>{color.name}</em>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <section className="controls">
          <div className="control-head">
            <strong>{isColorTool ? "色卡结果" : "参数面板"}</strong>
            <span>{isColorTool ? "可复制 / 可保存" : "本地预览"}</span>
          </div>
          {isColorTool ? (
            <div className="color-tool-options">
              <button type="button" className="active">主色</button>
              <button type="button">辅助色</button>
              <button type="button">渐变</button>
              <button type="button">对比度 8.2</button>
            </div>
          ) : (
            <>
              <div className="slider-row">
                <span>强度</span>
                <div><i style={{ width: "66%" }} /></div>
                <b>66</b>
              </div>
              <div className="option-row">
                {["自然", "像素", "胶片", "手帐"].map((item, index) => (
                  <button key={item} type="button" className={index === 1 ? "active" : ""}>{item}</button>
                ))}
              </div>
            </>
          )}
          <div className="editor-actions">
            <button type="button" onClick={closeEditor}>{isColorTool ? "复制色值" : "保存到相册"}</button>
            <button type="button" className="primary" onClick={openSaveSheet}>
              {isColorTool ? "保存色卡到灵感册" : "保存到灵感册"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function EditableTags({ tags }) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className={cx("tag-editor", isEditing && "editing")}>
      <div className="tag-cloud">
        {tags.map((tag) => (
          <button type="button" className={cx("tag-chip", isEditing && "removable")} key={tag}>
            <span>{tag}</span>
            {isEditing && <X size={12} />}
          </button>
        ))}
        {isEditing && (
          <button type="button" className="tag-chip add-tag">
            <Plus size={13} />
            自定义新增
          </button>
        )}
        <button type="button" className="tag-edit-toggle" onClick={() => setIsEditing((value) => !value)}>
          <Edit3 size={13} />
          {isEditing ? "完成" : "编辑标签"}
        </button>
      </div>
    </div>
  );
}

function DetailModal({ card, onClose, openCollect }) {
  if (card.type === "md") {
    return (
      <div className="overlay">
        <div className="md-reader">
          <header>
            <button type="button" onClick={onClose}>
              <X size={22} />
            </button>
            <strong>手稿阅读</strong>
            <div className="detail-header-actions">
              <button type="button" aria-label="收录到灵感册" onClick={() => openCollect(card)}>
                <BookOpen size={20} />
              </button>
              <button type="button" aria-label="下载文档">
                <Download size={20} />
              </button>
            </div>
          </header>
          <div className="detail-actions">
            <button type="button">
              <Copy size={16} />
              复制
            </button>
          </div>
          <EditableTags tags={card.tags} />
          <article className="md-paper">
            {(card.md || []).map((block, index) => {
              if (block.kind === "h1") return <h1 key={index}>{block.text}</h1>;
              if (block.kind === "h2") return <h2 key={index}>{block.text}</h2>;
              if (block.kind === "li") return <p key={index} className="md-li">{block.text}</p>;
              if (block.kind === "quote") return <blockquote key={index}>{block.text}</blockquote>;
              if (block.kind === "code") return <pre key={index}>{block.text}</pre>;
              return <p key={index}>{block.text}</p>;
            })}
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay">
      <div className="detail">
          <header>
            <button type="button" onClick={onClose}>
              <X size={22} />
            </button>
            <strong>{card.title}</strong>
            <div className="detail-header-actions">
              <button type="button" aria-label="收录到灵感册" onClick={() => openCollect(card)}>
                <BookOpen size={20} />
              </button>
              <button type="button" aria-label="下载原图">
                <Download size={20} />
              </button>
            </div>
          </header>
        <div className="detail-image">
          <img src={card.image} alt={card.title} />
          <div className="zoom-tools">
            <span>4032 x 3024</span>
            <button type="button"><Maximize2 size={17} /> 原始</button>
          </div>
        </div>
        <section>
          <EditableTags tags={card.tags} />
          <div className="detail-actions image-actions">
            <button type="button">
              <Download size={16} />
              下载原图
            </button>
          </div>
          <p>原图通过后端代理加载，外部卡片仍然使用 PhotoPrism 缩略图。</p>
        </section>
      </div>
    </div>
  );
}

function CollectionsModal({ onClose, openCollect }) {
  const [activeCollectionId, setActiveCollectionId] = useState(collections[0].id);
  const activeCollection = collections.find((collection) => collection.id === activeCollectionId) || collections[0];
  const bookCards = diaryCards.slice(0, activeCollection.count);

  return (
    <div className="overlay">
      <div className="collections-modal">
        <header>
          <button type="button" onClick={onClose}>
            <ChevronLeft size={22} />
          </button>
          <div>
            <strong>我的灵感册</strong>
            <span>把每日灵感收录成专题</span>
          </div>
          <button type="button">
            <Plus size={21} />
          </button>
        </header>
        <div className="books-workspace">
          <aside className="books-sidebar">
            <div className="bookshelf-label">BOOKSHELF</div>
            <label className="book-search">
              <Search size={14} />
              <input placeholder="搜索册子" />
            </label>
            <div className="book-list">
              {collections.map((collection) => (
                <button
                  type="button"
                  key={collection.id}
                  className={collection.id === activeCollection.id ? "active" : ""}
                  onClick={() => setActiveCollectionId(collection.id)}
                >
                  <img src={collection.cover} alt="" />
                  <span>
                    <strong>{collection.name}</strong>
                    <em>{collection.count} 条灵感</em>
                  </span>
                </button>
              ))}
            </div>
            <div className="book-crud">
              <button type="button">
                <Plus size={15} />
                新建
              </button>
              <button type="button">
                <Edit3 size={15} />
                编辑
              </button>
              <button type="button" className="danger">
                <Trash2 size={15} />
                删除
              </button>
            </div>
          </aside>
          <main className="book-content">
            <section className="book-title-row">
              <div>
                <span>当前灵感册</span>
                <h2>{activeCollection.name}</h2>
                <p>{activeCollection.desc}</p>
              </div>
              <button type="button" onClick={() => openCollect(diaryCards[0])}>
                <BookOpen size={16} />
                收录
              </button>
            </section>
            <div className="book-tag-row">
              {activeCollection.tags.map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
            </div>
            <div className="book-items">
              {bookCards.map((card, index) => (
                <article key={card.id} className={index === 0 ? "cover" : ""}>
                  <div className="book-item-thumb">
                    <img src={card.image} alt="" />
                    {index === 0 ? <b>封面</b> : null}
                  </div>
                  <strong>{card.title}</strong>
                  <p>{card.tags.map((tag) => `#${tag}`).join(" ")}</p>
                </article>
              ))}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function CollectSheet({ card, onClose }) {
  const [selected, setSelected] = useState(["ui"]);

  return (
    <div className="sheet-backdrop">
      <div className="collect-sheet">
        <button type="button" className="sheet-close" onClick={onClose}>
          <X size={19} />
        </button>
        <h2>收录到灵感册</h2>
        <p>{card.title} 仍保留在每日灵感中，这里只是加入专题册。</p>
        <div className="collect-options">
          {collections.map((collection) => {
            const active = selected.includes(collection.id);
            return (
              <button
                type="button"
                key={collection.id}
                className={active ? "active" : ""}
                onClick={() => {
                  setSelected((items) => (
                    items.includes(collection.id)
                      ? items.filter((item) => item !== collection.id)
                      : [...items, collection.id]
                  ));
                }}
              >
                <img src={collection.cover} alt="" />
                <div>
                  <strong>{collection.name}</strong>
                  <span>{collection.count} 条灵感</span>
                </div>
                {active ? <Check size={18} /> : null}
              </button>
            );
          })}
        </div>
        <button type="button" className="new-inline-collection">
          <Plus size={17} />
          新建灵感册并收录
        </button>
        <button type="button" className="primary full" onClick={onClose}>完成收录</button>
      </div>
    </div>
  );
}

function DayListModal({ day, cards, onClose, openDetail, openUploadSheet }) {
  return (
    <div className="overlay">
      <div className="day-list-modal">
        <header>
          <button type="button" onClick={onClose}>
            <ChevronLeft size={22} />
          </button>
          <div>
            <strong>{day}</strong>
            <span>{cards.length} 条灵感，按时间倒序</span>
          </div>
          <button type="button" onClick={openUploadSheet}>
            <Plus size={21} />
          </button>
        </header>
        <div className="day-gallery">
          {cards.map((card) => (
            <button key={card.id} type="button" className="day-gallery-card" onClick={() => openDetail(card)}>
              <img src={card.image} alt={card.title} />
              <div>
                <span className="type-pill">{card.type === "md" ? "MD" : "IMG"}</span>
                <h3>{card.title}</h3>
                <p>{card.tags.join(" / ")}</p>
              </div>
              <time>{card.time}</time>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function UploadChoiceSheet({ onClose, openSaveSheet }) {
  const choices = [
    { id: "camera", title: "拍照", desc: "调用相机拍一张今天的灵感", icon: Camera },
    { id: "album", title: "从相册选择", desc: "可选择一张或多张图片", icon: Image },
    { id: "md", title: "Markdown / 文本", desc: "上传手稿并生成摘要标签", icon: FileText },
    { id: "toolbox", title: "从工具箱图片选择", desc: "把刚处理的图片保存进灵感册", icon: Wand2 },
  ];

  return (
    <div className="sheet-backdrop">
      <div className="upload-sheet">
        <button type="button" className="sheet-close" onClick={onClose}>
          <X size={19} />
        </button>
        <h2>添加每日灵感</h2>
        <p>选择来源后进入确认页，默认保存到今天，也可以改到本周任意一天。</p>
        <div className="upload-options">
          {choices.map((choice) => {
            const Icon = choice.icon;
            return (
              <button
                key={choice.id}
                type="button"
                onClick={() => {
                  onClose();
                  openSaveSheet();
                }}
              >
                <Icon size={24} />
                <div>
                  <strong>{choice.title}</strong>
                  <span>{choice.desc}</span>
                </div>
                <ChevronRight size={18} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SearchPanel({ onClose, openDetail }) {
  const [query, setQuery] = useState("像素风");
  const [filter, setFilter] = useState("全部");
  const filters = ["全部", "图片", "MD", "标签"];
  const normalizedQuery = query.trim();
  const results = diaryCards.filter((card) => {
    const matchesType = filter === "全部"
      || (filter === "图片" && card.type === "image")
      || (filter === "MD" && card.type === "md")
      || filter === "标签";
    const text = [card.title, card.summary, ...(card.tags || [])].join(" ");
    const matchesQuery = !normalizedQuery || text.includes(normalizedQuery);
    return matchesType && matchesQuery;
  });

  return (
    <div className="overlay">
      <div className="search-panel">
        <header>
          <button type="button" onClick={onClose}>
            <ChevronLeft size={22} />
          </button>
          <label>
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
          </label>
        </header>
        <div className="search-filters">
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <section className="recent-search">
          <span>最近搜索</span>
          <button type="button" onClick={() => setQuery("手稿")}>手稿</button>
          <button type="button" onClick={() => setQuery("留白")}>留白</button>
          <button type="button" onClick={() => setQuery("像素风")}>像素风</button>
        </section>
        <div className="search-results">
          {results.map((card) => (
            <button
              key={card.id}
              type="button"
              className="search-result-card"
              onClick={() => {
                onClose();
                openDetail(card);
              }}
            >
              <img src={card.image} alt={card.title} />
              <div>
                <span className="type-pill">{card.type === "md" ? "MD" : "IMG"}</span>
                <h3>{card.title}</h3>
                <p>{card.day} · {card.time} · {card.tags.join(" / ")}</p>
              </div>
            </button>
          ))}
          {results.length === 0 && (
            <div className="empty-search">
              <Search size={30} />
              <strong>没有找到相关灵感</strong>
              <span>试试搜索标签、手稿标题或摘要内容。</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WeekPickerSheet({ onClose, openSummary }) {
  const weeks = [
    { range: "Jun 22 - Jun 28", count: 7, summary: "已生成", active: true },
    { range: "Jun 15 - Jun 21", count: 12, summary: "查看总结" },
    { range: "Jun 08 - Jun 14", count: 5, summary: "查看总结" },
    { range: "Jun 01 - Jun 07", count: 9, summary: "待生成" },
    { range: "May 25 - May 31", count: 4, summary: "查看总结" },
  ];

  return (
    <div className="sheet-backdrop">
      <div className="week-sheet">
        <button type="button" className="sheet-close" onClick={onClose}>
          <X size={19} />
        </button>
        <h2>切换周视图</h2>
        <p>选择最近一周查看每日灵感。完整月历可以后续再扩展。</p>
        <div className="week-options">
          {weeks.map((week, index) => (
            <div
              key={week.range}
              className={week.active ? "week-option active" : "week-option"}
            >
              <button type="button" className="week-select" onClick={onClose}>
                <div>
                  <strong>第 {26 - index} 周</strong>
                  <span>{week.range}</span>
                </div>
                <b>{week.count} 条</b>
              </button>
              <button
                type="button"
                className="week-summary-link"
                onClick={() => {
                  onClose();
                  openSummary();
                }}
              >
                {week.summary}
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="primary full" onClick={onClose}>回到本周</button>
      </div>
    </div>
  );
}

function WeeklySummaryModal({ onClose }) {
  const keywords = ["自然层次", "纸感版式", "像素复古", "雾面绿", "留白"];

  return (
    <div className="overlay">
      <div className="weekly-summary-modal">
        <header>
          <button type="button" onClick={onClose}>
            <X size={21} />
          </button>
          <strong>本周总结</strong>
          <button type="button">
            <Download size={20} />
          </button>
        </header>
        <main>
          <section className="summary-hero">
            <span>Jun 22 - Jun 28 · 第 26 周</span>
            <h1>自然层次与纸感版式的一周</h1>
            <p>本周灵感集中在雾面绿色、柔光纸张、像素复古和水印留白，适合沉淀成轻量工具箱首屏方向。</p>
          </section>

          <section className="summary-stats">
            <div>
              <strong>7</strong>
              <span>图片灵感</span>
            </div>
            <div>
              <strong>1</strong>
              <span>手稿</span>
            </div>
            <div>
              <strong>12</strong>
              <span>标签</span>
            </div>
          </section>

          <section className="summary-block">
            <h2>关键词</h2>
            <div className="summary-tags">
              {keywords.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </section>

          <section className="summary-block">
            <h2>图片灵感</h2>
            <p>周一和周四的图片更偏轻柔自然，适合做首页推广图、工具箱入口背景和滤镜预设封面。</p>
          </section>

          <section className="summary-block">
            <h2>手稿摘要</h2>
            <p>产品海报手稿强调未登录工具箱的吸引力，同时需要把用户带回每日灵感，形成记录和整理闭环。</p>
          </section>
        </main>
        <footer className="summary-actions">
          <button type="button">复制总结</button>
          <button type="button">下载 Markdown</button>
        </footer>
      </div>
    </div>
  );
}

function SaveSheet({ onClose, setLoggedIn, loggedIn, setActiveTab }) {
  return (
    <div className="sheet-backdrop">
      <div className="save-sheet">
        <button type="button" className="sheet-close" onClick={onClose}>
          <X size={19} />
        </button>
        <div className="checkmark">
          <Check size={28} />
        </div>
        <h2>{loggedIn ? "保存到灵感册" : "登录后保存到灵感册"}</h2>
        <p>选择日期后，图片会进入 PhotoPrism，灵感标签由 Web 后端生成。</p>
        <div className="date-picker">
          {["今天", "周一", "周二", "周末"].map((item, index) => (
            <button key={item} type="button" className={index === 0 ? "active" : ""}>{item}</button>
          ))}
        </div>
        <textarea placeholder="可选：写一句备注，比如这张图为什么值得保存" />
        <button
          type="button"
          className="primary full"
          onClick={() => {
            setLoggedIn(true);
            setActiveTab("diary");
            onClose();
          }}
        >
          {loggedIn ? "确认保存" : "微信登录并保存"}
        </button>
      </div>
    </div>
  );
}

export function App() {
  const [activeTab, setActiveTab] = useState("toolbox");
  const [loggedIn, setLoggedIn] = useState(false);
  const [editingTool, setEditingTool] = useState(null);
  const [detailCard, setDetailCard] = useState(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [activeDay, setActiveDay] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [collectCard, setCollectCard] = useState(null);
  const activeDayCards = activeDay ? diaryCards.filter((card) => card.day === activeDay) : [];
  const openCollect = (card) => {
    setCollectCard(card);
  };

  return (
    <AppChrome activeTab={activeTab} setActiveTab={setActiveTab}>
      {activeTab === "toolbox" && (
        <Toolbox
          loggedIn={loggedIn}
          setLoggedIn={setLoggedIn}
          setActiveTab={setActiveTab}
          openTool={(id) => setEditingTool(id)}
        />
      )}
      {activeTab === "diary" && (
        <Diary
          loggedIn={loggedIn}
          setLoggedIn={setLoggedIn}
          openDetail={setDetailCard}
          openUploadSheet={() => setUploadOpen(true)}
          openDay={setActiveDay}
          openSearch={() => setSearchOpen(true)}
          openWeekPicker={() => setWeekPickerOpen(true)}
          openSummary={() => setSummaryOpen(true)}
          openCollections={() => setCollectionsOpen(true)}
        />
      )}
      {activeTab === "me" && <Me loggedIn={loggedIn} setLoggedIn={setLoggedIn} />}

      {editingTool && (
        <ToolEditor
          toolId={editingTool}
          closeEditor={() => setEditingTool(null)}
          openSaveSheet={() => setSaveOpen(true)}
        />
      )}
      {detailCard && (
        <DetailModal
          card={detailCard}
          onClose={() => setDetailCard(null)}
          openCollect={openCollect}
        />
      )}
      {activeDay && (
        <DayListModal
          day={activeDay}
          cards={activeDayCards}
          onClose={() => setActiveDay(null)}
          openDetail={(card) => {
            setActiveDay(null);
            setDetailCard(card);
          }}
          openUploadSheet={() => setUploadOpen(true)}
        />
      )}
      {uploadOpen && (
        <UploadChoiceSheet
          onClose={() => setUploadOpen(false)}
          openSaveSheet={() => setSaveOpen(true)}
        />
      )}
      {searchOpen && (
        <SearchPanel
          onClose={() => setSearchOpen(false)}
          openDetail={setDetailCard}
        />
      )}
      {weekPickerOpen && (
        <WeekPickerSheet
          onClose={() => setWeekPickerOpen(false)}
          openSummary={() => setSummaryOpen(true)}
        />
      )}
      {summaryOpen && <WeeklySummaryModal onClose={() => setSummaryOpen(false)} />}
      {collectionsOpen && (
        <CollectionsModal
          onClose={() => setCollectionsOpen(false)}
          openCollect={openCollect}
        />
      )}
      {collectCard && <CollectSheet card={collectCard} onClose={() => setCollectCard(null)} />}
      {saveOpen && (
        <SaveSheet
          loggedIn={loggedIn}
          setLoggedIn={setLoggedIn}
          setActiveTab={setActiveTab}
          onClose={() => setSaveOpen(false)}
        />
      )}
    </AppChrome>
  );
}
