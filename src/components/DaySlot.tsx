import React, { useRef, useState, useEffect } from "react";
import { ImageCard } from "../types";
import { Clipboard, Image, Layers3, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import PolaroidCard from "./PolaroidCard";
import { motion } from "motion/react";
import WeatherBackground from "./WeatherBackground";
import { extractDocumentText, isSupportedDocumentFile } from "../lib/dbClient";

interface DaySlotProps {
  dayIndex: number;
  label: string;
  subLabel: string;
  cards: ImageCard[];
  onUploadImage: (dayIndex: number, originalFile: File, analysisBlob?: Blob) => Promise<void>;
  onUploadMd?: (dayIndex: number, text: string, filename: string) => Promise<void>;
  onUploadVideo?: (dayIndex: number, file: File) => Promise<void>;
  onCreateComboCard?: (dayIndex: number) => void;
  onDeleteCard: (id: string) => void;
  onDeleteTerm: (cardId: string, termIndex: number) => void;
  onZoom: (card: ImageCard) => void;
  onUpdateTerms: (cardId: string, terms: string[]) => void;
  onBookMembershipChanged?: () => void;
  onToggleFavorite?: (card: ImageCard) => void;
  favoriteUpdatingCardIds?: Set<string>;
  onBatchUploadStart?: () => void;
  onBatchUploadEnd?: () => void;
}

type BatchFailure = {
  filename: string;
  reason: string;
};

type BatchStatus = {
  total: number;
  completed: number;
  succeeded: number;
  failed: BatchFailure[];
  currentFile: string;
  done: boolean;
};

export default function DaySlot({
  dayIndex,
  label,
  subLabel,
  cards,
  onUploadImage,
  onUploadMd,
  onUploadVideo,
  onCreateComboCard,
  onDeleteCard,
  onDeleteTerm,
  onZoom,
  onUpdateTerms,
  onBookMembershipChanged,
  onToggleFavorite,
  favoriteUpdatingCardIds,
  onBatchUploadStart,
  onBatchUploadEnd,
}: DaySlotProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);

  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);
  const [activeStackIndex, setActiveStackIndex] = useState(0);
  const [flyOutState, setFlyOutState] = useState<{ id: string; dir: number } | null>(null);

  // Keep activeStackIndex within safe indices when cards array changes
  useEffect(() => {
    if (cards.length > 0) {
      setActiveStackIndex((current) => {
        if (current >= cards.length || current < 0) {
          return 0;
        }
        return 0;
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

  const isImageFile = (file: File) => file.type.startsWith("image/");
  const isVideoFile = (file: File) => {
    const lowerName = file.name.toLowerCase();
    return file.type.startsWith("video/") || lowerName.endsWith(".mp4") || lowerName.endsWith(".mov") || lowerName.endsWith(".webm");
  };

  const updateBatchProgress = (updater: (current: BatchStatus) => BatchStatus) => {
    setBatchStatus((current) => {
      if (!current) return current;
      return updater(current);
    });
  };

  const processMdFileCore = async (file: File) => {
    if (!isSupportedDocumentFile(file)) {
      throw new Error("不支持的文档文件。");
    }

    const extracted = await extractDocumentText(file);
    const text = extracted.text;
    if (!text.trim()) {
      throw new Error("文档内容为空。");
    }

    if (!onUploadMd) {
      throw new Error("当前页面不支持文档导入。");
    }

    await onUploadMd(dayIndex, text, extracted.filename || file.name);
  };

  const processVideoFileCore = async (file: File) => {
    if (!isVideoFile(file)) {
      throw new Error("不支持的视频文件。");
    }
    if (!onUploadVideo) {
      throw new Error("当前页面不支持视频导入。");
    }
    await onUploadVideo(dayIndex, file);
  };

  // Store the original image, but keep a smaller copy for AI analysis payloads.
  const processImageFileCore = (file: File) => {
    return new Promise<void>((resolve, reject) => {
      if (!isImageFile(file)) {
        reject(new Error("不支持的图片文件。"));
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const originalBase64 = event.target?.result as string;
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
          } else if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            try {
              await onUploadImage(dayIndex, file, file);
              resolve();
            } catch (err: any) {
              reject(err);
            }
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(async (blob) => {
            try {
              await onUploadImage(dayIndex, file, blob || file);
              resolve();
            } catch (err: any) {
              reject(err);
            }
          }, "image/jpeg", 0.82);
        };

        img.onerror = () => reject(new Error("Could not load image reference."));
        img.src = originalBase64;
      };

      reader.onerror = () => reject(new Error("Could not read image file."));
      reader.readAsDataURL(file);
    });
  };

  const processImageFile = async (file: File) => {
    setIsUploading(true);
    setUploadError(null);
    setBatchStatus(null);
    try {
      await processImageFileCore(file);
    } catch (err: any) {
      setUploadError(err.message || "Failed to analyze image terms.");
    } finally {
      setIsUploading(false);
    }
  };

  const processBatchFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setIsUploading(true);
    setUploadError(null);
    setBatchStatus({
      total: files.length,
      completed: 0,
      succeeded: 0,
      failed: [],
      currentFile: files[0]?.name || "",
      done: false,
    });

    onBatchUploadStart?.();
    try {
      for (const file of files) {
        updateBatchProgress((current) => ({ ...current, currentFile: file.name || "未命名文件" }));
        try {
          if (isImageFile(file)) {
            await processImageFileCore(file);
        } else if (isSupportedDocumentFile(file)) {
          await processMdFileCore(file);
          } else if (isVideoFile(file)) {
            await processVideoFileCore(file);
          } else {
            throw new Error("不支持的文件类型。");
          }

          updateBatchProgress((current) => ({
            ...current,
            completed: current.completed + 1,
            succeeded: current.succeeded + 1,
          }));
        } catch (err: any) {
          updateBatchProgress((current) => ({
            ...current,
            completed: current.completed + 1,
            failed: [
              ...current.failed,
              {
                filename: file.name || "未命名文件",
                reason: err?.message || "导入失败。",
              },
            ],
          }));
        }
      }
    } finally {
      onBatchUploadEnd?.();
    }

    setBatchStatus((current) => current ? { ...current, currentFile: "", done: true } : current);
    setIsUploading(false);
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
            void processImageFile(file);
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
      void processBatchFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void processBatchFiles(e.target.files);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
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
      className={`group/slot relative min-h-[190px] flex flex-col p-4 rounded-2xl border transition-all duration-300 select-none overflow-visible ${
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
                accept="image/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.md,.markdown,.txt,.pdf,.docx,text/markdown,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        multiple
        onChange={handleFileChange}
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
        {batchStatus?.done && (
          <div className={`mb-2 rounded px-2 py-1 text-[11px] font-medium ${
            batchStatus.failed.length > 0
              ? "bg-amber-100/70 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
              : "bg-emerald-100/70 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200"
          }`}>
            <div>
              批量导入完成：成功 {batchStatus.succeeded} 个，失败 {batchStatus.failed.length} 个
            </div>
            {batchStatus.failed.length > 0 && (
              <div className="mt-1 space-y-0.5">
                {batchStatus.failed.slice(0, 3).map((failure) => (
                  <div key={`${failure.filename}-${failure.reason}`} className="truncate">
                    {failure.filename}: {failure.reason}
                  </div>
                ))}
                {batchStatus.failed.length > 3 && (
                  <div>还有 {batchStatus.failed.length - 3} 个文件导入失败。</div>
                )}
              </div>
            )}
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
                      onBookMembershipChanged={onBookMembershipChanged}
                      onToggleFavorite={onToggleFavorite}
                      isFavoriteUpdating={favoriteUpdatingCardIds?.has(card.id)}
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
            {batchStatus ? (
              <>
                <div className="text-[11px] font-handwritten font-bold text-amber-800 dark:text-amber-300">
                  正在导入 {Math.min(batchStatus.completed + 1, batchStatus.total)}/{batchStatus.total}
                </div>
                {batchStatus.currentFile && (
                  <div className="mt-1 max-w-full truncate text-[10px] text-stone-500 dark:text-stone-400">
                    当前：{batchStatus.currentFile}
                  </div>
                )}
                <div className="mt-2 text-[10px] text-stone-500 dark:text-stone-400">
                  成功 {batchStatus.succeeded} 个，失败 {batchStatus.failed.length} 个
                </div>
              </>
            ) : (
              <div className="text-[11px] font-handwritten font-bold text-amber-800 dark:text-amber-300">
                Gemini parsing aesthetic...
              </div>
            )}
            
            {/* Visual breakdown of parameters sent for real analysis */}
            {!batchStatus && (
              <div className="mt-3 p-2 bg-stone-100/60 dark:bg-stone-950/50 rounded-lg border border-stone-200/40 dark:border-white/5 text-[10px] text-stone-500 dark:text-stone-400 font-sans w-full text-left leading-relaxed">
                <span className="font-semibold text-amber-700 dark:text-amber-400 block mb-0.5">🚀 已发送 API 分析请求</span>
                <p className="opacity-80 text-[9px]">
                  <strong>发送提示词:</strong> "Analyze this image to extract evocative artistic inspirations..."
                </p>
              </div>
            )}
          </div>
        )}

        {/* Empty placeholder slot with double support (Drag & Drop + Clipboard Paste + Click) */}
        {!isUploading && cards.length === 0 && (
          <div className="w-full flex-grow flex flex-col items-center justify-center py-6 px-4 rounded-xl border-2 border-dashed border-stone-200 dark:border-stone-800 hover:border-amber-400 group/dropzone bg-stone-50/40 dark:bg-stone-900/20 hover:bg-amber-50/10 transition-all text-center">
            <div className="flex items-center gap-2">
              <div
                onClick={triggerFileSelect}
                className="flex flex-col items-center cursor-pointer group/importbtn p-2 rounded-xl hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
              >
                <div className="relative p-2 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-400 group-hover/importbtn:bg-amber-100 dark:group-hover/importbtn:bg-amber-950/40 group-hover/importbtn:text-amber-700 dark:group-hover/importbtn:text-amber-300 transition-colors transform group-hover/importbtn:-rotate-6 scale-100 group-hover/importbtn:scale-110 duration-300">
                  <Image size={17} strokeWidth={1.5} />
                  <Clipboard size={10} strokeWidth={1.8} className="absolute -right-1 -bottom-1 rounded-full bg-white text-teal-600 shadow-sm dark:bg-stone-950 dark:text-teal-300" />
                </div>
                <div className="mt-2 text-xs font-serif italic font-medium text-stone-500 group-hover/importbtn:text-stone-800 dark:group-hover/importbtn:text-stone-300">
                  批量导入
                </div>
              </div>
              <button
                type="button"
                onClick={() => onCreateComboCard?.(dayIndex)}
                className="flex flex-col items-center rounded-xl p-2 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                title="创建组合卡片"
              >
                <div className="rounded-full bg-stone-100 p-2 text-stone-500 transition-colors dark:bg-stone-800 dark:text-stone-400">
                  <Layers3 size={17} strokeWidth={1.5} />
                </div>
                <div className="mt-2 text-xs font-serif italic font-medium">
                  创建组合
                </div>
              </button>
            </div>
            <p className="text-[10px] text-stone-400 dark:text-stone-500 max-w-[170px] mt-1 tracking-tight leading-normal">
              多选图片或文档，全部导入这一天。
            </p>
          </div>
        )}
      </div>

      {/* Floating Plus button on slots with existing cards to allow stacking multiple inspirations */}
      {cards.length > 0 && !isUploading && (
        <div className="absolute bottom-2.5 right-2.5 z-[130] flex flex-col gap-2 opacity-0 group-hover/slot:opacity-100 transition-all duration-300 pointer-events-auto">
          <button
            onClick={triggerFileSelect}
            className="w-6 h-6 rounded-full bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center cursor-pointer shadow-md transform hover:scale-110 hover:rotate-12 transition-all"
            id={`add-more-btn-${dayIndex}`}
            title="批量导入图片和文档"
          >
            <span className="relative inline-flex">
              <Image size={12} strokeWidth={2} />
              <Clipboard size={7} strokeWidth={2.2} className="absolute -right-1.5 -bottom-1 rounded-full bg-amber-600 text-white" />
            </span>
          </button>
          <button
            type="button"
            onClick={() => onCreateComboCard?.(dayIndex)}
            className="w-6 h-6 rounded-full bg-stone-900 hover:bg-stone-800 text-white flex items-center justify-center cursor-pointer shadow-md transform hover:scale-110 transition-all dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
            title="创建组合卡片"
          >
            <Layers3 size={12} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}
