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
} from "./lib/dbClient";
import TimelineHeader from "./components/TimelineHeader";
import DaySlot from "./components/DaySlot";
import PolaroidCard from "./components/PolaroidCard";
import { Sun, Moon, Sparkles, BookOpen, Clock, Loader2, Save, Settings, Search, X, Copy, Calendar, Globe, Wand2, Trash, RefreshCw, ChevronLeft, ChevronRight, LogOut, Compass, Lock, FileText } from "lucide-react";
import SettingsModal from "./components/SettingsModal";
import { WeeklyPreviewModal } from "./components/WeeklyPreviewModal";
import InspirationUniverse from "./components/InspirationUniverse";
import PublicInspirationBoard from "./components/PublicInspirationBoard";
import { InkTabs } from "./components/InkNavigation";
import LoginScreen from "./components/LoginScreen";
import { generateMockImage } from "./utils/mockGenerator";
import { auth } from "./lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import Markdown from 'react-markdown';

// Ink diffusion transition for tabs
const inkDiffusionVariants = {
  hidden: (color: string) => ({ 
    opacity: 0,
    filter: color ? `blur(12px) drop-shadow(0 0 30px ${color})` : "blur(12px) contrast(1.2) sepia(0.2)",
    clipPath: "circle(0% at 50% 10%)"
  }),
  visible: { 
    opacity: 1, 
    filter: "blur(0px) drop-shadow(0 0 0px transparent) contrast(1) sepia(0)",
    clipPath: "circle(200% at 50% 50%)",
    transition: { 
      duration: 1.5, 
      ease: [0.4, 0, 0.2, 1] 
    }
  },
  exit: (color: string) => ({ 
    opacity: 0, 
    filter: color ? `blur(8px) drop-shadow(0 0 20px ${color})` : "blur(8px) contrast(1.2) sepia(0.2)",
    clipPath: "circle(0% at 50% 50%)",
    transition: { 
      duration: 0.8,
      ease: [0.4, 0, 1, 0.6] 
    }
  })
};

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [authInitialized, setAuthInitialized] = useState<boolean>(false);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsLoggedIn(!!user);
      setAuthInitialized(true);
    });
    return () => unsubscribe();
  }, []);

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
  const [isSummarizing, setIsSummarizing] = useState<boolean>(false);
  const [showWeeklyPreview, setShowWeeklyPreview] = useState<boolean>(false);
  const [showUniverse, setShowUniverse] = useState<boolean>(false);
  const [showPublicInspiration, setShowPublicInspiration] = useState<boolean>(false);
  const [moodColor, setMoodColor] = useState<string>("");
  const [cardToDelete, setCardToDelete] = useState<ImageCard | null>(null);
  const [deletePhase, setDeletePhase] = useState<"prompt" | "animating">("prompt");
  const [historyPage, setHistoryPage] = useState<number>(1);
  const [historyDirection, setHistoryDirection] = useState<number>(1);

  useEffect(() => {
    setHistoryPage(1);
    setHistoryDirection(1);
  }, [searchScope, searchQuery]);

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
            setMoodColor(data.moodColor || "");
          } else {
            setNoteContent("");
            setNoteHeight(220);
            setMoodColor("");
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
        await saveNote(weekId, noteContent, noteHeight, moodColor);
        setDbSaveStatus("clean");
      } catch (err) {
        console.error("Failed to sync note:", err);
        setDbSaveStatus("error");
      }
    }, 1200);

    return () => clearTimeout(delayDebounceFn);
  }, [noteContent, noteHeight, moodColor, weekId]);

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

  const handleSummarize = async () => {
    // Gather all terms for the current week
    const currentWeekCards = cards.filter((c) => c.weekId === weekId);
    const allTerms = currentWeekCards.flatMap((c) => c.terms);
    if (allTerms.length === 0) {
      alert("本周还没有任何灵感记录！");
      return;
    }

    setIsSummarizing(true);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-provider": customProvider || "gemini",
      };

      if (customProvider === "anthropic") {
        if (anthropicAuthToken) headers["x-api-key"] = anthropicAuthToken;
        if (anthropicModel) headers["x-model-name"] = anthropicModel;
        if (anthropicBaseUrl) headers["x-anthropic-base-url"] = anthropicBaseUrl;
      } else {
        if (customApiKey) headers["x-api-key"] = customApiKey;
        if (selectedModel) headers["x-model-name"] = selectedModel;
        if (customGeminiBaseUrl) headers["x-gemini-base-url"] = customGeminiBaseUrl;
      }

      const response = await fetch("/api/summarize-week", {
        method: "POST",
        headers,
        body: JSON.stringify({ terms: allTerms }),
      });

      if (!response.ok) {
        const errObj = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(errObj.error || "Failed to summarize terms.");
      }

      const data = await response.json();
      if (data.summary) {
        // Append summary to note
        const newNoteMsg = `\n\n【AI 本周灵感总结】\n${data.summary}\n`;
        const updatedNote = (noteContent + newNoteMsg).trim();
        setNoteContent(updatedNote);
        setNoteHeight(Math.max(noteHeight, 280));
      }
      if (data.moodColor) {
        setMoodColor(data.moodColor);
      }
    } catch (err: any) {
      console.error(err);
      alert(`AI 总结失败: ${err.message}`);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleUploadMd = async (dayIndex: number, text: string, filename: string) => {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-provider": customProvider || "gemini",
      };

      if (customProvider === "anthropic") {
        if (anthropicAuthToken) headers["x-api-key"] = anthropicAuthToken;
        if (anthropicModel) headers["x-model-name"] = anthropicModel;
        if (anthropicBaseUrl) headers["x-anthropic-base-url"] = anthropicBaseUrl;
      } else {
        if (customApiKey) headers["x-api-key"] = customApiKey;
        if (selectedModel) headers["x-model-name"] = selectedModel;
        if (customGeminiBaseUrl) headers["x-gemini-base-url"] = customGeminiBaseUrl;
      }

      const response = await fetch("/api/summarize-md", {
        method: "POST",
        headers,
        body: JSON.stringify({ markdown: text }),
      });

      if (!response.ok) {
        throw new Error("Failed to summarize MD.");
      }

      const data = await response.json();
      
      const newCard: ImageCard = {
        id: createNewCardId(),
        weekId,
        dayIndex,
        imageUrl: "", // not used for MD
        terms: ["Document", "Markdown"],
        decoType: "washi", // arbitrary default,
        angle: (Math.random() - 0.5) * 6,
        createdAt: Date.now(),
        userId: auth.currentUser?.uid || "guest",
        isPublic: false,
        type: "md",
        mdContent: text,
        mdSummary: data.summary || "No summary generated",
        mdName: filename,
      };

      await saveCard(newCard);
    } catch (err: any) {
      console.error(err);
      throw err;
    }
  };

  // Upload card and proxy call AI analysis API server-side
  const handleUploadImage = async (dayIndex: number, base64Data: string) => {
    try {
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

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout limit

      let response: Response;
      try {
        response = await fetch("/api/analyze-image", {
          method: "POST",
          headers,
          body: JSON.stringify({ imageBase64: base64Data }),
          signal: controller.signal,
        });
      } catch (fetchErr: any) {
        if (fetchErr.name === "AbortError") {
          throw new Error("Request timed out (60s limit). Please check your AI endpoint / API key or try using a faster model like gemini-3.5-flash.");
        }
        throw fetchErr;
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const rawErrorText = await response.text();
        let displayError = rawErrorText;
        try {
          const parsedErr = JSON.parse(rawErrorText);
          if (parsedErr.error) {
            displayError = parsedErr.error;
          }
        } catch {
          // Keep raw text if not valid JSON
        }
        throw new Error(displayError || `Server returned error status ${response.status}`);
      }

      const resParsed = await response.json();
      const extractedTerms = resParsed.terms || [];

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
        terms: extractedTerms.length > 0 ? extractedTerms : selectedFallback,
        decoType: randomDeco,
        angle: randomAngle,
        createdAt: Date.now(),
      };

      await saveCard(newCard);
    } catch (error: any) {
      console.error("Aesthetic extracting terms error:", error);
      throw new Error(error.message || "Failed to parse terms with Gemini AI.");
    }
  };

  // Trigger deletion prompt
  const handleDeleteCard = (cardId: string) => {
    const card = cards.find(c => c.id === cardId);
    if (card) {
      setCardToDelete(card);
      setDeletePhase("prompt");
    }
  };

  const confirmDeleteCard = async () => {
    if (!cardToDelete) return;
    setDeletePhase("animating");

    // Play animation
    await new Promise((resolve) => setTimeout(resolve, 1200));

    try {
      await deleteCard(cardToDelete.id, cardToDelete.weekId);
    } catch (err) {
      console.error("Card removal error:", err);
    } finally {
      setCardToDelete(null);
      setDeletePhase("prompt");
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

  const handleTogglePublic = async (card: ImageCard) => {
    try {
      // requires import { toggleCardPublic } from "./lib/dbClient"
      const { toggleCardPublic } = await import("./lib/dbClient");
      await toggleCardPublic(card.id, card.weekId, !card.isPublic);
    } catch (err) {
      console.error("Failed to toggle public state:", err);
    }
  };

  // Populate the active week with gorgeous design mock-up data cards and notes
  const [isInjectingMock, setIsInjectingMock] = useState(false);
  const [mockSuccessMessage, setMockSuccessMessage] = useState("");

  const handleInjectMockData = async () => {
    if (!weekId) return;
    setIsInjectingMock(true);
    setMockSuccessMessage("");
    try {
      // 1. Create 6 mock templates representing diverse aesthetic styles
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
          createdAt: Date.now() - (10 - i) * 10000, // staggered slightly
        };
        await saveCard(mockCard);
      }

      // 4. Fill notebook notes page
      const beautifulMockNotes = `★ 灵感随手记 (Mock Weekly Ideas Journal):
- 本周美学探索：围绕冷暖色温与有机几何（Organic Geometry）的碰撞展开。
- 星期一的【侘寂美学】粗糙花瓶奠定了返璞归真的色调氛围，推荐搭配生亚麻与粗泥灰的材质硬装。
- 星期二引入的【赛博朋克霓虹】作为未来感冲撞点，给沉闷的极简版面制造了前卫趣味。
- 星期三的【经典包豪斯】红黄蓝几何三原色，是版面排版与视觉重心的基础规则。
- 星期四的【温柔莫兰迪】午后茶歇，平衡了高饱和的冰冷，回归生活的松弛气韵。
- 星期五与周末引入的【孟菲斯波普】以及【中世纪胡桃木】则给本周探索画上了圆满句号。
★ 下周计划：深入探索中世纪复古未来主义（Retro-Futurism）与数码迷幻印花的结合。`;

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
      setMockSuccessMessage("🧹 本周数据已清空。你可以再次点击“填充 Mock 数据”按钮进行还原！");
      setTimeout(() => setMockSuccessMessage(""), 5000);
    } catch (err) {
      console.error("Failed to clear week:", err);
    }
  };

  // Dynamically filter cards based on user search query (matching terms/keywords case-insensitively)
  const filteredCards = cards.filter((card) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    if (card.terms.some((term) => term.toLowerCase().includes(q))) return true;
    if (card.type === 'md') {
      if (card.mdName?.toLowerCase().includes(q)) return true;
      if (card.mdSummary?.toLowerCase().includes(q)) return true;
    }
    return false;
  });

  // Zoom modal carousel navigation helpers
  const handlePrevZoomedCard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (filteredCards.length <= 1 || !zoomedCard) return;
    const currentIdx = filteredCards.findIndex((c) => c.id === zoomedCard.id);
    if (currentIdx === -1) return;
    const prevIdx = (currentIdx - 1 + filteredCards.length) % filteredCards.length;
    setZoomedCard(filteredCards[prevIdx]);
  };

  const handleNextZoomedCard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (filteredCards.length <= 1 || !zoomedCard) return;
    const currentIdx = filteredCards.findIndex((c) => c.id === zoomedCard.id);
    if (currentIdx === -1) return;
    const nextIdx = (currentIdx + 1) % filteredCards.length;
    setZoomedCard(filteredCards[nextIdx]);
  };

  // Keyboard navigation when zoomed
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!zoomedCard || filteredCards.length <= 1) return;
      
      const currentIdx = filteredCards.findIndex((c) => c.id === zoomedCard.id);
      if (currentIdx === -1) return;
      
      if (e.key === "ArrowLeft") {
        const prevIdx = (currentIdx - 1 + filteredCards.length) % filteredCards.length;
        setZoomedCard(filteredCards[prevIdx]);
      } else if (e.key === "ArrowRight") {
        const nextIdx = (currentIdx + 1) % filteredCards.length;
        setZoomedCard(filteredCards[nextIdx]);
      } else if (e.key === "Escape") {
        setZoomedCard(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [zoomedCard, filteredCards]);

  // Helper to resolve Chinese labels for day indices
  const getDayLabelForDayIndex = (idx: number): string => {
    const days = ["星期一 (Monday)", "星期二 (Tuesday)", "星期三 (Wednesday)", "星期四 (Thursday)", "星期五 (Friday)", "周末 (Weekend)"];
    return days[idx] || "记录时间";
  };

  if (!authInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 dark:bg-stone-950">
        <Loader2 className="animate-spin text-stone-400" />
      </div>
    );
  }

  const cardsPerPage = 8;
  const totalPages = Math.max(1, Math.ceil(filteredCards.length / cardsPerPage));
  const paginatedCards = filteredCards.slice((historyPage - 1) * cardsPerPage, historyPage * cardsPerPage);

  const handleNextPage = () => {
    if (historyPage < totalPages) {
      setHistoryDirection(1);
      setHistoryPage((prev) => prev + 1);
    }
  };

  const handlePrevPage = () => {
    if (historyPage > 1) {
      setHistoryDirection(-1);
      setHistoryPage((prev) => prev - 1);
    }
  };

  const pageVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 40 : -40,
      y: 10,
      opacity: 0,
      scale: 0.95,
      rotateZ: direction > 0 ? 2 : -2,
      filter: "blur(10px)",
    }),
    center: {
      x: 0,
      y: 0,
      rotateZ: 0,
      opacity: 1,
      scale: 1,
      filter: "blur(0px)",
      transition: { 
        duration: 0.8, 
        ease: [0.16, 1, 0.3, 1] 
      }
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 40 : -40,
      y: -10,
      opacity: 0,
      scale: 0.95,
      rotateZ: direction < 0 ? 2 : -2,
      filter: "blur(10px)",
      transition: { 
        duration: 0.5, 
        ease: [0.7, 0, 0.84, 0] 
      }
    })
  };

  const handleAddMockData = async () => {
    try {
      const styles = ["wabi-sabi", "cyberpunk", "bauhaus", "morandi", "memphis", "mid-century"];
      const decos: Array<"tape" | "pin" | "paperclip" | "washi"> = ["tape", "pin", "paperclip", "washi"];
      const fallbackOptions = [
        ["氛围感光影", "质感细节"],
        ["经典极简", "留白艺术"],
        ["摩登复古", "创意视觉"],
        ["温柔色调", "温暖松弛"],
        ["视觉秩序", "构成美学"]
      ];

      for (let i = 0; i < 24; i++) {
        const style = styles[Math.floor(Math.random() * styles.length)];
        const b64 = generateMockImage(style);
        const cardId = createNewCardId();
        const randDayIndex = Math.floor(Math.random() * 6);
        const randWeekOffset = Math.floor(Math.random() * 4); // some previous weeks
        
        const date = new Date(currentDate);
        date.setDate(date.getDate() - (randWeekOffset * 7));
        // Use standard JS week calculation for mock data so it scatters visually in different weeks
        const dWeekId = `${date.getFullYear()}-W${Math.ceil((date.getDate() - date.getDay() + 1) / 7)}`;

        const newCard: ImageCard = {
          id: cardId,
          weekId: dWeekId,
          dayIndex: randDayIndex,
          imageUrl: b64,
          terms: fallbackOptions[Math.floor(Math.random() * fallbackOptions.length)],
          decoType: decos[Math.floor(Math.random() * decos.length)],
          angle: parseFloat((Math.random() * 6 - 3).toFixed(1)),
          createdAt: Date.now() - Math.random() * 10000000,
        };
        await saveCard(newCard);
      }
      alert("✅ 生成 24 条测试数据成功");
    } catch (err) {
      console.error(err);
      alert("生成数据失败: " + err);
    }
  };

  if (!isLoggedIn) {
    return <LoginScreen onLogin={() => setIsLoggedIn(true)} />;
  }

  return (
    <div className="min-h-screen flex flex-col transition-colors duration-300">
      {/* Visual background lines representing analog journal grid */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] dark:opacity-[0.02] bg-[linear-gradient(rgba(0,0,0,1)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,1)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,1)_1px,transparent_1px)] bg-[size:24px_24px]" />

      {/* Primary Container */}
      <div className="max-w-7xl mx-auto w-full px-4 py-6 md:py-8 flex flex-col flex-grow relative z-10">
        
        {/* Secondary Navigation row with Theme control */}
        <div className="flex items-center justify-between mb-4 px-2">
          <div className="flex items-center gap-2 text-stone-500 text-xs font-serif italic select-none">
            <BookOpen size={14} className="text-amber-800" />
            <span>光影拾记 · 灵感引擎</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleAddMockData}
              className="p-2 px-3 rounded-xl bg-green-500/10 hover:bg-green-500/20 text-green-700 dark:text-green-300 transition-colors shadow-sm cursor-pointer border border-green-500/20 flex items-center justify-center gap-1.5 text-xs font-semibold"
              title="Generate Mock Data"
            >
              <RefreshCw size={14} />
              <span className="hidden sm:inline">24 测试数据</span>
            </button>

            <button
              onClick={() => setShowSettings(true)}
              className="p-2 px-3 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-950 dark:text-amber-300 transition-colors shadow-sm cursor-pointer border border-amber-500/20 flex items-center justify-center gap-1.5 text-xs font-semibold"
              title="Configure AI service"
              id="ai-settings-trigger"
            >
              <Settings size={14} />
              <span className="hidden sm:inline">灵感引擎</span>
            </button>

            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-950 dark:text-amber-300 transition-colors shadow-sm cursor-pointer border border-amber-500/20 flex items-center justify-center"
              title="昼夜交替"
            >
              {isDarkMode ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            <button
              onClick={() => signOut(auth)}
              className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-900 dark:text-red-300 transition-colors shadow-sm cursor-pointer border border-red-500/20 flex items-center justify-center"
              title="回归现实"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>

        {/* Ink Tabs replacing old big gallery tabs */}
        <div className="mt-4 mb-4">
          <InkTabs 
            activeTab={searchScope} 
            onTabChange={setSearchScope} 
            totalCards={cards.length} 
            onOpenUniverse={() => setShowUniverse(true)}
            onOpenRoaming={() => setShowPublicInspiration(true)}
          />
        </div>

        {/* Calendar Nav Header - Moved inside current section logic */}
        <AnimatePresence mode="popLayout">
          {searchScope === "current" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <TimelineHeader
                currentDate={currentDate}
                onPrevWeek={handlePrevWeek}
                onNextWeek={handleNextWeek}
                onGoToday={handleGoToday}
                onPreviewWeek={() => setShowWeeklyPreview(true)}
                weekIdentifier={weekId}
              />
            </motion.div>
          )}
        </AnimatePresence>

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
              placeholder="寻觅曾经记录过的光影碎片与灵感低语..."
              className="w-full pl-9 pr-8 py-2 rounded-xl border border-amber-900/10 dark:border-amber-100/15 bg-white/70 dark:bg-stone-900/70 text-sm text-stone-800 dark:text-stone-100 placeholder-stone-400 dark:placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-amber-500 hover:border-amber-900/20 transition-all font-sans"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 cursor-pointer"
                title="清除搜索"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 self-end md:self-auto flex-shrink-0">
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

        {/* Mock Data Generator Panel - Highly visual, interactive & easily controllable */}
        <div className="mb-6 px-2">
          <div className="p-4 md:p-5 rounded-2xl bg-gradient-to-r from-amber-500/10 to-amber-700/[0.03] dark:from-amber-500/10 dark:to-transparent border border-amber-500/20 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-900 dark:text-amber-300 shadow-sm mt-0.5 animate-pulse">
                <Wand2 size={18} />
              </div>
              <div>
                <h4 className="font-serif font-bold text-sm text-stone-900 dark:text-stone-100 italic flex items-center gap-1.5 flex-wrap">
                  <span>🪄 演示与款式调优工具 (Mock Data Center)</span>
                  <span className="text-[10px] font-sans font-normal not-italic px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-900 dark:text-amber-300">
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

          {/* Success toast / Status Message */}
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

        {/* MAIN Content Grid / Multi-Week View */}
        <div className="mt-2">
          <AnimatePresence mode="wait">
            {searchScope === "all" ? (
              <motion.div
                key="global-inspiration-bank"
                custom={moodColor}
                variants={inkDiffusionVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
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
                      此处已为您安全同步并展现<strong>岁月长卷</strong>中曾记录的光影碎片。支持点击原图放大预览，自定义编辑以及一键提取灵感词。
                    </p>
                  </div>
                  {filteredCards.length > 0 && totalPages > 1 && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handlePrevPage}
                        disabled={historyPage === 1}
                        className="p-1.5 rounded-full bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 disabled:opacity-30 text-stone-600 dark:text-stone-300 transition-colors"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className="text-[11px] font-mono font-medium text-stone-500 dark:text-stone-400">
                        {historyPage} / {totalPages}
                      </span>
                      <button
                        onClick={handleNextPage}
                        disabled={historyPage === totalPages}
                        className="p-1.5 rounded-full bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 disabled:opacity-30 text-stone-600 dark:text-stone-300 transition-colors"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </div>

                {filteredCards.length > 0 ? (
                  <div className="w-full relative" style={{ perspective: "1500px" }}>
                    <AnimatePresence mode="wait" custom={historyDirection}>
                      <motion.div
                        key={historyPage}
                        custom={historyDirection}
                        variants={pageVariants}
                        initial="enter"
                        animate="center"
                        exit="exit"
                        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 py-2 origin-center"
                        style={{ transformStyle: "preserve-3d" }}
                      >
                        {paginatedCards.map((card) => (
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
                              onTogglePublic={handleTogglePublic}
                            />
                          </div>
                        ))}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                ) : (
                  <div className="flex-grow flex flex-col items-center justify-center py-16 text-center">
                    <Sparkles size={32} className="text-amber-500/40 mb-3 animate-pulse" />
                    <p className="text-sm font-handwritten text-stone-400 dark:text-stone-500 italic">
                      {searchQuery ? "未能在一纸回忆中寻得此字影" : "此刻，库中仍在等待第一缕光影。回到「此刻灵光」中撒下回忆的种子吧！"}
                    </p>
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="weekly-standard-grid"
                custom={moodColor}
                variants={inkDiffusionVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="flex flex-col gap-5 mb-5"
              >
                {/* Row 1: Monday, Tuesday, Wednesday */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <DaySlot
                    dayIndex={0}
                    label="破晓"
                    subLabel={getDayLabelForOffset(currentDate, 0)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 0)}
                    onUploadImage={handleUploadImage}
                    onUploadMd={handleUploadMd}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                    onTogglePublic={handleTogglePublic}
                  />
                  <DaySlot
                    dayIndex={1}
                    label="微风"
                    subLabel={getDayLabelForOffset(currentDate, 1)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 1)}
                    onUploadImage={handleUploadImage}
                    onUploadMd={handleUploadMd}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                    onTogglePublic={handleTogglePublic}
                  />
                  <DaySlot
                    dayIndex={2}
                    label="暖阳"
                    subLabel={getDayLabelForOffset(currentDate, 2)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 2)}
                    onUploadImage={handleUploadImage}
                    onUploadMd={handleUploadMd}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                    onTogglePublic={handleTogglePublic}
                  />
                </div>

                {/* Row 2: Thursday, Friday, Weekend */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <DaySlot
                    dayIndex={3}
                    label="暮云"
                    subLabel={getDayLabelForOffset(currentDate, 3)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 3)}
                    onUploadImage={handleUploadImage}
                    onUploadMd={handleUploadMd}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                    onTogglePublic={handleTogglePublic}
                  />
                  <DaySlot
                    dayIndex={4}
                    label="星夜"
                    subLabel={getDayLabelForOffset(currentDate, 4)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 4)}
                    onUploadImage={handleUploadImage}
                    onUploadMd={handleUploadMd}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                    onTogglePublic={handleTogglePublic}
                  />
                  {/* Weekend combined cell */}
                  <DaySlot
                    dayIndex={5}
                    label="留白"
                    subLabel={getDayLabelForOffset(currentDate, 5)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 5)}
                    onUploadImage={handleUploadImage}
                    onUploadMd={handleUploadMd}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                    onTogglePublic={handleTogglePublic}
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
                    漫笔随想
                  </span>
                  <span className="text-[10px] font-handwritten tracking-wide text-amber-800 dark:text-amber-300 uppercase select-none leading-none">
                    ★ 片段与沉思 ★
                  </span>
                  <button
                    onClick={handleSummarize}
                    disabled={isSummarizing || cards.filter(c => c.weekId === weekId).length === 0}
                    className="ml-2 px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 hover:bg-indigo-100 dark:hover:bg-indigo-800/60 transition-colors shadow-sm text-[10px] font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSummarizing ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
                    <span>AI 时光淬炼</span>
                  </button>
                </div>

                {/* DB sync loading indicators */}
                <div className="text-[10px] font-mono font-medium flex items-center gap-1.5 text-stone-400 dark:text-stone-500">
                  {dbSaveStatus === "saving" && (
                    <>
                      <Loader2 size={10} className="animate-spin text-amber-500" />
                      <span>正在封存记忆...</span>
                    </>
                  )}
                  {dbSaveStatus === "clean" && (
                    <span className="text-emerald-600 dark:text-emerald-500 font-semibold flex items-center gap-1">
                      ✓ 已镌刻于云端
                    </span>
                  )}
                  {dbSaveStatus === "error" && (
                    <span className="text-red-500 font-semibold">
                      ⚠ 记忆遗失
                    </span>
                  )}
                </div>
              </div>

              {/* Editable handwriting textarea pads */}
              <textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="在此驻留片刻，写下光影中的低语与期许……"
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
          onSave={(config) => {
            localStorage.setItem("custom_provider", config.customProvider);
            localStorage.setItem("custom_gemini_api_key", config.customApiKey);
            localStorage.setItem("custom_gemini_base_url", config.customGeminiBaseUrl);
            localStorage.setItem("custom_gemini_model", config.selectedModel);
            localStorage.setItem("custom_anthropic_auth_token", config.anthropicAuthToken);
            localStorage.setItem("custom_anthropic_base_url", config.anthropicBaseUrl);
            localStorage.setItem("custom_anthropic_model", config.anthropicModel);

            setCustomProvider(config.customProvider);
            setCustomApiKey(config.customApiKey);
            setCustomGeminiBaseUrl(config.customGeminiBaseUrl);
            setSelectedModel(config.selectedModel);
            setAnthropicAuthToken(config.anthropicAuthToken);
            setAnthropicBaseUrl(config.anthropicBaseUrl);
            setAnthropicModel(config.anthropicModel);
          }}
        />
      )}

      {/* Weekly Preview Modal */}
      {showWeeklyPreview && (
        <WeeklyPreviewModal
          cards={cards.filter(c => c.weekId === weekId)}
          weekRangeStr={weekId || "Current Week"}
          onClose={() => setShowWeeklyPreview(false)}
        />
      )}

      {/* Inspiration Universe */}
      {showUniverse && (
        <InspirationUniverse
          isOpen={showUniverse}
          onClose={() => setShowUniverse(false)}
          cards={cards}
        />
      )}

      {/* Public Inspiration Board */}
      {showPublicInspiration && (
        <PublicInspirationBoard
          onClose={() => setShowPublicInspiration(false)}
          onZoom={setZoomedCard}
        />
      )}

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {cardToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => deletePhase === "prompt" && setCardToDelete(null)}
              className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-stone-100 dark:bg-stone-900 rounded-2xl shadow-xl overflow-hidden border border-stone-200 dark:border-stone-800 p-6 flex flex-col gap-4 text-center z-10"
            >
              
              {/* Shredder animation container */}
              <div className="relative mx-auto w-32 h-40 flex flex-col items-center justify-start overflow-hidden mb-2 pt-2">
                {/* The card preview */}
                <motion.div
                  animate={
                    deletePhase === "animating" 
                      ? { y: 120 }
                      : { y: 0, rotate: [-1, 1, -1], transition: { repeat: Infinity, duration: 4, ease: "easeInOut" } }
                  }
                  transition={deletePhase === "animating" ? { duration: 0.7, ease: "anticipate" } : {}}
                  className="z-10 w-24 h-28 bg-white p-1.5 shadow-sm flex flex-col border border-stone-200 dark:border-stone-700"
                >
                  <img src={cardToDelete.imageUrl} className="w-full h-16 object-cover bg-stone-200 dark:bg-stone-800" alt="" />
                  <div className="flex-1 mt-1 bg-stone-50 dark:bg-stone-800 flex items-end p-1">
                     <div className="h-1 flex-1 bg-stone-200 dark:bg-stone-700 rounded-full w-1/2 opacity-50" />
                  </div>
                </motion.div>
                
                {/* The Shredder Slot */}
                <div className="absolute bottom-6 w-full flex justify-center z-20">
                   <div className="w-28 h-3 bg-stone-300 dark:bg-stone-800 rounded-sm border border-stone-400 dark:border-stone-700 shadow-inner flex items-center justify-center">
                      <div className="w-[100px] h-1.5 bg-stone-800 dark:bg-black rounded-full" />
                   </div>
                </div>

                {/* Shredded pieces */}
                <div className="absolute bottom-0 w-24 h-6 flex justify-between gap-[1px] z-0 px-0.5">
                  {[...Array(6)].map((_, i) => (
                    <motion.div 
                      key={i}
                      initial={{ y: -24, opacity: 0 }}
                      animate={deletePhase === "animating" ? { y: 24, opacity: [0, 1, 0] } : {}}
                      transition={deletePhase === "animating" ? { duration: 0.6, delay: 0.4 + (i * 0.05) } : {}}
                      className="flex-1 bg-white border-x border-b border-stone-200 dark:border-stone-700 h-10 shadow-sm rounded-b-sm"
                    />
                  ))}
                </div>
              </div>

              <h3 className="text-xl font-bold font-sans text-stone-800 dark:text-stone-100">Delete Photo?</h3>
              <p className="text-sm text-stone-500 dark:text-stone-400 font-sans">
                This photo will be permanently removed.<br/>Are you sure you want to proceed?
              </p>
              <div className="flex gap-3 mt-2">
                <button
                  disabled={deletePhase === "animating"}
                  onClick={() => setCardToDelete(null)}
                  className="flex-1 py-2.5 rounded-xl font-medium text-stone-600 dark:text-stone-300 bg-stone-200 dark:bg-stone-800 hover:bg-stone-300 dark:hover:bg-stone-700 transition disabled:opacity-50"
                  id="cancel-delete-card-btn"
                >
                  Cancel
                </button>
                <button
                  disabled={deletePhase === "animating"}
                  onClick={confirmDeleteCard}
                  className="flex-1 py-2.5 rounded-xl font-medium text-white bg-red-500 hover:bg-red-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
                  id="confirm-delete-card-btn"
                >
                  {deletePhase === "animating" ? "Deleting..." : "Delete"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
              className={`relative w-full bg-white dark:bg-stone-850 p-4 md:p-6 pb-6 md:pb-8 shadow-[0_24px_50px_rgba(0,0,0,0.6)] dark:shadow-[0_24px_60px_rgba(0,0,0,0.9)] border border-amber-900/10 dark:border-stone-600/50 select-text rounded-2xl flex flex-col md:flex-row gap-6 items-center md:items-start ${zoomedCard.type === 'md' ? 'max-w-5xl' : 'max-w-3xl'}`}
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

              {/* Left Column: Picture or MD */}
              <div className={`relative overflow-hidden bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-inner rounded-xl group/zoomimage ${zoomedCard.type === 'md' ? 'w-full md:w-3/4 h-[70vh] max-h-[800px]' : 'w-full md:w-3/5 aspect-square max-w-[420px]'}`}>
                {zoomedCard.type === 'md' ? (
                  <div className="w-full h-full overflow-y-auto p-6 md:p-10 bg-white dark:bg-stone-900 custom-scrollbar text-left text-sm md:text-base prose prose-stone dark:prose-invert max-w-none prose-h1:font-serif prose-h2:font-serif prose-h3:font-serif prose-p:font-sans prose-p:leading-relaxed prose-a:text-amber-600 prose-img:rounded-xl shadow-inner break-words">
                    <Markdown>{zoomedCard.mdContent || ""}</Markdown>
                  </div>
                ) : (
                  <img
                    src={zoomedCard.imageUrl}
                    alt="Original Snippet View"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/5 to-white/5 pointer-events-none" />

                {/* Left/Right Arrows inside zoomed image */}
                {filteredCards.length > 1 && (
                  <>
                    <button
                      onClick={handlePrevZoomedCard}
                      className="absolute left-3 top-1/2 -translate-y-1/2 z-20 bg-stone-950/70 hover:bg-amber-500 hover:scale-110 active:scale-95 text-white p-2.5 rounded-full shadow-lg border border-white/10 transition-all cursor-pointer opacity-80 hover:opacity-100"
                      title="上一张 (ArrowLeft)"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      onClick={handleNextZoomedCard}
                      className="absolute right-3 top-1/2 -translate-y-1/2 z-20 bg-stone-950/70 hover:bg-amber-500 hover:scale-110 active:scale-95 text-white p-2.5 rounded-full shadow-lg border border-white/10 transition-all cursor-pointer opacity-80 hover:opacity-100"
                      title="下一张 (ArrowRight)"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </>
                )}
              </div>

              {/* Right Column: Key Details, Tag lists, info */}
              <div className={`w-full flex flex-col h-full justify-between gap-5 self-stretch py-1 ${zoomedCard.type === 'md' ? 'md:w-1/4' : 'md:w-2/5'}`}>
                <div className="flex flex-col gap-4">
                  {/* Title / Mood heading */}
                  <div className="border-b border-dashed border-amber-900/15 dark:border-amber-100/10 pb-3">
                    <span className="text-xs font-handwritten font-bold text-amber-800 dark:text-amber-400 tracking-wider block mb-1 uppercase">
                      ★ Captured Inspiration ★
                    </span>
                    <h3 className="font-serif font-bold text-lg text-stone-900 dark:text-stone-100 italic leading-tight">
                      {getDayLabelForDayIndex(zoomedCard.dayIndex)} 灵感记录
                    </h3>
                    <p className="text-[10px] font-mono text-stone-400 dark:text-stone-500 mt-1.5 flex items-center justify-between">
                      <span>记录时间： {new Date(zoomedCard.createdAt).toLocaleString()}</span>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          await handleTogglePublic(zoomedCard);
                          setZoomedCard(prev => prev ? { ...prev, isPublic: !prev.isPublic } : null);
                        }}
                        className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold transition-colors border ${
                            zoomedCard.isPublic 
                              ? "bg-emerald-100/50 text-emerald-700 border-emerald-200 hover:bg-stone-100 hover:text-stone-500 hover:border-stone-200"
                              : "bg-stone-100 text-stone-500 border-stone-200 hover:bg-emerald-100/50 hover:text-emerald-700 hover:border-emerald-200"
                        }`}
                      >
                         {zoomedCard.isPublic ? <Globe size={10} /> : <Lock size={10} />}
                         {zoomedCard.isPublic ? "已公开" : "私密"}
                      </button>
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
