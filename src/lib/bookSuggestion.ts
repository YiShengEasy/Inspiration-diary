import type { BookSuggestionCandidate, ImageCard, InspirationBook } from "../types";

export type BookSuggestionMatch = BookSuggestionCandidate;

interface BookSuggestionOptions {
  minScore?: number;
  limit?: number;
  scoreAdjustments?: Record<string, number>;
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

function compactText(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function longestCommonChineseRun(a: string, b: string): number {
  const left = Array.from(compactText(a));
  const right = Array.from(compactText(b));
  let longest = 0;

  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < right.length; j += 1) {
      let length = 0;
      while (left[i + length] && left[i + length] === right[j + length]) {
        length += 1;
      }
      longest = Math.max(longest, length);
    }
  }

  return longest;
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

  const commonChineseRun = longestCommonChineseRun(text, bookText);
  if (commonChineseRun >= 4) return 7;
  if (commonChineseRun >= 3) return 5;
  if (commonChineseRun >= 2) return 4;

  const bookTokenInText = Array.from(bookTokens).some((token) => token.length >= 2 && text.includes(token));
  if (bookTokenInText) return 2;

  return 0;
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
    baseScore: score,
    feedbackAdjustment: 0,
    matchedTerms: unique(matchedTerms).slice(0, 4),
  };
}

export function findBookSuggestionCandidates(
  card: ImageCard,
  books: InspirationBook[],
  options: BookSuggestionOptions = {},
): BookSuggestionMatch[] {
  const minScore = options.minScore ?? 4;
  const limit = options.limit ?? 3;
  return books
    .map((book) => scoreBook(card, book))
    .filter((match): match is BookSuggestionMatch => Boolean(match))
    .map((match) => {
      const feedbackAdjustment = options.scoreAdjustments?.[match.book.id] || 0;
      return {
        ...match,
        feedbackAdjustment,
        score: match.baseScore + feedbackAdjustment,
      };
    })
    .filter((match) => match.score >= minScore)
    .sort((a, b) => b.score - a.score || b.baseScore - a.baseScore)
    .slice(0, Math.max(1, limit));
}

export function findBestBookSuggestion(
  card: ImageCard,
  books: InspirationBook[],
  options: BookSuggestionOptions = {},
): BookSuggestionMatch | null {
  return findBookSuggestionCandidates(card, books, { ...options, limit: 1 })[0] || null;
}
