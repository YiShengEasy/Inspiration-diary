import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Calendar, Globe, Sparkles, Brush } from "lucide-react";

function InkTabBackground() {
  return (
    <motion.div 
      layoutId="ink-tab-background"
      className="absolute inset-0 z-0 overflow-hidden pointer-events-none"
      transition={{ 
        layout: { type: "spring", stiffness: 100, damping: 15, mass: 1.2 }
      }}
      style={{ borderRadius: "12px" }}
    >
      <motion.div
        className="absolute inset-0 bg-stone-200/80 dark:bg-stone-800/60 filter blur-[1px]"
        animate={{ 
          borderRadius: ["40% 60% 70% 30%", "60% 40% 30% 70%", "30% 70% 60% 40%", "40% 60% 70% 30%"]
        }}
        transition={{ 
          borderRadius: { repeat: Infinity, duration: 4, ease: "easeInOut" }
        }}
      />
      
      {/* Ink splashes flying to the right - we keep these in the background but continuous */}
      <motion.div
        className="absolute top-1/2 -translate-y-1/2 w-2 h-2 bg-stone-300 dark:bg-stone-600 rounded-full filter blur-[1px]"
        animate={{ x: ["-20%", "120%"], opacity: [0, 1, 0], scale: [1, 2, 0] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut", repeatDelay: 1 }}
      />
      <motion.div
        className="absolute bottom-1/4 w-1.5 h-1.5 bg-stone-300 dark:bg-stone-600 rounded-full filter blur-[1px]"
        animate={{ x: ["-10%", "110%"], opacity: [0, 1, 0], scale: [1, 1.5, 0] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut", delay: 0.4, repeatDelay: 1.5 }}
      />
    </motion.div>
  );
}

export function InkTabs({ 
  activeTab, 
  onTabChange, 
  totalCards,
  onOpenUniverse,
  onOpenRoaming
}: { 
  activeTab: "current" | "all"; 
  onTabChange: (tab: "current" | "all") => void; 
  totalCards: number;
  onOpenUniverse?: () => void;
  onOpenRoaming?: () => void;
}) {
  return (
    <div className="relative flex items-center gap-2 md:gap-4 pb-3 pt-2">
      <button
        onClick={() => onTabChange("current")}
        className={`relative px-4 py-2 text-sm md:text-base font-serif tracking-widest transition-colors duration-500 rounded-lg ${
           activeTab === "current" ? "text-stone-900 dark:text-stone-100 font-bold" : "text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
        }`}
      >
        <div className="relative z-10 flex items-center gap-2">
           <Calendar size={16} className={activeTab === "current" ? "opacity-90" : "opacity-50"} />
           <span>此刻灵光</span>
        </div>
        {activeTab === "current" && <InkTabBackground />}
      </button>

      {/* Decorative vertical separator */}
      <div className="h-4 w-[1px] bg-gradient-to-b from-transparent via-stone-300 dark:via-stone-700 to-transparent opacity-50 mx-2" />

      <button
        onClick={() => onTabChange("all")}
        className={`relative px-4 py-2 text-sm md:text-base font-serif tracking-widest transition-colors duration-500 rounded-lg ${
           activeTab === "all" ? "text-stone-900 dark:text-stone-100 font-bold" : "text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
        }`}
      >
        <div className="relative z-10 flex items-center gap-2">
           <Globe size={16} className={activeTab === "all" ? "opacity-90" : "opacity-50"} />
           <span>岁月长卷 <span className="text-xs opacity-70">({totalCards})</span></span>
        </div>
        {activeTab === "all" && <InkTabBackground />}
      </button>

      {/* The trailing small icon portals */}
      {onOpenUniverse && onOpenRoaming && (
        <>
          <div className="h-4 w-[1px] bg-gradient-to-b from-transparent via-stone-300 dark:via-stone-700 to-transparent opacity-50 mx-2" />
          
          <div className="flex items-center gap-2">
             <button
               onClick={onOpenUniverse}
               title="灵感宇宙"
               className="relative group p-2 text-stone-400 hover:text-stone-800 dark:text-stone-500 dark:hover:text-stone-200 transition-colors"
             >
                <motion.div
                   whileHover={{ rotate: 180, scale: 1.2 }}
                   transition={{ duration: 0.8, type: "spring" }}
                >
                   <Sparkles size={18} />
                </motion.div>
                {/* little ink drop background on hover */}
                <div className="absolute inset-0 bg-stone-200/50 dark:bg-stone-800/50 rounded-full blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10" />
             </button>

             <button
               onClick={onOpenRoaming}
               title="灵感漫游"
               className="relative group p-2 text-stone-400 hover:text-stone-800 dark:text-stone-500 dark:hover:text-stone-200 transition-colors"
             >
                <motion.div
                   whileHover={{ rotate: -15, scale: 1.15, y: -2 }}
                   transition={{ duration: 0.5, type: "spring" }}
                >
                   <Brush size={18} />
                </motion.div>
                <div className="absolute inset-0 bg-stone-200/50 dark:bg-stone-800/50 rounded-full blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10" />
             </button>
          </div>
        </>
      )}

      {/* Subtle background ink stain trailing the active tab */}
      <div className="absolute bottom-0 left-0 w-32 h-10 bg-stone-400/10 dark:bg-stone-500/10 rounded-[40%_60%_70%_30%] blur-[12px] -z-10 mix-blend-multiply dark:mix-blend-lighten pointer-events-none transition-transform duration-1000"
           style={{ transform: activeTab === 'all' ? 'translateX(100px)' : 'translateX(0)' }} />
    </div>
  );
}
