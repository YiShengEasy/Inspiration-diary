import React, { useState } from "react";
import { ImageCard } from "../types";
import { X, Plus } from "lucide-react";

interface PolaroidCardProps {
  key?: React.Key;
  card: ImageCard;
  onDeleteCard: (id: string) => void;
  onDeleteTerm: (cardId: string, termIndex: number) => void;
  onZoom: (card: ImageCard) => void;
  onUpdateTerms: (cardId: string, terms: string[]) => void;
}

export default function PolaroidCard({ card, onDeleteCard, onDeleteTerm, onZoom, onUpdateTerms }: PolaroidCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isAddingTerm, setIsAddingTerm] = useState(false);
  const [newTermInput, setNewTermInput] = useState("");

  const handleCopy = (term: string) => {
    navigator.clipboard.writeText(term);
  };

  const handleAddCustomTerm = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newTermInput.trim();
    if (trimmed && !card.terms.includes(trimmed)) {
      onUpdateTerms(card.id, [...card.terms, trimmed]);
      setNewTermInput("");
    }
    setIsAddingTerm(false);
  };

  // Render the skeuomorphic decoration at the top of the photo
  const renderDecoration = () => {
    switch (card.decoType) {
      case "pin":
        return (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-3 z-30 pointer-events-none flex flex-col items-center">
            <div className="w-4 h-4 bg-red-500 rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.3)] border-b border-red-700 relative">
              <div className="absolute top-0.5 left-0.5 w-1.5 h-1.5 bg-white/40 rounded-full" />
            </div>
            <div className="w-0.5 h-1.5 bg-stone-600 opacity-80" />
          </div>
        );
      case "paperclip":
        return (
          <div className="absolute top-0 left-4 -translate-y-4 z-30 pointer-events-none rotate-[-12deg]">
            <div className="w-5 h-12 border-2 border-amber-800/20 rounded-full bg-slate-300/30 backdrop-blur-[1px] relative shadow-[1px_2px_2px_rgba(0,0,0,0.15)] flex justify-center">
              <div className="absolute top-1 bottom-1 w-3 border border-slate-400/40 rounded-full" />
            </div>
          </div>
        );
      case "washi":
        return (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-3.5 z-30 pointer-events-none rotate-[2deg] shadow-sm select-none">
            <div className="px-5 py-1 bg-gradient-to-r from-teal-200/60 to-emerald-200/60 backdrop-blur-[0.5px] border-x border-dashed border-teal-300 text-[8px] font-handwritten tracking-wider text-teal-800 uppercase select-none">
              ★ journaling ★
            </div>
          </div>
        );
      case "tape":
      default:
        return (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-4 z-30 pointer-events-none rotate-[-4deg] select-none shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            <div className="w-16 h-6 bg-amber-100/70 border-b border-amber-200/40 backdrop-blur-[1px] relative">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-r from-transparent to-amber-100/10 [clip-path:polygon(0%_0%,100%_20%,0%_40%,100%_60%,0%_80%,100%_100%)]" />
              <div className="absolute right-0 top-0 bottom-0 w-1 bg-gradient-to-l from-transparent to-amber-100/10 [clip-path:polygon(100%_0%,0%_20%,100%_40%,0%_60%,100%_80%,0%_100%)]" />
            </div>
          </div>
        );
    }
  };

  return (
    <div
      className="relative flex justify-center w-full group/card transition-all duration-300 w-full"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="relative w-full max-w-[170px] bg-white dark:bg-stone-800 p-2.5 pb-2 shadow-[0_8px_20px_rgba(0,0,0,0.12)] dark:shadow-[0_12px_25px_rgba(0,0,0,0.8)] border border-amber-900/5 dark:border-stone-600/70 select-none rounded-[2px] transition-transform duration-300 flex flex-col"
      >
        {renderDecoration()}

        {/* Polaroid Picture or Markdown clipping */}
        {card.type === "md" ? (
          <div
            onClick={() => onZoom(card)}
            className="relative aspect-square w-full overflow-hidden bg-stone-50 dark:bg-stone-900 border border-stone-200/50 dark:border-stone-700/50 shadow-inner cursor-zoom-in hover:bg-stone-100 dark:hover:bg-stone-800 transition-all flex flex-col p-2 select-none"
            title="查看完整文档"
          >
            <div
              className="flex-1 overflow-hidden"
              style={{
                maskImage: "linear-gradient(to bottom, black 52%, transparent 100%)",
                WebkitMaskImage: "linear-gradient(to bottom, black 52%, transparent 100%)",
              }}
            >
              <h4 className="text-[11px] font-semibold text-stone-800 dark:text-stone-200 mb-1 leading-tight break-words font-serif">
                {card.mdName || "Markdown Note"}
              </h4>
              <p className="text-[9px] text-stone-500 dark:text-stone-400 font-sans leading-relaxed">
                {card.mdSummary || card.mdContent || "点击查看完整手稿。"}
              </p>
            </div>
            <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/5 to-white/10 pointer-events-none" />
          </div>
        ) : (
          <div
            onClick={() => onZoom(card)}
            className="relative aspect-square w-full overflow-hidden bg-stone-100 dark:bg-stone-900 border border-black/5 shadow-inner cursor-zoom-in hover:brightness-95 transition-all"
            title="点击放大查看原图"
          >
            <img
              src={card.thumbnailUrl || card.imageUrl}
              alt="Snippet Inspiration"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover select-none pointer-events-none"
            />
            <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/5 to-white/10 pointer-events-none" />
          </div>
        )}

        {/* Delete button of entire Polaroid card */}
        <button
          onClick={() => onDeleteCard(card.id)}
          className="absolute -top-2 -right-2 opacity-0 group-hover/card:opacity-100 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-500 dark:text-stone-400 hover:text-red-500 dark:hover:text-red-400 rounded-full p-1.5 transition-all cursor-pointer z-40 shadow-sm border border-stone-200 dark:border-stone-700"
          title="删除这张相片卡"
        >
          <X size={12} strokeWidth={2.5} />
        </button>

        {/* Polaroid Bottom Margin (Writable Area) with terms */}
        <div className="mt-2.5 min-h-[40px] flex flex-col w-full relative z-20 bg-white/50 dark:bg-stone-800/50">
          <div className="flex flex-wrap gap-x-1.5 gap-y-1 items-center justify-start pointer-events-auto">
            {card.terms.map((term, index) => (
              <div
                key={`${term}-${index}`}
                className="group/tag inline-flex items-center text-[10px] sm:text-[11px] font-handwritten text-stone-600 dark:text-stone-300 relative leading-tight"
              >
                <span
                  onClick={() => handleCopy(term)}
                  className="cursor-pointer hover:text-amber-600 transition-colors"
                  title="点击复制"
                >
                  #{term}
                </span>
                <button
                  onClick={() => onDeleteTerm(card.id, index)}
                  className="opacity-0 group-hover/tag:opacity-100 text-red-400 hover:text-red-600 cursor-pointer ml-0.5 transition-opacity"
                  title="删除"
                >
                  <X size={8} />
                </button>
              </div>
            ))}

            {/* Custom Add Term */}
            {isAddingTerm ? (
              <form
                onSubmit={handleAddCustomTerm}
                className="inline-flex items-center w-full mt-1"
              >
                <input
                  type="text"
                  value={newTermInput}
                  onChange={(e) => setNewTermInput(e.target.value)}
                  placeholder="..."
                  className="text-[11px] outline-none border-b border-stone-300 dark:border-stone-600 bg-transparent w-full text-stone-700 dark:text-stone-300 p-0 font-handwritten focus:ring-0 h-4"
                  autoFocus
                  onBlur={() => {
                    setTimeout(() => {
                      const trimmed = newTermInput.trim();
                      if (trimmed && !card.terms.includes(trimmed)) {
                        onUpdateTerms(card.id, [...card.terms, trimmed]);
                        setNewTermInput("");
                      }
                      setIsAddingTerm(false);
                    }, 120);
                  }}
                />
              </form>
            ) : (
              <button
                onClick={() => setIsAddingTerm(true)}
                className="opacity-0 group-hover/card:opacity-100 inline-flex items-center text-stone-300 hover:text-stone-500 cursor-pointer transition-opacity ml-1"
                title="添加灵感词"
              >
                <Plus size={10} />
              </button>
            )}
          </div>
          
          <div className="mt-1 text-right text-[8px] font-mono text-stone-300 dark:text-stone-600 select-none">
            {new Date(card.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    </div>
  );
}
