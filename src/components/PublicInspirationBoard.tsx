import React, { useState, useEffect } from "react";
import { Copy, Heart, X, Search, Sparkles, Globe, Compass } from "lucide-react";
import { ImageCard } from "../types";
import { subscribePublicCards, likeCard } from "../lib/dbClient";
import { motion, AnimatePresence } from "motion/react";
import PolaroidCard from "./PolaroidCard"; // We will make a simplified read-only version if we want, or just reuse PolaroidCard

interface PublicInspirationBoardProps {
  onClose: () => void;
  onZoom: (card: ImageCard) => void;
}

export default function PublicInspirationBoard({ onClose, onZoom }: PublicInspirationBoardProps) {
  const [publicCards, setPublicCards] = useState<ImageCard[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const unsub = subscribePublicCards((cards) => {
      setPublicCards(cards);
      setIsLoaded(true);
    });
    return () => unsub();
  }, []);

  const handleLike = async (card: ImageCard) => {
    // Optimistic UI update could be added here, handled by DB real-time stream mostly
    await likeCard(card.id, card.likes || 0);
  };

  const filteredCards = publicCards.filter(c => {
    if(!searchTerm) return true;
    return c.terms.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()));
  });

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-md"
      >
        <div className="relative w-full max-w-6xl h-[85vh] bg-stone-100 dark:bg-stone-900 rounded-3xl shadow-2xl overflow-hidden border border-stone-200 dark:border-stone-800 flex flex-col">
          
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-stone-200 dark:border-stone-800 bg-white/50 dark:bg-stone-900/50 backdrop-blur-xl shrink-0">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-2xl shadow-inner">
                <Compass size={24} className="animate-[spin_4s_linear_infinite]" />
              </div>
              <div>
                <h2 className="text-2xl font-serif font-bold text-stone-800 dark:text-stone-100">灵感漫游</h2>
                <p className="text-xs text-stone-500 dark:text-stone-400 mt-1 font-mono tracking-wider">Public Inspiration Gallery</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input 
                  type="text" 
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="探索关键词..." 
                  className="pl-9 pr-4 py-2 w-48 text-sm outline-none border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 rounded-full focus:ring-2 focus:ring-emerald-500/30 transition-all font-mono"
                />
              </div>
              <button
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-stone-200 dark:bg-stone-800 hover:bg-stone-300 dark:hover:bg-stone-700 text-stone-600 dark:text-stone-300 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Canvas area */}
          <div className="flex-1 overflow-y-auto p-8 layout-scroll">
            {!isLoaded ? (
              <div className="flex items-center justify-center h-full">
                <Sparkles className="animate-pulse text-stone-300 dark:text-stone-700" size={40} />
              </div>
            ) : filteredCards.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-stone-400 font-handwritten">
                <Globe size={48} className="mb-4 opacity-20" />
                <p className="text-lg">星海茫茫，暂未寻得关于 "{searchTerm}" 的公共足迹</p>
              </div>
            ) : (
              <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-6 gap-y-12">
                {filteredCards.map((card, idx) => {
                  // Generate stable dummy rotation based on their id
                  const idString = String(card.id);
                  let hash = 0;
                  for (let i = 0; i < idString.length; i++) {
                    hash += idString.charCodeAt(i);
                  }
                  const randomAngle = (hash % 10) - 5; // -5 to 5 degrees
                  const tiltOffset = (hash % 14) - 7;
                  
                  return (
                  <motion.div 
                    key={card.id}
                    initial={{ opacity: 0, y: 30, rotate: 0 }}
                    animate={{ opacity: 1, y: 0, rotate: randomAngle }}
                    whileHover={{ scale: 1.05, rotate: randomAngle + 2, zIndex: 10 }}
                    transition={{ delay: idx * 0.05, type: "spring" }}
                    className="break-inside-avoid relative group mb-8 inline-block w-full cursor-pointer"
                    style={{
                       transformOrigin: "center center",
                    }}
                  >
                    <div className="absolute -top-3 -right-3 z-50 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleLike(card); }}
                        className="flex items-center gap-1.5 px-2 py-1 bg-rose-100 hover:bg-rose-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-rose-500 dark:text-rose-400 rounded-full shadow-lg border border-rose-200 dark:border-stone-600 transition-all active:scale-95"
                      >
                        <Heart size={14} className={card.likes ? "fill-current" : ""} />
                        <span className="text-xs font-mono font-bold leading-none">{card.likes || 0}</span>
                      </button>
                    </div>
                    {/* Readonly styled photo */}
                    <div className="relative w-full bg-white dark:bg-stone-800 p-3 pb-4 shadow-[0_8px_20px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_25px_rgba(0,0,0,0.6)] border border-stone-200 dark:border-stone-700 rounded-[3px]">
                        
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-4 z-30 pointer-events-none select-none">
                        <div className={`w-12 h-6 bg-emerald-100/60 border-b border-emerald-200/40 backdrop-blur-[1px] shadow-sm transform-gpu transition-all ${tiltOffset > 0 ? "rotate-2" : "-rotate-2"}`} />
                      </div>

                      <div 
                        onClick={() => onZoom(card)}
                        className="relative w-full aspect-auto overflow-hidden bg-stone-100 dark:bg-stone-900 border border-black/5 hover:brightness-95 transition-all"
                      >
                        <img 
                          src={card.imageUrl} 
                          alt="public" 
                          referrerPolicy="no-referrer"
                          className="w-full h-auto object-cover select-none pointer-events-none block" 
                        />
                      </div>
                      <div className="mt-4 min-h-[30px] flex flex-wrap gap-1">
                        {card.terms.slice(0,4).map((t, i) => (
                           <span key={i} className="text-[10px] text-stone-500 dark:text-stone-400 font-handwritten px-1">#{t}</span>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )})}
              </div>
            )}
          </div>
          
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
