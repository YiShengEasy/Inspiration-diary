import React, { useState, useEffect, useRef, useCallback } from "react";
import { ImageCard, type BookSuggestionCandidate, type CustomTagGroup, type InspirationBook } from "./types";
import { motion, AnimatePresence } from "motion/react";
import {
  subscribeCards,
  loadNote,
  saveNote,
  createNewCardId,
  saveCard,
  deleteCard,
  updateCardTerms,
  updateCardInsightNote,
  refreshCards,
  loadSettings,
  saveSettings,
  loadAllCardsPage,
  uploadVideoAsset,
  MAX_VIDEO_UPLOAD_BYTES,
  MAX_IMAGE_ASSET_UPLOAD_BYTES,
  loadCardVideos,
  deleteVideoAsset,
  uploadImageAsset,
  loadCardImages,
  deleteImageAsset,
  isSupportedImageAssetFile,
  createComboCard,
} from "./lib/dbClient";
import TimelineHeader from "./components/TimelineHeader";
import DaySlot from "./components/DaySlot";
import PolaroidCard from "./components/PolaroidCard";
import InspirationBooksView from "./components/InspirationBooksView";
import CustomTagLibraryView from "./components/CustomTagLibraryView";
import CardBookPopover from "./components/CardBookPopover";
import { ComboCardDetailView } from "./components/ComboCardDetail";
import LoginScreen from "./components/LoginScreen";
import { WeeklyPreviewModal } from "./components/WeeklyPreviewModal";
import { Sun, Moon, Sparkles, BookOpen, Clock, Loader2, Save, Settings, Search, X, Copy, Calendar, Globe, Wand2, Trash, RefreshCw, LogOut, ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut, Maximize2, Move, Image as ImageIcon, FileText, Tags, FileVideo, Upload } from "lucide-react";
import { generateMockImage } from "./utils/mockGenerator";
import SettingsModal from "./components/SettingsModal";
import { getCurrentUser, login, logout, register, authFetch, type AuthUser } from "./lib/authClient";
import { loadBooks, loadBookSuggestionCandidates, loadCardBookMembership, recordBookSuggestionFeedback, setCardBookMembership } from "./lib/booksClient";
import { CUSTOM_TAG_LIBRARY_ENABLED_SETTINGS_KEY, CUSTOM_TAG_LIBRARY_SETTINGS_KEY, flattenEnabledCustomTagGroups, normalizeCustomTagGroups } from "./lib/customTagLibrary";
import Markdown from "react-markdown";

const ALL_CARDS_PAGE_SIZE = 12;
const SMART_BOOK_SUGGEST_IMAGES_KEY = "smart_book_suggest_images";
const SMART_BOOK_SUGGEST_MARKDOWN_KEY = "smart_book_suggest_markdown";
type PendingSmartSuggestion = {
  card: ImageCard;
  match: BookSuggestionCandidate;
  candidates: BookSuggestionCandidate[];
};

type SmartSuggestionGroup = {
  book: InspirationBook;
  candidates: BookSuggestionCandidate[];
  cards: ImageCard[];
  matchedTerms: string[];
  score: number;
};

type UploadTargetOptions = {
  targetWeekId?: string;
  targetBookId?: string;
};

export default function App() {
  const shouldShowMockTools = import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCK_TOOLS === "true";
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(true);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [weekId, setWeekId] = useState<string>("");
  const [cards, setCards] = useState<ImageCard[]>([]);
  const [noteContent, setNoteContent] = useState<string>("");
  const [noteHeight, setNoteHeight] = useState<number>(220);
  const [dbSaveStatus, setDbSaveStatus] = useState<"clean" | "saving" | "error">("clean");
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchScope, setSearchScope] = useState<"current" | "all">("current");
  const [mainView, setMainView] = useState<"board" | "books" | "tags">("board");
  const [bookRefreshToken, setBookRefreshToken] = useState<number>(0);
  const [customTagGroups, setCustomTagGroups] = useState<CustomTagGroup[]>([]);
  const [customTagLibraryEnabled, setCustomTagLibraryEnabled] = useState<boolean>(true);
  const [customTagSyncStatus, setCustomTagSyncStatus] = useState<"clean" | "saving" | "error">("clean");
  const [zoomedCard, setZoomedCard] = useState<ImageCard | null>(null);
  const [isDetailBookPopoverOpen, setIsDetailBookPopoverOpen] = useState<boolean>(false);
  const [detailInsightNote, setDetailInsightNote] = useState<string>("");
  const [detailInsightSaveStatus, setDetailInsightSaveStatus] = useState<"clean" | "dirty" | "saving" | "error">("clean");
  const [isBindingVideo, setIsBindingVideo] = useState<boolean>(false);
  const [videoBindError, setVideoBindError] = useState<string>("");
  const [isBindingImage, setIsBindingImage] = useState<boolean>(false);
  const [imageBindError, setImageBindError] = useState<string>("");
  const [imageZoomScale, setImageZoomScale] = useState<number>(1);
  const [imagePan, setImagePan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [imageViewMode, setImageViewMode] = useState<"fit" | "actual">("fit");
  const imagePanStartRef = useRef<{ pointerId: number; startX: number; startY: number; panX: number; panY: number } | null>(null);
  const detailVideoInputRef = useRef<HTMLInputElement>(null);
  const detailImageInputRef = useRef<HTMLInputElement>(null);
  const [isRefreshingCards, setIsRefreshingCards] = useState<boolean>(false);
  const [showWeeklyPreview, setShowWeeklyPreview] = useState<boolean>(false);
  const [cardToDelete, setCardToDelete] = useState<ImageCard | null>(null);
  const [deletePhase, setDeletePhase] = useState<"prompt" | "animating">("prompt");
  const [allCardsPage, setAllCardsPage] = useState<number>(1);
  const [allCardsPageCards, setAllCardsPageCards] = useState<ImageCard[]>([]);
  const [allCardsTotal, setAllCardsTotal] = useState<number>(0);
  const [allCardsTotalPages, setAllCardsTotalPages] = useState<number>(1);
  const [isLoadingAllCards, setIsLoadingAllCards] = useState<boolean>(false);
  const [smartSuggestImages, setSmartSuggestImages] = useState<boolean>(false);
  const [smartSuggestMarkdown, setSmartSuggestMarkdown] = useState<boolean>(false);
  const [smartSuggestSyncStatus, setSmartSuggestSyncStatus] = useState<"clean" | "saving" | "error">("clean");
  const smartSuggestImagesRef = useRef<boolean>(false);
  const smartSuggestMarkdownRef = useRef<boolean>(false);
  const smartSuggestionRef = useRef<SmartSuggestionGroup | null>(null);
  const smartBatchModeRef = useRef<boolean>(false);
  const batchSmartSuggestionsRef = useRef<Map<string, SmartSuggestionGroup>>(new Map());
  const [smartSuggestion, setSmartSuggestion] = useState<SmartSuggestionGroup | null>(null);
  const [queuedSmartSuggestions, setQueuedSmartSuggestions] = useState<SmartSuggestionGroup[]>([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(() => new Set());
  const [isApplyingSmartSuggestion, setIsApplyingSmartSuggestion] = useState<boolean>(false);
  const [smartSuggestionError, setSmartSuggestionError] = useState<string | null>(null);
  const [selectedSmartBookId, setSelectedSmartBookId] = useState<string>("");

  // Custom AI parameter states
  const [customProvider, setCustomProvider] = useState<string>(() => {
    return localStorage.getItem("custom_provider") || "thirdparty";
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
    return localStorage.getItem("custom_thirdparty_model") || "doubao-seed-2.0-code";
  });
  const [thirdPartyThinking, setThirdPartyThinking] = useState<boolean>(() => {
    return localStorage.getItem("custom_thirdparty_thinking") === "true";
  });
  const [showSettings, setShowSettings] = useState<boolean>(false);

  const dragStartRef = useRef<number | null>(null);
  const initialHeightRef = useRef<number | null>(null);

  const clearAuthenticatedState = useCallback(() => {
    setAuthUser(null);
    setCards([]);
    setAllCardsPageCards([]);
    setAllCardsTotal(0);
    setAllCardsTotalPages(1);
    setAllCardsPage(1);
    setMainView("board");
    setZoomedCard(null);
  }, []);

  useEffect(() => {
    let alive = true;

    getCurrentUser()
      .then((user) => {
        if (alive) setAuthUser(user);
      })
      .finally(() => {
        if (alive) setIsCheckingAuth(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      clearAuthenticatedState();
    };

    window.addEventListener("auth:required", handler);
    return () => window.removeEventListener("auth:required", handler);
  }, [clearAuthenticatedState]);

  // Calculate the week identifier (e.g., "2026-W25")
  const getWeekIdentifier = (date: Date): string => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  };

  const getDayIndexForDate = (date: Date): number => {
    const day = date.getDay();
    if (day === 0 || day === 6) return 5;
    return day - 1;
  };

  useEffect(() => {
    setWeekId(getWeekIdentifier(currentDate));
  }, [currentDate]);

  // Load AI settings from DB on startup (DB values take priority over localStorage)
  useEffect(() => {
    if (!authUser) return;

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
      if (dbSettings[SMART_BOOK_SUGGEST_IMAGES_KEY] !== undefined) {
        setSmartSuggestImages(dbSettings[SMART_BOOK_SUGGEST_IMAGES_KEY] === "true");
      }
      if (dbSettings[SMART_BOOK_SUGGEST_MARKDOWN_KEY] !== undefined) {
        setSmartSuggestMarkdown(dbSettings[SMART_BOOK_SUGGEST_MARKDOWN_KEY] === "true");
      }
      if (dbSettings[CUSTOM_TAG_LIBRARY_SETTINGS_KEY] !== undefined) {
        setCustomTagGroups(normalizeCustomTagGroups(dbSettings[CUSTOM_TAG_LIBRARY_SETTINGS_KEY]));
      }
      if (dbSettings[CUSTOM_TAG_LIBRARY_ENABLED_SETTINGS_KEY] !== undefined) {
        setCustomTagLibraryEnabled(dbSettings[CUSTOM_TAG_LIBRARY_ENABLED_SETTINGS_KEY] !== "false");
      }
    }).catch((err) => console.error("Failed to load settings from DB:", err));
  }, [authUser]);

  useEffect(() => {
    smartSuggestImagesRef.current = smartSuggestImages;
  }, [smartSuggestImages]);

  useEffect(() => {
    smartSuggestMarkdownRef.current = smartSuggestMarkdown;
  }, [smartSuggestMarkdown]);

  useEffect(() => {
    smartSuggestionRef.current = smartSuggestion;
    setSelectedSmartBookId(smartSuggestion?.book.id || "");
  }, [smartSuggestion]);

  useEffect(() => {
    if (smartSuggestion || queuedSmartSuggestions.length === 0) return;
    const [nextSuggestion, ...remainingSuggestions] = queuedSmartSuggestions;
    setQueuedSmartSuggestions(remainingSuggestions);
    setSmartSuggestion(nextSuggestion);
    setSmartSuggestionError(null);
  }, [queuedSmartSuggestions, smartSuggestion]);

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
    if (!authUser) return;
    if (!weekId) return;
    if (mainView !== "board") return;
    if (searchScope === "all") return;

    const unsubscribe = subscribeCards(weekId, (fetchedCards) => {
      setCards(fetchedCards);
    });

    return () => unsubscribe();
  }, [authUser, weekId, searchScope, mainView]);

  const loadHistoricalCardsPage = async (page = allCardsPage) => {
    setIsLoadingAllCards(true);
    try {
      const result = await loadAllCardsPage({
        page,
        pageSize: ALL_CARDS_PAGE_SIZE,
        query: searchQuery,
      });
      setAllCardsPageCards(result.cards);
      setAllCardsTotal(result.total);
      setAllCardsPage(result.page);
      setAllCardsTotalPages(result.totalPages);
    } catch (err) {
      console.error("Failed to load historical cards page:", err);
      setAllCardsPageCards([]);
      setAllCardsTotal(0);
      setAllCardsTotalPages(1);
    } finally {
      setIsLoadingAllCards(false);
    }
  };

  useEffect(() => {
    if (!authUser) return;
    if (mainView !== "board") return;
    if (searchScope !== "all") return;
    void loadHistoricalCardsPage(allCardsPage);
  }, [authUser, mainView, searchScope, allCardsPage, searchQuery]);

  useEffect(() => {
    setAllCardsPage(1);
  }, [searchQuery, searchScope]);

  // Fetch / subscribe for notes of the current week
  useEffect(() => {
    if (!authUser) return;
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
  }, [authUser, weekId]);

  // Debounced note & height auto-saving
  useEffect(() => {
    if (!authUser) return;
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
  }, [authUser, noteContent, noteHeight, weekId]);

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

  const handleRefreshCards = async () => {
    if (!weekId || isRefreshingCards) return;
    setIsRefreshingCards(true);
    try {
      if (searchScope === "all") {
        await loadHistoricalCardsPage(allCardsPage);
        return;
      }
      const refreshedCards = await refreshCards(weekId);
      setCards(refreshedCards);
    } catch (err) {
      console.error("Failed to refresh cards:", err);
    } finally {
      setIsRefreshingCards(false);
    }
  };

  const handleBookMembershipChanged = useCallback(() => {
    setBookRefreshToken((current) => current + 1);
  }, []);

  const persistSmartSuggestSetting = async (key: string, value: boolean) => {
    setSmartSuggestSyncStatus("saving");
    try {
      await saveSettings({ [key]: String(value) });
      setSmartSuggestSyncStatus("clean");
    } catch (err) {
      console.error("Failed to save smart suggestion setting:", err);
      setSmartSuggestSyncStatus("error");
    }
  };

  const handleSaveCustomTagGroups = async (groups: CustomTagGroup[]) => {
    const normalizedGroups = normalizeCustomTagGroups(groups);
    setCustomTagGroups(normalizedGroups);
    setCustomTagSyncStatus("saving");
    try {
      await saveSettings({ [CUSTOM_TAG_LIBRARY_SETTINGS_KEY]: JSON.stringify(normalizedGroups) });
      setCustomTagSyncStatus("clean");
    } catch (err) {
      console.error("Failed to save custom tag library:", err);
      setCustomTagSyncStatus("error");
      throw err;
    }
  };

  const handleCustomTagLibraryEnabledChange = (enabled: boolean) => {
    setCustomTagLibraryEnabled(enabled);
    setCustomTagSyncStatus("saving");
    saveSettings({ [CUSTOM_TAG_LIBRARY_ENABLED_SETTINGS_KEY]: String(enabled) })
      .then(() => setCustomTagSyncStatus("clean"))
      .catch((err) => {
        console.error("Failed to save custom tag library enabled setting:", err);
        setCustomTagSyncStatus("error");
      });
  };

  const handleSmartSuggestImagesChange = (enabled: boolean) => {
    smartSuggestImagesRef.current = enabled;
    setSmartSuggestImages(enabled);
    void persistSmartSuggestSetting(SMART_BOOK_SUGGEST_IMAGES_KEY, enabled);
  };

  const handleSmartSuggestMarkdownChange = (enabled: boolean) => {
    smartSuggestMarkdownRef.current = enabled;
    setSmartSuggestMarkdown(enabled);
    void persistSmartSuggestSetting(SMART_BOOK_SUGGEST_MARKDOWN_KEY, enabled);
  };

  const suggestionKey = (cardId: string, bookId: string) => `${cardId}:${bookId}`;

  const loadSmartBookHints = async (cardType: "image" | "md") => {
    const shouldSuggest = cardType === "md" ? smartSuggestMarkdownRef.current : smartSuggestImagesRef.current;
    if (!shouldSuggest) return [];

    try {
      const books = await loadBooks();
      return books
        .map((book) => [book.title, book.description].filter(Boolean).join("：").trim())
        .filter(Boolean)
        .slice(0, 20);
    } catch (err) {
      console.warn("Smart book hint loading skipped:", err);
      return [];
    }
  };

  const createSmartSuggestionGroup = (suggestion: PendingSmartSuggestion): SmartSuggestionGroup => ({
    book: suggestion.match.book,
    candidates: suggestion.candidates,
    cards: [suggestion.card],
    matchedTerms: suggestion.match.matchedTerms,
    score: suggestion.match.score,
  });

  const mergeSmartSuggestionIntoGroup = (
    group: SmartSuggestionGroup,
    suggestion: PendingSmartSuggestion,
  ): SmartSuggestionGroup => {
    if (group.cards.some((card) => card.id === suggestion.card.id)) {
      return {
        ...group,
        candidates: group.candidates.length >= suggestion.candidates.length ? group.candidates : suggestion.candidates,
        matchedTerms: Array.from(new Set([...group.matchedTerms, ...suggestion.match.matchedTerms])).slice(0, 6),
        score: Math.max(group.score, suggestion.match.score),
      };
    }

    return {
      ...group,
      candidates: group.candidates.length >= suggestion.candidates.length ? group.candidates : suggestion.candidates,
      cards: [...group.cards, suggestion.card],
      matchedTerms: Array.from(new Set([...group.matchedTerms, ...suggestion.match.matchedTerms])).slice(0, 6),
      score: Math.max(group.score, suggestion.match.score),
    };
  };

  const queueSmartSuggestion = (suggestion: PendingSmartSuggestion) => {
    const nextKey = suggestionKey(suggestion.card.id, suggestion.match.book.id);
    const activeSuggestion = smartSuggestionRef.current;
    if (activeSuggestion?.book.id === suggestion.match.book.id && activeSuggestion.cards.some((card) => card.id === suggestion.card.id)) {
      return;
    }

    if (smartBatchModeRef.current) {
      const batchSuggestions = batchSmartSuggestionsRef.current;
      const existingGroup = batchSuggestions.get(suggestion.match.book.id);
      batchSuggestions.set(
        suggestion.match.book.id,
        existingGroup ? mergeSmartSuggestionIntoGroup(existingGroup, suggestion) : createSmartSuggestionGroup(suggestion),
      );
      return;
    }

    const nextGroup = createSmartSuggestionGroup(suggestion);
    setQueuedSmartSuggestions((current) => {
      if (current.some((group) => group.book.id === suggestion.match.book.id && group.cards.some((card) => suggestionKey(card.id, group.book.id) === nextKey))) {
        return current;
      }
      return [...current, nextGroup];
    });
  };

  const handleBatchUploadStart = useCallback(() => {
    smartBatchModeRef.current = true;
    batchSmartSuggestionsRef.current = new Map();
  }, []);

  const handleBatchUploadEnd = useCallback(() => {
    smartBatchModeRef.current = false;
    const batchSuggestions = Array.from(batchSmartSuggestionsRef.current.values())
      .filter((group) => group.cards.length > 0);
    batchSmartSuggestionsRef.current = new Map();
    if (batchSuggestions.length > 0) {
      setQueuedSmartSuggestions((current) => [...current, ...batchSuggestions]);
    }
  }, []);

  const maybeSuggestBookMembership = async (card: ImageCard) => {
    const shouldSuggest = card.type === "md" ? smartSuggestMarkdownRef.current : smartSuggestImagesRef.current;
    if (!shouldSuggest) {
      console.info("Smart book suggestion skipped: switch is off", { cardId: card.id, type: card.type || "image" });
      return;
    }

    try {
      const candidates = await loadBookSuggestionCandidates(card.id);
      const memberships = await loadCardBookMembership(card.id);
      const availableCandidates = candidates.filter((candidate) => {
        return !memberships.some((book) => book.id === candidate.book.id && book.containsCard);
      });
      const match = availableCandidates[0];
      if (!match) {
        console.info("Smart book suggestion skipped: no matching book", {
          cardId: card.id,
          terms: card.terms,
          mdName: card.mdName,
        });
        return;
      }

      const key = suggestionKey(card.id, match.book.id);
      if (dismissedSuggestions.has(key)) return;

      queueSmartSuggestion({ card, match, candidates: availableCandidates });
    } catch (err) {
      console.warn("Smart book suggestion skipped:", err);
    }
  };

  const dismissSmartSuggestion = (recordFeedback = true) => {
    if (smartSuggestion) {
      setDismissedSuggestions((current) => {
        const next = new Set(current);
        smartSuggestion.cards.forEach((card) => next.add(suggestionKey(card.id, smartSuggestion.book.id)));
        return next;
      });
      if (recordFeedback) {
        smartSuggestion.cards.forEach((card) => {
          void recordBookSuggestionFeedback({
            cardId: card.id,
            suggestedBookId: smartSuggestion.book.id,
            action: "dismissed",
            matchedTerms: smartSuggestion.matchedTerms,
            score: smartSuggestion.score,
          }).catch((err) => console.warn("Smart book feedback skipped:", err));
        });
      }
    }
    setSmartSuggestion(null);
    setSmartSuggestionError(null);
  };

  const confirmSmartSuggestion = async () => {
    if (!smartSuggestion) return;
    const selectedCandidate = smartSuggestion.candidates.find((candidate) => candidate.book.id === selectedSmartBookId) || smartSuggestion.candidates[0];
    if (!selectedCandidate) return;
    setIsApplyingSmartSuggestion(true);
    setSmartSuggestionError(null);
    try {
      await Promise.all(
        smartSuggestion.cards.map((card) => setCardBookMembership(card.id, selectedCandidate.book.id, true)),
      );
      await Promise.all(
        smartSuggestion.cards.map((card) => recordBookSuggestionFeedback({
          cardId: card.id,
          suggestedBookId: smartSuggestion.book.id,
          selectedBookId: selectedCandidate.book.id,
          action: selectedCandidate.book.id === smartSuggestion.book.id ? "accepted" : "corrected",
          matchedTerms: selectedCandidate.matchedTerms.length > 0 ? selectedCandidate.matchedTerms : smartSuggestion.matchedTerms,
          score: selectedCandidate.score,
        })),
      );
      handleBookMembershipChanged();
      dismissSmartSuggestion(false);
    } catch (err) {
      setSmartSuggestionError(err instanceof Error ? err.message : "加入灵感册失败");
    } finally {
      setIsApplyingSmartSuggestion(false);
    }
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
  const handleUploadImage = async (
    dayIndex: number,
    originalFile: File,
    analysisBlob: Blob = originalFile,
    options: UploadTargetOptions = {},
  ) => {
    try {
      const targetWeekId = options.targetWeekId || weekId;
      const targetBookId = options.targetBookId;

      if (!targetWeekId) {
        throw new Error("当前周信息还在加载，请稍后再粘贴图片。");
      }

      const headers: Record<string, string> = {
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

      const storeForm = new FormData();
      storeForm.append("image", originalFile, originalFile.name || "inspiration-upload.jpg");
      storeForm.append("source", "web");

	      const storeResponse = await authFetch("/api/store-image", {
	        method: "POST",
	        body: storeForm,
	      });

	      if (!storeResponse.ok) {
	        const rawErrorText = await storeResponse.text();
	        let message = rawErrorText;
	        try {
	          const parsed = JSON.parse(rawErrorText);
	          message = parsed.error || message;
	        } catch {
	          // Keep raw response text.
	        }
	        throw new Error(message || `PhotoPrism upload failed with status ${storeResponse.status}`);
	      }

	      const storedImage = await storeResponse.json();
      const imageUrl = storedImage.imageUrl || "";
      const thumbnailUrl = storedImage.thumbnailUrl || "";

	      // Generate a new doc in the cards collection
	      const cardId = createNewCardId();
	      const newCard: ImageCard = {
	        id: cardId,
	        weekId: targetWeekId,
	        dayIndex,
	        imageUrl,
	        thumbnailUrl,
	        photoUid: storedImage.photoUid || "",
          photoHash: storedImage.photoHash || "",
	        terms: selectedFallback,
        decoType: randomDeco,
        angle: randomAngle,
        createdAt: Date.now(),
      };

      await saveCard(newCard);
      if (targetBookId) {
        await setCardBookMembership(cardId, targetBookId, true);
        handleBookMembershipChanged();
      } else {
        void maybeSuggestBookMembership(newCard);
      }

      const analyzeAndUpdateTerms = async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout limit

        try {
          const analyzeForm = new FormData();
          analyzeForm.append("image", analysisBlob, "analysis.jpg");
          const bookHints = await loadSmartBookHints("image");
          if (bookHints.length > 0) {
            analyzeForm.append("bookHints", JSON.stringify(bookHints));
          }
          const customTagHints = customTagLibraryEnabled ? flattenEnabledCustomTagGroups(customTagGroups) : [];
          if (customTagHints.length > 0) {
            analyzeForm.append("customTagHints", JSON.stringify(customTagHints));
          }

          const response = await authFetch("/api/analyze-image", {
            method: "POST",
            headers,
            body: analyzeForm,
            signal: controller.signal,
          });

          if (!response.ok) {
            const rawErrorText = await response.text();
            console.warn("Image term extraction skipped:", rawErrorText || `status ${response.status}`);
            return;
          }

          const resParsed = await response.json();
          const extractedTerms = Array.isArray(resParsed.terms) ? resParsed.terms.slice(0, 5) : [];
          if (extractedTerms.length > 0) {
            await updateCardTerms(cardId, targetWeekId, extractedTerms);
            if (!targetBookId) {
              await maybeSuggestBookMembership({ ...newCard, terms: extractedTerms });
            }
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

      if (smartBatchModeRef.current) {
        await analyzeAndUpdateTerms();
      } else {
        void analyzeAndUpdateTerms();
      }
    } catch (error: any) {
      console.error("Aesthetic extracting terms error:", error);
      throw new Error(error.message || "Failed to parse terms with the configured AI provider.");
    }
  };

  const handleUploadMd = async (
    dayIndex: number,
    text: string,
    filename: string,
    options: UploadTargetOptions = {},
  ) => {
    try {
      const targetWeekId = options.targetWeekId || weekId;
      const targetBookId = options.targetBookId;

      if (!targetWeekId) {
        throw new Error("当前周信息还在加载，请稍后再上传手稿。");
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "x-provider": customProvider || "gemini",
      };

      if (customProvider === "anthropic") {
        if (anthropicAuthToken) headers["x-api-key"] = anthropicAuthToken;
        if (anthropicModel) headers["x-model-name"] = anthropicModel;
        if (anthropicBaseUrl) headers["x-anthropic-base-url"] = anthropicBaseUrl;
      } else if (customProvider === "thirdparty") {
        headers["x-provider"] = "gemini";
        if (thirdPartyApiKey) headers["x-api-key"] = thirdPartyApiKey;
        if (thirdPartyModel) headers["x-model-name"] = thirdPartyModel;
        if (thirdPartyBaseUrl) headers["x-gemini-base-url"] = thirdPartyBaseUrl;
        if (thirdPartyThinking) headers["x-thinking-enabled"] = "true";
      } else {
        if (customApiKey) headers["x-api-key"] = customApiKey;
        if (selectedModel) headers["x-model-name"] = selectedModel;
        if (customGeminiBaseUrl) headers["x-gemini-base-url"] = customGeminiBaseUrl;
      }

      let mdSummary = text
        .replace(/[#>*_`~\-[\]()]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
      let mdTerms = ["文档手稿", "资料整理"];

      try {
        const bookHints = await loadSmartBookHints("md");
        const customTagHints = customTagLibraryEnabled ? flattenEnabledCustomTagGroups(customTagGroups) : [];
        const response = await authFetch("/api/summarize-md", {
          method: "POST",
          headers,
          body: JSON.stringify({ markdown: text, bookHints, customTagHints }),
        });
        if (response.ok) {
          const data = await response.json();
          if (typeof data.summary === "string" && data.summary.trim()) {
            mdSummary = data.summary.trim();
          }
          if (Array.isArray(data.terms)) {
            const terms = data.terms
              .filter((term: unknown): term is string => typeof term === "string" && term.trim().length > 0)
              .map((term: string) => term.trim())
              .slice(0, 5);
            if (terms.length > 0) {
              mdTerms = terms;
            }
          }
        } else {
          console.warn("Markdown summary skipped:", await response.text());
        }
      } catch (err) {
        console.warn("Markdown summary skipped:", err);
      }

      const cardId = createNewCardId();
      const newCard: ImageCard = {
        id: cardId,
        weekId: targetWeekId,
        dayIndex,
        imageUrl: "",
        terms: mdTerms,
        decoType: "washi",
        angle: parseFloat((Math.random() * 6 - 3).toFixed(1)),
        createdAt: Date.now(),
        type: "md",
        mdContent: text,
        mdSummary: mdSummary || "点击查看完整手稿。",
        mdName: filename,
      };

      await saveCard(newCard);
      if (targetBookId) {
        await setCardBookMembership(cardId, targetBookId, true);
        handleBookMembershipChanged();
      } else {
        await maybeSuggestBookMembership(newCard);
      }
    } catch (error: any) {
      console.error("Markdown upload error:", error);
      throw new Error(error.message || "Failed to save Markdown document.");
    }
  };

  const handleUploadImageToBook = async (bookId: string, originalFile: File, analysisBlob: Blob = originalFile) => {
    const today = new Date();
    await handleUploadImage(getDayIndexForDate(today), originalFile, analysisBlob, {
      targetWeekId: getWeekIdentifier(today),
      targetBookId: bookId,
    });
  };

  const handleUploadMdToBook = async (bookId: string, text: string, filename: string) => {
    const today = new Date();
    await handleUploadMd(getDayIndexForDate(today), text, filename, {
      targetWeekId: getWeekIdentifier(today),
      targetBookId: bookId,
    });
  };

  const handleUploadVideo = async (dayIndex: number, file: File, options: UploadTargetOptions = {}) => {
    if (!weekId && !options.targetWeekId) {
      throw new Error("当前周信息还在加载，请稍后再上传视频。");
    }
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      throw new Error("视频不能超过 100MB。");
    }

    const targetWeekId = options.targetWeekId || weekId;
    const result = await uploadVideoAsset({
      file,
      weekId: targetWeekId,
      dayIndex,
      bookId: options.targetBookId,
    });

    if (result.card.weekId === weekId) {
      setCards((current) => {
        const next = [result.card, ...current.filter((card) => card.id !== result.card.id)];
        return next.sort((a, b) => {
          if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
          return b.createdAt - a.createdAt;
        });
      });
    }
    if (options.targetBookId) {
      handleBookMembershipChanged();
    }
  };

  const handleUploadVideoToBook = async (bookId: string, file: File) => {
    const today = new Date();
    await handleUploadVideo(getDayIndexForDate(today), file, {
      targetWeekId: getWeekIdentifier(today),
      targetBookId: bookId,
    });
  };

  const handleCreateComboCard = useCallback(async (dayIndex: number) => {
    if (!weekId) return;
    try {
      const result = await createComboCard({
        weekId,
        dayIndex,
        title: "组合灵感",
      });
      const comboCard = result.card as ImageCard;
      setCards((current) => {
        const next = [comboCard, ...current.filter((card) => card.id !== comboCard.id)];
        return next.sort((a, b) => {
          if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
          return b.createdAt - a.createdAt;
        });
      });
      setAllCardsPageCards((current) => [comboCard, ...current.filter((card) => card.id !== comboCard.id)]);
      setZoomedCard(comboCard);
    } catch (err) {
      alert(err instanceof Error ? err.message : "组合卡片创建失败");
    }
  }, [weekId]);

  const handleBindVideoToCard = async (cardId: string, file: File) => {
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      throw new Error("视频不能超过 100MB。");
    }
    const result = await uploadVideoAsset({ file, cardId });
    syncCardVideoAssets(result.card);
  };

  // Trigger deletion prompt before absolute card removal.
  const handleDeleteCard = (cardId: string) => {
    const card = cards.find((c) => c.id === cardId)
      || allCardsPageCards.find((c) => c.id === cardId)
      || (zoomedCard?.id === cardId ? zoomedCard : null);
    if (card) {
      setCardToDelete(card);
      setDeletePhase("prompt");
    }
  };

  const confirmDeleteCard = async () => {
    if (!cardToDelete) return;
    setDeletePhase("animating");

    await new Promise((resolve) => setTimeout(resolve, 1200));

    try {
      await deleteCard(cardToDelete.id, cardToDelete.weekId);
      if (searchScope === "all") {
        await loadHistoricalCardsPage(allCardsPage);
      }
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
      const targetCard = cards.find((c) => c.id === cardId)
        || allCardsPageCards.find((c) => c.id === cardId)
        || (zoomedCard?.id === cardId ? zoomedCard : null);
      if (targetCard) {
        const updatedTerms = [...targetCard.terms];
        updatedTerms.splice(termIndex, 1);
        await updateCardTerms(cardId, targetCard.weekId, updatedTerms);
      }
    } catch (err) {
      console.error("Tag deletion error:", err);
    }
  };

  // Custom addition or absolute text keyword modifications
  const handleUpdateCardTerms = async (cardId: string, terms: string[]) => {
    try {
      const targetCard = cards.find((c) => c.id === cardId)
        || allCardsPageCards.find((c) => c.id === cardId)
        || (zoomedCard?.id === cardId ? zoomedCard : null);
      await updateCardTerms(cardId, targetCard?.weekId || weekId, terms);
    } catch (err) {
      console.error("Failed to update custom terms list:", err);
    }
  };

  const syncCardInsightNote = useCallback((cardId: string, insightNote: string) => {
    setCards((current) => current.map((card) => card.id === cardId ? { ...card, insightNote } : card));
    setAllCardsPageCards((current) => current.map((card) => card.id === cardId ? { ...card, insightNote } : card));
    setZoomedCard((current) => current?.id === cardId ? { ...current, insightNote } : current);
  }, []);

  const syncCardVideoAssets = useCallback((card: ImageCard) => {
    setCards((current) => current.map((item) => item.id === card.id ? card : item));
    setAllCardsPageCards((current) => current.map((item) => item.id === card.id ? card : item));
    setZoomedCard((current) => current?.id === card.id ? card : current);
  }, []);

  const syncCardImageAssets = useCallback((card: ImageCard) => {
    setCards((current) => current.map((item) => item.id === card.id ? card : item));
    setAllCardsPageCards((current) => current.map((item) => item.id === card.id ? card : item));
    setZoomedCard((current) => current?.id === card.id ? card : current);
  }, []);

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
    if (card.terms.some((term) => term.toLowerCase().includes(q))) return true;
    if (card.type === "md") {
      if (card.mdName?.toLowerCase().includes(q)) return true;
      if (card.mdSummary?.toLowerCase().includes(q)) return true;
      if (card.mdContent?.toLowerCase().includes(q)) return true;
    }
    return false;
  });
  const visibleCards = mainView === "books" ? [] : searchScope === "all" ? allCardsPageCards : filteredCards;
  const zoomedCardType = zoomedCard?.type as ImageCard["type"] | "combo" | undefined;
  const zoomedCardIsCombo = zoomedCardType === "combo";

  const handlePrevZoomedCard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (visibleCards.length <= 1 || !zoomedCard) return;
    const currentIdx = visibleCards.findIndex((c) => c.id === zoomedCard.id);
    if (currentIdx === -1) return;
    const prevIdx = (currentIdx - 1 + visibleCards.length) % visibleCards.length;
    setZoomedCard(visibleCards[prevIdx]);
  };

  const handleNextZoomedCard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (visibleCards.length <= 1 || !zoomedCard) return;
    const currentIdx = visibleCards.findIndex((c) => c.id === zoomedCard.id);
    if (currentIdx === -1) return;
    const nextIdx = (currentIdx + 1) % visibleCards.length;
    setZoomedCard(visibleCards[nextIdx]);
  };

  const resetImageInspector = useCallback(() => {
    setImageZoomScale(1);
    setImagePan({ x: 0, y: 0 });
    setImageNaturalSize(null);
    setImageViewMode("fit");
    imagePanStartRef.current = null;
  }, []);

  const updateImageZoom = (nextScale: number) => {
    const clampedScale = Math.min(6, Math.max(0.25, nextScale));
    setImageZoomScale(clampedScale);
    if (clampedScale <= 1 && imageViewMode === "fit") {
      setImagePan({ x: 0, y: 0 });
    }
  };

  const handleImageWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const direction = e.deltaY > 0 ? -0.15 : 0.15;
    updateImageZoom(imageZoomScale + direction);
  };

  const handleImagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (imageZoomScale <= 1 && imageViewMode !== "actual") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    imagePanStartRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      panX: imagePan.x,
      panY: imagePan.y,
    };
  };

  const handleImagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const panStart = imagePanStartRef.current;
    if (!panStart || panStart.pointerId !== e.pointerId) return;
    setImagePan({
      x: panStart.panX + e.clientX - panStart.startX,
      y: panStart.panY + e.clientY - panStart.startY,
    });
  };

  const handleImagePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (imagePanStartRef.current?.pointerId === e.pointerId) {
      imagePanStartRef.current = null;
    }
  };

  const toggleActualSize = () => {
    setImageViewMode((current) => current === "actual" ? "fit" : "actual");
    setImageZoomScale(1);
    setImagePan({ x: 0, y: 0 });
  };

  useEffect(() => {
    resetImageInspector();
  }, [zoomedCard?.id, resetImageInspector]);

  useEffect(() => {
    setIsDetailBookPopoverOpen(false);
    setDetailInsightNote(zoomedCard?.insightNote || "");
    setDetailInsightSaveStatus("clean");
    setVideoBindError("");
    setImageBindError("");
  }, [zoomedCard?.id]);

  useEffect(() => {
    const currentType = zoomedCard?.type as ImageCard["type"] | "combo" | undefined;
    if (!zoomedCard || currentType === "video" || currentType === "combo") return;
    let alive = true;
    loadCardVideos(zoomedCard.id)
      .then((videoAssets) => {
        if (!alive) return;
        const nextCard = { ...zoomedCard, videoAssets };
        syncCardVideoAssets(nextCard);
      })
      .catch((err) => {
        console.warn("Failed to refresh card videos:", err);
      });
    return () => {
      alive = false;
    };
  }, [syncCardVideoAssets, zoomedCard?.id, zoomedCard?.type]);

  useEffect(() => {
    const currentType = zoomedCard?.type as ImageCard["type"] | "combo" | undefined;
    if (!zoomedCard || currentType !== "video") return;
    let alive = true;
    loadCardImages(zoomedCard.id)
      .then((imageAssets) => {
        if (!alive) return;
        const nextCard = { ...zoomedCard, imageAssets };
        syncCardImageAssets(nextCard);
      })
      .catch((err) => {
        console.warn("Failed to refresh card images:", err);
      });
    return () => {
      alive = false;
    };
  }, [syncCardImageAssets, zoomedCard?.id, zoomedCard?.type]);

  const sanitizeDownloadName = (name: string) => {
    return name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 120) || "inspiration";
  };

  const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
    const mb = bytes / 1024 / 1024;
    if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCard = async (card: ImageCard) => {
    if (card.type === "md") {
      const filename = sanitizeDownloadName(card.mdName || `${card.weekId}-${getDayLabelForDayIndex(card.dayIndex)}.md`);
      const safeFilename = filename.toLowerCase().endsWith(".md") ? filename : `${filename}.md`;
      downloadBlob(new Blob([card.mdContent || ""], { type: "text/markdown;charset=utf-8" }), safeFilename);
      return;
    }

    if (card.type === "video") {
      const primaryVideo = card.videoAssets?.[0];
      if (!primaryVideo) {
        throw new Error("当前视频卡没有可下载的视频文件。");
      }
      const response = await authFetch(primaryVideo.videoUrl);
      if (!response.ok) {
        throw new Error("视频下载失败，请稍后重试。");
      }
      const blob = await response.blob();
      downloadBlob(blob, sanitizeDownloadName(primaryVideo.originalName || `${card.id}.mp4`));
      return;
    }

    const response = card.imageUrl.startsWith("data:")
      ? await fetch(card.imageUrl)
      : await authFetch(card.imageUrl);
    if (!response.ok) {
      throw new Error("图片下载失败，请稍后重试。");
    }
    const blob = await response.blob();
    const contentType = blob.type || response.headers.get("content-type") || "";
    const extension = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : contentType.includes("gif")
          ? "gif"
          : "jpg";
    const filename = sanitizeDownloadName(`${card.weekId}-${getDayLabelForDayIndex(card.dayIndex)}-${card.id}.${extension}`);
    downloadBlob(blob, filename);
  };

  const handleDetailVideoInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (detailVideoInputRef.current) {
      detailVideoInputRef.current.value = "";
    }
    if (!file || !zoomedCard) return;

    setIsBindingVideo(true);
    setVideoBindError("");
    try {
      await handleBindVideoToCard(zoomedCard.id, file);
    } catch (err: any) {
      setVideoBindError(err?.message || "视频绑定失败");
    } finally {
      setIsBindingVideo(false);
    }
  };

  const handleDeleteBoundVideo = async (videoId: string) => {
    if (!zoomedCard) return;
    const confirmed = window.confirm("删除这个绑定视频？");
    if (!confirmed) return;
    try {
      await deleteVideoAsset(videoId);
      const videoAssets = await loadCardVideos(zoomedCard.id);
      syncCardVideoAssets({ ...zoomedCard, videoAssets });
    } catch (err: any) {
      setVideoBindError(err?.message || "视频删除失败");
    }
  };

  const handleSaveDetailInsightNote = async () => {
    if (!zoomedCard || detailInsightSaveStatus === "saving") return;
    const targetCard = zoomedCard;
    setDetailInsightSaveStatus("saving");
    try {
      await updateCardInsightNote(targetCard.id, targetCard.weekId, detailInsightNote);
      syncCardInsightNote(targetCard.id, detailInsightNote);
      setDetailInsightSaveStatus("clean");
    } catch (err) {
      console.error("Failed to update insight note:", err);
      setDetailInsightSaveStatus("error");
    }
  };

  const handleDetailImageInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (detailImageInputRef.current) {
      detailImageInputRef.current.value = "";
    }
    if (files.length === 0 || !zoomedCard) return;
    if (zoomedCard.type !== "video") {
      setImageBindError("只有视频卡片可以绑定图片。");
      return;
    }

    const unsupportedFile = files.find((file) => !isSupportedImageAssetFile(file));
    if (unsupportedFile) {
      setImageBindError(`${unsupportedFile.name} 不是支持的图片格式。`);
      return;
    }
    const oversizedFile = files.find((file) => file.size > MAX_IMAGE_ASSET_UPLOAD_BYTES);
    if (oversizedFile) {
      setImageBindError(`${oversizedFile.name} 超过 25MB。`);
      return;
    }

    setIsBindingImage(true);
    setImageBindError("");
    try {
      for (const file of files) {
        await uploadImageAsset({ file, cardId: zoomedCard.id });
      }
      const imageAssets = await loadCardImages(zoomedCard.id);
      syncCardImageAssets({ ...zoomedCard, imageAssets });
    } catch (err: any) {
      setImageBindError(err?.message || "图片绑定失败");
    } finally {
      setIsBindingImage(false);
    }
  };

  const handleDeleteBoundImage = async (imageId: string) => {
    if (!zoomedCard) return;
    const confirmed = window.confirm("删除这个绑定图片？");
    if (!confirmed) return;
    try {
      await deleteImageAsset(imageId);
      const imageAssets = await loadCardImages(zoomedCard.id);
      syncCardImageAssets({ ...zoomedCard, imageAssets });
    } catch (err: any) {
      setImageBindError(err?.message || "图片删除失败");
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!zoomedCard || visibleCards.length <= 1) {
        if (zoomedCard && e.key === "Escape") {
          setZoomedCard(null);
        }
        return;
      }

      const currentIdx = visibleCards.findIndex((c) => c.id === zoomedCard.id);
      if (currentIdx === -1) return;

      if (e.key === "ArrowLeft") {
        const prevIdx = (currentIdx - 1 + visibleCards.length) % visibleCards.length;
        setZoomedCard(visibleCards[prevIdx]);
      } else if (e.key === "ArrowRight") {
        const nextIdx = (currentIdx + 1) % visibleCards.length;
        setZoomedCard(visibleCards[nextIdx]);
      } else if (e.key === "Escape") {
        setZoomedCard(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [zoomedCard, visibleCards]);

  const renderSmartBookSwitch = (
    label: string,
    icon: React.ReactNode,
    enabled: boolean,
    onChange: (enabled: boolean) => void,
  ) => (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`relative grid h-9 w-9 shrink-0 place-items-center rounded-xl border shadow-sm transition-all hover:-translate-y-0.5 active:translate-y-0 active:scale-95 ${
        enabled
          ? "border-amber-500/45 bg-amber-100 text-amber-900 dark:border-amber-200/40 dark:bg-amber-300/18 dark:text-amber-100"
          : "border-stone-900/10 bg-white/45 text-stone-500 hover:border-stone-900/20 hover:bg-white/70 hover:text-stone-800 dark:border-white/10 dark:bg-white/[0.05] dark:text-stone-500 dark:hover:text-stone-200"
      }`}
      title={`${label}${enabled ? "已开启" : "已关闭"}`}
      aria-label={`${label}${enabled ? "已开启" : "已关闭"}`}
      aria-pressed={enabled}
    >
      {icon}
      <span
        className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full transition-colors ${
          enabled ? "bg-amber-600 dark:bg-amber-200" : "bg-stone-300 dark:bg-stone-700"
        }`}
      />
    </button>
  );

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-stone-950 flex items-center justify-center gap-2 text-stone-600 dark:text-stone-300">
        <Loader2 className="animate-spin text-stone-400" size={18} />
        <span className="text-sm font-serif">正在确认登录状态...</span>
      </div>
    );
  }

  if (!authUser) {
    return (
      <LoginScreen
        onLogin={async (email, password) => {
          const user = await login(email, password);
          setAuthUser(user);
        }}
        onRegister={async (email, password) => {
          const user = await register(email, password);
          setAuthUser(user);
        }}
      />
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col transition-colors duration-300"
      data-weekly-preview-open={showWeeklyPreview}
    >
      {/* Visual background lines representing analog journal grid */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] dark:opacity-[0.02] bg-[linear-gradient(rgba(0,0,0,1)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,1)_1px,transparent_1px)] bg-[size:24px_24px]" />

      {/* Primary Container */}
      <div className="max-w-7xl mx-auto w-full px-4 py-6 md:py-8 flex flex-col flex-grow relative z-10">
        
        {/* Secondary Navigation row with Theme control */}
        <div className="mb-4 flex flex-col gap-3 px-2 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-stone-500 text-xs font-serif italic select-none">
            <BookOpen size={14} className="text-amber-800" />
            <span>AI Design Notebook</span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex h-10 items-center gap-1.5 rounded-xl border border-stone-900/10 bg-white/50 px-1.5 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-stone-950/35">
              <span className="px-1.5 text-[11px] font-semibold text-stone-600 dark:text-stone-300">智能入册</span>
              {renderSmartBookSwitch("图片智能入册", <ImageIcon size={14} />, smartSuggestImages, handleSmartSuggestImagesChange)}
              {renderSmartBookSwitch("MD 智能入册", <FileText size={14} />, smartSuggestMarkdown, handleSmartSuggestMarkdownChange)}
              {smartSuggestSyncStatus === "saving" ? (
                <Loader2 size={12} className="mr-1 animate-spin text-stone-500 dark:text-stone-400" />
              ) : smartSuggestSyncStatus === "error" ? (
                <span className="mr-1 h-1.5 w-1.5 rounded-full bg-red-500" title="设置同步失败" />
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setMainView((current) => current === "books" ? "board" : "books")}
              className={`group relative inline-flex h-10 items-center justify-center overflow-hidden rounded-full p-[1px] text-xs font-bold transition-transform hover:scale-105 active:scale-95 ${
                mainView === "books"
                  ? "bg-gradient-to-r from-stone-950 via-slate-800 to-amber-700 text-white shadow-[0_12px_26px_rgba(28,25,23,0.30)] dark:from-amber-300 dark:via-sky-300 dark:to-violet-400 dark:text-stone-950 dark:shadow-[0_0_26px_rgba(251,191,36,0.26)]"
                  : "bg-gradient-to-r from-slate-900 via-blue-700 to-violet-700 text-white shadow-[0_12px_26px_rgba(30,64,175,0.28)] dark:from-sky-400 dark:via-blue-500 dark:to-violet-500 dark:text-white dark:shadow-[0_0_22px_rgba(59,130,246,0.22)]"
              }`}
              title={mainView === "books" ? "返回灵感画板" : "打开灵感册"}
              aria-pressed={mainView === "books"}
            >
              <span className="absolute inset-0 opacity-40 blur-md transition-opacity group-hover:opacity-90 bg-[radial-gradient(circle_at_20%_30%,rgba(255,255,255,0.9),transparent_18%),radial-gradient(circle_at_82%_60%,rgba(251,191,36,0.55),transparent_24%)]" />
              <span className="relative inline-flex h-full items-center justify-center gap-2 rounded-full bg-black/18 px-4 py-2 text-inherit backdrop-blur-sm ring-1 ring-white/25 dark:bg-black/20">
                <Sparkles size={15} className="fill-current opacity-90 transition-transform group-hover:rotate-12 group-hover:scale-110" />
                <Sparkles size={7} className="absolute left-3 top-2 fill-current opacity-60 transition-opacity group-hover:opacity-100" />
                <Sparkles size={6} className="absolute bottom-2 right-4 fill-current opacity-50 transition-opacity group-hover:opacity-100" />
                <span>{mainView === "books" ? "返回画板" : "打开灵感册"}</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setMainView((current) => current === "tags" ? "board" : "tags")}
              className={`inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-xs font-bold shadow-sm transition-all hover:-translate-y-0.5 active:scale-95 ${
                mainView === "tags"
                  ? "bg-stone-900 text-[#fbf7ed] dark:bg-amber-200 dark:text-stone-950"
                  : "border border-stone-900/10 bg-white/55 text-stone-700 hover:bg-white/80 dark:border-white/10 dark:bg-stone-950/35 dark:text-stone-200 dark:hover:bg-white/[0.08]"
              }`}
              title={mainView === "tags" ? "返回灵感画板" : "打开自定义标签库"}
              aria-pressed={mainView === "tags"}
            >
              <Tags size={14} />
              <span>{mainView === "tags" ? "返回画板" : "标签库"}</span>
            </button>

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

            <button
              onClick={async () => {
                await logout();
                clearAuthenticatedState();
              }}
              className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-900 dark:text-red-300 transition-colors shadow-sm cursor-pointer border border-red-500/20 flex items-center justify-center"
              title="Logout"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>

        {mainView === "board" ? (
          <>
        {/* Calendar Nav Header */}
        <TimelineHeader
          currentDate={currentDate}
          onPrevWeek={handlePrevWeek}
          onNextWeek={handleNextWeek}
          onGoToday={handleGoToday}
          onPreviewWeek={() => setShowWeeklyPreview(true)}
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
            <button
              onClick={handleRefreshCards}
              disabled={isRefreshingCards || !weekId}
              className="p-2 rounded-xl bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100 transition-all active:scale-95 border border-stone-200/50 dark:border-stone-700 cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
              title="手动刷新图片列表"
              aria-label="手动刷新图片列表"
            >
              <RefreshCw size={14} className={isRefreshingCards ? "animate-spin" : ""} />
            </button>

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
                <span>所有历史周 ({searchScope === "all" ? allCardsTotal : "检索"})</span>
              </button>
            </div>

            {searchQuery && (
              <div className="text-xs text-stone-500 dark:text-stone-400 font-serif italic flex items-center gap-1 bg-amber-500/5 px-2.5 py-1.5 border border-amber-500/10 rounded-xl select-none">
                <span>匹配：</span>
                <strong className="text-amber-800 dark:text-amber-300 font-sans not-italic font-semibold bg-amber-500/10 px-1.5 py-0.5 rounded">
                  {searchScope === "all" ? allCardsTotal : filteredCards.length}
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
                        共 {allCardsTotal} 张 · 第 {allCardsPage} / {allCardsTotalPages} 页
                      </span>
                    </h3>
                    <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 font-serif">
                      此处已为您安全同步并展现<strong>所有历史周</strong>上传过的照片。支持点击原图放大，自定义编辑以及一键复制灵感词。
                    </p>
                  </div>
                </div>

                {isLoadingAllCards ? (
                  <div className="flex-grow flex flex-col items-center justify-center py-16 text-center">
                    <Loader2 size={28} className="animate-spin text-amber-500/70 mb-3" />
                    <p className="text-sm font-handwritten text-stone-400 dark:text-stone-500 italic">
                      正在分页加载历史灵感...
                    </p>
                  </div>
                ) : allCardsPageCards.length > 0 ? (
                  <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 py-2">
                    {allCardsPageCards.map((card) => (
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
                          onBookMembershipChanged={handleBookMembershipChanged}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-stone-200/50 dark:border-stone-800/60 pt-4">
                    <div className="text-xs text-stone-500 dark:text-stone-400 font-mono">
                      每页 {ALL_CARDS_PAGE_SIZE} 张 · 共 {allCardsTotal} 张
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setAllCardsPage((page) => Math.max(1, page - 1))}
                        disabled={allCardsPage <= 1 || isLoadingAllCards}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-300 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                      >
                        上一页
                      </button>
                      <span className="text-xs font-mono text-stone-500 dark:text-stone-400 min-w-[72px] text-center">
                        {allCardsPage} / {allCardsTotalPages}
                      </span>
                      <button
                        onClick={() => setAllCardsPage((page) => Math.min(allCardsTotalPages, page + 1))}
                        disabled={allCardsPage >= allCardsTotalPages || isLoadingAllCards}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-300 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                  </>
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
                    onUploadMd={handleUploadMd}
                    onUploadVideo={handleUploadVideo}
                    onCreateComboCard={handleCreateComboCard}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                    onBookMembershipChanged={handleBookMembershipChanged}
                    onBatchUploadStart={handleBatchUploadStart}
                    onBatchUploadEnd={handleBatchUploadEnd}
                  />
                  <DaySlot
                    dayIndex={1}
                    label="Tuesday"
                    subLabel={getDayLabelForOffset(currentDate, 1)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 1)}
                    onUploadImage={handleUploadImage}
                    onUploadMd={handleUploadMd}
                    onUploadVideo={handleUploadVideo}
                    onCreateComboCard={handleCreateComboCard}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                    onBookMembershipChanged={handleBookMembershipChanged}
                    onBatchUploadStart={handleBatchUploadStart}
                    onBatchUploadEnd={handleBatchUploadEnd}
                  />
                  <DaySlot
                    dayIndex={2}
                    label="Wednesday"
                    subLabel={getDayLabelForOffset(currentDate, 2)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 2)}
                    onUploadImage={handleUploadImage}
                    onUploadMd={handleUploadMd}
                    onUploadVideo={handleUploadVideo}
                    onCreateComboCard={handleCreateComboCard}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                    onBookMembershipChanged={handleBookMembershipChanged}
                    onBatchUploadStart={handleBatchUploadStart}
                    onBatchUploadEnd={handleBatchUploadEnd}
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
                    onUploadMd={handleUploadMd}
                    onUploadVideo={handleUploadVideo}
                    onCreateComboCard={handleCreateComboCard}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                    onBookMembershipChanged={handleBookMembershipChanged}
                    onBatchUploadStart={handleBatchUploadStart}
                    onBatchUploadEnd={handleBatchUploadEnd}
                  />
                  <DaySlot
                    dayIndex={4}
                    label="Friday"
                    subLabel={getDayLabelForOffset(currentDate, 4)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 4)}
                    onUploadImage={handleUploadImage}
                    onUploadMd={handleUploadMd}
                    onUploadVideo={handleUploadVideo}
                    onCreateComboCard={handleCreateComboCard}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                    onBookMembershipChanged={handleBookMembershipChanged}
                    onBatchUploadStart={handleBatchUploadStart}
                    onBatchUploadEnd={handleBatchUploadEnd}
                  />
                  {/* Weekend combined cell */}
                  <DaySlot
                    dayIndex={5}
                    label="Weekend"
                    subLabel={getDayLabelForOffset(currentDate, 5)}
                    cards={filteredCards.filter((c) => c.weekId === weekId && c.dayIndex === 5)}
                    onUploadImage={handleUploadImage}
                    onUploadMd={handleUploadMd}
                    onUploadVideo={handleUploadVideo}
                    onCreateComboCard={handleCreateComboCard}
                    onDeleteCard={handleDeleteCard}
                    onDeleteTerm={handleDeleteTerm}
                    onZoom={setZoomedCard}
                    onUpdateTerms={handleUpdateCardTerms}
                    onBookMembershipChanged={handleBookMembershipChanged}
                    onBatchUploadStart={handleBatchUploadStart}
                    onBatchUploadEnd={handleBatchUploadEnd}
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
          </>
        ) : mainView === "books" ? (
          <InspirationBooksView
            refreshToken={bookRefreshToken}
            onZoom={setZoomedCard}
            onDeleteTerm={handleDeleteTerm}
            onUpdateTerms={handleUpdateCardTerms}
            onBookMembershipChanged={handleBookMembershipChanged}
            onUploadImageToBook={handleUploadImageToBook}
            onUploadMdToBook={handleUploadMdToBook}
            onUploadVideoToBook={handleUploadVideoToBook}
          />
        ) : (
          <CustomTagLibraryView
            groups={customTagGroups}
            libraryEnabled={customTagLibraryEnabled}
            syncStatus={customTagSyncStatus}
            onSave={handleSaveCustomTagGroups}
            onLibraryEnabledChange={handleCustomTagLibraryEnabledChange}
          />
        )}
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

      {showWeeklyPreview && (
        <WeeklyPreviewModal
          cards={cards.filter((c) => c.weekId === weekId)}
          weekRangeStr={weekId || "Current Week"}
          onClose={() => setShowWeeklyPreview(false)}
        />
      )}

      <AnimatePresence>
        {smartSuggestion && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-stone-950/45 backdrop-blur-sm"
              onClick={() => dismissSmartSuggestion()}
            />
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="relative w-full max-w-md rounded-[8px] border border-stone-900/10 bg-[#fbf7ed] p-5 text-stone-900 shadow-[0_24px_70px_rgba(28,25,23,0.25)] dark:border-white/10 dark:bg-stone-950 dark:text-stone-100"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-stone-900 text-[#fbf7ed] dark:bg-amber-200 dark:text-stone-950">
                  <BookOpen size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-serif text-lg font-bold italic leading-snug">
                    {smartSuggestion.cards.length > 1
                      ? `发现 ${smartSuggestion.cards.length} 条灵感可能适合入册`
                      : "这条灵感可能适合入册"}
                  </h3>
                  {smartSuggestion.book.description ? (
                    <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
                      默认推荐《{smartSuggestion.book.title}》：{smartSuggestion.book.description}
                    </p>
                  ) : null}
                </div>
              </div>

              {smartSuggestion.candidates.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {smartSuggestion.candidates.map((candidate) => {
                    const selected = selectedSmartBookId === candidate.book.id;
                    return (
                      <button
                        key={candidate.book.id}
                        type="button"
                        onClick={() => setSelectedSmartBookId(candidate.book.id)}
                        className={`flex w-full items-start gap-3 rounded-[8px] border px-3 py-2 text-left transition-colors ${
                          selected
                            ? "border-amber-500/70 bg-amber-100/70 text-stone-950 dark:border-amber-300/70 dark:bg-amber-300/15 dark:text-amber-50"
                            : "border-stone-900/10 bg-white/55 text-stone-700 hover:bg-white/80 dark:border-white/10 dark:bg-white/[0.04] dark:text-stone-300 dark:hover:bg-white/[0.08]"
                        }`}
                      >
                        <span className={`mt-1 h-3 w-3 rounded-full border ${selected ? "border-amber-600 bg-amber-500 dark:border-amber-200 dark:bg-amber-200" : "border-stone-400 dark:border-stone-500"}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">《{candidate.book.title}》</span>
                          <span className="mt-0.5 block text-xs text-stone-500 dark:text-stone-400">
                            匹配 {Math.round(candidate.score)} 分
                            {candidate.feedbackAdjustment !== 0 ? `，学习修正 ${candidate.feedbackAdjustment > 0 ? "+" : ""}${Math.round(candidate.feedbackAdjustment)}` : ""}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {smartSuggestion.matchedTerms.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {smartSuggestion.matchedTerms.map((term) => (
                    <span key={term} className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-900 dark:bg-amber-300/15 dark:text-amber-100">
                      {term}
                    </span>
                  ))}
                </div>
              ) : null}

              {smartSuggestionError ? (
                <div className="mt-4 rounded-[6px] bg-red-100 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200">
                  {smartSuggestionError}
                </div>
              ) : null}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => dismissSmartSuggestion()}
                  className="h-9 rounded-[6px] border border-stone-900/10 px-3 text-sm font-semibold text-stone-600 transition-colors hover:bg-stone-900/[0.04] dark:border-white/10 dark:text-stone-300 dark:hover:bg-white/[0.07]"
                >
                  暂不加入
                </button>
                <button
                  type="button"
                  onClick={confirmSmartSuggestion}
                  disabled={isApplyingSmartSuggestion}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-[6px] bg-stone-900 px-3 text-sm font-semibold text-[#fbf7ed] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-wait disabled:opacity-70 dark:bg-amber-200 dark:text-stone-950"
                >
                  {isApplyingSmartSuggestion ? <Loader2 size={14} className="animate-spin" /> : <BookOpen size={14} />}
                  {smartSuggestion.cards.length > 1 ? "全部加入所选册" : "加入所选册"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
              <div className="relative mx-auto w-32 h-40 flex flex-col items-center justify-start overflow-hidden mb-2 pt-2">
                <motion.div
                  animate={
                    deletePhase === "animating"
                      ? { y: 120 }
                      : { y: 0, rotate: [-1, 1, -1], transition: { repeat: Infinity, duration: 4, ease: "easeInOut" } }
                  }
                  transition={deletePhase === "animating" ? { duration: 0.7, ease: "anticipate" } : {}}
                  className="z-10 w-24 h-28 bg-white p-1.5 shadow-sm flex flex-col border border-stone-200 dark:border-stone-700"
                >
                  <img
                    src={cardToDelete.thumbnailUrl || cardToDelete.imageUrl}
                    className="w-full h-16 object-cover bg-stone-200 dark:bg-stone-800"
                    alt=""
                  />
                  <div className="flex-1 mt-1 bg-stone-50 dark:bg-stone-800 flex items-end p-1">
                    <div className="h-1 flex-1 bg-stone-200 dark:bg-stone-700 rounded-full w-1/2 opacity-50" />
                  </div>
                </motion.div>

                <div className="absolute bottom-6 w-full flex justify-center z-20">
                  <div className="w-28 h-3 bg-stone-300 dark:bg-stone-800 rounded-sm border border-stone-400 dark:border-stone-700 shadow-inner flex items-center justify-center">
                    <div className="w-[100px] h-1.5 bg-stone-800 dark:bg-black rounded-full" />
                  </div>
                </div>

                <div className="absolute bottom-0 w-24 h-6 flex justify-between gap-[1px] z-0 px-0.5">
                  {[...Array(6)].map((_, i) => (
                    <motion.div
                      key={i}
                      initial={{ y: -24, opacity: 0 }}
                      animate={deletePhase === "animating" ? { y: 24, opacity: [0, 1, 0] } : {}}
                      transition={deletePhase === "animating" ? { duration: 0.6, delay: 0.4 + i * 0.05 } : {}}
                      className="flex-1 bg-white border-x border-b border-stone-200 dark:border-stone-700 h-10 shadow-sm rounded-b-sm"
                    />
                  ))}
                </div>
              </div>

              <h3 className="text-xl font-bold font-sans text-stone-800 dark:text-stone-100">Delete Photo?</h3>
              <p className="text-sm text-stone-500 dark:text-stone-400 font-sans">
                This photo will be permanently removed.<br />Are you sure you want to proceed?
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
              className={`relative flex max-h-[calc(100vh-1.5rem)] w-full flex-col items-stretch gap-4 overflow-y-auto rounded-2xl border border-amber-900/10 bg-white p-4 pb-5 shadow-[0_24px_50px_rgba(0,0,0,0.6)] select-text dark:border-white/10 dark:bg-stone-850 md:h-[calc(100vh-2rem)] md:flex-row md:gap-5 md:overflow-hidden md:p-5 ${zoomedCard.type === "md" || zoomedCardIsCombo ? "max-w-5xl" : "max-w-7xl"}`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button on top corner */}
              <button
                onClick={() => setZoomedCard(null)}
                className="absolute right-3 top-3 z-40 rounded-full bg-stone-100 p-1.5 text-stone-500 shadow-sm transition-transform hover:scale-105 hover:text-stone-800 dark:bg-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
                title="关闭视图"
                id="close-zoom-modal-btn"
              >
                <X size={18} />
              </button>

              {/* Left Column: Picture or Markdown document */}
              <div className={`relative w-full shrink-0 overflow-hidden rounded-xl border border-stone-200 bg-stone-100 shadow-inner group/zoomimage dark:border-stone-800 dark:bg-stone-900 md:h-full md:min-h-0 ${zoomedCard.type === "md" || zoomedCardIsCombo ? "h-[58vh] md:w-[68%]" : "h-[56vh] min-h-[300px] md:w-[66%]"}`}>
                {zoomedCardIsCombo ? (
                  <ComboCardDetailView
                    card={zoomedCard}
                    onCardChanged={(card) => {
                      setZoomedCard(card);
                      setCards((current) => current.map((item) => item.id === card.id ? card : item));
                      setAllCardsPageCards((current) => current.map((item) => item.id === card.id ? card : item));
                    }}
                  />
                ) : zoomedCard.type === "md" ? (
                  <div className="w-full h-full overflow-y-auto p-6 md:p-10 bg-white dark:bg-stone-900 custom-scrollbar text-left text-sm md:text-base text-stone-800 dark:text-stone-100 shadow-inner break-words leading-relaxed [&_h1]:font-serif [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mb-4 [&_h2]:font-serif [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-3 [&_h3]:font-serif [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:mt-5 [&_h3]:mb-2 [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_blockquote]:border-l-4 [&_blockquote]:border-amber-400 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-stone-600 [&_a]:text-amber-600 [&_a]:underline [&_code]:rounded [&_code]:bg-stone-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-amber-700 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-stone-950 [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:text-stone-100 [&_img]:rounded-xl">
                    <Markdown>{zoomedCard.mdContent || ""}</Markdown>
                  </div>
                ) : zoomedCard.type === "video" ? (
                  <div className="flex h-full w-full items-center justify-center bg-stone-950">
                    {zoomedCard.videoAssets?.[0] ? (
                      <video
                        src={zoomedCard.videoAssets[0].videoUrl}
                        poster={zoomedCard.videoAssets[0].posterUrl || undefined}
                        className="h-full w-full object-contain"
                        controls
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-3 text-stone-400">
                        <FileVideo size={42} />
                        <span className="text-sm">视频文件不存在或仍在加载。</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div
                      className={`relative z-10 flex h-full w-full items-center justify-center overflow-hidden touch-none ${imageZoomScale > 1 || imageViewMode === "actual" ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}
                      onWheel={handleImageWheel}
                      onPointerDown={handleImagePointerDown}
                      onPointerMove={handleImagePointerMove}
                      onPointerUp={handleImagePointerEnd}
                      onPointerCancel={handleImagePointerEnd}
                      onDoubleClick={toggleActualSize}
                    >
                      <img
                        src={zoomedCard.imageUrl}
                        alt="Original Snippet View"
                        referrerPolicy="no-referrer"
                        onLoad={(e) => {
                          const img = e.currentTarget;
                          setImageNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
                        }}
                        className={`${imageViewMode === "actual" ? "max-w-none max-h-none object-none" : "h-full w-full object-contain"} select-none pointer-events-none transition-transform duration-150 ease-out`}
                        style={{
                          width: imageViewMode === "actual" && imageNaturalSize ? `${imageNaturalSize.width}px` : undefined,
                          height: imageViewMode === "actual" && imageNaturalSize ? `${imageNaturalSize.height}px` : undefined,
                          transform: `translate3d(${imagePan.x}px, ${imagePan.y}px, 0) scale(${imageZoomScale})`,
                          transformOrigin: "center center",
                        }}
                      />
                    </div>
                    <div className="absolute left-3 top-3 z-30 flex items-center gap-2 rounded-full bg-stone-950/70 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg backdrop-blur-sm">
                      <span>{Math.round(imageZoomScale * 100)}%</span>
                      <span className="text-white/70">{imageViewMode === "actual" ? "原始" : "适配"}</span>
                      {imageNaturalSize && (
                        <span className="text-white/70">
                          {imageNaturalSize.width} x {imageNaturalSize.height}
                        </span>
                      )}
                    </div>
                    <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5 rounded-full bg-stone-950/70 p-1.5 shadow-lg backdrop-blur-sm">
                      <button
                        type="button"
                        onClick={() => updateImageZoom(imageZoomScale - 0.25)}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-white hover:bg-white/15 active:scale-95 transition-all"
                        title="缩小"
                      >
                        <ZoomOut size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={toggleActualSize}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-white hover:bg-white/15 active:scale-95 transition-all"
                        title="切换原始大小"
                      >
                        <Maximize2 size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => updateImageZoom(imageZoomScale + 0.25)}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-white hover:bg-white/15 active:scale-95 transition-all"
                        title="放大"
                      >
                        <ZoomIn size={15} />
                      </button>
                    </div>
                    {(imageZoomScale > 1 || imageViewMode === "actual") && (
                      <div className="absolute bottom-3 left-3 z-30 inline-flex items-center gap-1.5 rounded-full bg-stone-950/60 px-3 py-1.5 text-[11px] font-medium text-white/80 shadow-lg backdrop-blur-sm">
                        <Move size={12} />
                        <span>拖动查看</span>
                      </div>
                    )}
                  </>
                )}
                {!zoomedCardIsCombo ? <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/5 to-white/5 pointer-events-none" /> : null}
                {zoomedCard.type !== "md" && zoomedCard.type !== "video" && !zoomedCardIsCombo && visibleCards.length > 1 && (
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
              <div className={`flex min-h-[360px] w-full flex-col overflow-hidden rounded-xl border border-stone-900/10 bg-[#fbf7ed]/45 dark:border-white/10 dark:bg-white/[0.035] md:h-full md:min-h-0 ${zoomedCard.type === "md" || zoomedCardIsCombo ? "md:w-[32%]" : "md:w-[34%]"}`}>
                <div className="shrink-0 border-b border-dashed border-amber-900/15 px-3 pb-3 pt-1 pr-11 dark:border-amber-100/10 md:px-1 md:pb-3 md:pt-1 md:pr-9">
                  {/* Title / Mood heading */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="mb-1 block font-handwritten text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400">
                        ★ Captured Inspiration ★
                      </span>
                      <h3 className="break-words font-serif text-lg font-bold italic leading-tight text-stone-900 dark:text-stone-100">
                        {zoomedCard.type === "md"
                          ? (zoomedCard.mdName || "Markdown 手稿")
                          : zoomedCardIsCombo
                            ? (zoomedCard.mdName || "组合灵感")
                          : zoomedCard.type === "video"
                            ? (zoomedCard.videoAssets?.[0]?.originalName || "视频灵感")
                            : `${getDayLabelForDayIndex(zoomedCard.dayIndex)} 灵感记录`}
                      </h3>
                    </div>
                    <div className="relative shrink-0">
                      <button
                        type="button"
                        onClick={() => setIsDetailBookPopoverOpen((current) => !current)}
                        className={`grid h-9 w-9 place-items-center rounded-full border shadow-sm transition-all active:scale-95 ${
                          isDetailBookPopoverOpen
                            ? "border-stone-900/25 bg-stone-900 text-[#fbf7ed] dark:border-amber-200/50 dark:bg-amber-200 dark:text-stone-950"
                            : "border-stone-900/10 bg-[#fbf7ed] text-stone-700 hover:-translate-y-0.5 hover:border-stone-900/20 hover:bg-white dark:border-white/10 dark:bg-white/[0.07] dark:text-amber-100 dark:hover:border-amber-200/30 dark:hover:bg-white/[0.12]"
                        }`}
                        title="收录到灵感册"
                        aria-label="收录到灵感册"
                      >
                        <BookOpen size={16} />
                      </button>
                      {isDetailBookPopoverOpen ? (
                        <CardBookPopover
                          cardId={zoomedCard.id}
                          onClose={() => setIsDetailBookPopoverOpen(false)}
                          onChanged={handleBookMembershipChanged}
                        />
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-1.5 font-mono text-[10px] text-stone-400 dark:text-stone-500">
                    记录时间： {new Date(zoomedCard.createdAt).toLocaleString()}
                  </p>
                </div>

                <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3 md:px-1">

                  {/* Active tags visualizer */}
                  <div>
                    <h4 className="text-xs font-serif font-bold italic text-stone-600 dark:text-stone-300 mb-2.5">
                      创意 / 灵感 关键词：
                    </h4>
                    <div className="flex flex-wrap gap-1">
                      {zoomedCard.terms.map((term, index) => (
                        <div
                          key={`${term}-${index}`}
                          onClick={() => {
                            navigator.clipboard.writeText(term);
                          }}
                          className="group inline-flex max-w-full items-center gap-1 rounded-[5px] border border-amber-200/50 bg-amber-50 px-2 py-0.5 text-[11px] font-medium leading-5 text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-900/30 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/40"
                          title="点击复制关键词"
                        >
                          <span className="select-all">{term}</span>
                            <Copy size={8} className="flex-shrink-0 opacity-40 group-hover:opacity-100" />
                        </div>
                      ))}
                      {zoomedCard.terms.length === 0 && (
                        <span className="text-xs font-handwritten text-stone-400 italic">
                          当前无灵感词。悬停在主板的卡片上可自定义添加！
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h4 className="text-xs font-serif font-bold italic text-stone-600 dark:text-stone-300">
                        感悟 / 备注：
                      </h4>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-mono ${
                          detailInsightSaveStatus === "error"
                            ? "text-red-600 dark:text-red-300"
                            : detailInsightSaveStatus === "dirty"
                              ? "text-amber-700 dark:text-amber-300"
                              : "text-stone-400 dark:text-stone-500"
                        }`}>
                          {detailInsightSaveStatus === "saving" && "保存中..."}
                          {detailInsightSaveStatus === "clean" && "已保存"}
                          {detailInsightSaveStatus === "dirty" && "未保存"}
                          {detailInsightSaveStatus === "error" && "保存失败"}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleSaveDetailInsightNote()}
                          disabled={detailInsightSaveStatus === "saving" || detailInsightSaveStatus === "clean"}
                          className="inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-stone-900 px-2.5 text-[11px] font-bold text-[#fbf7ed] transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-amber-200 dark:text-stone-950"
                        >
                          {detailInsightSaveStatus === "saving" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                          保存
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={detailInsightNote}
                      onChange={(event) => {
                        const nextNote = event.target.value;
                        setDetailInsightNote(nextNote);
                        setDetailInsightSaveStatus(nextNote === (zoomedCard.insightNote || "") ? "clean" : "dirty");
                      }}
                      maxLength={4000}
                      placeholder="写一点这张灵感给你的感觉、可复用的设计点，或后续要尝试的方向..."
                      className="min-h-[104px] w-full resize-y rounded-[8px] border border-stone-900/10 bg-[#fbf7ed]/80 px-3 py-2.5 text-sm leading-relaxed text-stone-800 shadow-inner outline-none transition-colors placeholder:text-stone-400 focus:border-stone-800/30 dark:border-white/10 dark:bg-white/[0.055] dark:text-stone-100 dark:placeholder:text-stone-600 dark:focus:border-amber-200/35"
                      style={{
                        backgroundImage: isDarkMode
                          ? "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)"
                          : "radial-gradient(circle at 12% 16%, rgba(68,64,60,0.08), transparent 22%), linear-gradient(rgba(68,64,60,0.06) 1px, transparent 1px)",
                        backgroundSize: isDarkMode ? "100% 1.75rem" : "auto, 100% 1.75rem",
                        lineHeight: "1.75rem",
                      }}
                    />
                    <div className="mt-1 text-right text-[10px] font-mono text-stone-400 dark:text-stone-600">
                      {detailInsightNote.length} / 4000
                    </div>
                  </div>

                  {zoomedCardIsCombo ? (
                    <div className="rounded-[8px] border border-dashed border-stone-900/15 px-3 py-4 text-[11px] leading-relaxed text-stone-500 dark:border-white/12 dark:text-stone-500">
                      参考图、角色分类、提示词和视频记录在左侧组合编辑器里维护。这里保留通用关键词、备注和灵感册收录。
                    </div>
                  ) : zoomedCard.type === "video" ? (
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h4 className="text-xs font-serif font-bold italic text-stone-600 dark:text-stone-300">
                          绑定图片：
                        </h4>
                        <button
                          type="button"
                          onClick={() => detailImageInputRef.current?.click()}
                          disabled={isBindingImage}
                          className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-amber-900 px-2.5 text-[11px] font-bold text-[#fbf7ed] transition-colors hover:bg-amber-800 disabled:cursor-wait disabled:opacity-60 dark:bg-amber-200 dark:text-stone-950"
                        >
                          {isBindingImage ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                          上传
                        </button>
                        <input
                          ref={detailImageInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
                          multiple
                          onChange={handleDetailImageInputChange}
                          className="hidden"
                        />
                      </div>
                      {imageBindError ? (
                        <div className="mb-2 rounded-[6px] border border-red-900/15 bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-700 dark:border-red-300/20 dark:bg-red-500/10 dark:text-red-200">
                          {imageBindError}
                        </div>
                      ) : null}
                      {zoomedCard.imageAssets && zoomedCard.imageAssets.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2">
                          {zoomedCard.imageAssets.map((image) => (
                            <div key={image.id} className="overflow-hidden rounded-[8px] border border-stone-900/10 bg-white/65 dark:border-white/10 dark:bg-white/[0.05]">
                              <img
                                src={image.imageUrl}
                                alt={image.originalName}
                                className="aspect-square w-full bg-stone-100 object-cover dark:bg-stone-900"
                                loading="lazy"
                              />
                              <div className="p-2">
                                <div className="truncate text-[11px] font-bold text-stone-800 dark:text-stone-100">{image.originalName}</div>
                                <div className="mt-0.5 text-[10px] font-mono text-stone-500">{formatBytes(image.sizeBytes)}</div>
                                <div className="mt-2 flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const response = await authFetch(image.imageUrl);
                                      if (!response.ok) return;
                                      downloadBlob(await response.blob(), sanitizeDownloadName(image.originalName || `${image.id}.jpg`));
                                    }}
                                    className="grid h-7 flex-1 place-items-center rounded-[6px] bg-stone-900/[0.06] text-stone-600 hover:bg-stone-900/[0.10] dark:bg-white/[0.08] dark:text-stone-300"
                                    title="下载图片"
                                  >
                                    <Download size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteBoundImage(image.id)}
                                    className="grid h-7 flex-1 place-items-center rounded-[6px] bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-200"
                                    title="删除绑定图片"
                                  >
                                    <Trash size={12} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-[8px] border border-dashed border-stone-900/15 px-3 py-4 text-center text-[11px] text-stone-500 dark:border-white/12 dark:text-stone-500">
                          暂无绑定图片，可多选上传图片作为这个视频的补充素材。
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h4 className="text-xs font-serif font-bold italic text-stone-600 dark:text-stone-300">
                          绑定视频：
                        </h4>
                        <button
                          type="button"
                          onClick={() => detailVideoInputRef.current?.click()}
                          disabled={isBindingVideo}
                          className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-stone-900 px-2.5 text-[11px] font-bold text-[#fbf7ed] transition-colors hover:bg-stone-800 disabled:cursor-wait disabled:opacity-60 dark:bg-amber-200 dark:text-stone-950"
                        >
                          {isBindingVideo ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                          上传
                        </button>
                        <input
                          ref={detailVideoInputRef}
                          type="file"
                          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                          onChange={handleDetailVideoInputChange}
                          className="hidden"
                        />
                      </div>
                      {videoBindError ? (
                        <div className="mb-2 rounded-[6px] border border-red-900/15 bg-red-50 px-2 py-1.5 text-[11px] font-semibold text-red-700 dark:border-red-300/20 dark:bg-red-500/10 dark:text-red-200">
                          {videoBindError}
                        </div>
                      ) : null}
                      {zoomedCard.videoAssets && zoomedCard.videoAssets.length > 0 ? (
                        <div className="space-y-2">
                          {zoomedCard.videoAssets.map((video) => (
                            <div key={video.id} className="rounded-[8px] border border-stone-900/10 bg-white/65 p-2 dark:border-white/10 dark:bg-white/[0.05]">
                              <video
                                src={video.videoUrl}
                                className="mb-2 aspect-video max-h-40 min-h-[128px] w-full rounded-[6px] bg-stone-950 object-contain"
                                controls
                                playsInline
                                preload="metadata"
                              />
                              <div className="flex min-w-0 items-center justify-between gap-2">
                                <div className="min-w-0 self-center">
                                  <div className="truncate text-xs font-bold text-stone-800 dark:text-stone-100">{video.originalName}</div>
                                  <div className="mt-0.5 text-[10px] font-mono text-stone-500">{formatBytes(video.sizeBytes)}</div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const response = await authFetch(video.videoUrl);
                                      if (!response.ok) return;
                                      downloadBlob(await response.blob(), sanitizeDownloadName(video.originalName || `${video.id}.mp4`));
                                    }}
                                    className="grid h-7 w-7 place-items-center rounded-full bg-stone-900/[0.06] text-stone-600 hover:bg-stone-900/[0.10] dark:bg-white/[0.08] dark:text-stone-300"
                                    title="下载视频"
                                  >
                                    <Download size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteBoundVideo(video.id)}
                                    className="grid h-7 w-7 place-items-center rounded-full bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-200"
                                    title="删除绑定视频"
                                  >
                                    <Trash size={12} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-[8px] border border-dashed border-stone-900/15 px-3 py-4 text-center text-[11px] text-stone-500 dark:border-white/12 dark:text-stone-500">
                          暂无绑定视频，可上传一个视频作为这张卡的补充素材。
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer instructions */}
                <div className="shrink-0 border-t border-dashed border-amber-900/15 px-3 py-3 text-[11px] leading-normal text-stone-400 dark:border-amber-100/10 dark:text-stone-500 md:px-1 md:pb-1">
                  <div className="mb-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (zoomedCardIsCombo) return;
                        void handleDownloadCard(zoomedCard).catch((err) => {
                          console.error("Download failed:", err);
                          alert(err.message || "下载失败，请稍后重试。");
                        });
                      }}
                      disabled={zoomedCardIsCombo}
                      className="grid h-9 w-9 place-items-center rounded-full border border-amber-900/15 bg-amber-100/70 text-amber-900 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-amber-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45 dark:border-amber-100/10 dark:bg-amber-300/15 dark:text-amber-100 dark:hover:bg-amber-300/25"
                      title={zoomedCardIsCombo ? "组合素材请在左侧单项下载" : zoomedCard.type === "md" ? "下载 Markdown 文件" : zoomedCard.type === "video" ? "下载视频" : "下载原图"}
                      aria-label={zoomedCardIsCombo ? "组合素材请在左侧单项下载" : zoomedCard.type === "md" ? "下载 Markdown 文件" : zoomedCard.type === "video" ? "下载视频" : "下载原图"}
                    >
                      <Download size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const targetCard = zoomedCard;
                        setZoomedCard(null);
                        handleDeleteCard(targetCard.id);
                      }}
                      className="grid h-9 w-9 place-items-center rounded-full border border-red-900/15 bg-red-50 text-red-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-red-100 active:scale-95 dark:border-red-300/20 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
                      title="删除当前记录"
                      aria-label="删除当前记录"
                    >
                      <Trash size={15} />
                    </button>
                  </div>
                  <span className="font-handwritten text-xs block text-stone-500 dark:text-stone-400 mb-1">提示：</span>
                  在主页面悬停在 Polaroid 灵感相片底部，可对关键词进行<strong>自定义新增</strong>或<strong>删除</strong>管理。
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
