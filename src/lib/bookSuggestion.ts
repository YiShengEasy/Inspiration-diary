import type { ImageCard, InspirationBook } from "../types";

export interface BookSuggestionMatch {
  book: InspirationBook;
  score: number;
  matchedTerms: string[];
}

interface BookSuggestionOptions {
  minScore?: number;
}

function normalizeText(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[~`!@#$%^&*()_\-+=[\]{}|\\:;"'<>,.?/，。！？；：“”‘’（）【】《》、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function splitTokens(value: string): string[] {
  return unique(normalizeText(value).split(/\s+/)).filter((token) => token.length >= 2);
}

function collectCardTexts(card: ImageCard): string[] {
  return unique([
    ...(card.terms || []),
    card.type === "md" ? card.mdName || "" : "",
    card.type === "md" ? card.mdSummary || "" : "",
  ]);
}

function getBookText(book: InspirationBook): string {
  return normalizeText(`${book.title} ${book.description || ""}`);
}

function scoreTextAgainstBook(rawText: string, bookText: string, bookTokens: Set<string>): number {
  const text = normalizeText(rawText);
  if (!text) return 0;

  if (bookText.includes(text)) {
    return text.length >= 4 ? 8 : 5;
  }

  if (text.includes(bookText) && bookText.length >= 2) {
    return bookText.length >= 4 ? 8 : 5;
  }

  const textTokens = splitTokens(text);
  const tokenOverlap = textTokens.filter((token) => bookTokens.has(token));
  if (tokenOverlap.length > 0) {
    return tokenOverlap.length * 2;
  }

  const partialOverlap = textTokens.some((token) => token.length >= 3 && bookText.includes(token));
  if (partialOverlap) return 1;

  const bookTokenInText = Array.from(bookTokens).some((token) => token.length >= 2 && text.includes(token));
  return bookTokenInText ? 2 : 0;
}

function scoreBook(card: ImageCard, book: InspirationBook): BookSuggestionMatch | null {
  const bookText = getBookText(book);
  if (!bookText) return null;

  const bookTokens = new Set(splitTokens(bookText));
  const matchedTerms: string[] = [];
  let score = 0;

  for (const text of collectCardTexts(card)) {
    const textScore = scoreTextAgainstBook(text, bookText, bookTokens);
    if (textScore <= 0) continue;
    score += textScore;
    matchedTerms.push(text);
  }

  if (score <= 0) return null;
  return {
    book,
    score,
    matchedTerms: unique(matchedTerms).slice(0, 4),
  };
}

export function findBestBookSuggestion(
  card: ImageCard,
  books: InspirationBook[],
  options: BookSuggestionOptions = {},
): BookSuggestionMatch | null {
  const minScore = options.minScore ?? 6;
  const best = books
    .map((book) => scoreBook(card, book))
    .filter((match): match is BookSuggestionMatch => Boolean(match))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score < minScore) return null;
  return best;
}
