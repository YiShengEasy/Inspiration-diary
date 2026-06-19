import React, { useState, useEffect, useRef } from "react";
import { ImageCard, WeeklyNote } from "./types";
import { motion, AnimatePresence } from "motion/react";
import {
  subscribeCards,
  subscribeAllCards,
  loadNote,
  saveNote,
  createNewCardId,
  saveCard,
  deleteCard,
  updateCardTerms,
  loadSettings,
  saveSettings,
} from "./lib/dbClient";
import TimelineHeader from "./components/TimelineHeader";
import DaySlot from "./components/DaySlot";
import PolaroidCard from "./components/PolaroidCard";
import { Sun, Moon, Sparkles, BookOpen, Clock, Loader2, Save, Settings, Search, X, Copy, Calendar, Globe, Wand2, Trash, RefreshCw } from "lucide-react";
import { generateMockImage } from "./utils/mockGenerator";
import SettingsModal from "./components/SettingsModal";

export default function App() {
  const shouldShowMockTools = import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCK_TOOLS === "true";
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [weekId, setWeekId] = useState<string>("");
  const [cards, setCards] = useState<ImageCard[]>([]);
  const [noteContent, setNoteContent] = useState<string>("");
  const [noteHeight, setNoteHeight] = useState<number>(220);
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);
  const [dbSaveStatus, setDbSaveStatus] = useState<"clean" | "saving" | "error">("clean");
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchScope, setSearchScope] = useState<"current" | "all">("current");
  const [zoomedCard, setZoomedCard] = useState<ImageCard | null>(null);

  // Custom AI parameter states
  const [customProvider, setCustomProvider] = useState<string>(() => {
    return localStorage.getItem("custom_provider") || "gemini";
  });
  const [customApiKey, setCustomApiKey] = useState<string>(() => {
    return localStorage.getItem("custom_gemini_api_key") || "";
  });
  const [customGeminiBaseUrl, setCustomGeminiBaseUrl] = useState<string>(() => {
    return localStorage.getItem("custom_gemini_base_url") || "";
  });
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem("custom_gemini_model") || "gemini-3.5-flash";
  });
  const [anthropicAuthToken, setAnthropicAuthToken] = useState<string>(() => {
    return localStorage.getItem("custom_anthropic_auth_token") || "";
  });
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState<string>(() => {
    return localStorage.getItem("custom_anthropic_base_url") || "https://api.anthropic.com";
  });
  const [anthropicModel, setAnthropicModel] = useState<string>(() => {
    return localStorage.getItem("custom_anthropic_model") || "claude-3-5-sonnet-latest";
  });
  const [thirdPartyApiKey, setThirdPartyApiKey] = useState<string>(() => {
    return localStorage.getItem("custom_thirdparty_api_key") || "";
  });
  const [thirdPartyBaseUrl, setThirdPartyBaseUrl] = useState<string>(() => {
    return localStorage.getItem("custom_thirdparty_base_url") || "";
  });
  const [thirdPartyModel, setThirdPartyModel] = useState<string>(() => {
    return localStorage.getItem("custom_thirdparty_model") || "";
  });
  const [thirdPartyThinking, setThirdPartyThinking] = useState<boolean>(() => {
    return localStorage.getItem("custom_thirdparty_thinking") === "true";
  });
  const [showSettings, setShowSettings] = useState<boolean>(false);

  const dragStartRef = useRef<number | null>(null);
  const initialHeightRef = useRef<number | null>(null);

  // Calculate the week identifier (e.g., "2026-W25")
  const getWeekIdentifier = (date: Date): string => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  };

  useEffect(() => {
    setWeekId(getWeekIdentifier(currentDate));
  }, [currentDate]);

  // Load AI settings from DB on startup (DB values take priority over localStorage)
  useEffect(() => {
    loadSettings().then((dbSettings) => {
      if (Object.keys(dbSettings).length === 0) return;
      if (dbSettings.custom_provider) { setCustomProvider(dbSettings.custom_provider); localStorage.setItem("custom_provider", dbSettings.custom_provider); }
      if (dbSettings.custom_gemini_api_key !== undefined) { setCustomApiKey(dbSettings.custom_gemini_api_key); localStorage.setItem("custom_gemini_api_key", dbSettings.custom_gemini_api_key); }
      if (dbSettings.custom_gemini_base_url !== undefined) { setCustomGeminiBaseUrl(dbSettings.custom_gemini_base_url); localStorage.setItem("custom_gemini_base_url", dbSettings.custom_gemini_base_url); }
      if (dbSettings.custom_gemini_model) { setSelectedModel(dbSettings.custom_gemini_model); localStorage.setItem("custom_gemini_model", dbSettings.custom_gemini_model); }
      if (dbSettings.custom_anthropic_auth_token !== undefined) { setAnthropicAuthToken(dbSettings.custom_anthropic_auth_token); localStorage.setItem("custom_anthropic_auth_token", dbSettings.custom_anthropic_auth_token); }
      if (dbSettings.custom_anthropic_base_url) { setAnthropicBaseUrl(dbSettings.custom_anthropic_base_url); localStorage.setItem("custom_anthropic_base_url", dbSettings.custom_anthropic_base_url); }
      if (dbSettings.custom_anthropic_model) { setAnthropicModel(dbSettings.custom_anthropic_model); localStorage.setItem("custom_anthropic_model", dbSettings.custom_anthropic_model); }
      if (dbSettings.custom_thirdparty_api_key !== undefined) { setThirdPartyApiKey(dbSettings.custom_thirdparty_api_key); localStorage.setItem("custom_thirdparty_api_key", dbSettings.custom_thirdparty_api_key); }
      if (dbSettings.custom_thirdparty_base_url !== undefined) { setThirdPartyBaseUrl(dbSettings.custom_thirdparty_base_url); localStorage.setItem("custom_thirdparty_base_url", dbSettings.custom_thirdparty_base_url); }
      if (dbSettings.custom_thirdparty_model !== undefined) { setThirdPartyModel(dbSettings.custom_thirdparty_model); localStorage.setItem("custom_thirdparty_model", dbSettings.custom_thirdparty_model); }
      if (dbSettings.custom_thirdparty_thinking !== undefined) { const v = dbSettings.custom_thirdparty_thinking === "true"; setThirdPartyThinking(v); localStorage.setItem("custom_thirdparty_thinking", String(v)); }
    }).catch((err) => console.error("Failed to load settings from DB:", err));
  }, []);

  // Handle Dark mode sync
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  // Real-time listener for image cards (either current week or globally across all weeks)
  useEffect(() => {
    if (!weekId) return;

    let unsubscribe: () => void;
    if (searchScope === "all") {
      unsubscribe = subscribeAllCards((fetchedCards) => {
        setCards(fetchedCards);
      });
    } else {
      unsubscribe = subscribeCards(weekId, (fetchedCards) => {
        setCards(fetchedCards);
      });
    }

    return () => unsubscribe();
  }, [weekId, searchScope]);

  // Fetch / subscribe for notes of the current week
  useEffect(() => {
    if (!weekId) return;

    let isSubscribed = true;
    const fetchNote = async () => {
      try {
        const data = await loadNote(weekId);
        if (isSubscribed) {
          if (data) {
            setNoteContent(data.note || "");
            setNoteHeight(data.height || 220);
          } else {
            setNoteContent("");
            setNoteHeight(220);
          }
          setDbSaveStatus("clean");
        }
      } catch (err) {
        console.error("Failed to load notes:", err);
      }
    };

    fetchNote();
    return () => {
      isSubscribed = false;
    };
  }, [weekId]);

  // Debounced note & height auto-saving
  useEffect(() => {
    if (!weekId) return;
    
    // Skip saving initial empty state before note loads
    const delayDebounceFn = setTimeout(async () => {
      setDbSaveStatus("saving");
      try {
        await saveNote(weekId, noteContent, noteHeight);
        setDbSaveStatus("clean");
      } catch (err) {
        console.error("Failed to sync note:", err);
        setDbSaveStatus("error");
      }
    }, 1200);

    return () => clearTimeout(delayDebounceFn);
  }, [noteContent, noteHeight, weekId]);

  // Shift current view week
  const handlePrevWeek = () => {
    const nextDate = new Date(currentDate);
    nextDate.setDate(currentDate.getDate() - 7);
    setCurrentDate(nextDate);
  };

  const handleNextWeek = () => {
    const nextDate = new Date(currentDate);
    nextDate.setDate(currentDate.getDate() + 7);
    setCurrentDate(nextDate);
  };

  const handleGoToday = () => {
    setCurrentDate(new Date());
  };

  // Drag height of note pad resize operations
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartRef.current = e.clientY;
    initialHeightRef.current = noteHeight;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (dragStartRef.current !== null && initialHeightRef.current !== null) {
      // Pulling the top handle UP expands the notes container (ClientY gets smaller)
      const delta = dragStartRef.current - e.clientY;
      const newHeight = Math.max(120, Math.min(500, initialHeightRef.current + delta));
      setNoteHeight(newHeight);
    }
  };

  const handleMouseUp = () => {
    dragStartRef.current = null;
    initialHeightRef.current = null;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  };

  // Helper calculation for individual slot headers and actual dates
  const getDayLabelForOffset = (baseDate: Date, offset: number) => {
    const currentDay = baseDate.getDay();
    // Monday offset setup (Sunday is 0, Monday is 1... Sat is 6)
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    const targetDate = new Date(baseDate);
    targetDate.setDate(baseDate.getDate() + distanceToMonday + offset);
    
    if (offset === 5) {
      // Sat & Sun composite sublabel
      const sunDate = new Date(targetDate);
      sunDate.setDate(targetDate.getDate() + 1);
      
      if (targetDate.getMonth() === sunDate.getMonth()) {
        return `${targetDate.toLocaleDateString("en-US", { month: "short" })} ${targetDate.getDate()} – ${sunDate.getDate()}`;
      } else {
        return `${targetDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${sunDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      }
    }

    return targetDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Upload card and proxy call AI analysis API server-side
  const handleUploadImage = async (dayIndex: number, base64Data: string) => {
    try {
      if (!weekId) {
        throw new Error("当前周信息还在加载，请稍后再粘贴图片。");
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-provider": customProvider || "gemini",
      };

      if (customProvider === "anthropic") {
        if (anthropicAuthToken) {
          headers["x-api-key"] = anthropicAuthToken;
        }
        if (anthropicModel) {
          headers["x-model-name"] = anthropicModel;
        }
        if (anthropicBaseUrl) {
          headers["x-anthropic-base-url"] = anthropicBaseUrl;
        }
      } else if (customProvider === "thirdparty") {
        headers["x-provider"] = "gemini"; // server routes third-party via non-Google base URL
        if (thirdPartyApiKey) headers["x-api-key"] = thirdPartyApiKey;
        if (thirdPartyModel) headers["x-model-name"] = thirdPartyModel;
        if (thirdPartyBaseUrl) headers["x-gemini-base-url"] = thirdPartyBaseUrl;
        if (thirdPartyThinking) headers["x-thinking-enabled"] = "true";
      } else {
        if (customApiKey) {
          headers["x-api-key"] = customApiKey;
        }
        if (selectedModel) {
          headers["x-model-name"] = selectedModel;
        }
        if (customGeminiBaseUrl) {
          headers["x-gemini-base-url"] = customGeminiBaseUrl;
        }
      }

      // Decorator types cycle list
      const decoList: Array<"tape" | "pin" | "paperclip" | "washi"> = [
        "tape",
        "pin",
        "paperclip",
        "washi"
      ];
      const randomDeco = decoList[Math.floor(Math.random() * decoList.length)];
      // Tilt angles random set
      const randomAngle = parseFloat((Math.random() * 6 - 3).toFixed(1));

      // Beautiful, diverse design fallback terms if AI extraction doesn't return anything (e.g. key/network issue)
      const fallbackOptions = [
        ["氛围感光影", "质感细节"],
        ["经典极简", "留白艺术"],
        ["摩登复古", "创意视觉"],
        ["温柔色调", "温暖松弛"],
        ["视觉秩序", "构成美学"]
      ];
      const selectedFallback = fallbackOptions[Math.floor(Math.random() * fallbackOptions.length)];

      // Generate a new doc in the cards collection
      const cardId = createNewCardId();
      const newCard: ImageCard = {
        id: cardId,
        weekId,
        dayIndex,
        imageUrl: base64Data,
        terms: selectedFallback,
        decoType: randomDeco,
        angle: randomAngle,
        createdAt: Date.now(),
      };

      await saveCard(newCard);

      const analyzeAndUpdateTerms = async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout limit

        try {
          const response = await fetch("/api/analyze-image", {
            method: "POST",
            headers,
            body: JSON.stringify({ imageBase64: base64Data }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const rawErrorText = await response.text();
            console.warn("Image term extraction skipped:", rawErrorText || `status ${response.status}`);
            return;
          }

          const resParsed = await response.json();
          const extractedTerms = Array.isArray(resParsed.terms) ? resParsed.terms : [];
          if (extractedTerms.length > 0) {
            await updateCardTerms(cardId, weekId, extractedTerms);
          }
        } catch (fetchErr: any) {
          const message = fetchErr?.name === "AbortError"
            ? "request timed out"
            : fetchErr?.message || fetchErr;
          console.warn("Image term extraction skipped:", message);
        } finally {
          clearTimeout(timeoutId);
        }
      };

      void analyzeAndUpdateTerms();
    } catch (error: any) {
      console.error("Aesthetic extracting terms error:", error);
      throw new Error(error.message || "Failed to parse terms with Gemini AI.");
    }
  };

  // Absolute deletion of card documents
  const handleDeleteCard = async (cardId: string) => {
    try {
      await deleteCard(cardId, weekId);
    } catch (err) {
      console.error("Card removal error:", err);
    }
  };

  // Delete individual keyword term from tags list
  const handleDeleteTerm = async (cardId: string, termIndex: number) => {
    try {
      const targetCard = cards.find((c) => c.id === cardId);
      if (targetCard) {
        const updatedTerms = [...targetCard.terms];
        updatedTerms.splice(termIndex, 1);
        await updateCardTerms(cardId, weekId, updatedTerms);
      }
    } catch (err) {
      console.error("Tag deletion error:", err);
    }
  };

  // Custom addition or absolute text keyword modifications
  const handleUpdateCardTerms = async (cardId: string, terms: string[]) => {
    try {
      await updateCardTerms(cardId, weekId, terms);
    } catch (err) {
      console.error("Failed to update custom terms list:", err);
    }
  };

  // Populate the active week with gorgeous design mock-up data cards and notes
  const [isInjectingMock, setIsInjectingMock] = useState(false);
  const [mockSuccessMessage, setMockSuccessMessage] = useState("");

  const handleInjectMockData = async () => {
    if (!shouldShowMockTools) return;
    if (!weekId) return;
    setIsInjectingMock(true);
    setMockSuccessMessage("");
    try {
      // 1. Create mock templates representing diverse aesthetic styles
      const mockTemplates = [
        {
          style: "wabi-sabi",
          dayIndex: 0,
          terms: ["侘寂美质", "中性大地色", "斑点肌理", "留白艺术", "Wabi-Sabi", "自然质朴美"]
        },
        {
          style: "cyberpunk",
          dayIndex: 1,
          terms: ["赛博朋克深空", "霓虹光晕冷暖", "激光投影网格", "未来主义", "Cyberpunk", "动感效能"]
        },
        {
          style: "bauhaus",
          dayIndex: 2,
          terms: ["包豪斯构成学", "三原色重叠", "瑞士极简秩序", "网格几何", "Bauhaus Grid", "理性比例"]
        },
        {
          style: "morandi",
          dayIndex: 3,
          terms: ["温柔莫兰迪", "高级灰色相"]
        },
        {
          style: "wabi-sabi",
          dayIndex: 3,
          terms: ["午后茶歇随记", "生活松弛感"]
        },
        {
          style: "bauhaus",
          dayIndex: 3,
          terms: ["Minimal Teapot", "居家治愈"]
        },
        {
          style: "memphis",
          dayIndex: 4,
          terms: ["孟菲斯波普", "糖果怪诞趣味", "网孔波点排版"]
        },
        {
          style: "cyberpunk",
          dayIndex: 4,
          terms: ["几何随性", "Memphis Pop", "高饱亮色撞色"]
        },
        {
          style: "mid-century",
          dayIndex: 5,
          terms: ["中世纪胡桃木", "温润原木构筑", "温暖时间"]
        },
        {
          style: "wabi-sabi",
          dayIndex: 5,
          terms: ["夕阳余晖橙色", "Mid-Century Chair"]
        }
      ];

      // 2. Clean existing cards of this current week first
      const currentWeekCards = cards.filter((c) => c.weekId === weekId);
      for (const card of currentWeekCards) {
        await deleteCard(card.id, weekId);
      }

      // 3. Inject new beautiful polaroids with fine staggering
      for (let i = 0; i < mockTemplates.length; i++) {
        const template = mockTemplates[i];
        const base64Data = generateMockImage(template.style);
        const cardId = createNewCardId();
        
        const randomDecoList: Array<"tape" | "pin" | "paperclip" | "washi"> = ["tape", "pin", "paperclip", "washi"];
        const deco = randomDecoList[template.dayIndex % randomDecoList.length];
        const angle = parseFloat((Math.random() * 8 - 4).toFixed(1));

        const mockCard: ImageCard = {
          id: cardId,
          weekId,
          dayIndex: template.dayIndex,
          imageUrl: base64Data,
          terms: template.terms,
          decoType: deco,
          angle,
          createdAt: Date.now() - (10 - i) * 10000,
        };
        await saveCard(mockCard);
      }

      // 4. Fill notebook notes page
      const beautifulMockNotes = `★ 灵感随手记 (Mock Weekly Ideas Journal):\n- 本周美学探索：围绕冷暖色温与有机几何（Organic Geometry）的碰撞展开。\n- 星期一的【侘寂美学】粗糙花瓶奠定了返璞归真的色调氛围，推荐搭配生亚麻与粗泥灰的材质硬装。\n- 星期二引入的【赛博朋克霓虹】作为未来感冲撞点，给沉闷的极简版面制造了前卫趣味。\n- 星期三的【经典包豪斯】红黄蓝几何三原色，是版面排版与视觉重心的基础规则。\n- 星期四的【温柔莫兰迪】午后茶歇，平衡了高饱和的冰冷，回归生活的松弛气韵。\n- 星期五与周末引入的【孟菲斯波普】以及【中世纪胡桃木】则给本周探索画上了圆满句号。\n★ 下周计划：深入探索中世纪复古未来主义（Retro-Futurism）与数码迷幻印花的结合。`;

      setNoteContent(beautifulMockNotes);
      await saveNote(weekId, beautifulMockNotes, 280);
      setNoteHeight(280);

      setMockSuccessMessage("✨ 极美 Mock 数据已成功填入！现在你可以点击相片放大、微调关键词或调整记事本高度，体验丝滑流畅的排版啦！");
      setTimeout(() => setMockSuccessMessage(""), 6000);
    } catch (err: any) {
      console.error("Failed to inject mock data:", err);
    } finally {
      setIsInjectingMock(false);
    }
  };

  const handleClearCurrentWeek = async () => {
    if (!weekId) return;
    setMockSuccessMessage("");
    try {
      const currentWeekCards = cards.filter((c) => c.weekId === weekId);
      for (const card of currentWeekCards) {
        await deleteCard(card.id, weekId);
      }
      setNoteContent("");
      await saveNote(weekId, "", 220);
      setNoteHeight(220);
      setMockSuccessMessage("🧹 本周数据已清空。你可以再次点击\"填充 Mock 数据\"按钮进行还原！");
      setTimeout(() => setMockSuccessMessage(""), 5000);
    } catch (err) {
      console.error("Failed to clear week:", err);
    }
  };

  // Helper to resolve Chinese labels for day indices
  const getDayLabelForDayIndex = (idx: number): string => {
    const days = ["星期一 (Monday)", "星期二 (Tuesday)", "星期三 (Wednesday)", "星期四 (Thursday)", "星期五 (Friday)", "周末 (Weekend)"];
    return days[idx] || "记录时间";
  };

  // Dynamically filter cards based on user search query (matching terms/keywords case-insensitively)
  const filteredCards = cards.filter((card) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return card.terms.some((term) => term.toLowerCase().includes(q));
  });

  return (
    <div className="min-h-screen flex flex-col transition-colors duration-300">
      {/* Visual background lines representing analog journal grid */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] dark:opacity-[0.02] bg-[linear-gradient(rgba(0,0,0,1)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,1)_1px,transparent_1px)] bg-[size:24px_24px]" />

      {/* Primary Container */}
      <div className="max-w-7xl mx-auto w-full px-4 py-6 md:py-8 flex flex-col flex-grow relative z-10">
        
        {/* Secondary Navigation row with Theme control */}
        <div className="flex items-center justify-between mb-4 px-2">
          <div className="flex items-center gap-2 text-stone-500 text-xs font-serif italic select-none">
            <BookOpen size={14} className="text-amber-800" />
            <span>AI Design Notebook</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 px-3 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-950 dark:text-amber-350 transition-colors shadow-sm cursor-pointer border border-amber-500/20 flex items-center justify-center gap-1.5 text-xs font-semibold"
              title="Configure AI service"
              id="ai-settings-trigger"
            >
              <Settings size={14} />
              <span>AI Settings</span>
            </button>

            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-950 dark:text-amber-300 transition-colors shadow-sm cursor-pointer border border-amber-500/20 flex items-center justify-center"
              title="Toggle theme vibe"
            >
              {isDarkMode ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>

        {/* Calendar Nav Header */}
        <TimelineHeader
          currentDate={currentDate}
          onPrevWeek={handlePrevWeek}
          onNextWeek={handleNextWeek}
          onGoToday={handleGoToday}
          weekIdentifier={weekId}
        />

        {/* Dynamic Multi-match Inspiration Search Bar */}
        <div className="my-4 px-2 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <div className="relative flex-grow">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-stone-400">
              <Search size={14} className="text-amber-800/60 dark:text-amber-400/60" />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索所有已记录的关键词、灵感或是创意描述..."
              className="w-full pl-9 pr-8 py-2 rounded-xl border border-amber-900/10 dark:border-amber-100/15 bg-white/70 dark:bg-stone-900/70 text-sm text-stone-850 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-amber-500 hover:border-amber-900/20 transition-all font-sans"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-stone-400 hover:text-stone-600 dark:hover:text-stone-250 cursor-pointer"
                title="清除搜索"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 self-end md:self-auto flex-shrink-0">
            {/* Search Scope Switcher */}
            <div className="flex gap-1 items-center bg-stone-100 dark:bg-stone-800/80 p-1 rounded-xl border border-stone-200/50 dark:border-stone-800">
              <button
                onClick={() => setSearchScope("current")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 ${
                  searchScope === "current"
                    ? "bg-white dark:bg-stone-700 text-amber-900 dark:text-amber-200 shadow-sm font-bold"
                    : "text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
                }`}
              >
                <Calendar size={12} />
                <span>仅看本周</span>
              </button>
              <button
                onClick={() => setSearchScope("all")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 ${
                  searchScope === "all"
                    ? "bg-white dark:bg-stone-700 text-amber-900 dark:text-amber-200 shadow-sm font-bold"
                    : "text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
                }`}
              >
                <Globe size={12} />
                <span>所有历史周 ({searchScope === "all" ? cards.length : "检索"})</span>
              </button>
            </div>

            {searchQuery && (
              <div className="text-xs text-stone-500 dark:text-stone-400 font-serif italic flex items-center gap-1 bg-amber-500/5 px-2.5 py-1.5 border border-amber-500/10 rounded-xl select-none">
                <span>匹配：</span>
                <strong className="text-amber-800 dark:text-amber-300 font-sans not-italic font-semibold bg-amber-500/10 px-1.5 py-0.5 rounded">
                  {filteredCards.length}
                </strong>
              </div>
            )}
          </div>
        </div>

        {shouldShowMockTools && (
          <div className="mb-6 px-2">
            <div className="p-4 md:p-5 rounded-2xl bg-gradient-to-r from-amber-500/10 to-amber-700/[0.03] dark:from-amber-500/10 dark:to-transparent border border-amber-500/20 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-900 dark:text-amber-300 shadow-sm mt-0.5 animate-pulse">
                  <Wand2 size={18} />
                </div>
                <div>
                  <h4 className="font-serif font-bold text-sm text-stone-900 dark:text-stone-100 italic flex items-center gap-1.5 flex-wrap">
                    <span>🪄 演示与款式调优工具 (Mock Data Center)</span>
                    <span className="text-[10px] font-sans font-normal not-italic px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-900 dark:text-amber-350">
                      无需任何 API 密钥一键生成
                    </span>
                  </h4>
                  <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 max-w-2xl font-serif leading-relaxed">
                    为了便于查看、测试各种精美的 <strong>Polaroid 相片排版组件、手写便签随笔</strong> 以及调整全套暗黑/明亮款式细节，您可以一键填满或清空本周演示内容。
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 self-stretch md:self-auto justify-end">
                <button
                  disabled={isInjectingMock}
                  onClick={handleInjectMockData}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-600 text-white shadow hover:shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                >
                  {isInjectingMock ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" />
                      <span>正在绘制相片...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 size={12} />
                      <span>填满本周 Mock 数据</span>
                    </>
                  )}
                </button>

                <button
                  onClick={handleClearCurrentWeek}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-300 hover:text-stone-800 dark:hover:text-stone-100 transition-all active:scale-95 border border-stone-200/40 dark:border-stone-700 cursor-pointer"
                  title="清空本周的所有卡片与便签"
                >
                  <Trash size={12} />
                  <span>清空本周</span>
                </button>
              </div>
            </div>

            <AnimatePresence>
              {mockSuccessMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mt-2.5 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 text-xs font-serif italic border border-emerald-500/20 shadow-sm flex items-center gap-2"
                >
                  <span>✨</span>
                  <span>{mockSuccessMessage}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* MAIN Content Grid / Multi-Week View */}
        <div className="mt-2">
          <AnimatePresence mode="wait">
            {searchScope === "all" ? (
              <motion.div
                key="global-inspiration-bank"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.2 }}
                className="bg-amber-500/5 dark:bg-stone-900/10 rounded-2xl p-4 md:p-6 border border-dashed border-amber-900/15 dark:border-amber-100/10 min-h-[350px] flex flex-col mb-5"
              >
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 border-b border-stone-200/50 dark:border-stone-800/60 pb-4 mb-5">
                  <div>
                    <h3 className="font-serif font-bold text-base text-stone-900 dark:text-stone-100 italic flex items-center gap-2">
                      <span>🌍 跨周全局创意库</span>
                      <span className="text-xs font-sans not-italic font-normal bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full font-semibold">
                        共加载 {filteredCards.length} 张灵感快照
                      </span>
                    </h3>
                    <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 font-serif">
                      此处已为您安全同步并展现<strong>所有历史周</strong>上传过的照片。支持点击原图放大，自定义编辑以及一键复制灵感词。
                    </p>
                  </div>
                </div>

                {filteredCards.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 py-2">
                    {filteredCards.map((card) => (
                      <div key={card.id} className="relative pt-6">
                        {/* Floating Week Banner */}
                        <div className="absolute top-1 left-4 bg-amber-800/95 dark:bg-amber-900/95 text-amber-100 text-[9px] font-mono tracking-wider px-2 py-0.5 rounded shadow-sm z-10 select-none uppercase">
                          {card.weekId} • {getDayLabelForDayIndex(card.dayIndex).split(" ")[0]}
                        </div>
                        <PolaroidCard
                          card={card}
                          onDeleteCard={handleDeleteCard}
                          onDeleteTerm={handleDeleteTerm}
                          onZoom={setZoomedCard}
                          onUpdateTerms={handleUpdateCardTerms}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex-grow flex flex-col items-center justify-center py-16 text-center">
                    <Sparkles size={32} className="text-amber-500/40 mb-3 animate-pulse" />
                    <p className="text-sm font-handwritten text-stone-400 dark:text-stone-500 italic">
                      {searchQuery ? "未检索到匹配该关键词的任何创意卡片" : "当前创意库中暂无记录。返回“仅看本周”上传照片，即可在这里查阅历史照片！"}
                    </p>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="weekly-standard-grid"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col gap-5 mb-5"
              >
                {/* Row 1: Monday, Tuesday, Wednesday */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <DaySlot
                    dayIndex={0}
                    label="Monday"
                    subLabel={getDayLabelForOffset(currentDate, 0)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 0)}
                    onUploadImage={handleUploadImage}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                  />
                  <DaySlot
                    dayIndex={1}
                    label="Tuesday"
                    subLabel={getDayLabelForOffset(currentDate, 1)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 1)}
                    onUploadImage={handleUploadImage}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                  />
                  <DaySlot
                    dayIndex={2}
                    label="Wednesday"
                    subLabel={getDayLabelForOffset(currentDate, 2)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 2)}
                    onUploadImage={handleUploadImage}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                  />
                </div>

                {/* Row 2: Thursday, Friday, Weekend */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <DaySlot
                    dayIndex={3}
                    label="Thursday"
                    subLabel={getDayLabelForOffset(currentDate, 3)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 3)}
                    onUploadImage={handleUploadImage}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                  />
                  <DaySlot
                    dayIndex={4}
                    label="Friday"
                    subLabel={getDayLabelForOffset(currentDate, 4)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 4)}
                    onUploadImage={handleUploadImage}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                  />
                  {/* Weekend combined cell */}
                  <DaySlot
                    dayIndex={5}
                    label="Weekend"
                    subLabel={getDayLabelForOffset(currentDate, 5)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 5)}
                    onUploadImage={handleUploadImage}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Row 3: Adjustable height notes pad */}
          <div className="relative">
            {/* Draggable Handle on top */}
            <div
              onMouseDown={handleMouseDown}
              className="absolute top-0 left-0 right-0 h-1 md:h-1.5 cursor-row-resize bg-gradient-to-r from-transparent via-amber-200/50 dark:via-amber-900/60 to-transparent hover:via-amber-400 group/handle z-20 flex items-center justify-center transition-all"
              title="Drag up to expand note height"
              id="notes-resize-handle"
            >
              <div className="w-16 h-1 rounded bg-stone-300 dark:bg-stone-700 opacity-60 group-hover/handle:bg-amber-500 group-hover/handle:scale-y-125 transition-all" />
            </div>

            {/* Note cardboard pad */}
            <div
              className="flex flex-col border border-amber-900/10 dark:border-amber-100/10 bg-gradient-to-b from-amber-50/20 to-white dark:from-stone-900/30 dark:to-stone-900 rounded-2xl shadow-sm p-5 md:p-6 select-none overflow-hidden mt-1"
              style={{ height: `${noteHeight}px` }}
              id="weekly-notes-pad"
            >
              {/* Note Header / metadata */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-serif font-semibold italic text-stone-900 dark:text-stone-100 text-sm">
                    Notebook Ideas
                  </span>
                  <span className="text-[10px] font-handwritten tracking-wide text-amber-800 dark:text-amber-300 uppercase select-none leading-none">
                    ★ scribbles & thoughts ★
                  </span>
                </div>

                {/* DB sync loading indicators */}
                <div className="text-[10px] font-mono font-medium flex items-center gap-1.5 text-stone-400 dark:text-stone-500">
                  {dbSaveStatus === "saving" && (
                    <>
                      <Loader2 size={10} className="animate-spin text-amber-500" />
                      <span>Saving draft...</span>
                    </>
                  )}
                  {dbSaveStatus === "clean" && (
                    <span className="text-emerald-600 dark:text-emerald-500 font-semibold flex items-center gap-1">
                      ✓ Auto-saved
                    </span>
                  )}
                  {dbSaveStatus === "error" && (
                    <span className="text-red-500 font-semibold">
                      ⚠ Cloud Sync Error
                    </span>
                  )}
                </div>
              </div>

              {/* Editable handwriting textarea pads */}
              <textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Jot down design motifs, weekly conclusions, inspiration sources, or general layout reminders..."
                className="w-full flex-grow bg-transparent border-0 outline-none resize-none font-handwritten text-base md:text-lg leading-relaxed text-stone-800 dark:text-amber-50 placeholder-stone-400 dark:placeholder-stone-600 select-text p-1 min-h-0 focus:outline-none"
                style={{
                  // Faint realistic ledger line rules background just like old spiral sheets
                  backgroundImage: "linear-gradient(rgba(0, 0, 0, 0.05) 1px, transparent 1px)",
                  backgroundSize: "100% 2rem",
                  lineHeight: "2rem",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* AI Config modal */}
      {showSettings && (
        <SettingsModal
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
          customProvider={customProvider}
          customApiKey={customApiKey}
          customGeminiBaseUrl={customGeminiBaseUrl}
          selectedModel={selectedModel}
          anthropicAuthToken={anthropicAuthToken}
          anthropicBaseUrl={anthropicBaseUrl}
          anthropicModel={anthropicModel}
          thirdPartyApiKey={thirdPartyApiKey}
          thirdPartyBaseUrl={thirdPartyBaseUrl}
          thirdPartyModel={thirdPartyModel}
          thirdPartyThinking={thirdPartyThinking}
          onSave={(config) => {
            localStorage.setItem("custom_provider", config.customProvider);
            localStorage.setItem("custom_gemini_api_key", config.customApiKey);
            localStorage.setItem("custom_gemini_base_url", config.customGeminiBaseUrl);
            localStorage.setItem("custom_gemini_model", config.selectedModel);
            localStorage.setItem("custom_anthropic_auth_token", config.anthropicAuthToken);
            localStorage.setItem("custom_anthropic_base_url", config.anthropicBaseUrl);
            localStorage.setItem("custom_anthropic_model", config.anthropicModel);
            localStorage.setItem("custom_thirdparty_api_key", config.thirdPartyApiKey);
            localStorage.setItem("custom_thirdparty_base_url", config.thirdPartyBaseUrl);
            localStorage.setItem("custom_thirdparty_model", config.thirdPartyModel);
            localStorage.setItem("custom_thirdparty_thinking", String(config.thirdPartyThinking));

            saveSettings({
              custom_provider: config.customProvider,
              custom_gemini_api_key: config.customApiKey,
              custom_gemini_base_url: config.customGeminiBaseUrl,
              custom_gemini_model: config.selectedModel,
              custom_anthropic_auth_token: config.anthropicAuthToken,
              custom_anthropic_base_url: config.anthropicBaseUrl,
              custom_anthropic_model: config.anthropicModel,
              custom_thirdparty_api_key: config.thirdPartyApiKey,
              custom_thirdparty_base_url: config.thirdPartyBaseUrl,
              custom_thirdparty_model: config.thirdPartyModel,
              custom_thirdparty_thinking: String(config.thirdPartyThinking),
            });

            setCustomProvider(config.customProvider);
            setCustomApiKey(config.customApiKey);
            setCustomGeminiBaseUrl(config.customGeminiBaseUrl);
            setSelectedModel(config.selectedModel);
            setAnthropicAuthToken(config.anthropicAuthToken);
            setAnthropicBaseUrl(config.anthropicBaseUrl);
            setAnthropicModel(config.anthropicModel);
            setThirdPartyApiKey(config.thirdPartyApiKey);
            setThirdPartyBaseUrl(config.thirdPartyBaseUrl);
            setThirdPartyModel(config.thirdPartyModel);
            setThirdPartyThinking(config.thirdPartyThinking);
          }}
        />
      )}

      {/* Zoomed Polaroid Image Modal overlay with backdrop-blur */}
      <AnimatePresence>
        {zoomedCard && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/85 backdrop-blur-md select-none"
            onClick={() => setZoomedCard(null)}
          >
            <motion.div
              initial={{ scale: 0.93, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.93, y: 15 }}
              className="relative max-w-3xl w-full bg-white dark:bg-stone-850 p-4 md:p-6 pb-6 md:pb-8 shadow-[0_24px_50px_rgba(0,0,0,0.6)] border border-amber-900/10 dark:border-white/10 select-text rounded-2xl flex flex-col md:flex-row gap-6 items-center md:items-start"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button on top corner */}
              <button
                onClick={() => setZoomedCard(null)}
                className="absolute top-3 right-3 text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100 p-1.5 rounded-full bg-stone-100 dark:bg-stone-800 cursor-pointer hover:scale-105 transition-transform z-10"
                title="关闭视图"
                id="close-zoom-modal-btn"
              >
                <X size={18} />
              </button>

              {/* Left Column: Picture */}
              <div className="w-full md:w-3/5 aspect-square max-w-[420px] relative overflow-hidden bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-inner rounded-xl">
                <img
                  src={zoomedCard.imageUrl}
                  alt="Original Snippet View"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-contain"
                />
                <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/5 to-white/5 pointer-events-none" />
              </div>

              {/* Right Column: Key Details, Tag lists, info */}
              <div className="w-full md:w-2/5 flex flex-col h-full justify-between gap-5 self-stretch py-1">
                <div className="flex flex-col gap-4">
                  {/* Title / Mood heading */}
                  <div className="border-b border-dashed border-amber-900/15 dark:border-amber-100/10 pb-3">
                    <span className="text-xs font-handwritten font-bold text-amber-800 dark:text-amber-400 tracking-wider block mb-1 uppercase">
                      ★ Captured Inspiration ★
                    </span>
                    <h3 className="font-serif font-bold text-lg text-stone-900 dark:text-stone-100 italic leading-tight">
                      {getDayLabelForDayIndex(zoomedCard.dayIndex)} 灵感记录
                    </h3>
                    <p className="text-[10px] font-mono text-stone-400 dark:text-stone-500 mt-1.5">
                      记录时间： {new Date(zoomedCard.createdAt).toLocaleString()}
                    </p>
                  </div>

                  {/* Active tags visualizer */}
                  <div>
                    <h4 className="text-xs font-serif font-bold italic text-stone-600 dark:text-stone-300 mb-2.5">
                      创意 / 灵感 关键词：
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {zoomedCard.terms.map((term, index) => (
                        <div
                          key={`${term}-${index}`}
                          onClick={() => {
                            navigator.clipboard.writeText(term);
                          }}
                          className="group inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-200/50 dark:border-amber-900/30 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                          title="点击复制关键词"
                        >
                          <span className="select-all">{term}</span>
                          <Copy size={9} className="opacity-40 group-hover:opacity-100 flex-shrink-0" />
                        </div>
                      ))}
                      {zoomedCard.terms.length === 0 && (
                        <span className="text-xs font-handwritten text-stone-400 italic">
                          当前无灵感词。悬停在主板的卡片上可自定义添加！
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer instructions */}
                <div className="mt-auto pt-4 border-t border-dashed border-amber-900/15 dark:border-amber-100/10 text-[11px] text-stone-400 dark:text-stone-500 leading-normal">
                  <span className="font-handwritten text-xs block text-stone-500 dark:text-stone-400 mb-1">提示：</span>
                  在主页面悬停在 Polaroid 灵感相片右侧，可对关键词进行<strong>自定义新增</strong>或<strong>删除</strong>管理。
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
