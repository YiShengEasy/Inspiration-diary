import { db } from "./firebase";
import {
  collection,
  doc,
  query,
  where,
  getDoc,
  setDoc,
  onSnapshot,
  deleteDoc,
  updateDoc,
} from "firebase/firestore";
import { ImageCard, WeeklyNote } from "../types";
import { authFetch } from "./authClient";

// Detect if we are in PostgreSQL Mode
const isPostgresMode = (import.meta as any).env.VITE_DATABASE_TYPE === "postgres";

// Simple local pub/sub listener map for PostgreSQL Mode
type CardCallback = (cards: ImageCard[]) => void;
const cardListeners = new Map<string, Set<CardCallback>>();
const activeWeekCardsMemory = new Map<string, ImageCard[]>();

export interface PaginatedCardsResult {
  cards: ImageCard[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function notifyCardsSubscribers(weekId: string, cards: ImageCard[]) {
  const set = cardListeners.get(weekId);
  if (set) {
    set.forEach((cb) => cb(cards));
  }
}

function upsertCachedCard(card: ImageCard) {
  const existing = activeWeekCardsMemory.get(card.weekId) || [];
  const idx = existing.findIndex((c) => c.id === card.id);
  const updated = [...existing];
  if (idx >= 0) {
    updated[idx] = card;
  } else {
    updated.push(card);
  }
  updated.sort((a, b) => b.createdAt - a.createdAt);
  activeWeekCardsMemory.set(card.weekId, updated);
  notifyCardsSubscribers(card.weekId, updated);

  const allCards = activeWeekCardsMemory.get("all");
  if (allCards) {
    const allIdx = allCards.findIndex((c) => c.id === card.id);
    const nextAllCards = [...allCards];
    if (allIdx >= 0) {
      nextAllCards[allIdx] = card;
    } else {
      nextAllCards.push(card);
    }
    nextAllCards.sort((a, b) => b.createdAt - a.createdAt);
    activeWeekCardsMemory.set("all", nextAllCards);
    notifyCardsSubscribers("all", nextAllCards);
  }
}

function removeCachedCard(cardId: string, weekId: string) {
  const existing = activeWeekCardsMemory.get(weekId) || [];
  const updated = existing.filter((c) => c.id !== cardId);
  activeWeekCardsMemory.set(weekId, updated);
  notifyCardsSubscribers(weekId, updated);

  const allCards = activeWeekCardsMemory.get("all");
  if (allCards) {
    const nextAllCards = allCards.filter((c) => c.id !== cardId);
    activeWeekCardsMemory.set("all", nextAllCards);
    notifyCardsSubscribers("all", nextAllCards);
  }
}

function updateCachedCardTerms(cardId: string, weekId: string, terms: string[]) {
  const existing = activeWeekCardsMemory.get(weekId) || [];
  const updated = existing.map((c) => c.id === cardId ? { ...c, terms } : c);
  activeWeekCardsMemory.set(weekId, updated);
  notifyCardsSubscribers(weekId, updated);

  const allCards = activeWeekCardsMemory.get("all");
  if (allCards) {
    const nextAllCards = allCards.map((c) => c.id === cardId ? { ...c, terms } : c);
    activeWeekCardsMemory.set("all", nextAllCards);
    notifyCardsSubscribers("all", nextAllCards);
  }
}

/**
 * Real-time or locally notified subscription to image cards for a given week identifier.
 */
export function subscribeCards(weekId: string, callback: CardCallback): () => void {
  if (isPostgresMode) {
    // 1. Register callback in our client pub-sub
    if (!cardListeners.has(weekId)) {
      cardListeners.set(weekId, new Set());
    }
    cardListeners.get(weekId)!.add(callback);

    // 2. Load initial set immediately
    fetchCardsFromApi(weekId).then((cards) => {
      activeWeekCardsMemory.set(weekId, cards);
      callback(cards);
    });

    // Disposer of subscriber
    return () => {
      const set = cardListeners.get(weekId);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          cardListeners.delete(weekId);
        }
      }
    };
  } else {
    // Firestore native real-time stream
    const cardsQuery = query(collection(db, "cards"), where("weekId", "==", weekId));
    return onSnapshot(cardsQuery, (snapshot) => {
      const fetchedCards: ImageCard[] = [];
      snapshot.forEach((doc) => {
        fetchedCards.push({ id: doc.id, ...doc.data() } as ImageCard);
      });
      fetchedCards.sort((a, b) => b.createdAt - a.createdAt);
      activeWeekCardsMemory.set(weekId, fetchedCards);
      callback(fetchedCards);
    }, (error) => {
      console.error("Firestore loading error for cards:", error);
    });
  }
}

/**
 * Internal helper to query cards from backend Server Express APIs
 */
async function fetchCardsFromApi(weekId: string): Promise<ImageCard[]> {
  try {
    const res = await authFetch(`/api/db/cards?weekId=${encodeURIComponent(weekId)}`);
    if (res.ok) {
      const data = await res.json();
      return Array.isArray(data) ? data : data.cards || [];
    }
  } catch (err) {
    console.error("Failed to query cards from API:", err);
  }
  return [];
}

/**
 * Loads a paginated slice of all historical cards from the backend.
 */
export async function loadAllCardsPage(params: {
  page: number;
  pageSize: number;
  query?: string;
}): Promise<PaginatedCardsResult> {
  const page = Math.max(1, params.page);
  const pageSize = Math.max(1, params.pageSize);

  if (!isPostgresMode) {
    const allCards = activeWeekCardsMemory.get("all") || [];
    const q = (params.query || "").trim().toLowerCase();
    const filtered = q
      ? allCards.filter((card) => card.terms.some((term) => term.toLowerCase().includes(q)))
      : allCards;
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    return {
      cards: filtered.slice(start, start + pageSize),
      total,
      page: safePage,
      pageSize,
      totalPages,
    };
  }

  try {
    const searchParams = new URLSearchParams({
      weekId: "all",
      page: String(page),
      pageSize: String(pageSize),
    });
    const query = (params.query || "").trim();
    if (query) {
      searchParams.set("q", query);
    }

    const res = await authFetch(`/api/db/cards?${searchParams.toString()}`);
    if (res.ok) {
      const data = await res.json();
      const cards = Array.isArray(data) ? data : data.cards || [];
      const total = Number(data.total ?? cards.length);
      const totalPages = Math.max(1, Number(data.totalPages ?? Math.ceil(total / pageSize)));
      return {
        cards,
        total,
        page: Number(data.page ?? page),
        pageSize: Number(data.pageSize ?? pageSize),
        totalPages,
      };
    }
  } catch (err) {
    console.error("Failed to query paginated cards from API:", err);
  }

  return {
    cards: [],
    total: 0,
    page,
    pageSize,
    totalPages: 1,
  };
}

/**
 * Loads the weekly note configuration
 */
export async function loadNote(weekId: string): Promise<WeeklyNote | null> {
  if (isPostgresMode) {
    try {
      const res = await authFetch(`/api/db/notes/${encodeURIComponent(weekId)}`);
      if (res.ok) {
        const body = await res.json();
        return body;
      }
    } catch (err) {
      console.error("Failed to retrieve notes from API:", err);
    }
    return null;
  } else {
    const noteDocRef = doc(db, "notes", weekId);
    const noteDoc = await getDoc(noteDocRef);
    if (noteDoc.exists()) {
      return noteDoc.data() as WeeklyNote;
    }
    return null;
  }
}

/**
 * Saves or updates a weekly note
 */
export async function saveNote(weekId: string, note: string, height: number): Promise<void> {
  if (isPostgresMode) {
    const res = await authFetch(`/api/db/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekId, note, height }),
    });
    if (!res.ok) {
      throw new Error(`Failed to save note via local API: ${res.statusText}`);
    }
  } else {
    const noteDocRef = doc(db, "notes", weekId);
    // Execute optimistic write without block awaiting network database confirm
    setDoc(noteDocRef, {
      weekId,
      note,
      height,
      updatedAt: Date.now(),
    }, { merge: true }).catch((err) => {
      console.error("Firestore saveNote error:", err);
    });
  }
}

/**
 * Generates a unique collection ID
 */
export function createNewCardId(): string {
  if (isPostgresMode) {
    return "card_" + Math.random().toString(36).substring(2, 15) + "_" + Date.now().toString(36);
  } else {
    return doc(collection(db, "cards")).id;
  }
}

/**
 * Persists a polaroid aesthetic image card
 */
export async function saveCard(card: ImageCard): Promise<void> {
  if (isPostgresMode) {
    const res = await authFetch(`/api/db/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });
    if (!res.ok) {
      throw new Error(`Failed to save card via local API: ${res.statusText}`);
    }
    
    upsertCachedCard(card);
  } else {
    // Initiate Firestore setDoc, let offline cache update the UI snappy
    setDoc(doc(db, "cards", card.id), card).catch((err) => {
      console.error("Firestore saveCard error:", err);
    });
  }
}

/**
 * Deletes a polaroid image card document
 */
export async function deleteCard(cardId: string, weekId: string): Promise<void> {
  if (isPostgresMode) {
    const res = await authFetch(`/api/db/cards/${encodeURIComponent(cardId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error(`Failed to remove card via local API: ${res.statusText}`);
    }

    removeCachedCard(cardId, weekId);
  } else {
    deleteDoc(doc(db, "cards", cardId)).catch((err) => {
      console.error("Firestore deleteCard error:", err);
    });
  }
}

/**
 * Inline updates for term keywords of a specific polaroid card
 */
export async function updateCardTerms(cardId: string, weekId: string, terms: string[]): Promise<void> {
  if (isPostgresMode) {
    const res = await authFetch(`/api/db/cards/${encodeURIComponent(cardId)}/terms`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terms }),
    });
    if (!res.ok) {
      throw new Error(`Failed to update tags via API: ${res.statusText}`);
    }

    updateCachedCardTerms(cardId, weekId, terms);
  } else {
    const cardRef = doc(db, "cards", cardId);
    updateDoc(cardRef, { terms }).catch((err) => {
      console.error("Firestore updateCardTerms error:", err);
    });
  }
}

/**
 * Real-time stream subscription to ALL cards in the entire database (cross-week/global view)
 */
export function subscribeAllCards(callback: CardCallback): () => void {
  if (isPostgresMode) {
    if (!cardListeners.has("all")) {
      cardListeners.set("all", new Set());
    }
    cardListeners.get("all")!.add(callback);

    fetchCardsFromApi("all").then((cards) => {
      activeWeekCardsMemory.set("all", cards);
      callback(cards);
    });

    return () => {
      const set = cardListeners.get("all");
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          cardListeners.delete("all");
        }
      }
    };
  } else {
    // Firestore cards collection query for everything
    const cardsQuery = query(collection(db, "cards"));
    return onSnapshot(cardsQuery, (snapshot) => {
      const fetchedCards: ImageCard[] = [];
      snapshot.forEach((doc) => {
        fetchedCards.push({ id: doc.id, ...doc.data() } as ImageCard);
      });
      fetchedCards.sort((a, b) => b.createdAt - a.createdAt); // Order by creation absolute date desc
      activeWeekCardsMemory.set("all", fetchedCards);
      callback(fetchedCards);
    }, (error) => {
      console.error("Firestore loading error for all cards:", error);
    });
  }
}

/**
 * Manually reloads cards from the backend in PostgreSQL mode.
 * Firestore mode relies on native snapshots, so this returns the current cache there.
 */
export async function refreshCards(weekId: string): Promise<ImageCard[]> {
  if (!isPostgresMode) {
    return activeWeekCardsMemory.get(weekId) || [];
  }

  const cards = await fetchCardsFromApi(weekId);
  activeWeekCardsMemory.set(weekId, cards);
  notifyCardsSubscribers(weekId, cards);
  return cards;
}

/**
 * Loads AI settings from the database (Postgres mode only).
 * Falls back to empty object if not configured or Firestore mode.
 */
export async function loadSettings(): Promise<Record<string, string>> {
  if (!isPostgresMode) return {};
  try {
    const res = await authFetch("/api/db/settings");
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error("Failed to load settings from DB:", err);
  }
  return {};
}

/**
 * Persists AI settings to the database (Postgres mode only).
 */
export async function saveSettings(settings: Record<string, string>): Promise<void> {
  if (!isPostgresMode) return;
  try {
    const res = await authFetch("/api/db/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    if (!res.ok) {
      console.error("Failed to save settings to DB:", res.statusText);
    }
  } catch (err) {
    console.error("Failed to save settings to DB:", err);
  }
}
