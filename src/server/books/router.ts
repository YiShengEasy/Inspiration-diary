import crypto from "node:crypto";
import { Router, type Request } from "express";
import type pg from "pg";

import { findBookSuggestionCandidates } from "../../lib/bookSuggestion.ts";
import type { BookSuggestionFeedbackAction, ImageCard, InspirationBook } from "../../types.ts";
import type { AuthenticatedRequest } from "../auth.ts";
import { withDatabaseTransaction } from "../database/transaction.ts";

export interface BooksRouterDependencies {
  pool: pg.Pool;
  comboSummarySelectForCard: string;
  comboSummarySelectForCoverCard: string;
  mapBookRow: (row: unknown, req: Request) => InspirationBook;
  mapCardRows: (rows: unknown[], req: Request) => ImageCard[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalizeSuggestionTerms(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 12)));
}

function collectSuggestionTexts(card: ImageCard): string[] {
  return normalizeSuggestionTerms([
    ...(card.terms || []),
    card.type === "md" ? card.mdName || "" : "",
    card.type === "md" ? card.mdSummary || "" : "",
    card.insightNote || "",
  ]);
}

function suggestionTextOverlap(cardTexts: string[], feedbackTerms: string[]): number {
  const normalizedCardTexts = cardTexts.map((text) => text.toLowerCase());
  return feedbackTerms.reduce((count, term) => {
    const normalizedTerm = term.toLowerCase();
    if (!normalizedTerm) return count;
    return normalizedCardTexts.some((text) => text.includes(normalizedTerm) || normalizedTerm.includes(text))
      ? count + 1
      : count;
  }, 0);
}

function buildBookSuggestionScoreAdjustments(card: ImageCard, feedbackRows: unknown[]): Record<string, number> {
  const cardTexts = collectSuggestionTexts(card);
  const adjustments: Record<string, number> = {};
  for (const value of feedbackRows) {
    const row = record(value);
    const overlap = suggestionTextOverlap(cardTexts, normalizeSuggestionTerms(row.matched_terms));
    if (overlap <= 0) continue;
    const suggestedBookId = String(row.suggested_book_id || "");
    const selectedBookId = String(row.selected_book_id || "");
    const action = String(row.action || "") as BookSuggestionFeedbackAction;
    if (action === "accepted") {
      const bookId = selectedBookId || suggestedBookId;
      if (bookId) adjustments[bookId] = (adjustments[bookId] || 0) + overlap * 2;
    } else if (action === "corrected") {
      if (selectedBookId) adjustments[selectedBookId] = (adjustments[selectedBookId] || 0) + overlap * 3;
      if (suggestedBookId && suggestedBookId !== selectedBookId) {
        adjustments[suggestedBookId] = (adjustments[suggestedBookId] || 0) - overlap * 2;
      }
    } else if (action === "dismissed" && suggestedBookId) {
      adjustments[suggestedBookId] = (adjustments[suggestedBookId] || 0) - overlap * 2;
    }
  }
  return adjustments;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Database operation failed";
}

export function createBooksRouter(deps: BooksRouterDependencies): Router {
  const { pool, mapBookRow, mapCardRows } = deps;
  const router = Router();

  router.get("/books", async (req: AuthenticatedRequest, res) => {
    try {
      const result = await pool.query(
        `SELECT b.id, b.title, b.description, b.cover_card_id, b.created_at, b.updated_at,
                COUNT(bc.card_id)::int AS card_count,
                (SELECT row_to_json(c) FROM (
                   SELECT c2.id, c2.week_id, c2.day_index, c2.image_url, c2.thumbnail_url,
                          c2.photo_uid, c2.photo_hash, c2.terms, c2.deco_type, c2.angle,
                          c2.created_at, c2.type, c2.md_content, c2.md_summary, c2.md_name,
                          c2.insight_note, c2.is_favorite, c2.favorited_at,
                          ${deps.comboSummarySelectForCoverCard}
                   FROM inspiration_book_cards bc2
                   INNER JOIN cards c2 ON c2.id = bc2.card_id AND c2.user_id = $1
                   WHERE bc2.user_id = $1 AND bc2.book_id = b.id
                     AND COALESCE(c2.type, 'image') <> 'md' AND COALESCE(c2.image_url, '') <> ''
                   ORDER BY CASE WHEN bc2.card_id = b.cover_card_id THEN 0 ELSE 1 END, bc2.added_at ASC
                   LIMIT 1
                 ) c) AS cover_card
         FROM inspiration_books b
         LEFT JOIN inspiration_book_cards bc ON bc.book_id = b.id AND bc.user_id = $1
         WHERE b.user_id = $1
         GROUP BY b.id ORDER BY b.updated_at DESC`,
        [req.user!.id],
      );
      return res.json(result.rows.map((row) => mapBookRow(row, req)));
    } catch (error: unknown) {
      console.error("Error fetching inspiration books:", error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.post("/books", async (req: AuthenticatedRequest, res) => {
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    if (!title) return res.status(400).json({ error: "Book title is required." });
    try {
      const now = Date.now();
      const id = `book_${Math.random().toString(36).slice(2, 12)}_${now.toString(36)}`;
      const result = await pool.query(
        `INSERT INTO inspiration_books (id, user_id, title, description, cover_card_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NULL, $5, $5)
         RETURNING id, title, description, cover_card_id, created_at, updated_at,
                   0::int AS card_count, NULL::json AS cover_card`,
        [id, req.user!.id, title, description, now],
      );
      return res.json(mapBookRow(result.rows[0], req));
    } catch (error: unknown) {
      console.error("Error creating inspiration book:", error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.put("/books/:bookId", async (req: AuthenticatedRequest, res) => {
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    if (!title) return res.status(400).json({ error: "Book title is required." });
    try {
      const result = await pool.query(
        `UPDATE inspiration_books SET title = $1, description = $2, updated_at = $3
         WHERE id = $4 AND user_id = $5 RETURNING id`,
        [title, description, Date.now(), req.params.bookId, req.user!.id],
      );
      return result.rowCount === 0
        ? res.status(404).json({ error: "Book not found" })
        : res.json({ success: true });
    } catch (error: unknown) {
      console.error("Error updating inspiration book:", error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.put("/books/:bookId/cover", async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const cardId = String(req.body.cardId || "").trim();
    if (!cardId) return res.status(400).json({ error: "cardId is required." });
    try {
      const status = await withDatabaseTransaction(pool, async (client) => {
        const owned = await client.query(
          `SELECT b.id AS book_id, c.id AS card_id
           FROM inspiration_books b
           INNER JOIN inspiration_book_cards bc ON bc.book_id = b.id AND bc.user_id = $1 AND bc.card_id = $2
           INNER JOIN cards c ON c.id = bc.card_id AND c.user_id = $1
           WHERE b.id = $3 AND b.user_id = $1
             AND COALESCE(c.type, 'image') <> 'md' AND COALESCE(c.image_url, '') <> ''`,
          [userId, cardId, req.params.bookId],
        );
        if (owned.rowCount === 0) return "card_missing" as const;
        const updated = await client.query(
          `UPDATE inspiration_books SET cover_card_id = $1, updated_at = $2
           WHERE id = $3 AND user_id = $4 RETURNING id`,
          [cardId, Date.now(), req.params.bookId, userId],
        );
        return updated.rowCount === 0 ? "book_missing" as const : "updated" as const;
      });
      if (status === "card_missing") return res.status(404).json({ error: "Book image card not found" });
      if (status === "book_missing") return res.status(404).json({ error: "Book not found" });
      return res.json({ success: true });
    } catch (error: unknown) {
      console.error("Error updating inspiration book cover:", error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.delete("/books/:bookId", async (req: AuthenticatedRequest, res) => {
    try {
      const result = await pool.query("DELETE FROM inspiration_books WHERE id = $1 AND user_id = $2", [req.params.bookId, req.user!.id]);
      return result.rowCount === 0
        ? res.status(404).json({ error: "Book not found" })
        : res.json({ success: true });
    } catch (error: unknown) {
      console.error("Error deleting inspiration book:", error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.get("/books/:bookId/cards", async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const bookId = req.params.bookId;
      const book = await pool.query("SELECT id FROM inspiration_books WHERE id = $1 AND user_id = $2", [bookId, userId]);
      if (book.rowCount === 0) return res.status(404).json({ error: "Book not found" });
      const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
      const pageSize = Math.min(60, Math.max(1, Number.parseInt(String(req.query.pageSize || "12"), 10) || 12));
      const offset = (page - 1) * pageSize;
      const q = String(req.query.q || "").trim();
      const values: Array<string | number> = [userId, bookId];
      const searchSql = q ? "AND c.terms_text ILIKE $3" : "";
      if (q) values.push(`%${q}%`);
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS total FROM inspiration_book_cards bc
         INNER JOIN cards c ON c.id = bc.card_id AND c.user_id = $1
         WHERE bc.user_id = $1 AND bc.book_id = $2 ${searchSql}`,
        values,
      );
      const total = Number(countResult.rows[0]?.total || 0);
      values.push(pageSize);
      const limitParam = values.length;
      values.push(offset);
      const offsetParam = values.length;
      const cardsResult = await pool.query(
        `SELECT c.id, c.week_id, c.day_index, c.image_url, c.thumbnail_url, c.photo_uid, c.photo_hash,
                c.terms, c.deco_type, c.angle, c.created_at, c.type, c.md_content, c.md_summary,
                c.md_name, c.insight_note, c.is_favorite, c.favorited_at,
                ${deps.comboSummarySelectForCard},
                (SELECT COALESCE(json_agg(va ORDER BY va.created_at DESC), '[]'::json)
                 FROM video_assets va WHERE va.user_id = c.user_id AND va.card_id = c.id) AS video_assets,
                (SELECT COALESCE(json_agg(ia ORDER BY ia.created_at DESC), '[]'::json)
                 FROM image_assets ia WHERE ia.user_id = c.user_id AND ia.card_id = c.id) AS image_assets
         FROM inspiration_book_cards bc
         INNER JOIN cards c ON c.id = bc.card_id AND c.user_id = $1
         WHERE bc.user_id = $1 AND bc.book_id = $2 ${searchSql}
         ORDER BY bc.added_at DESC LIMIT $${limitParam} OFFSET $${offsetParam}`,
        values,
      );
      return res.json({
        cards: mapCardRows(cardsResult.rows, req),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (error: unknown) {
      console.error("Error fetching inspiration book cards:", error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.post("/books/:bookId/cards", async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const cardId = String(req.body.cardId || "").trim();
    if (!cardId) return res.status(400).json({ error: "cardId is required." });
    try {
      const found = await withDatabaseTransaction(pool, async (client) => {
        const owned = await client.query(
          `SELECT b.id AS book_id, c.id AS card_id FROM inspiration_books b
           INNER JOIN cards c ON c.id = $2 AND c.user_id = $1
           WHERE b.id = $3 AND b.user_id = $1`,
          [userId, cardId, req.params.bookId],
        );
        if (owned.rowCount === 0) return false;
        const now = Date.now();
        await client.query(
          `INSERT INTO inspiration_book_cards (user_id, book_id, card_id, added_at)
           VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, book_id, card_id) DO NOTHING`,
          [userId, req.params.bookId, cardId, now],
        );
        await client.query(
          `UPDATE inspiration_books b SET cover_card_id = CASE
               WHEN b.cover_card_id IS NULL AND COALESCE(c.type, 'image') <> 'md'
                 AND COALESCE(c.image_url, '') <> '' THEN $3 ELSE b.cover_card_id END,
               updated_at = $4
           FROM cards c WHERE b.id = $2 AND b.user_id = $1 AND c.id = $3 AND c.user_id = $1`,
          [userId, req.params.bookId, cardId, now],
        );
        return true;
      });
      return found ? res.json({ success: true }) : res.status(404).json({ error: "Book or card not found" });
    } catch (error: unknown) {
      console.error("Error adding card to inspiration book:", error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.delete("/books/:bookId/cards/:cardId", async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    try {
      const found = await withDatabaseTransaction(pool, async (client) => {
        const book = await client.query("SELECT id FROM inspiration_books WHERE id = $1 AND user_id = $2", [req.params.bookId, userId]);
        if (book.rowCount === 0) return false;
        await client.query("DELETE FROM inspiration_book_cards WHERE user_id = $1 AND book_id = $2 AND card_id = $3", [userId, req.params.bookId, req.params.cardId]);
        await client.query(
          `UPDATE inspiration_books b SET cover_card_id = CASE WHEN b.cover_card_id = $3 THEN (
               SELECT bc.card_id FROM inspiration_book_cards bc
               INNER JOIN cards c ON c.id = bc.card_id AND c.user_id = $1
               WHERE bc.user_id = $1 AND bc.book_id = $2
                 AND COALESCE(c.type, 'image') <> 'md' AND COALESCE(c.image_url, '') <> ''
               ORDER BY bc.added_at ASC LIMIT 1) ELSE b.cover_card_id END,
             updated_at = $4 WHERE b.id = $2 AND b.user_id = $1`,
          [userId, req.params.bookId, req.params.cardId, Date.now()],
        );
        return true;
      });
      return found ? res.json({ success: true }) : res.status(404).json({ error: "Book not found" });
    } catch (error: unknown) {
      console.error("Error removing card from inspiration book:", error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.get("/cards/:cardId/books", async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const card = await pool.query("SELECT id FROM cards WHERE id = $1 AND user_id = $2", [req.params.cardId, userId]);
      if (card.rowCount === 0) return res.status(404).json({ error: "Card not found" });
      const result = await pool.query(
        `SELECT b.id, b.title, b.description, COUNT(all_bc.card_id)::int AS card_count,
                CASE WHEN own_bc.card_id IS NULL THEN false ELSE true END AS contains_card
         FROM inspiration_books b
         LEFT JOIN inspiration_book_cards all_bc ON all_bc.book_id = b.id AND all_bc.user_id = $1
         LEFT JOIN inspiration_book_cards own_bc ON own_bc.book_id = b.id AND own_bc.user_id = $1 AND own_bc.card_id = $2
         WHERE b.user_id = $1 GROUP BY b.id, own_bc.card_id ORDER BY b.updated_at DESC`,
        [userId, req.params.cardId],
      );
      return res.json(result.rows.map((rowValue) => {
        const row = record(rowValue);
        return {
          id: row.id,
          title: row.title,
          description: row.description || "",
          cardCount: Number(row.card_count || 0),
          containsCard: Boolean(row.contains_card),
        };
      }));
    } catch (error: unknown) {
      console.error("Error fetching card inspiration book membership:", error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.get("/cards/:cardId/book-suggestions", async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const cardResult = await pool.query(
        `SELECT id, week_id, day_index, image_url, thumbnail_url, photo_uid, photo_hash,
                terms, deco_type, angle, created_at, type, md_content, md_summary, md_name,
                insight_note, is_favorite, favorited_at FROM cards WHERE id = $1 AND user_id = $2`,
        [req.params.cardId, userId],
      );
      const card = mapCardRows(cardResult.rows, req)[0];
      if (!card) return res.status(404).json({ error: "Card not found" });
      const booksResult = await pool.query(
        `SELECT b.id, b.title, b.description, b.cover_card_id, b.created_at, b.updated_at,
                COUNT(bc.card_id)::int AS card_count, NULL::json AS cover_card
         FROM inspiration_books b
         LEFT JOIN inspiration_book_cards bc ON bc.book_id = b.id AND bc.user_id = $1
         WHERE b.user_id = $1 GROUP BY b.id ORDER BY b.updated_at DESC`,
        [userId],
      );
      const feedbackResult = await pool.query(
        `SELECT suggested_book_id, selected_book_id, action, matched_terms
         FROM book_suggestion_feedback WHERE user_id = $1 ORDER BY created_at DESC LIMIT 300`,
        [userId],
      );
      const limit = Math.min(5, Math.max(1, Number.parseInt(String(req.query.limit || "3"), 10) || 3));
      return res.json({
        candidates: findBookSuggestionCandidates(
          card,
          booksResult.rows.map((row) => mapBookRow(row, req)),
          { limit, scoreAdjustments: buildBookSuggestionScoreAdjustments(card, feedbackResult.rows) },
        ),
      });
    } catch (error: unknown) {
      console.error("Error fetching book suggestions:", error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  router.post("/cards/:cardId/book-suggestion-feedback", async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const action = String(req.body.action || "").trim() as BookSuggestionFeedbackAction;
    if (!["accepted", "corrected", "dismissed"].includes(action)) {
      return res.status(400).json({ error: "Invalid feedback action." });
    }
    try {
      const card = await pool.query("SELECT id FROM cards WHERE id = $1 AND user_id = $2", [req.params.cardId, userId]);
      if (card.rowCount === 0) return res.status(404).json({ error: "Card not found" });
      const suggestedBookId = String(req.body.suggestedBookId || "").trim() || null;
      const selectedBookId = String(req.body.selectedBookId || "").trim() || null;
      const bookIds = Array.from(new Set([suggestedBookId, selectedBookId].filter((value): value is string => Boolean(value))));
      if (bookIds.length > 0) {
        const ownedBooks = await pool.query("SELECT id FROM inspiration_books WHERE user_id = $1 AND id = ANY($2::text[])", [userId, bookIds]);
        if (ownedBooks.rowCount !== bookIds.length) return res.status(404).json({ error: "Book not found" });
      }
      const score = Number(req.body.score || 0);
      await pool.query(
        `INSERT INTO book_suggestion_feedback
           (id, user_id, card_id, suggested_book_id, selected_book_id, action, matched_terms, score, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
        [
          `feedback_${crypto.randomUUID()}`, userId, req.params.cardId,
          suggestedBookId, selectedBookId, action,
          JSON.stringify(normalizeSuggestionTerms(req.body.matchedTerms)),
          Number.isFinite(score) ? score : 0, Date.now(),
        ],
      );
      return res.json({ success: true });
    } catch (error: unknown) {
      console.error("Error recording book suggestion feedback:", error);
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  return router;
}
