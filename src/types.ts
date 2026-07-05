export interface ImageCard {
  id: string;
  weekId: string;
  dayIndex: number; // 0: Mon, 1: Tue, 2: Wed, 3: Thu, 4: Fri, 5: Weekend
  imageUrl: string; // Large PhotoPrism image URL
  thumbnailUrl?: string; // PhotoPrism thumbnail URL for board cards
  photoUid?: string; // PhotoPrism photo/file identifier used for traceability
  photoHash?: string; // PhotoPrism content hash used by authenticated proxy routes
  terms: string[];
  decoType: "tape" | "pin" | "paperclip" | "washi";
  angle: number; // Random value from -3 to 3 for polaroid tilt styling
  createdAt: number;
  type?: "image" | "md" | "video";
  mdContent?: string;
  mdSummary?: string;
  mdName?: string;
  insightNote?: string;
  videoAssets?: VideoAsset[];
  imageAssets?: ImageAsset[];
}

export interface VideoAsset {
  id: string;
  cardId: string;
  storageProvider: "local" | "oss" | string;
  storageKey: string;
  videoUrl: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  posterUrl?: string;
  createdAt: number;
}

export interface ImageAsset {
  id: string;
  cardId: string;
  storageProvider: "local" | "oss" | string;
  storageKey: string;
  imageUrl: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
}

export interface WeeklyNote {
  weekId: string;
  note: string;
  height: number;
}

export interface InspirationBook {
  id: string;
  title: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  cardCount: number;
  coverCardId: string;
  coverCard: ImageCard | null;
}

export interface CardBookMembership {
  id: string;
  title: string;
  description: string;
  cardCount: number;
  containsCard: boolean;
}

export type BookSuggestionFeedbackAction = "accepted" | "corrected" | "dismissed";

export interface BookSuggestionCandidate {
  book: InspirationBook;
  score: number;
  baseScore: number;
  feedbackAdjustment: number;
  matchedTerms: string[];
}

export interface PaginatedBookCardsResult {
  cards: ImageCard[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CustomTagGroup {
  id: string;
  name: string;
  enabled: boolean;
  terms: string[];
  createdAt: number;
  updatedAt: number;
}
