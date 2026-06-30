# Web Batch Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mixed multi-file upload entry to each Web day slot so images and Markdown files can be selected or dropped together and imported into the chosen day.

**Architecture:** Keep the server and database unchanged. `DaySlot` owns file selection, drag/drop, queue progress, and per-file error summaries, while `App` continues to own the existing single image and single Markdown upload functions. The batch queue processes files sequentially and delegates each file to the existing single-file path.

**Tech Stack:** React 19, TypeScript, Vite, lucide-react, existing Express/Postgres/PhotoPrism APIs.

---

## File Structure

- Modify `src/components/DaySlot.tsx`
  - Convert the hidden file input to accept mixed images and Markdown with `multiple`.
  - Add batch queue state and helper functions.
  - Route file selection and drag/drop through one sequential batch processor.
  - Preserve the existing paste screenshot behavior as single image upload.
  - Update empty and populated slot controls to show one mixed batch upload entry.
- No server or database files are modified.
- No new tests are added because the repository currently validates frontend TypeScript through `npm run lint`; manual browser validation covers drag/drop and file picker behavior.

## Task 1: Add Batch Queue State And File Type Helpers

**Files:**
- Modify: `src/components/DaySlot.tsx`

- [ ] **Step 1: Add typed batch status state near the existing upload state**

Add these types and state declarations inside `DaySlot`, next to `isUploading` and `uploadError`:

```ts
type BatchFailure = {
  filename: string;
  reason: string;
};

const [batchStatus, setBatchStatus] = useState<{
  total: number;
  completed: number;
  succeeded: number;
  failed: BatchFailure[];
  currentFile: string;
  done: boolean;
} | null>(null);
```

- [ ] **Step 2: Add file type helpers before `processMdFile`**

```ts
const isMarkdownFile = (file: File) => {
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith(".md") || file.type === "text/markdown";
};

const isImageFile = (file: File) => file.type.startsWith("image/");

const updateBatchProgress = (updater: (current: NonNullable<typeof batchStatus>) => NonNullable<typeof batchStatus>) => {
  setBatchStatus((current) => {
    if (!current) return current;
    return updater(current);
  });
};
```

## Task 2: Split Single-File Processors From UI State

**Files:**
- Modify: `src/components/DaySlot.tsx`

- [ ] **Step 1: Create `processMdFileCore`**

Extract the current Markdown logic into a core function that throws errors instead of setting banners:

```ts
const processMdFileCore = async (file: File) => {
  if (!isMarkdownFile(file)) {
    throw new Error("不支持的 Markdown 文件。");
  }

  const text = await file.text();
  if (!text.trim()) {
    throw new Error("Markdown 文件为空。");
  }

  if (!onUploadMd) {
    throw new Error("当前页面不支持 Markdown 导入。");
  }

  await onUploadMd(dayIndex, text, file.name);
};
```

- [ ] **Step 2: Keep `processMdFile` as the single-file wrapper**

Replace `processMdFile` with:

```ts
const processMdFile = async (file: File) => {
  setIsUploading(true);
  setUploadError(null);
  setBatchStatus(null);
  try {
    await processMdFileCore(file);
  } catch (err: any) {
    setUploadError(err.message || "Failed to process Markdown document.");
  } finally {
    setIsUploading(false);
  }
};
```

- [ ] **Step 3: Create `processImageFileCore`**

Move the existing image upload body into a Promise-returning core function:

```ts
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
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 600;
        const MAX_HEIGHT = 600;
        let width = img.width;
        let height = img.height;

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
          } catch (err) {
            reject(err);
          }
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(async (blob) => {
          try {
            await onUploadImage(dayIndex, file, blob || file);
            resolve();
          } catch (err) {
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
```

- [ ] **Step 4: Keep `processImageFile` as the single-file wrapper**

```ts
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
```

## Task 3: Add Sequential Batch Processor

**Files:**
- Modify: `src/components/DaySlot.tsx`

- [ ] **Step 1: Add `processBatchFiles`**

```ts
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

  for (const file of files) {
    updateBatchProgress((current) => ({ ...current, currentFile: file.name }));
    try {
      if (isImageFile(file)) {
        await processImageFileCore(file);
      } else if (isMarkdownFile(file)) {
        await processMdFileCore(file);
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
        failed: [...current.failed, { filename: file.name || "未命名文件", reason: err?.message || "导入失败。" }],
      }));
    }
  }

  setBatchStatus((current) => current ? { ...current, currentFile: "", done: true } : current);
  setIsUploading(false);
};
```

## Task 4: Wire Selection And Drag/Drop To Batch Processor

**Files:**
- Modify: `src/components/DaySlot.tsx`

- [ ] **Step 1: Update Markdown input change handler**

The separate Markdown input will be removed from the UI, but its handler can be deleted or left unused. The mixed file input should be the only picker path.

- [ ] **Step 2: Update `handleDrop`**

```ts
const handleDrop = (e: React.DragEvent) => {
  e.preventDefault();
  setIsDragOver(false);
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    void processBatchFiles(e.dataTransfer.files);
  }
};
```

- [ ] **Step 3: Update `handleFileChange`**

```ts
const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  if (e.target.files && e.target.files.length > 0) {
    void processBatchFiles(e.target.files);
  }
  if (fileInputRef.current) fileInputRef.current.value = "";
};
```

- [ ] **Step 4: Update file input attributes**

```tsx
<input
  ref={fileInputRef}
  type="file"
  accept="image/*,.md,text/markdown"
  multiple
  onChange={handleFileChange}
  className="hidden"
/>
```

## Task 5: Update Upload UI And Progress Feedback

**Files:**
- Modify: `src/components/DaySlot.tsx`

- [ ] **Step 1: Replace empty placeholder dual buttons with one mixed batch button**

Use one clickable area with `Image` and `Clipboard` icons and the label `批量导入`.

- [ ] **Step 2: Replace populated slot floating buttons with one mixed batch button**

Use one button title `批量导入图片和MD` and keep `onClick={triggerFileSelect}`.

- [ ] **Step 3: Render batch progress in the existing upload loader**

When `batchStatus` exists, show Chinese progress text and failure summary. When it does not exist, keep the existing single-image parsing message.

```tsx
{batchStatus ? (
  <>
    <div className="text-[11px] font-handwritten font-bold text-amber-800 dark:text-amber-300">
      {batchStatus.done ? "批量导入完成" : `正在导入 ${Math.min(batchStatus.completed + 1, batchStatus.total)}/${batchStatus.total}`}
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
```

## Task 6: Verify

**Files:**
- Verify: `src/components/DaySlot.tsx`

- [ ] **Step 1: Run TypeScript lint**

Run: `npm run lint`

Expected: TypeScript check completes without new errors.

- [ ] **Step 2: Inspect resulting diff**

Run: `git diff -- src/components/DaySlot.tsx`

Expected: Only `DaySlot` changes for mixed multi-file upload, queue state, and progress UI.

- [ ] **Step 3: Manual validation checklist**

In the Web UI:

- Select multiple images from one day slot and confirm cards land in that day.
- Select multiple `.md` files from one day slot and confirm cards land in that day.
- Mix images and `.md` files and confirm both card types appear.
- Drag multiple files into a day slot and confirm the same behavior.
- Include one unsupported file and confirm it appears in the failure summary while supported files still import.
