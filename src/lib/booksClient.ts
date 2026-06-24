import type { CardBookMembership, InspirationBook, PaginatedBookCardsResult } from "../types";
import { authFetch } from "./authClient";

async function parseJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || res.statusText);
  }
  return body as T;
}

export async function loadBooks(): Promise<InspirationBook[]> {
  const res = await authFetch("/api/db/books");
  return parseJson<InspirationBook[]>(res);
}

export async function createBook(input: { title: string; description?: string }): Promise<InspirationBook> {
  const res = await authFetch("/api/db/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson<InspirationBook>(res);
}

export async function updateBook(bookId: string, input: { title: string; description?: string }): Promise<void> {
  const res = await authFetch(`/api/db/books/${encodeURIComponent(bookId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await parseJson<{ success: boolean }>(res);
}

export async function deleteBook(bookId: string): Promise<void> {
  const res = await authFetch(`/api/db/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
  await parseJson<{ success: boolean }>(res);
}

export async function loadBookCards(params: {
  bookId: string;
  page: number;
  pageSize: number;
  query?: string;
}): Promise<PaginatedBookCardsResult> {
  const searchParams = new URLSearchParams({
    page: String(Math.max(1, params.page)),
    pageSize: String(Math.max(1, params.pageSize)),
  });
  const query = (params.query || "").trim();
  if (query) {
    searchParams.set("q", query);
  }

  const res = await authFetch(`/api/db/books/${encodeURIComponent(params.bookId)}/cards?${searchParams.toString()}`);
  return parseJson<PaginatedBookCardsResult>(res);
}

export async function loadCardBookMembership(cardId: string): Promise<CardBookMembership[]> {
  const res = await authFetch(`/api/db/cards/${encodeURIComponent(cardId)}/books`);
  return parseJson<CardBookMembership[]>(res);
}

export async function setCardBookMembership(cardId: string, bookId: string, shouldContain: boolean): Promise<void> {
  const url = `/api/db/books/${encodeURIComponent(bookId)}/cards${shouldContain ? "" : `/${encodeURIComponent(cardId)}`}`;
  const res = await authFetch(url, {
    method: shouldContain ? "POST" : "DELETE",
    headers: shouldContain ? { "Content-Type": "application/json" } : undefined,
    body: shouldContain ? JSON.stringify({ cardId }) : undefined,
  });
  await parseJson<{ success: boolean }>(res);
}
