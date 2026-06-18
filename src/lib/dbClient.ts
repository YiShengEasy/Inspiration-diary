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

// Detect if we are in PostgreSQL Mode
const isPostgresMode = (import.meta as any).env.VITE_DATABASE_TYPE === "postgres";

// Simple local pub/sub listener map for PostgreSQL Mode
type CardCallback = (cards: ImageCard[]) => void;
const cardListeners = new Map<string, Set<CardCallback>>();
const activeWeekCardsMemory = new Map<string, ImageCard[]>();

function notifyCardsSubscribers(weekId: string, cards: ImageCard[]) {
  const set = cardListeners.get(weekId);
  if (set) {
    set.forEach((cb) => cb(cards));
  }
}

/**
 * Real-time or polled subscription to image cards for a given week identifier.
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

    // 3. Keep a 5-second poll active for external sync in Postgres mode
    const interval = setInterval(() => {
      fetchCardsFromApi(weekId).then((cards) => {
        const cached = activeWeekCardsMemory.get(weekId) || [];
        if (JSON.stringify(cached) !== JSON.stringify(cards)) {
          activeWeekCardsMemory.set(weekId, cards);
          callback(cards);
        }
      });
    }, 5000);

    // Disposer of subscriber
    return () => {
      clearInterval(interval);
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
      fetchedCards.sort((a, b) => a.createdAt - b.createdAt);
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
    const res = await fetch(`/api/db/cards?weekId=${encodeURIComponent(weekId)}`);
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch (err) {
    console.error("Failed to query cards from API:", err);
  }
  return [];
}

/**
 * Loads the weekly note configuration
 */
export async function loadNote(weekId: string): Promise<WeeklyNote | null> {
  if (isPostgresMode) {
    try {
      const res = await fetch(`/api/db/notes/${encodeURIComponent(weekId)}`);
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
    const res = await fetch(`/api/db/notes`, {
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
    const res = await fetch(`/api/db/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });
    if (!res.ok) {
      throw new Error(`Failed to save card via local API: ${res.statusText}`);
    }
    
    // Optimistic local sync
    const existing = activeWeekCardsMemory.get(card.weekId) || [];
    const idx = existing.findIndex((c) => c.id === card.id);
    const updated = [...existing];
    if (idx >= 0) {
      updated[idx] = card;
    } else {
      updated.push(card);
    }
    updated.sort((a, b) => a.createdAt - b.createdAt);
    activeWeekCardsMemory.set(card.weekId, updated);
    notifyCardsSubscribers(card.weekId, updated);
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
    const res = await fetch(`/api/db/cards/${encodeURIComponent(cardId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error(`Failed to remove card via local API: ${res.statusText}`);
    }

    // Refresh memory cache
    const existing = activeWeekCardsMemory.get(weekId) || [];
    const updated = existing.filter((c) => c.id !== cardId);
    activeWeekCardsMemory.set(weekId, updated);
    notifyCardsSubscribers(weekId, updated);
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
    const res = await fetch(`/api/db/cards/${encodeURIComponent(cardId)}/terms`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terms }),
    });
    if (!res.ok) {
      throw new Error(`Failed to update tags via API: ${res.statusText}`);
    }

    // Notify memory cache
    const existing = activeWeekCardsMemory.get(weekId) || [];
    const updated = existing.map((c) => c.id === cardId ? { ...c, terms } : c);
    activeWeekCardsMemory.set(weekId, updated);
    notifyCardsSubscribers(weekId, updated);
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
    const fetchAll = () => {
      fetchCardsFromApi("all").then((cards) => {
        callback(cards);
      });
    };
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => {
      clearInterval(interval);
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
      callback(fetchedCards);
    }, (error) => {
      console.error("Firestore loading error for all cards:", error);
    });
  }
}

