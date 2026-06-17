import React from "react";
import { ChevronLeft, ChevronRight, Calendar, Sparkles } from "lucide-react";

interface TimelineHeaderProps {
  currentDate: Date;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onGoToday: () => void;
  weekIdentifier: string;
}

export default function TimelineHeader({
  currentDate,
  onPrevWeek,
  onNextWeek,
  onGoToday,
  weekIdentifier,
}: TimelineHeaderProps) {
  // Get date range for the current week (Monday to Sunday)
  const getWeekRangeDetails = (date: Date) => {
    const currentDay = date.getDay();
    // In JS: Sun is 0, Mon is 1, ..., Sat is 6
    // Shift Monday to be index 0
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    
    const monday = new Date(date);
    monday.setDate(date.getDate() + distanceToMonday);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    
    const formatYear = date.getFullYear();
    const formattedMonday = monday.toLocaleDateString("en-US", options);
    const formattedSunday = sunday.toLocaleDateString("en-US", options);

    return `${formattedMonday} – ${formattedSunday}, ${formatYear}`;
  };

  // Get week number
  const getWeekNumber = (d: Date): number => {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  };

  const weekNo = getWeekNumber(currentDate);
  const year = currentDate.getFullYear();
  const dateRangeStr = getWeekRangeDetails(currentDate);

  return (
    <header className="relative flex flex-col md:flex-row items-center justify-between gap-4 p-4 md:p-6 mb-4 bg-white dark:bg-stone-900 border border-amber-900/10 dark:border-amber-100/10 rounded-2xl shadow-sm select-none">
      {/* Background decoration representing journal paper grid faintly */}
      <div className="absolute inset-0 opacity-5 pointer-events-none rounded-2xl bg-[radial-gradient(#2d2319_1px,transparent_1px)] [background-size:16px_16px]" />

      {/* Main title of app */}
      <div className="flex items-center gap-3 relative z-10">
        <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 shadow-inner">
          <Sparkles size={20} className="animate-spin-slow text-amber-700 dark:text-amber-300" />
        </div>
        <div className="flex flex-col">
          <h1 className="text-xl md:text-2xl font-serif font-semibold tracking-tight text-stone-900 dark:text-stone-100 italic">
            Inspiration Clippboard
          </h1>
          <p className="text-[10px] uppercase tracking-widest text-amber-800 dark:text-amber-300 font-medium leading-none mt-1">
            Design Mood & Terminology board
          </p>
        </div>
      </div>

      {/* Weekly Date Selector navigation */}
      <div className="flex items-center gap-3 relative z-10 w-full sm:w-auto justify-end">
        {/* Date Range & Week Display */}
        <div className="text-right flex flex-col justify-center select-none mr-2 md:mr-4">
          <div className="text-xs font-mono font-medium text-amber-800 dark:text-amber-300 leading-none">
            WEEK {weekNo} / {year}
          </div>
          <div className="text-sm font-handwritten font-bold text-stone-700 dark:text-stone-300 mt-1 leading-none">
            {dateRangeStr}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 bg-amber-500/10 dark:bg-amber-500/5 p-1 rounded-xl border border-amber-200/40 dark:border-amber-900/40">
          <button
            onClick={onPrevWeek}
            className="p-1 px-2 rounded-lg hover:bg-white dark:hover:bg-stone-800 text-stone-600 hover:text-amber-950 dark:text-stone-300 dark:hover:text-amber-200 transition-all shadow-sm cursor-pointer"
            title="Previous Week"
          >
            <ChevronLeft size={16} />
          </button>

          <button
            onClick={onGoToday}
            className="px-2.5 py-1 text-xs font-medium rounded-lg hover:bg-white dark:hover:bg-stone-800 text-stone-600 hover:text-amber-950 dark:text-stone-300 dark:hover:text-amber-200 transition-all font-mono shadow-sm cursor-pointer"
            title="Jump to Current Week"
          >
            Today
          </button>

          <button
            onClick={onNextWeek}
            className="p-1 px-2 rounded-lg hover:bg-white dark:hover:bg-stone-800 text-stone-600 hover:text-amber-950 dark:text-stone-300 dark:hover:text-amber-200 transition-all shadow-sm cursor-pointer"
            title="Next Week"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
