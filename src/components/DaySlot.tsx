import React, { useRef, useState, useEffect } from "react";
import { ImageCard } from "../types";
import { Plus, Image, Loader2, Sparkles, Clipboard, ArrowDownToLine } from "lucide-react";
import PolaroidCard from "./PolaroidCard";

interface DaySlotProps {
  dayIndex: number;
  label: string;
  subLabel: string;
  cards: ImageCard[];
  onUploadImage: (dayIndex: number, base64Data: string) => Promise<void>;
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
  onDeleteCard,
  onDeleteTerm,
  onZoom,
  onUpdateTerms,
}: DaySlotProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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
      className={`group/slot relative min-h-[190px] flex flex-col p-4 rounded-2xl border transition-all duration-300 select-none ${
        isDragOver
          ? "border-amber-500 bg-amber-500/5 shadow-[inset_0_2px_12px_rgba(245,158,11,0.08)] scale-[0.99]"
          : "border-amber-900/10 dark:border-amber-100/10 bg-white/50 dark:bg-stone-900/50 hover:bg-white dark:hover:bg-stone-900 shadow-sm"
      }`}
      id={`day-slot-${dayIndex}`}
    >
      {/* Invisible file input picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Grid Day Heading */}
      <div className="flex items-center justify-between mb-3 border-b border-dashed border-amber-900/10 dark:border-amber-100/10 pb-1.5 select-none text-stone-800 dark:text-stone-200">
        <span className="font-serif font-bold text-sm italic">{label}</span>
        <span className="font-handwritten text-xs text-amber-950/60 dark:text-amber-200/60 font-semibold">{subLabel}</span>
      </div>

      {/* Uploading or Error Feedback banner */}
      <div className="empty:hidden">
        {uploadError && (
          <div className="mb-2 text-[11px] font-medium text-red-600 bg-red-100/60 dark:bg-red-950/20 px-2 py-1 rounded">
            ⚠️ {uploadError}
          </div>
        )}
      </div>

      {/* List of uploaded Polaroids for this slot */}
      <div className="flex-grow flex flex-col gap-3 py-1">
        {cards.map((card) => (
          <PolaroidCard
            key={card.id}
            card={card}
            onDeleteCard={onDeleteCard}
            onDeleteTerm={onDeleteTerm}
            onZoom={onZoom}
            onUpdateTerms={onUpdateTerms}
          />
        ))}

        {isUploading && (
          <div className="flex flex-col items-center justify-center p-5 border-2 border-dashed border-amber-500/30 rounded-xl bg-amber-500/5 animate-pulse min-h-[140px]" id={`analysing-loader-${dayIndex}`}>
            <Loader2 size={24} className="animate-spin text-amber-600 dark:text-amber-400 mb-1.5" />
            <div className="text-[11px] font-handwritten font-bold text-amber-800 dark:text-amber-300">
              Gemini parsing aesthetic...
            </div>
            
            {/* Visual breakdown of parameters sent for real analysis */}
            <div className="mt-3 p-2 bg-stone-100/60 dark:bg-stone-950/50 rounded-lg border border-stone-200/40 dark:border-white/5 text-[10px] text-stone-500 dark:text-stone-400 font-sans w-full text-left leading-relaxed">
              <span className="font-semibold text-amber-700 dark:text-amber-400 block mb-0.5">🚀 已发送 API 分析请求</span>
              <p className="opacity-80">
                <strong>发送提示词:</strong> "Analyze this image to extract evocative artistic inspirations, creative concepts, design styles, mood terms, color palettes, and visual keywords in Chinese... Return as JSON 'terms'."
              </p>
            </div>
          </div>
        )}

        {/* Empty placeholder slot with double support (Drag & Drop + Clipboard Paste + Click) */}
        {!isUploading && cards.length === 0 && (
          <div
            onClick={triggerFileSelect}
            className="flex-grow flex flex-col items-center justify-center py-6 px-4 rounded-xl border-2 border-dashed border-stone-200 dark:border-stone-800 hover:border-amber-400 group/dropzone cursor-pointer bg-stone-50/40 dark:bg-stone-900/20 hover:bg-amber-50/10 transition-all text-center"
          >
            <div className="p-2 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-400 group-hover/dropzone:bg-amber-100 dark:group-hover/dropzone:bg-amber-950/40 group-hover/dropzone:text-amber-700 dark:group-hover/dropzone:text-amber-300 transition-colors">
              <Plus size={16} />
            </div>
            <div className="mt-2 text-xs font-serif italic font-medium text-stone-500 group-hover/dropzone:text-stone-800 dark:group-hover/dropzone:text-stone-300">
              Pin a clip
            </div>
            <p className="text-[10px] text-stone-400 dark:text-stone-500 max-w-[150px] mt-1 tracking-tight leading-normal">
              Drop file, paste screenshot (Cmd+V), or click to choose.
            </p>
          </div>
        )}
      </div>

      {/* Floating Plus button on slots with existing cards to allow stacking multiple inspirations */}
      {cards.length > 0 && !isUploading && (
        <button
          onClick={triggerFileSelect}
          className="absolute bottom-2.5 right-2.5 w-6 h-6 rounded-full bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center opacity-0 group-hover/slot:opacity-100 cursor-pointer shadow-md transform transition-all translate-y-1 hover:scale-105"
          id={`add-more-btn-${dayIndex}`}
          title="Add another snippet to this day"
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}
