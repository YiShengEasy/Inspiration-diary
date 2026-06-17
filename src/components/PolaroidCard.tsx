import React, { useState } from "react";
import { ImageCard } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { Copy, Trash2, X, Check, Plus, Sparkles } from "lucide-react";

interface PolaroidCardProps {
  key?: React.Key;
  card: ImageCard;
  onDeleteCard: (id: string) => void;
  onDeleteTerm: (cardId: string, termIndex: number) => void;
  onZoom: (card: ImageCard) => void;
  onUpdateTerms: (cardId: string, terms: string[]) => void;
}

export default function PolaroidCard({ card, onDeleteCard, onDeleteTerm, onZoom, onUpdateTerms }: PolaroidCardProps) {
  const [isCopied, setIsCopied] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isAddingTerm, setIsAddingTerm] = useState(false);
  const [newTermInput, setNewTermInput] = useState("");

  const handleCopy = (term: string) => {
    navigator.clipboard.writeText(term);
    setIsCopied(term);
    setTimeout(() => {
      setIsCopied(null);
    }, 1500);
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
            {/* The pin plastic head */}
            <div className="w-4 h-4 bg-red-500 rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.3)] border-b border-red-700 relative">
              <div className="absolute top-0.5 left-0.5 w-1.5 h-1.5 bg-white/40 rounded-full" />
            </div>
            {/* The pin shadow / point */}
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
              {/* Jagged ends */}
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-r from-transparent to-amber-100/10 [clip-path:polygon(0%_0%,100%_20%,0%_40%,100%_60%,0%_80%,100%_100%)]" />
              <div className="absolute right-0 top-0 bottom-0 w-1 bg-gradient-to-l from-transparent to-amber-100/10 [clip-path:polygon(100%_0%,0%_20%,100%_40%,0%_60%,100%_80%,0%_100%)]" />
            </div>
          </div>
        );
    }
  };

  return (
    <div
      className="relative flex flex-col items-center gap-3 w-full p-3 rounded-2xl bg-stone-50/20 dark:bg-stone-900/10 border border-stone-150/10 dark:border-stone-800/10 transition-all duration-300 hover:bg-stone-50/40 dark:hover:bg-stone-900/30 group/card"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 1. Polaroid Photo Section */}
      <div className="flex justify-center w-full relative pt-2">
        <div
          className="relative flex-shrink-0 bg-white dark:bg-stone-805 p-2.5 pb-4 shadow-[0_8px_20px_rgba(0,0,0,0.12)] border border-amber-905/5 select-none rounded-[1px] transition-transform duration-300 group-hover/card:scale-[1.03] flex flex-col"
          style={{
            transform: `rotate(${card.angle}deg)`,
            width: "140px",
          }}
        >
          {renderDecoration()}

          {/* Polaroid Picture */}
          <div
            onClick={() => onZoom(card)}
            className="relative aspect-square w-full overflow-hidden bg-stone-100 dark:bg-stone-900 border border-black/5 shadow-inner cursor-zoom-in hover:brightness-95 transition-all"
            title="点击放大查看原图"
          >
            <img
              src={card.imageUrl}
              alt="Snippet Inspiration"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover select-none pointer-events-none"
            />
            {/* Overlay shine/scratch decoration for warm analog look */}
            <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/5 to-white/10 pointer-events-none" />
          </div>

          {/* Delete button of entire Polaroid card */}
          <button
            onClick={() => onDeleteCard(card.id)}
            className="absolute bottom-1 right-2 opacity-0 group-hover/card:opacity-100 text-stone-400 hover:text-red-600 transition-opacity p-0.5 cursor-pointer z-10"
            title="删除这张相片卡"
          >
            <Trash2 size={13} />
          </button>

          {/* Polaroid caption - handwriting signature of timestamp */}
          <div className="mt-2 text-center text-[10px] font-handwritten text-stone-500 tracking-wide truncate">
            {new Date(card.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>

      {/* 2. Bottom Section: Beautiful Terminology Labels */}
      <div className="w-full mt-1.5 px-0.5 flex flex-col gap-2">
        {/* Title or indicator for tags */}
        <div className="flex items-center justify-between text-[11px] font-medium text-stone-600 dark:text-stone-350 select-none">
          <span className="font-serif italic text-amber-900/60 dark:text-amber-300/60 font-semibold flex items-center gap-1">
            <Sparkles size={11} className="text-amber-600 dark:text-amber-400" />
            <span>灵感词</span>
          </span>
          {card.terms.length > 0 && (
            <span className="text-[9px] font-mono text-stone-400 dark:text-stone-500">
              共 {card.terms.length} 个
            </span>
          )}
        </div>

        {/* Tags flex container - clean, readable, no vertical squishing */}
        <div className="flex flex-wrap gap-1 p-2 rounded-xl bg-amber-500/5 dark:bg-stone-950/40 border border-amber-900/5 dark:border-white/5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.01)] min-h-[36px] items-center">
          {card.terms.map((term, index) => (
            <div
              key={`${term}-${index}`}
              className="group/single-tag relative inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-200 border border-stone-200/70 dark:border-stone-700/60 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all hover:bg-amber-500/[0.04] dark:hover:bg-amber-500/[0.05] hover:border-amber-500/30"
            >
              {/* Tag content clickable to copy */}
              <span
                onClick={() => handleCopy(term)}
                className="cursor-pointer font-sans select-all active:text-amber-600 truncate max-w-[120px]"
                title="点击复制此词语"
              >
                {term}
              </span>

              {/* Copied checkmark / copy tool icon */}
              {isCopied === term ? (
                <Check size={9} className="text-emerald-600 flex-shrink-0" />
              ) : (
                <Copy
                  size={8}
                  className="opacity-0 group-hover/single-tag:opacity-50 text-stone-400 hover:text-amber-800 dark:hover:text-amber-300 flex-shrink-0 cursor-pointer transition-opacity"
                  onClick={() => handleCopy(term)}
                  title="复制"
                />
              )}

              {/* Delete tag button (X) */}
              <button
                onClick={() => onDeleteTerm(card.id, index)}
                className="inline-flex items-center justify-center w-3 h-3 rounded hover:bg-red-50 dark:hover:bg-red-950/80 text-stone-400 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer ml-0.5"
                title="删除关键词"
              >
                <X size={8} />
              </button>
            </div>
          ))}

          {card.terms.length === 0 && !isAddingTerm && (
            <span className="text-[10px] font-serif italic text-stone-400 dark:text-stone-500 py-1 w-full text-center">
              暂无灵感，轻点右下角添加
            </span>
          )}

          {/* Inline custom keyword insertion input/button */}
          {isAddingTerm ? (
            <form
              onSubmit={handleAddCustomTerm}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded-md bg-amber-50/50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-300 border border-amber-500/40 dark:border-amber-500/40 shadow-sm transition-all"
            >
              <input
                type="text"
                value={newTermInput}
                onChange={(e) => setNewTermInput(e.target.value)}
                placeholder="键入创意词..."
                className="text-[11px] outline-none border-none bg-transparent w-16 text-amber-900 dark:text-amber-200 p-0 placeholder-amber-900/40 dark:placeholder-amber-300/40 font-sans focus:ring-0 h-4"
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
              <button type="submit" className="hidden" />
            </form>
          ) : (
            <button
              onClick={() => setIsAddingTerm(true)}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-medium rounded-md border border-dashed border-amber-500/40 dark:border-amber-500/30 bg-transparent text-amber-800 dark:text-amber-400 hover:bg-amber-500/5 hover:border-amber-500/70 transition-all cursor-pointer shadow-sm select-none ml-auto"
            >
              <Plus size={8} />
              <span>新加词</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
