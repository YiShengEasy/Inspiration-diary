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
      className="absolute right-0 top-8 z-50 w-[260px] overflow-hidden rounded-[8px] border border-white/15 bg-stone-950/90 text-stone-100 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.06] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-amber-300/15 text-amber-200">
            <BookOpen size={14} />
          </span>
          <div>
            <div className="text-[12px] font-semibold leading-tight">收录成册</div>
            <div className="text-[10px] text-stone-400">已加入 {selectedCount} 个灵感册</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-stone-400 transition-colors hover:bg-white/10 hover:text-stone-100"
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>

      <div className="max-h-[188px] overflow-y-auto px-2 py-2">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-stone-400">
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
                className="group/book flex w-full items-center gap-2 rounded-[6px] border border-transparent px-2 py-2 text-left transition-all hover:border-amber-200/20 hover:bg-white/[0.07] disabled:cursor-wait disabled:opacity-70"
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition-all ${
                    book.containsCard
                      ? "border-amber-300 bg-amber-300 text-stone-950 shadow-[0_0_18px_rgba(252,211,77,0.28)]"
                      : "border-stone-600 bg-stone-900/80 text-transparent group-hover/book:border-stone-400"
                  }`}
                >
                  <Check size={11} strokeWidth={3} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-stone-100">{book.title}</span>
                  <span className="block truncate text-[10px] text-stone-500">
                    {book.description || `${book.cardCount} 条灵感`}
                  </span>
                </span>
                {busyBookId === book.id ? (
                  <Loader2 size={13} className="shrink-0 animate-spin text-amber-200" />
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-[6px] border border-dashed border-white/10 px-3 py-5 text-center text-[12px] text-stone-400">
            还没有灵感册
          </div>
        )}
      </div>

      <form onSubmit={handleCreateBook} className="space-y-2 border-t border-white/10 bg-black/15 px-3 py-3">
        <input
          type="text"
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          maxLength={80}
          placeholder="新建灵感册"
          className="h-8 w-full rounded-[6px] border border-white/10 bg-white/[0.06] px-2 text-[12px] text-stone-100 outline-none transition-colors placeholder:text-stone-500 focus:border-amber-200/50"
        />
        <input
          type="text"
          value={newDescription}
          onChange={(event) => setNewDescription(event.target.value)}
          maxLength={200}
          placeholder="描述，可选"
          className="h-7 w-full rounded-[6px] border border-white/10 bg-white/[0.04] px-2 text-[11px] text-stone-200 outline-none transition-colors placeholder:text-stone-600 focus:border-amber-200/40"
        />
        {error ? <div className="text-[11px] leading-snug text-red-300">{error}</div> : null}
        <button
          type="submit"
          disabled={isCreating}
          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[6px] bg-amber-200 text-[12px] font-semibold text-stone-950 shadow-[0_10px_24px_rgba(252,211,77,0.18)] transition-transform hover:-translate-y-0.5 hover:bg-amber-100 disabled:translate-y-0 disabled:cursor-wait disabled:opacity-70"
        >
          {isCreating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          新建并收录
        </button>
      </form>
    </div>
  );
}
