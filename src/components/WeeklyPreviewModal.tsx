import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import { MasonryGrid } from "./ui/masonry-grid";
import { ImageCard } from "../types";
import { motion, AnimatePresence } from "motion/react";

interface WeeklyPreviewModalProps {
  cards: ImageCard[];
  onClose: () => void;
  weekRangeStr: string;
}

export function WeeklyPreviewModal({ cards, onClose, weekRangeStr }: WeeklyPreviewModalProps) {
  const [columns, setColumns] = useState(4);

  const getColumns = (width: number) => {
    if (width < 640) return 1;    // sm
    if (width < 1024) return 2;   // lg
    if (width < 1280) return 3;   // xl
    return 4;                     // 2xl and up
  };

  useEffect(() => {
    const handleResize = () => setColumns(getColumns(window.innerWidth));
    handleResize(); 
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-stone-900/60 backdrop-blur-md"
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative w-full max-w-6xl max-h-[90vh] bg-stone-100 dark:bg-stone-900 rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-amber-900/10 dark:border-stone-700/50"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 pb-4 border-b border-amber-900/5 dark:border-stone-700/30">
            <div>
              <h2 className="text-2xl font-bold font-sans text-stone-800 dark:text-stone-100 mb-1">Weekly Collection</h2>
              <p className="text-sm text-stone-500 dark:text-stone-400 font-mono">{weekRangeStr}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-stone-200 dark:hover:bg-stone-800 text-stone-500 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 md:p-8">
            {cards.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-stone-400 font-handwritten">
                No images recorded this week.
              </div>
            ) : (
              <MasonryGrid columns={columns} gap={6}>
                {cards.map((card) => (
                  <div
                    key={card.id}
                    className="relative rounded-2xl overflow-hidden bg-white dark:bg-stone-800 shadow-md transform transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 hover:shadow-xl group"
                  >
                    {card.type === "md" ? (
                      <div className="min-h-48 p-5 bg-stone-50 dark:bg-stone-950 text-stone-700 dark:text-stone-200">
                        <h3 className="font-serif font-bold text-base leading-tight mb-3">
                          {card.mdName || "Markdown Note"}
                        </h3>
                        <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                          {card.mdSummary || card.mdContent || "点击卡片查看完整手稿。"}
                        </p>
                      </div>
                    ) : (
                      <img
                        src={card.thumbnailUrl || card.imageUrl}
                        alt="Weekly memory"
                        className="w-full h-auto object-cover"
                        loading="lazy"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
                      <div className="flex flex-wrap gap-1.5">
                        {card.terms?.slice(0, 4).map((t: string, i: number) => (
                          <span
                            key={i}
                            className="bg-black/50 backdrop-blur-sm text-white border border-white/20 px-2 py-0.5 rounded text-[10px] font-sans"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </MasonryGrid>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
