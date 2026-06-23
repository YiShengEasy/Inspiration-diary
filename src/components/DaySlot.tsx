import React, { useRef, useState, useEffect } from "react";
import { ImageCard } from "../types";
import { Clipboard, Image, Loader2, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import PolaroidCard from "./PolaroidCard";
import { motion } from "motion/react";
import WeatherBackground from "./WeatherBackground";

interface DaySlotProps {
  dayIndex: number;
  label: string;
  subLabel: string;
  cards: ImageCard[];
  onUploadImage: (dayIndex: number, base64Data: string) => Promise<void>;
  onUploadMd?: (dayIndex: number, text: string, filename: string) => Promise<void>;
  onDeleteCard: (id: string) => void;
  onDeleteTerm: (cardId: string, termIndex: number) => void;
  onZoom: (card: ImageCard) => void;
  onUpdateTerms: (cardId: string, terms: string[]) => void;
}

export default function DaySlot({
  dayIndex,
  label,
  subLabel,
  cards,
  onUploadImage,
  onUploadMd,
  onDeleteCard,
  onDeleteTerm,
  onZoom,
  onUpdateTerms,
}: DaySlotProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mdInputRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [activeStackIndex, setActiveStackIndex] = useState(0);
  const [flyOutState, setFlyOutState] = useState<{ id: string; dir: number } | null>(null);

  // Keep activeStackIndex within safe indices when cards array changes
  useEffect(() => {
    if (cards.length > 0) {
      setActiveStackIndex((current) => {
        if (current >= cards.length || current < 0) {
          return cards.length - 1;
        }
        return current;
      });
    } else {
      setActiveStackIndex(0);
    }
  }, [cards.length]);

  const handlePrevCard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cards.length <= 1) return;
    setActiveStackIndex((prev) => (prev - 1 + cards.length) % cards.length);
  };

  const handleNextCard = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cards.length <= 1) return;
    setActiveStackIndex((prev) => (prev + 1) % cards.length);
  };

  const processMdFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".md") && file.type !== "text/markdown") {
      setUploadError("Please provide a valid markdown file.");
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    try {
      const text = await file.text();
      if (onUploadMd) {
        await onUploadMd(dayIndex, text, file.name);
      }
    } catch (err: any) {
      setUploadError(err.message || "Failed to process Markdown document.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleMdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      void processMdFile(e.target.files[0]);
    }
    if (mdInputRef.current) mdInputRef.current.value = "";
  };

  const triggerMdSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    mdInputRef.current?.click();
  };

  // Resize and compress image using canvas
  const processImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setUploadError("Please provide a valid image file.");
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.onload = async () => {
        // Create canvas for compression
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 600;
        const MAX_HEIGHT = 600;
        let width = img.width;
        let height = img.height;

        // Calculate aspect ratios for shrinking
        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          // Compress to JPEG with 0.8 quality
          const compressedBase64 = canvas.toDataURL("image/jpeg", 0.82);
          try {
            await onUploadImage(dayIndex, compressedBase64);
          } catch (err: any) {
            setUploadError(err.message || "Failed to analyze image terms.");
          } finally {
            setIsUploading(false);
          }
        } else {
          setIsUploading(false);
          setUploadError("Image compression helper failure.");
        }
      };
      
      img.onerror = () => {
        setIsUploading(false);
        setUploadError("Could not load image reference.");
      };

      img.src = event.target?.result as string;
    };

    reader.onerror = () => {
      setIsUploading(false);
      setUploadError("Could not read image file.");
    };

    reader.readAsDataURL(file);
  };

  // Keyboard shortcut Paste listener (for clipboard screenshots paste!)
  const handlePaste = (e: ClipboardEvent) => {
    const activeElement = document.activeElement;
    // Check if the focus is inside editable areas (notes/inputs) to avoid stealing typing paste
    if (activeElement?.tagName === "TEXTAREA" || activeElement?.tagName === "INPUT") {
      return;
    }

    // Capture paste only if this day slot container is hovered or active
    const isHovered = slotRef.current?.matches(":hover");
    if (!isHovered) return;

    if (e.clipboardData && e.clipboardData.items) {
      for (let i = 0; i < e.clipboardData.items.length; i++) {
        const item = e.clipboardData.items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            processImageFile(file);
            break;
          }
        }
      }
    }
  };

  useEffect(() => {
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processImageFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processImageFile(e.target.files[0]);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  return (
    <div
      ref={slotRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group/slot relative min-h-[190px] flex flex-col p-4 rounded-2xl border transition-all duration-300 select-none overflow-hidden ${
        isDragOver
          ? "border-amber-500 bg-amber-500/5 shadow-[inset_0_2px_12px_rgba(245,158,11,0.08)] scale-[0.99]"
          : "border-amber-900/10 dark:border-amber-100/10 bg-white/50 dark:bg-stone-900/50 hover:bg-white dark:hover:bg-stone-900 shadow-sm"
      }`}
      id={`day-slot-${dayIndex}`}
    >
      <WeatherBackground />

      {/* Invisible file input pickers */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
      <input
        ref={mdInputRef}
        type="file"
        accept=".md,text/markdown"
        onChange={handleMdChange}
        className="hidden"
      />

      {/* Grid Day Heading */}
      <div className="relative z-10 flex items-center justify-between mb-3 border-b border-dashed border-amber-900/10 dark:border-amber-100/10 pb-1.5 select-none text-stone-800 dark:text-stone-200">
        <span className="font-serif font-bold text-sm italic">{label}</span>
        <span className="font-handwritten text-xs text-amber-950/60 dark:text-amber-200/60 font-semibold">{subLabel}</span>
      </div>

      {/* Uploading or Error Feedback banner */}
      <div className="relative z-10 empty:hidden">
        {uploadError && (
          <div className="mb-2 text-[11px] font-medium text-red-600 bg-red-100/60 dark:bg-red-950/20 px-2 py-1 rounded">
            ⚠️ {uploadError}
          </div>
        )}
      </div>

      {/* List of uploaded Polaroids for this slot */}
      <div className={`relative z-10 flex-grow flex flex-col justify-center items-center ${cards.length > 0 ? "min-h-[250px] mb-2" : "min-h-[140px]"}`}>
        {cards.length > 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            {cards.map((card, index) => {
              const isTopMost = index === activeStackIndex;
              const isHovered = hoveredCardId === card.id;
              
              // Calculate slight offset stagger
              const total = cards.length;
              const progress = total > 1 ? index / (total - 1) : 0.5;
              const xOffset = total > 1 ? (progress - 0.5) * 16 : 0;
              const yOffset = total > 1 ? (progress - 0.5) * 8 : 0;
              
              const rotation = card.angle || ((progress - 0.5) * 12);
              
              let targetXOffset = xOffset;
              let targetYOffset = yOffset;
              let targetScale = 1;
              let targetRotate = rotation;
              let targetOpacity = 1;

              const isFlyingOut = flyOutState?.id === card.id;
              if (isFlyingOut && flyOutState) {
                targetXOffset = flyOutState.dir * 300;
                targetRotate = rotation + flyOutState.dir * 45;
                targetOpacity = 0;
              } else if (isHovered) {
                targetRotate = rotation * 0.3;
                targetYOffset = yOffset - 22;
                targetScale = 1.08;
              } else if (isTopMost && total > 1) {
                targetYOffset = yOffset - 4;
                targetScale = 1.02;
              }

              return (
                <div
                  key={card.id}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[140px] sm:w-[145px]"
                  style={{ zIndex: isHovered || isFlyingOut ? 100 : isTopMost ? 40 : index + 10 }}
                  onMouseEnter={() => setHoveredCardId(card.id)}
                  onMouseLeave={() => setHoveredCardId(null)}
                >
                  <motion.div
                    animate={{
                      x: targetXOffset,
                      y: targetYOffset,
                      rotate: targetRotate,
                      scale: targetScale,
                      opacity: targetOpacity,
                    }}
                    whileDrag={{ scale: 1.05, cursor: "grabbing" }}
                    drag={isTopMost && !isFlyingOut ? "x" : false}
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.8}
                    onDragStart={() => {
                      dragRef.current = true;
                    }}
                    onDragEnd={(_event, info) => {
                      const swipeThreshold = 50;
                      let dir = 0;
                      if (info.offset.x < -swipeThreshold) dir = -1;
                      else if (info.offset.x > swipeThreshold) dir = 1;

                      if (dir !== 0 && cards.length > 1) {
                        setFlyOutState({ id: card.id, dir });
                        setTimeout(() => {
                          setActiveStackIndex((prev) => (prev - dir + cards.length) % cards.length);
                          setFlyOutState(null);
                        }, 200);
                      }

                      setTimeout(() => {
                        dragRef.current = false;
                      }, 100);
                    }}
                    transition={{ type: "spring", stiffness: 300, damping: 25 }}
                    className={isTopMost ? "cursor-grab" : ""}
                  >
                    <PolaroidCard
                      card={card}
                      onDeleteCard={onDeleteCard}
                      onDeleteTerm={onDeleteTerm}
                      onZoom={(c) => {
                        if (dragRef.current) return;
                        onZoom(c);
                      }}
                      onUpdateTerms={onUpdateTerms}
                    />
                  </motion.div>
                </div>
              );
            })}

            {/* Left/Right Nav overlay shown on slot hover */}
            {cards.length > 1 && (
              <>
                <button
                  onClick={handlePrevCard}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 z-[45] bg-stone-900/60 hover:bg-stone-900/80 hover:scale-110 active:scale-95 text-white p-1.5 rounded-full shadow backdrop-blur-sm opacity-0 group-hover/slot:opacity-100 transition-all duration-200 cursor-pointer"
                  title="查看前一张灵感"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={handleNextCard}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 z-[45] bg-stone-900/60 hover:bg-stone-900/80 hover:scale-110 active:scale-95 text-white p-1.5 rounded-full shadow backdrop-blur-sm opacity-0 group-hover/slot:opacity-100 transition-all duration-200 cursor-pointer"
                  title="查看后一张灵感"
                >
                  <ChevronRight size={16} />
                </button>

                {/* Micro dots indicator of stack size */}
                <div className="absolute bottom-1 bg-stone-900/40 hover:bg-stone-900/60 backdrop-blur-sm px-2 py-0.5 rounded-full z-[45] flex items-center gap-1.5 opacity-0 group-hover/slot:opacity-100 transition-all duration-200">
                  {cards.map((_, dotIdx) => (
                    <button
                      key={dotIdx}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveStackIndex(dotIdx);
                      }}
                      className={`w-1.5 h-1.5 rounded-full transition-all cursor-pointer ${
                        dotIdx === activeStackIndex ? "bg-amber-400 scale-110" : "bg-white/50 hover:bg-white/80"
                      }`}
                      title={`切换到第 ${dotIdx + 1} 张`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        ) : null}

        {isUploading && (
          <div className="flex flex-col items-center justify-center p-5 border-2 border-dashed border-amber-500/30 rounded-xl bg-amber-500/5 animate-pulse min-h-[140px] w-full" id={`analysing-loader-${dayIndex}`}>
            <Loader2 size={24} className="animate-spin text-amber-600 dark:text-amber-400 mb-1.5" />
            <div className="text-[11px] font-handwritten font-bold text-amber-800 dark:text-amber-300">
              Gemini parsing aesthetic...
            </div>
            
            {/* Visual breakdown of parameters sent for real analysis */}
            <div className="mt-3 p-2 bg-stone-100/60 dark:bg-stone-950/50 rounded-lg border border-stone-200/40 dark:border-white/5 text-[10px] text-stone-500 dark:text-stone-400 font-sans w-full text-left leading-relaxed">
              <span className="font-semibold text-amber-700 dark:text-amber-400 block mb-0.5">🚀 已发送 API 分析请求</span>
              <p className="opacity-80 text-[9px]">
                <strong>发送提示词:</strong> "Analyze this image to extract evocative artistic inspirations..."
              </p>
            </div>
          </div>
        )}

        {/* Empty placeholder slot with double support (Drag & Drop + Clipboard Paste + Click) */}
        {!isUploading && cards.length === 0 && (
          <div className="w-full flex-grow flex flex-col items-center justify-center py-6 px-4 rounded-xl border-2 border-dashed border-stone-200 dark:border-stone-800 hover:border-amber-400 group/dropzone bg-stone-50/40 dark:bg-stone-900/20 hover:bg-amber-50/10 transition-all text-center">
            <div className="flex gap-4 items-center">
              <div
                onClick={triggerFileSelect}
                className="flex flex-col items-center cursor-pointer group/imgbtn p-2 rounded-xl hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
              >
                <div className="p-2 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-400 group-hover/imgbtn:bg-amber-100 dark:group-hover/imgbtn:bg-amber-950/40 group-hover/imgbtn:text-amber-700 dark:group-hover/imgbtn:text-amber-300 transition-colors transform group-hover/imgbtn:-rotate-6 scale-100 group-hover/imgbtn:scale-110 duration-300">
                  <Image size={16} strokeWidth={1.5} />
                </div>
                <div className="mt-2 text-xs font-serif italic font-medium text-stone-500 group-hover/imgbtn:text-stone-800 dark:group-hover/imgbtn:text-stone-300">
                  图片灵感
                </div>
              </div>

              {onUploadMd && (
                <div
                  onClick={triggerMdSelect}
                  className="flex flex-col items-center cursor-pointer group/mdbtn p-2 rounded-xl hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
                >
                  <div className="p-2 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-400 group-hover/mdbtn:bg-teal-100 dark:group-hover/mdbtn:bg-teal-950/40 group-hover/mdbtn:text-teal-700 dark:group-hover/mdbtn:text-teal-300 transition-colors transform group-hover/mdbtn:rotate-6 scale-100 group-hover/mdbtn:scale-110 duration-300">
                    <Clipboard size={16} strokeWidth={1.5} />
                  </div>
                  <div className="mt-2 text-xs font-serif italic font-medium text-stone-500 group-hover/mdbtn:text-stone-800 dark:group-hover/mdbtn:text-stone-300">
                    随附手稿
                  </div>
                </div>
              )}
            </div>
            <p className="text-[10px] text-stone-400 dark:text-stone-500 max-w-[150px] mt-1 tracking-tight leading-normal">
              留存光影、长文笔记，或直接粘贴唤醒灵感。
            </p>
          </div>
        )}
      </div>

      {/* Floating Plus button on slots with existing cards to allow stacking multiple inspirations */}
      {cards.length > 0 && !isUploading && (
        <div className="absolute bottom-2.5 right-2.5 flex flex-col gap-2 opacity-0 group-hover/slot:opacity-100 transition-all duration-300">
          <button
            onClick={triggerFileSelect}
            className="w-6 h-6 rounded-full bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center cursor-pointer shadow-md transform hover:scale-110 hover:rotate-12 transition-all"
            id={`add-more-btn-${dayIndex}`}
            title="添加图片"
          >
            <Image size={12} strokeWidth={2} />
          </button>
          {onUploadMd && (
            <button
              onClick={triggerMdSelect}
              className="w-6 h-6 rounded-full bg-teal-500 hover:bg-teal-600 text-white flex items-center justify-center cursor-pointer shadow-md transform hover:scale-110 hover:-rotate-12 transition-all"
              title="添加MD笔记"
            >
              <Clipboard size={12} strokeWidth={2} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
