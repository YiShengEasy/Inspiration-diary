function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[~`!@#$%^&*()_\-+=[\]{}|\\:;"'<>,.?/，。！？；：“”‘’（）【】《》、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function splitTokens(value) {
  return unique(normalizeText(value).split(/\s+/)).filter((token) => token.length >= 2);
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function longestCommonRun(a, b) {
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

function collectCardTexts(card) {
  return unique([
    ...(Array.isArray(card.terms) ? card.terms : []),
    card.type === "md" ? card.mdName || "" : "",
    card.type === "md" ? card.mdSummary || "" : ""
  ]);
}

function getBookText(book) {
  return normalizeText(`${book.title || ""} ${book.description || ""}`);
}

function scoreTextAgainstBook(rawText, bookText, bookTokens) {
  const text = normalizeText(rawText);
  if (!text) return 0;

  if (bookText.includes(text)) return text.length >= 4 ? 8 : 5;
  if (text.includes(bookText) && bookText.length >= 2) return bookText.length >= 4 ? 8 : 5;

  const tokenOverlap = splitTokens(text).filter((token) => bookTokens.has(token));
  if (tokenOverlap.length > 0) return tokenOverlap.length * 2;

  const commonRun = longestCommonRun(text, bookText);
  if (commonRun >= 4) return 7;
  if (commonRun >= 3) return 5;
  if (commonRun >= 2) return 4;

  const bookTokenInText = Array.from(bookTokens).some((token) => token.length >= 2 && text.includes(token));
  return bookTokenInText ? 2 : 0;
}

function scoreBook(card, book) {
  const bookText = getBookText(book);
  if (!bookText) return null;

  const bookTokens = new Set(splitTokens(bookText));
  const matchedTerms = [];
  let score = 0;

  collectCardTexts(card).forEach((text) => {
    const textScore = scoreTextAgainstBook(text, bookText, bookTokens);
    if (textScore <= 0) return;
    score += textScore;
    matchedTerms.push(text);
  });

  if (score <= 0) return null;
  return {
    book,
    score,
    matchedTerms: unique(matchedTerms).slice(0, 4)
  };
}

function findBestBookSuggestion(card, books, options = {}) {
  const minScore = options.minScore || 4;
  const best = (books || [])
    .map((book) => scoreBook(card, book))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score < minScore) return null;
  return best;
}

module.exports = { findBestBookSuggestion };
