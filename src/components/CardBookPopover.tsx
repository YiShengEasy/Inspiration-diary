import React, { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, Loader2, Plus, X } from "lucide-react";
import type { CardBookMembership } from "../types";
import { createBook, loadCardBookMembership, setCardBookMembership } from "../lib/booksClient";

interface CardBookPopoverProps {
  cardId: string;
  onClose: () => void;
  onChanged?: () => void;
}

export default function CardBookPopover({ cardId, onClose, onChanged }: CardBookPopoverProps) {
  const [books, setBooks] = useState<CardBookMembership[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyBookId, setBusyBookId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCount = useMemo(() => books.filter((book) => book.containsCard).length, [books]);

  useEffect(() => {
    let isAlive = true;

    async function loadMembership() {
      setIsLoading(true);
      setError(null);
      try {
        const nextBooks = await loadCardBookMembership(cardId);
        if (isAlive) {
          setBooks(nextBooks);
        }
      } catch (err) {
        if (isAlive) {
          setError(err instanceof Error ? err.message : "灵感册加载失败");
        }
      } finally {
        if (isAlive) {
          setIsLoading(false);
        }
      }
    }

    loadMembership();

    return () => {
      isAlive = false;
    };
  }, [cardId]);

  const notifyChanged = () => {
    onChanged?.();
  };

  const handleToggleBook = async (book: CardBookMembership) => {
    const nextValue = !book.containsCard;
    setBusyBookId(book.id);
    setError(null);
    setBooks((current) =>
      current.map((item) =>
        item.id === book.id
          ? {
              ...item,
              containsCard: nextValue,
              cardCount: Math.max(0, item.cardCount + (nextValue ? 1 : -1)),
            }
          : item,
      ),
    );

    try {
      await setCardBookMembership(cardId, book.id, nextValue);
      notifyChanged();
    } catch (err) {
      setBooks((current) =>
        current.map((item) =>
          item.id === book.id
            ? {
                ...item,
                containsCard: book.containsCard,
                cardCount: book.cardCount,
              }
            : item,
        ),
      );
      setError(err instanceof Error ? err.message : "收录状态更新失败");
    } finally {
      setBusyBookId(null);
    }
  };

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
      const createdBook = await createBook({ title, description });
      await setCardBookMembership(cardId, createdBook.id, true);
      setBooks((current) => [
        {
          id: createdBook.id,
          title: createdBook.title,
          description: createdBook.description,
          cardCount: Math.max(1, createdBook.cardCount + 1),
          containsCard: true,
        },
        ...current,
      ]);
      setNewTitle("");
      setNewDescription("");
      notifyChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "灵感册创建失败");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div
      className="absolute right-0 top-10 z-50 w-[280px] overflow-hidden rounded-[8px] border border-stone-900/10 bg-[#fbf7ed]/95 text-stone-900 shadow-[0_18px_44px_rgba(55,48,37,0.18)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 dark:border-white/15 dark:bg-stone-950/90 dark:text-stone-100 dark:shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(68,64,60,0.14),transparent_24%),radial-gradient(circle_at_82%_72%,rgba(120,113,108,0.10),transparent_26%),linear-gradient(120deg,rgba(0,0,0,0.035)_1px,transparent_1px)] bg-[size:auto,auto,18px_18px] opacity-80 dark:bg-[radial-gradient(circle_at_20%_0%,rgba(251,191,36,0.16),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] dark:opacity-100" />
      <div className="relative flex items-center justify-between border-b border-stone-900/10 bg-white/35 px-3 py-2 dark:border-white/10 dark:bg-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full border border-stone-900/10 bg-stone-900/[0.06] text-stone-700 dark:border-transparent dark:bg-amber-300/15 dark:text-amber-200">
            <BookOpen size={14} />
          </span>
          <div>
            <div className="text-[12px] font-semibold leading-tight">收录成册</div>
            <div className="text-[10px] text-stone-600 dark:text-stone-400">已加入 {selectedCount} 个灵感册</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-stone-500 transition-colors hover:bg-stone-900/10 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-white/10 dark:hover:text-stone-100"
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>

      <div className="relative max-h-[188px] overflow-y-auto px-2 py-2">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-stone-500 dark:text-stone-400">
            <Loader2 size={14} className="animate-spin" />
            正在读取灵感册
          </div>
        ) : books.length > 0 ? (
          <div className="space-y-1">
            {books.map((book) => (
              <button
                type="button"
                key={book.id}
                disabled={busyBookId === book.id}
                onClick={() => handleToggleBook(book)}
                className="group/book flex w-full items-center gap-2 rounded-[6px] border border-transparent px-2 py-2 text-left transition-all hover:border-stone-900/10 hover:bg-stone-900/[0.04] disabled:cursor-wait disabled:opacity-70 dark:hover:border-amber-200/20 dark:hover:bg-white/[0.07]"
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition-all ${
                    book.containsCard
                      ? "border-stone-800 bg-stone-800 text-[#fbf7ed] shadow-[0_0_18px_rgba(68,64,60,0.16)] dark:border-amber-300 dark:bg-amber-300 dark:text-stone-950 dark:shadow-[0_0_18px_rgba(252,211,77,0.28)]"
                      : "border-stone-400 bg-white/40 text-transparent group-hover/book:border-stone-700 dark:border-stone-600 dark:bg-stone-900/80 dark:group-hover/book:border-stone-400"
                  }`}
                >
                  <Check size={11} strokeWidth={3} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-stone-900 dark:text-stone-100">{book.title}</span>
                  <span className="block truncate text-[10px] text-stone-600 dark:text-stone-500">
                    {book.description || `${book.cardCount} 条灵感`}
                  </span>
                </span>
                {busyBookId === book.id ? (
                  <Loader2 size={13} className="shrink-0 animate-spin text-stone-600 dark:text-amber-200" />
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-[6px] border border-dashed border-stone-900/15 px-3 py-5 text-center text-[12px] text-stone-500 dark:border-white/10 dark:text-stone-400">
            还没有灵感册
          </div>
        )}
      </div>

      <form onSubmit={handleCreateBook} className="relative space-y-2 border-t border-stone-900/10 bg-white/30 px-3 py-3 dark:border-white/10 dark:bg-black/15">
        <input
          type="text"
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          maxLength={80}
          placeholder="新建灵感册"
          className="h-8 w-full rounded-[6px] border border-stone-900/10 bg-white/60 px-2 text-[12px] text-stone-900 outline-none transition-colors placeholder:text-stone-500 focus:border-stone-800/40 dark:border-white/10 dark:bg-white/[0.06] dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-amber-200/50"
        />
        <input
          type="text"
          value={newDescription}
          onChange={(event) => setNewDescription(event.target.value)}
          maxLength={200}
          placeholder="描述，可选"
          className="h-7 w-full rounded-[6px] border border-stone-900/10 bg-white/50 px-2 text-[11px] text-stone-800 outline-none transition-colors placeholder:text-stone-500 focus:border-stone-800/30 dark:border-white/10 dark:bg-white/[0.04] dark:text-stone-200 dark:placeholder:text-stone-600 dark:focus:border-amber-200/40"
        />
        {error ? <div className="text-[11px] leading-snug text-red-700 dark:text-red-300">{error}</div> : null}
        <button
          type="submit"
          disabled={isCreating}
          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[6px] bg-stone-900 text-[12px] font-semibold text-[#fbf7ed] shadow-[0_10px_24px_rgba(68,64,60,0.16)] transition-transform hover:-translate-y-0.5 hover:bg-stone-800 disabled:translate-y-0 disabled:cursor-wait disabled:opacity-70 dark:bg-amber-200 dark:text-stone-950 dark:shadow-[0_10px_24px_rgba(252,211,77,0.18)] dark:hover:bg-amber-100"
        >
          {isCreating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          新建并收录
        </button>
      </form>
    </div>
  );
}
