# ai-design-termboard Style Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the `ai-design-termboard` login page, style system, and frontend animations into `Inspiration-diary` while preserving current PhotoPrism, database, settings, and AI request behavior.

**Architecture:** Treat `Inspiration-diary` as the production source of truth and `ai-design-termboard` as the UI reference. Copy self-contained visual components, then manually merge App-level interactions around the current upload/settings/data flows. Keep each task independently buildable and commit after each verified slice.

**Tech Stack:** React 19, Vite 6, TypeScript, Tailwind CSS v4, motion/react, lucide-react, Firebase Firestore/Auth, Express, PhotoPrism-backed storage, optional PostgreSQL mode.

---

## Source References

- Spec: `docs/superpowers/specs/2026-06-20-ai-design-termboard-style-migration-design.md`
- Reference project: `/Users/yisheng/Documents/SLUAN/ai-design-termboard`
- Target project: `/Users/yisheng/Documents/SLUAN/Inspiration-diary`

## File Structure

- Modify `package.json` and `package-lock.json`: add `clsx` and `tailwind-merge` because the reference masonry utility imports `cn`.
- Modify `src/lib/firebase.ts`: keep Firestore export and add Firebase Auth export.
- Create `src/lib/utils.ts`: provide `cn(...inputs)` used by the imported masonry component.
- Create `src/components/ui/ink-reveal.tsx`: self-contained login mask canvas.
- Create `src/components/ui/masonry-grid.tsx`: self-contained animated masonry layout.
- Create `src/components/LoginScreen.tsx`: Firebase email/password login/register screen from the reference.
- Create `src/components/WeatherBackground.tsx`: self-contained slot particle canvas.
- Create `src/components/WeeklyPreviewModal.tsx`: weekly masonry preview modal.
- Modify `src/index.css`: add the Tailwind v4 dark variant used by imported components.
- Modify `src/components/TimelineHeader.tsx`: add optional weekly preview button and reference dark styling.
- Modify `src/components/DaySlot.tsx`: add weather background, card drag/swipe animation, sparkle upload affordance, and safe paste listener dependency.
- Modify `src/components/PolaroidCard.tsx`: align delete affordance and shadows while preserving `thumbnailUrl || imageUrl` for board cards.
- Modify `src/App.tsx`: add auth gate, logout, weekly preview, zoom carousel, delete animation, and keep current PhotoPrism/upload/settings/refresh logic intact.

## Protected Current Logic

Do not replace these current `Inspiration-diary` behaviors with reference-project versions:

- `handleUploadImage` must keep `/api/store-image`, `thumbnailUrl`, `photoUid`, async `/api/analyze-image`, and third-party provider headers.
- Top-level settings must keep `loadSettings`, `saveSettings`, third-party provider props, and localStorage sync.
- Manual `handleRefreshCards` and the refresh button must remain.
- `subscribeCards`, `subscribeAllCards`, `loadNote`, `saveNote`, `saveCard`, `deleteCard`, and `updateCardTerms` APIs must keep their signatures.

---

### Task 1: Add Dependencies And Shared UI Utilities

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/lib/firebase.ts`
- Create: `src/lib/utils.ts`
- Create: `src/components/ui/ink-reveal.tsx`
- Create: `src/components/ui/masonry-grid.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Add utility dependencies**

Run:

```bash
npm install clsx tailwind-merge
```

Expected: npm exits with code `0`, and `package.json` plus `package-lock.json` include `clsx` and `tailwind-merge`.

- [ ] **Step 2: Add Firebase Auth export**

Update `src/lib/firebase.ts` to this exact shape:

```ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
```

- [ ] **Step 3: Create `cn` utility**

Create `src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Copy self-contained UI primitives from the reference project**

Run:

```bash
mkdir -p src/components/ui
cp /Users/yisheng/Documents/SLUAN/ai-design-termboard/src/components/ui/ink-reveal.tsx src/components/ui/ink-reveal.tsx
cp /Users/yisheng/Documents/SLUAN/ai-design-termboard/src/components/ui/masonry-grid.tsx src/components/ui/masonry-grid.tsx
```

Expected: both `cp` commands exit with code `0`, and both copied files exist under `src/components/ui`.

- [ ] **Step 5: Add Tailwind dark variant**

Ensure `src/index.css` begins with:

```css
@import url('https://fonts.googleapis.com/css2?family=Architects+Daughter&family=Inter:wght@400;500;600;700&family=Kalam:wght@400;700&family=Playfair+Display:ital,wght@0,400;1,400;1,600&display=swap');
@import "tailwindcss";

@variant dark (&:where(.dark, .dark *));
```

Keep the existing `@theme`, `body`, and `.dark body` blocks below this header.

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run lint
```

Expected:

```text
> react-example@0.0.0 lint
> tsc --noEmit
```

The command exits with code `0`.

- [ ] **Step 7: Commit**

Run:

```bash
git add package.json package-lock.json src/lib/firebase.ts src/lib/utils.ts src/components/ui/ink-reveal.tsx src/components/ui/masonry-grid.tsx src/index.css
git commit -m "添加样式迁移基础组件"
```

Expected: commit succeeds and includes only the files listed in `git add`.

---

### Task 2: Add Login Screen And Auth Gate

**Files:**
- Create: `src/components/LoginScreen.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Copy login screen from reference**

Run:

```bash
cp /Users/yisheng/Documents/SLUAN/ai-design-termboard/src/components/LoginScreen.tsx src/components/LoginScreen.tsx
```

Expected: command exits with code `0`.

- [ ] **Step 2: Add App imports for auth**

In `src/App.tsx`, add these imports without removing existing imports:

```ts
import LoginScreen from "./components/LoginScreen";
import { auth } from "./lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { LogOut } from "lucide-react";
```

If `LogOut` is easier to merge into the existing lucide import list, add it there instead of creating a second lucide import.

- [ ] **Step 3: Add auth state near the top of `App`**

Inside `export default function App()`, before week/card/note state, add:

```ts
const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
const [authInitialized, setAuthInitialized] = useState<boolean>(false);
```

- [ ] **Step 4: Add Firebase auth listener**

After the initial state declarations and before week-id effects, add:

```ts
useEffect(() => {
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    setIsLoggedIn(!!user);
    setAuthInitialized(true);
  });

  return () => unsubscribe();
}, []);
```

- [ ] **Step 5: Add auth-gated early returns**

Place these returns after helper functions and before the main app `return`:

```tsx
if (!authInitialized) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 dark:bg-stone-950">
      <Loader2 className="animate-spin text-stone-400" />
    </div>
  );
}

if (!isLoggedIn) {
  return <LoginScreen onLogin={() => setIsLoggedIn(true)} />;
}
```

- [ ] **Step 6: Add logout button to the top action row**

In the existing top-right action controls near the settings and theme buttons, add:

```tsx
<button
  onClick={() => signOut(auth)}
  className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-900 dark:text-red-300 transition-colors shadow-sm cursor-pointer border border-red-500/20 flex items-center justify-center"
  title="Logout"
>
  <LogOut size={15} />
</button>
```

- [ ] **Step 7: Run typecheck**

Run:

```bash
npm run lint
```

Expected: command exits with code `0`.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/App.tsx src/components/LoginScreen.tsx
git commit -m "添加登录页和认证门禁"
```

Expected: commit succeeds and does not include unrelated files.

---

### Task 3: Migrate Header, Slot, And Card Motion Styling

**Files:**
- Modify: `src/components/TimelineHeader.tsx`
- Create: `src/components/WeatherBackground.tsx`
- Modify: `src/components/DaySlot.tsx`
- Modify: `src/components/PolaroidCard.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Copy WeatherBackground**

Run:

```bash
cp /Users/yisheng/Documents/SLUAN/ai-design-termboard/src/components/WeatherBackground.tsx src/components/WeatherBackground.tsx
```

Expected: command exits with code `0`.

- [ ] **Step 2: Add weekly preview prop to TimelineHeader**

In `src/components/TimelineHeader.tsx`, import `LayoutGrid` and add an optional prop:

```ts
import { ChevronLeft, ChevronRight, Calendar, Sparkles, LayoutGrid } from "lucide-react";

interface TimelineHeaderProps {
  currentDate: Date;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onGoToday: () => void;
  onPreviewWeek?: () => void;
  weekIdentifier: string;
}
```

Destructure `onPreviewWeek` in the component parameters.

- [ ] **Step 3: Add preview button to TimelineHeader**

Inside the existing week navigation control group, after the next-week button, add:

```tsx
{onPreviewWeek && (
  <button
    onClick={onPreviewWeek}
    className="p-1 px-2 rounded-lg hover:bg-white dark:hover:bg-stone-800 text-stone-600 hover:text-amber-950 dark:text-stone-300 dark:hover:text-amber-200 transition-all shadow-sm cursor-pointer"
    title="Overview of The Week"
  >
    <LayoutGrid size={16} />
  </button>
)}
```

- [ ] **Step 4: Align TimelineHeader dark styling**

Change the header wrapper class to include the darker border/shadow:

```tsx
className="relative flex flex-col md:flex-row items-center justify-between gap-4 p-4 md:p-6 mb-4 bg-white dark:bg-stone-900 border border-amber-900/10 dark:border-stone-700/50 rounded-2xl shadow-sm dark:shadow-md select-none"
```

Change the dotted background div to:

```tsx
<div className="absolute inset-0 pointer-events-none rounded-2xl bg-[radial-gradient(#2d2319_1px,transparent_1px)] dark:bg-[radial-gradient(#ffffff_1px,transparent_1px)] opacity-5 [background-size:16px_16px]" />
```

- [ ] **Step 5: Add motion and weather imports to DaySlot**

At the top of `src/components/DaySlot.tsx`, add:

```ts
import { motion } from "motion/react";
import WeatherBackground from "./WeatherBackground";
```

- [ ] **Step 6: Add DaySlot drag bookkeeping**

Inside `DaySlot`, after `slotRef`, add:

```ts
const dragRef = useRef(false);
```

After `activeStackIndex`, add:

```ts
const [flyOutState, setFlyOutState] = useState<{ id: string; dir: number } | null>(null);
```

- [ ] **Step 7: Fix DaySlot paste listener dependency**

Change the paste listener effect cleanup block so the effect ends with an empty dependency array:

```ts
useEffect(() => {
  window.addEventListener("paste", handlePaste);
  return () => {
    window.removeEventListener("paste", handlePaste);
  };
}, []);
```

- [ ] **Step 8: Add weather background layer to DaySlot**

Add `overflow-hidden` to the root slot class and insert `<WeatherBackground />` immediately inside the root `<div>` before the hidden file input.

The root class must include:

```text
overflow-hidden
```

Wrap the header, error banner, and card-stack area with `relative z-10` class segments so weather particles stay behind content.

- [ ] **Step 9: Replace DaySlot stacked-card positioning with motion wrapper**

For each mapped card, calculate these target values before return:

```ts
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
```

Render each card with:

```tsx
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
```

- [ ] **Step 10: Update DaySlot empty and add-more affordances**

In the empty upload target, replace the plus icon container contents with:

```tsx
<div className="p-2 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-400 group-hover/dropzone:bg-amber-100 dark:group-hover/dropzone:bg-amber-950/40 group-hover/dropzone:text-amber-700 dark:group-hover/dropzone:text-amber-300 transition-colors transform group-hover/dropzone:-rotate-6 scale-100 group-hover/dropzone:scale-110 duration-300">
  <Sparkles size={16} strokeWidth={1.5} />
</div>
<div className="mt-3 text-xs font-serif italic font-medium text-stone-500 group-hover/dropzone:text-stone-800 dark:group-hover/dropzone:text-stone-300">
  New Inspiration
</div>
```

Keep the existing drop/paste/click helper text.

For the floating add button, use:

```tsx
<Sparkles size={12} strokeWidth={2} />
```

and ensure its class includes:

```text
hover:scale-110 hover:rotate-12 duration-300
```

- [ ] **Step 11: Update Polaroid delete button and shadows**

In `src/components/PolaroidCard.tsx`, remove the local `window.confirm` delete handler and call `onDeleteCard(card.id)` directly from the delete button.

Keep the image source as:

```tsx
src={card.thumbnailUrl || card.imageUrl}
```

Update the card wrapper class to include:

```text
dark:shadow-[0_12px_25px_rgba(0,0,0,0.8)] dark:border-stone-600/70
```

Replace the delete button with:

```tsx
<button
  onClick={() => onDeleteCard(card.id)}
  className="absolute -top-2 -right-2 opacity-0 group-hover/card:opacity-100 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-500 dark:text-stone-400 hover:text-red-500 dark:hover:text-red-400 rounded-full p-1.5 transition-all cursor-pointer z-40 shadow-sm border border-stone-200 dark:border-stone-700"
  title="删除这张相片卡"
>
  <X size={12} strokeWidth={2.5} />
</button>
```

- [ ] **Step 12: Pass weekly preview handler from App**

Add `showWeeklyPreview` state in `App`:

```ts
const [showWeeklyPreview, setShowWeeklyPreview] = useState<boolean>(false);
```

Pass it to `TimelineHeader`:

```tsx
onPreviewWeek={() => setShowWeeklyPreview(true)}
```

- [ ] **Step 13: Run typecheck**

Run:

```bash
npm run lint
```

Expected: command exits with code `0`.

- [ ] **Step 14: Commit**

Run:

```bash
git add src/components/TimelineHeader.tsx src/components/WeatherBackground.tsx src/components/DaySlot.tsx src/components/PolaroidCard.tsx src/App.tsx
git commit -m "迁移主面板卡片动效"
```

Expected: commit succeeds and does not include unrelated files.

---

### Task 4: Add Weekly Preview, Zoom Carousel, And Delete Animation

**Files:**
- Create: `src/components/WeeklyPreviewModal.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Copy WeeklyPreviewModal**

Run:

```bash
cp /Users/yisheng/Documents/SLUAN/ai-design-termboard/src/components/WeeklyPreviewModal.tsx src/components/WeeklyPreviewModal.tsx
```

Expected: command exits with code `0`.

- [ ] **Step 2: Add App imports**

In `src/App.tsx`, add:

```ts
import { WeeklyPreviewModal } from "./components/WeeklyPreviewModal";
```

Ensure the lucide import includes:

```ts
ChevronLeft, ChevronRight
```

- [ ] **Step 3: Add delete animation state**

In `App`, add:

```ts
const [cardToDelete, setCardToDelete] = useState<ImageCard | null>(null);
const [deletePhase, setDeletePhase] = useState<"prompt" | "animating">("prompt");
```

- [ ] **Step 4: Replace immediate delete handler with prompt trigger**

Replace the current `handleDeleteCard` with:

```ts
const handleDeleteCard = (cardId: string) => {
  const card = cards.find((c) => c.id === cardId);
  if (card) {
    setCardToDelete(card);
    setDeletePhase("prompt");
  }
};
```

Add the confirmation function:

```ts
const confirmDeleteCard = async () => {
  if (!cardToDelete) return;
  setDeletePhase("animating");

  await new Promise((resolve) => setTimeout(resolve, 1200));

  try {
    await deleteCard(cardToDelete.id, cardToDelete.weekId);
  } catch (err) {
    console.error("Card removal error:", err);
  } finally {
    setCardToDelete(null);
    setDeletePhase("prompt");
  }
};
```

- [ ] **Step 5: Add zoom carousel helpers**

After `filteredCards`, add:

```ts
const handlePrevZoomedCard = (e: React.MouseEvent) => {
  e.stopPropagation();
  if (filteredCards.length <= 1 || !zoomedCard) return;
  const currentIdx = filteredCards.findIndex((c) => c.id === zoomedCard.id);
  if (currentIdx === -1) return;
  const prevIdx = (currentIdx - 1 + filteredCards.length) % filteredCards.length;
  setZoomedCard(filteredCards[prevIdx]);
};

const handleNextZoomedCard = (e: React.MouseEvent) => {
  e.stopPropagation();
  if (filteredCards.length <= 1 || !zoomedCard) return;
  const currentIdx = filteredCards.findIndex((c) => c.id === zoomedCard.id);
  if (currentIdx === -1) return;
  const nextIdx = (currentIdx + 1) % filteredCards.length;
  setZoomedCard(filteredCards[nextIdx]);
};
```

- [ ] **Step 6: Add keyboard navigation effect**

After zoom helpers, add:

```ts
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!zoomedCard || filteredCards.length <= 1) {
      if (zoomedCard && e.key === "Escape") {
        setZoomedCard(null);
      }
      return;
    }

    const currentIdx = filteredCards.findIndex((c) => c.id === zoomedCard.id);
    if (currentIdx === -1) return;

    if (e.key === "ArrowLeft") {
      const prevIdx = (currentIdx - 1 + filteredCards.length) % filteredCards.length;
      setZoomedCard(filteredCards[prevIdx]);
    } else if (e.key === "ArrowRight") {
      const nextIdx = (currentIdx + 1) % filteredCards.length;
      setZoomedCard(filteredCards[nextIdx]);
    } else if (e.key === "Escape") {
      setZoomedCard(null);
    }
  };

  window.addEventListener("keydown", handleKeyDown);
  return () => {
    window.removeEventListener("keydown", handleKeyDown);
  };
}, [zoomedCard, filteredCards]);
```

- [ ] **Step 7: Render weekly preview modal**

Before the delete modal and zoom modal sections, add:

```tsx
{showWeeklyPreview && (
  <WeeklyPreviewModal
    cards={cards.filter((c) => c.weekId === weekId)}
    weekRangeStr={weekId || "Current Week"}
    onClose={() => setShowWeeklyPreview(false)}
  />
)}
```

- [ ] **Step 8: Add delete confirmation modal**

Before the zoom modal section, add this complete modal:

```tsx
<AnimatePresence>
  {cardToDelete && (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => deletePhase === "prompt" && setCardToDelete(null)}
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-sm bg-stone-100 dark:bg-stone-900 rounded-2xl shadow-xl overflow-hidden border border-stone-200 dark:border-stone-800 p-6 flex flex-col gap-4 text-center z-10"
      >
        <div className="relative mx-auto w-32 h-40 flex flex-col items-center justify-start overflow-hidden mb-2 pt-2">
          <motion.div
            animate={
              deletePhase === "animating"
                ? { y: 120 }
                : { y: 0, rotate: [-1, 1, -1], transition: { repeat: Infinity, duration: 4, ease: "easeInOut" } }
            }
            transition={deletePhase === "animating" ? { duration: 0.7, ease: "anticipate" } : {}}
            className="z-10 w-24 h-28 bg-white p-1.5 shadow-sm flex flex-col border border-stone-200 dark:border-stone-700"
          >
            <img
              src={cardToDelete.thumbnailUrl || cardToDelete.imageUrl}
              className="w-full h-16 object-cover bg-stone-200 dark:bg-stone-800"
              alt=""
            />
            <div className="flex-1 mt-1 bg-stone-50 dark:bg-stone-800 flex items-end p-1">
              <div className="h-1 flex-1 bg-stone-200 dark:bg-stone-700 rounded-full w-1/2 opacity-50" />
            </div>
          </motion.div>

          <div className="absolute bottom-6 w-full flex justify-center z-20">
            <div className="w-28 h-3 bg-stone-300 dark:bg-stone-800 rounded-sm border border-stone-400 dark:border-stone-700 shadow-inner flex items-center justify-center">
              <div className="w-[100px] h-1.5 bg-stone-800 dark:bg-black rounded-full" />
            </div>
          </div>

          <div className="absolute bottom-0 w-24 h-6 flex justify-between gap-[1px] z-0 px-0.5">
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                initial={{ y: -24, opacity: 0 }}
                animate={deletePhase === "animating" ? { y: 24, opacity: [0, 1, 0] } : {}}
                transition={deletePhase === "animating" ? { duration: 0.6, delay: 0.4 + i * 0.05 } : {}}
                className="flex-1 bg-white border-x border-b border-stone-200 dark:border-stone-700 h-10 shadow-sm rounded-b-sm"
              />
            ))}
          </div>
        </div>

        <h3 className="text-xl font-bold font-sans text-stone-800 dark:text-stone-100">Delete Photo?</h3>
        <p className="text-sm text-stone-500 dark:text-stone-400 font-sans">
          This photo will be permanently removed.<br />Are you sure you want to proceed?
        </p>
        <div className="flex gap-3 mt-2">
          <button
            disabled={deletePhase === "animating"}
            onClick={() => setCardToDelete(null)}
            className="flex-1 py-2.5 rounded-xl font-medium text-stone-600 dark:text-stone-300 bg-stone-200 dark:bg-stone-800 hover:bg-stone-300 dark:hover:bg-stone-700 transition disabled:opacity-50"
            id="cancel-delete-card-btn"
          >
            Cancel
          </button>
          <button
            disabled={deletePhase === "animating"}
            onClick={confirmDeleteCard}
            className="flex-1 py-2.5 rounded-xl font-medium text-white bg-red-500 hover:bg-red-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
            id="confirm-delete-card-btn"
          >
            {deletePhase === "animating" ? "Deleting..." : "Delete"}
          </button>
        </div>
      </motion.div>
    </div>
  )}
</AnimatePresence>
```

- [ ] **Step 9: Add zoom modal arrows**

Inside the zoom modal image container, after the image overlay, add:

```tsx
{filteredCards.length > 1 && (
  <>
    <button
      onClick={handlePrevZoomedCard}
      className="absolute left-3 top-1/2 -translate-y-1/2 z-20 bg-stone-950/70 hover:bg-amber-500 hover:scale-110 active:scale-95 text-white p-2.5 rounded-full shadow-lg border border-white/10 transition-all cursor-pointer opacity-80 hover:opacity-100"
      title="上一张 (ArrowLeft)"
    >
      <ChevronLeft size={18} />
    </button>
    <button
      onClick={handleNextZoomedCard}
      className="absolute right-3 top-1/2 -translate-y-1/2 z-20 bg-stone-950/70 hover:bg-amber-500 hover:scale-110 active:scale-95 text-white p-2.5 rounded-full shadow-lg border border-white/10 transition-all cursor-pointer opacity-80 hover:opacity-100"
      title="下一张 (ArrowRight)"
    >
      <ChevronRight size={18} />
    </button>
  </>
)}
```

Ensure the image container class includes:

```text
group/zoomimage
```

- [ ] **Step 10: Run typecheck**

Run:

```bash
npm run lint
```

Expected: command exits with code `0`.

- [ ] **Step 11: Commit**

Run:

```bash
git add src/components/WeeklyPreviewModal.tsx src/App.tsx
git commit -m "添加周预览和删除动画"
```

Expected: commit succeeds and does not include unrelated files.

---

### Task 5: Preserve Production Logic And Verify End-To-End

**Files:**
- Inspect: `src/App.tsx`
- Inspect: `src/components/SettingsModal.tsx`
- Inspect: `src/components/PolaroidCard.tsx`
- Inspect: `src/lib/dbClient.ts`

- [ ] **Step 1: Verify protected upload flow is still present**

Run:

```bash
rg -n "/api/store-image|thumbnailUrl|photoUid|analyzeAndUpdateTerms|custom_thirdparty|x-thinking-enabled|refreshCards|loadSettings|saveSettings" src/App.tsx
```

Expected output includes all of these strings:

```text
/api/store-image
thumbnailUrl
photoUid
analyzeAndUpdateTerms
custom_thirdparty
x-thinking-enabled
refreshCards
loadSettings
saveSettings
```

- [ ] **Step 2: Verify board cards still prefer thumbnails**

Run:

```bash
rg -n "thumbnailUrl \\|\\| card\\.imageUrl" src/components/PolaroidCard.tsx
```

Expected: one match in `PolaroidCard.tsx`.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run lint
```

Expected: command exits with code `0`.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: the output contains Vite build completion text, esbuild emits `dist/server.cjs`, and the command exits with code `0`.

- [ ] **Step 5: Start local dev server**

Run:

```bash
npm run dev
```

Expected server output contains a local URL such as:

```text
http://localhost:5173
```

Keep this process running for browser verification, then stop it after checks finish.

- [ ] **Step 6: Browser-check login page**

Open the local URL. Verify:

- Ink reveal canvas appears over the background image.
- Email and password fields render.
- Password visibility button toggles input type.
- Empty submit shows the bilingual validation message.
- Login/register switch changes the submit label between `启程` and `凝结`.

- [ ] **Step 7: Browser-check authenticated app**

After signing in with a valid Firebase Auth account, verify:

- App shell renders without losing existing cards or notes.
- Logout button returns to the login screen.
- Settings button still opens the full current settings modal, including third-party provider fields.
- Manual refresh button is still visible and clickable.
- Light/dark toggle remains readable.

- [ ] **Step 8: Browser-check board interactions**

With at least two cards in a day slot, verify:

- Weather particles animate behind the slot content.
- Arrow buttons cycle the visible card.
- Horizontal drag/swipe cycles the stack and does not open zoom during drag.
- Empty slot sparkle upload target still supports click, paste, and drop.
- Add-more sparkle button opens file picker.

- [ ] **Step 9: Browser-check modal interactions**

Verify:

- Weekly preview opens from the header grid button.
- Weekly preview masonry cards show images and terms.
- Clicking a board card opens the zoom modal.
- Zoom modal previous/next buttons cycle filtered cards.
- ArrowLeft and ArrowRight keys cycle zoomed cards.
- Escape closes the zoom modal.
- Delete button opens the animated delete modal.
- Cancel closes the delete modal without deleting.
- Confirm plays the delete animation and deletes through the existing data path.

- [ ] **Step 10: Final status check**

Run:

```bash
git status --short
```

Expected: only intentional implementation files are modified or the working tree is clean after commits. Do not stage unrelated pre-existing changes unless they are part of the implementation.

- [ ] **Step 11: Commit final verification fixes if needed**

If browser verification required small fixes, run:

```bash
git add src/App.tsx src/components/LoginScreen.tsx src/components/WeatherBackground.tsx src/components/WeeklyPreviewModal.tsx src/components/ui/ink-reveal.tsx src/components/ui/masonry-grid.tsx src/components/TimelineHeader.tsx src/components/DaySlot.tsx src/components/PolaroidCard.tsx src/index.css src/lib/firebase.ts src/lib/utils.ts package.json package-lock.json
git commit -m "完善样式迁移验证修复"
```

Expected: commit succeeds with only verification-fix files from the explicit `git add` list. If no fixes were needed, skip this step.

## Self-Review

- Spec coverage: Tasks cover login/register, auth gate, logout, weather background, weekly preview, card swipe, zoom carousel, delete animation, dark styling, and protected production data flows.
- Placeholder scan: The plan contains no open-ended implementation markers.
- Type consistency: The plan uses existing `ImageCard`, `SettingsModal`, `subscribeCards`, `subscribeAllCards`, `refreshCards`, `loadSettings`, `saveSettings`, `deleteCard`, and `updateCardTerms` names consistently.
