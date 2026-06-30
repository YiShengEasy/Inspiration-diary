import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { BookmarkCheck, BookOpen, Check, ChevronLeft, ChevronRight, Edit3, Image as ImageIcon, Loader2, Plus, Search, Trash, X } from "lucide-react";
import type { ImageCard, InspirationBook } from "../types";
import { createBook, deleteBook, loadBookCards, loadBooks, setBookCover, setCardBookMembership, updateBook } from "../lib/booksClient";
import { updateCardTerms } from "../lib/dbClient";
import PolaroidCard from "./PolaroidCard";

interface InspirationBooksViewProps {
  refreshToken: number;
  onZoom: (card: ImageCard) => void;
  onDeleteTerm: (cardId: string, termIndex: number) => void;
  onUpdateTerms: (cardId: string, terms: string[]) => void;
  onBookMembershipChanged: () => void;
}

const BOOK_CARDS_PAGE_SIZE = 12;

export default function InspirationBooksView({
  refreshToken,
  onZoom,
  onDeleteTerm,
  onUpdateTerms,
  onBookMembershipChanged,
}: InspirationBooksViewProps) {
  const [books, setBooks] = useState<InspirationBook[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [cards, setCards] = useState<ImageCard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [query, setQuery] = useState("");
  const [bookSearchQuery, setBookSearchQuery] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isCreatingOpen, setIsCreatingOpen] = useState(false);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isLoadingBooks, setIsLoadingBooks] = useState(true);
  const [isLoadingCards, setIsLoadingCards] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingBook, setIsSavingBook] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedBookId) || null,
    [books, selectedBookId],
  );
  const selectedCoverCardId = selectedBook?.coverCard?.id || selectedBook?.coverCardId || "";
  const filteredBooks = useMemo(() => {
    const q = bookSearchQuery.trim().toLowerCase();
    if (!q) return books;
    return books.filter((book) => {
      return book.title.toLowerCase().includes(q)
        || book.description.toLowerCase().includes(q);
    });
  }, [bookSearchQuery, books]);

  const refreshBooks = async (preferredBookId = selectedBookId) => {
    setIsLoadingBooks(true);
    setError(null);
    try {
      const nextBooks = await loadBooks();
      setBooks(nextBooks);
      if (nextBooks.length === 0) {
        setSelectedBookId(null);
        return;
      }
      const stillExists = preferredBookId && nextBooks.some((book) => book.id === preferredBookId);
      setSelectedBookId(stillExists ? preferredBookId : nextBooks[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "灵感册加载失败");
    } finally {
      setIsLoadingBooks(false);
    }
  };

  const refreshCurrentBookCards = async () => {
    if (!selectedBookId) {
      setCards([]);
      setTotal(0);
      setTotalPages(1);
      return;
    }

    setIsLoadingCards(true);
    setError(null);
    try {
      const result = await loadBookCards({
        bookId: selectedBookId,
        page,
        pageSize: BOOK_CARDS_PAGE_SIZE,
        query,
      });
      setCards(result.cards);
      setTotal(result.total);
      setPage(result.page);
      setTotalPages(result.totalPages);
    } catch (err) {
      setCards([]);
      setTotal(0);
      setTotalPages(1);
      setError(err instanceof Error ? err.message : "灵感册内容加载失败");
    } finally {
      setIsLoadingCards(false);
    }
  };

  useEffect(() => {
    void refreshBooks(selectedBookId);
  }, [refreshToken]);

  useEffect(() => {
    setPage(1);
  }, [selectedBookId, query]);

  useEffect(() => {
    void refreshCurrentBookCards();
  }, [selectedBookId, page, query, refreshToken]);

  const handleCreateBook = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = newTitle.trim();
    const description = newDescription.trim();
    if (!title) {
      setError("请先输入灵感册名称");
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      const created = await createBook({ title, description });
      setNewTitle("");
      setNewDescription("");
      setIsCreatingOpen(false);
      await refreshBooks(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "灵感册创建失败");
    } finally {
      setIsCreating(false);
    }
  };

  const startEditBook = (book: InspirationBook) => {
    setEditingBookId(book.id);
    setEditTitle(book.title);
    setEditDescription(book.description);
    setIsCreatingOpen(false);
    setError(null);
  };

  const cancelEditBook = () => {
    setEditingBookId(null);
    setEditTitle("");
    setEditDescription("");
  };

  const handleUpdateBook = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingBookId) return;
    const title = editTitle.trim();
    const description = editDescription.trim();
    if (!title) {
      setError("请先输入灵感册名称");
      return;
    }

    setIsSavingBook(true);
    setError(null);
    try {
      await updateBook(editingBookId, { title, description });
      await refreshBooks(editingBookId);
      cancelEditBook();
    } catch (err) {
      setError(err instanceof Error ? err.message : "灵感册保存失败");
    } finally {
      setIsSavingBook(false);
    }
  };

  const handleDeleteBook = async () => {
    if (!selectedBook) return;
    const confirmed = window.confirm(`删除灵感册「${selectedBook.title}」？册内灵感不会被删除，只会移出这个册。`);
    if (!confirmed) return;

    setError(null);
    try {
      await deleteBook(selectedBook.id);
      setCards([]);
      cancelEditBook();
      await refreshBooks(null);
      onBookMembershipChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "灵感册删除失败");
    }
  };

  const handleRemoveCard = async (cardId: string) => {
    if (!selectedBook) return;
    setError(null);
    try {
      await setCardBookMembership(cardId, selectedBook.id, false);
      onBookMembershipChanged();
      await refreshBooks(selectedBook.id);
      await refreshCurrentBookCards();
    } catch (err) {
      setError(err instanceof Error ? err.message : "从灵感册移除失败");
    }
  };

  const handleSetCover = async (card: ImageCard) => {
    if (!selectedBook || selectedCoverCardId === card.id) return;
    if (card.type === "md" || !card.imageUrl) {
      setError("封面需要选择图片灵感。");
      return;
    }

    setError(null);
    try {
      await setBookCover(selectedBook.id, card.id);
      await refreshBooks(selectedBook.id);
      onBookMembershipChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "封面设置失败");
    }
  };

  const handleDeleteTerm = async (cardId: string, termIndex: number) => {
    const targetCard = cards.find((card) => card.id === cardId);
    if (!targetCard) {
      onDeleteTerm(cardId, termIndex);
      return;
    }

    const nextTerms = [...targetCard.terms];
    nextTerms.splice(termIndex, 1);
    await handleUpdateTerms(cardId, nextTerms);
  };

  const handleUpdateTerms = async (cardId: string, terms: string[]) => {
    const targetCard = cards.find((card) => card.id === cardId);
    if (!targetCard) {
      onUpdateTerms(cardId, terms);
      return;
    }

    setError(null);
    try {
      await updateCardTerms(cardId, targetCard.weekId, terms);
      setCards((current) =>
        current.map((card) => (card.id === cardId ? { ...card, terms } : card)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "灵感词更新失败");
    }
  };

  return (
    <motion.section
      key="inspiration-books-view"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.22 }}
      className="relative mt-4 mb-8 overflow-hidden rounded-[8px] border border-stone-900/10 bg-[#fbf7ed] text-stone-900 shadow-[0_26px_70px_rgba(68,64,60,0.18)] backdrop-blur-xl dark:border-white/10 dark:bg-stone-950/70 dark:text-stone-100 dark:shadow-[0_26px_70px_rgba(0,0,0,0.35)]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_12%,rgba(68,64,60,0.16),transparent_20%),radial-gradient(circle_at_84%_10%,rgba(120,113,108,0.10),transparent_24%),radial-gradient(circle_at_72%_78%,rgba(68,64,60,0.08),transparent_28%),linear-gradient(120deg,rgba(68,64,60,0.035)_1px,transparent_1px)] bg-[size:auto,auto,auto,22px_22px] dark:bg-[radial-gradient(circle_at_20%_0%,rgba(251,191,36,0.2),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))]" />
      <div className="relative border-b border-stone-900/10 bg-white/30 px-4 py-5 dark:border-white/10 dark:bg-transparent md:px-6">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-stone-900/10 bg-white/45 px-3 py-1 text-[11px] font-semibold text-stone-700 shadow-sm dark:border-amber-200/20 dark:bg-amber-200/10 dark:text-amber-100">
            <BookOpen size={13} />
            Inspiration Books
          </div>
          <h2 className="font-serif text-2xl font-bold italic tracking-normal text-stone-950 md:text-3xl dark:text-white">灵感册</h2>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-stone-600 dark:text-stone-400">
            把散落在不同周里的灵感收进自定义册子。一本册可以收很多灵感，同一条灵感也可以同时存在于多个册里。
          </p>
        </div>

      </div>

      <div className="relative grid min-h-[560px] lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-b border-stone-900/10 bg-white/25 p-4 dark:border-white/10 dark:bg-black/20 lg:border-b-0 lg:border-r">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-stone-500">Bookshelf</span>
            {isLoadingBooks ? <Loader2 size={14} className="animate-spin text-stone-600 dark:text-amber-200" /> : null}
          </div>

          <div className="mb-3 space-y-2">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
              <input
                type="text"
                value={bookSearchQuery}
                onChange={(event) => setBookSearchQuery(event.target.value)}
                placeholder="搜索册子"
                className="h-9 w-full rounded-[6px] border border-stone-900/10 bg-white/60 pl-9 pr-8 text-sm text-stone-900 outline-none placeholder:text-stone-500 focus:border-stone-800/30 dark:border-white/10 dark:bg-white/[0.06] dark:text-stone-100 dark:placeholder:text-stone-600 dark:focus:border-amber-200/40"
              />
              {bookSearchQuery ? (
                <button
                  type="button"
                  onClick={() => setBookSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-stone-500 hover:bg-stone-900/10 hover:text-stone-900 dark:hover:bg-white/10 dark:hover:text-stone-200"
                  title="清除册子搜索"
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => {
                setIsCreatingOpen((current) => !current);
                cancelEditBook();
                setError(null);
              }}
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-[6px] bg-stone-900 text-sm font-bold text-[#fbf7ed] shadow-[0_12px_26px_rgba(68,64,60,0.14)] transition-all hover:-translate-y-0.5 hover:bg-stone-800 dark:bg-amber-200 dark:text-stone-950 dark:hover:bg-amber-100"
            >
              <Plus size={14} />
              新建灵感册
            </button>
          </div>

          <AnimatePresence initial={false}>
            {isCreatingOpen ? (
              <motion.form
                key="create-book-form"
                onSubmit={handleCreateBook}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-3 overflow-hidden rounded-[8px] border border-stone-900/10 bg-white/45 p-3 shadow-sm dark:border-white/10 dark:bg-white/[0.045]"
              >
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(event) => setNewTitle(event.target.value)}
                    maxLength={80}
                    placeholder="新建灵感册名称"
                    className="h-9 w-full rounded-[6px] border border-stone-900/10 bg-white/70 px-3 text-sm text-stone-900 outline-none placeholder:text-stone-500 focus:border-stone-800/40 dark:border-white/10 dark:bg-white/[0.07] dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-amber-200/50"
                  />
                  <textarea
                    value={newDescription}
                    onChange={(event) => setNewDescription(event.target.value)}
                    maxLength={200}
                    placeholder="描述，可选"
                    className="min-h-[64px] w-full resize-none rounded-[6px] border border-stone-900/10 bg-white/60 px-3 py-2 text-sm text-stone-800 outline-none placeholder:text-stone-500 focus:border-stone-800/30 dark:border-white/10 dark:bg-white/[0.05] dark:text-stone-200 dark:placeholder:text-stone-600 dark:focus:border-amber-200/40"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={isCreating}
                      className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[6px] bg-stone-900 text-xs font-bold text-[#fbf7ed] transition-all hover:bg-stone-800 disabled:cursor-wait disabled:opacity-60 dark:bg-amber-200 dark:text-stone-950 dark:hover:bg-amber-100"
                    >
                      {isCreating ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCreatingOpen(false)}
                      className="grid h-8 w-8 place-items-center rounded-[6px] bg-stone-900/[0.06] text-stone-600 hover:bg-stone-900/[0.10] dark:bg-white/[0.07] dark:text-stone-300 dark:hover:bg-white/[0.12]"
                      title="取消新建"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              </motion.form>
            ) : null}
          </AnimatePresence>

          {selectedBook ? (
            <div className="mb-3 rounded-[8px] border border-stone-900/10 bg-white/35 p-2 dark:border-white/10 dark:bg-white/[0.04]">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-stone-700 dark:text-stone-200">当前册</div>
                  <div className="truncate text-[11px] text-stone-500 dark:text-stone-500">{selectedBook.title}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEditBook(selectedBook)}
                    className="grid h-8 w-8 place-items-center rounded-[6px] bg-stone-900/[0.06] text-stone-600 transition-colors hover:bg-stone-900/[0.10] dark:bg-white/[0.07] dark:text-stone-300 dark:hover:bg-white/[0.12]"
                    title="编辑灵感册"
                  >
                    <Edit3 size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteBook}
                    className="grid h-8 w-8 place-items-center rounded-[6px] border border-red-900/15 bg-red-50 text-red-700 transition-colors hover:bg-red-100 dark:border-red-300/20 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
                    title="删除灵感册"
                  >
                    <Trash size={13} />
                  </button>
                </div>
              </div>

              <AnimatePresence initial={false}>
                {editingBookId === selectedBook.id ? (
                  <motion.form
                    key="edit-book-form"
                    onSubmit={handleUpdateBook}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2 pt-2">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                        maxLength={80}
                        placeholder="灵感册名称"
                        className="h-9 w-full rounded-[6px] border border-stone-900/10 bg-white/70 px-3 text-sm text-stone-900 outline-none placeholder:text-stone-500 focus:border-stone-800/40 dark:border-white/10 dark:bg-white/[0.07] dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-amber-200/50"
                      />
                      <textarea
                        value={editDescription}
                        onChange={(event) => setEditDescription(event.target.value)}
                        maxLength={200}
                        placeholder="描述，可选"
                        className="min-h-[64px] w-full resize-none rounded-[6px] border border-stone-900/10 bg-white/60 px-3 py-2 text-sm text-stone-800 outline-none placeholder:text-stone-500 focus:border-stone-800/30 dark:border-white/10 dark:bg-white/[0.05] dark:text-stone-200 dark:placeholder:text-stone-600 dark:focus:border-amber-200/40"
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={isSavingBook}
                          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[6px] bg-stone-900 text-xs font-bold text-[#fbf7ed] transition-all hover:bg-stone-800 disabled:cursor-wait disabled:opacity-60 dark:bg-amber-200 dark:text-stone-950 dark:hover:bg-amber-100"
                        >
                          {isSavingBook ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                          保存修改
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditBook}
                          className="grid h-8 w-8 place-items-center rounded-[6px] bg-stone-900/[0.06] text-stone-600 hover:bg-stone-900/[0.10] dark:bg-white/[0.07] dark:text-stone-300 dark:hover:bg-white/[0.12]"
                          title="取消编辑"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  </motion.form>
                ) : null}
              </AnimatePresence>
            </div>
          ) : null}

          <div className="space-y-2">
            {filteredBooks.map((book) => (
              <button
                type="button"
                key={book.id}
                onClick={() => {
                  setSelectedBookId(book.id);
                  cancelEditBook();
                }}
                className={`group/book w-full rounded-[8px] border p-3 text-left transition-all ${
                  selectedBookId === book.id
                    ? "border-stone-900/20 bg-white/65 shadow-[0_14px_32px_rgba(68,64,60,0.12)] dark:border-amber-200/45 dark:bg-amber-200/12 dark:shadow-[0_0_28px_rgba(251,191,36,0.12)]"
                    : "border-stone-900/8 bg-white/35 hover:border-stone-900/16 hover:bg-white/55 dark:border-white/8 dark:bg-white/[0.04] dark:hover:border-white/18 dark:hover:bg-white/[0.07]"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="relative mt-0.5 h-12 w-9 shrink-0 overflow-hidden rounded-[3px] border border-stone-900/15 bg-[radial-gradient(circle_at_35%_30%,rgba(68,64,60,0.18),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.8),rgba(214,211,209,0.55))] shadow-inner [clip-path:polygon(0_0,100%_0,100%_82%,80%_100%,0_92%)] dark:border-amber-100/20 dark:bg-gradient-to-br dark:from-amber-200/40 dark:to-stone-800">
                    {book.coverCard ? (
                      <img
                        src={book.coverCard.thumbnailUrl || book.coverCard.imageUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover opacity-90 grayscale-[20%] mix-blend-multiply dark:mix-blend-normal dark:grayscale-0"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-stone-500/60 dark:text-amber-100/30">
                        <ImageIcon size={14} />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">{book.title}</div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-stone-600 dark:text-stone-500">
                      {book.description || "未填写描述"}
                    </div>
                    <div className="mt-2 text-[10px] font-mono text-stone-700/70 dark:text-amber-100/70">{book.cardCount} 条灵感</div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {!isLoadingBooks && books.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-stone-900/15 px-4 py-10 text-center text-sm text-stone-500 dark:border-white/12">
              还没有灵感册。先在左侧新建一本，再从详情页收录灵感。
            </div>
          ) : null}
          {!isLoadingBooks && books.length > 0 && filteredBooks.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-stone-900/15 px-4 py-8 text-center text-sm text-stone-500 dark:border-white/12">
              没有匹配的册子。
            </div>
          ) : null}
        </aside>

        <main className="flex min-w-0 flex-col p-4 md:p-6">
          {selectedBook ? (
            <>
              <div className="mb-5 flex flex-col gap-4 border-b border-stone-900/10 pb-4 dark:border-white/10 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-serif text-xl font-bold italic text-stone-950 dark:text-white">{selectedBook.title}</h3>
                    <span className="rounded-full bg-stone-900/[0.06] px-2 py-1 text-[11px] font-mono text-stone-600 dark:bg-white/[0.07] dark:text-stone-400">
                      共 {total} 条 · 第 {page} / {totalPages} 页
                    </span>
                  </div>
                  {selectedBook.description ? (
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600 dark:text-stone-400">{selectedBook.description}</p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative min-w-[220px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
                    <input
                      type="text"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜索本册灵感"
                      className="h-9 w-full rounded-[6px] border border-stone-900/10 bg-white/60 pl-9 pr-8 text-sm text-stone-900 outline-none placeholder:text-stone-500 focus:border-stone-800/30 dark:border-white/10 dark:bg-white/[0.06] dark:text-stone-100 dark:placeholder:text-stone-600 dark:focus:border-amber-200/40"
                    />
                    {query ? (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-stone-500 hover:bg-stone-900/10 hover:text-stone-900 dark:hover:bg-white/10 dark:hover:text-stone-200"
                        title="清除搜索"
                      >
                        <X size={13} />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              {error ? (
                <div className="mb-4 rounded-[6px] border border-red-900/15 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-300/20 dark:bg-red-500/10 dark:text-red-200">{error}</div>
              ) : null}

              {isLoadingCards ? (
                <div className="flex flex-1 flex-col items-center justify-center py-20 text-stone-500">
                  <Loader2 size={28} className="mb-3 animate-spin text-stone-600/70 dark:text-amber-200/70" />
                  <span className="font-serif text-sm italic">正在翻阅灵感册...</span>
                </div>
              ) : cards.length > 0 ? (
                <>
                  <div className="grid grid-cols-1 gap-6 py-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                    <AnimatePresence initial={false}>
                      {cards.map((card) => (
                        <motion.div
                          key={card.id}
                          layout
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          className="relative pt-6"
                        >
                          <div className="absolute left-4 top-1 z-10 rounded bg-stone-900/85 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#fbf7ed] shadow-sm dark:bg-stone-950/90 dark:text-amber-100">
                            {card.weekId}
                          </div>
                          {selectedCoverCardId === card.id ? (
                            <div className="absolute right-4 top-1 z-20 inline-flex items-center gap-1 rounded-full border border-stone-900/10 bg-[#fbf7ed]/95 px-2 py-0.5 text-[9px] font-bold text-stone-800 shadow-sm dark:border-amber-200/30 dark:bg-amber-200 dark:text-stone-950">
                              <BookmarkCheck size={10} />
                              封面
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSetCover(card)}
                              disabled={card.type === "md" || !card.imageUrl}
                              className="absolute right-4 top-1 z-20 grid h-6 w-6 place-items-center rounded-full border border-stone-900/10 bg-[#fbf7ed]/90 text-stone-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white disabled:pointer-events-none disabled:opacity-40 dark:border-white/10 dark:bg-stone-950/85 dark:text-amber-100 dark:hover:border-amber-200/30"
                              title="设为封面"
                              aria-label="设为封面"
                            >
                              <ImageIcon size={12} />
                            </button>
                          )}
                          <PolaroidCard
                            card={card}
                            onDeleteCard={handleRemoveCard}
                            onDeleteTerm={handleDeleteTerm}
                            onZoom={onZoom}
                            onUpdateTerms={handleUpdateTerms}
                            onBookMembershipChanged={onBookMembershipChanged}
                            deleteCardTitle="从本册移除"
                          />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>

                  <div className="mt-auto flex flex-col items-center justify-between gap-3 border-t border-stone-900/10 pt-4 dark:border-white/10 sm:flex-row">
                    <div className="text-xs font-mono text-stone-500">每页 {BOOK_CARDS_PAGE_SIZE} 条 · 共 {total} 条</div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                        disabled={page <= 1 || isLoadingCards}
                        className="inline-flex h-8 items-center gap-1 rounded-[6px] bg-stone-900/[0.06] px-3 text-xs font-semibold text-stone-600 transition-colors hover:bg-stone-900/[0.10] disabled:pointer-events-none disabled:opacity-40 dark:bg-white/[0.07] dark:text-stone-300 dark:hover:bg-white/[0.12]"
                      >
                        <ChevronLeft size={13} />
                        上一页
                      </button>
                      <span className="min-w-[70px] text-center font-mono text-xs text-stone-500">
                        {page} / {totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                        disabled={page >= totalPages || isLoadingCards}
                        className="inline-flex h-8 items-center gap-1 rounded-[6px] bg-stone-900/[0.06] px-3 text-xs font-semibold text-stone-600 transition-colors hover:bg-stone-900/[0.10] disabled:pointer-events-none disabled:opacity-40 dark:bg-white/[0.07] dark:text-stone-300 dark:hover:bg-white/[0.12]"
                      >
                        下一页
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center rounded-[8px] border border-dashed border-stone-900/15 bg-white/20 px-4 py-20 text-center dark:border-white/12 dark:bg-transparent">
                  <BookOpen size={34} className="mb-3 text-stone-500/45 dark:text-amber-200/35" />
                  <p className="font-serif text-sm italic text-stone-500 dark:text-stone-400">
                    {query ? "本册里没有匹配的灵感。" : "这本灵感册还是空的。打开灵感详情，用书册按钮收录。"}
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center py-20 text-center text-stone-500">
              <BookOpen size={38} className="mb-3 text-stone-500/40 dark:text-amber-200/30" />
              <p className="font-serif text-sm italic">新建一本灵感册，开始整理你的视觉线索。</p>
              {error ? <p className="mt-3 text-sm text-red-700 dark:text-red-200">{error}</p> : null}
            </div>
          )}
        </main>
      </div>
    </motion.section>
  );
}
