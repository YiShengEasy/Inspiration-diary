export interface ImageCard {
  id: string;
  weekId: string;
  dayIndex: number; // 0: Mon, 1: Tue, 2: Wed, 3: Thu, 4: Fri, 5: Weekend
  imageUrl: string; // Large PhotoPrism image URL
  thumbnailUrl?: string; // PhotoPrism thumbnail URL for board cards
  photoUid?: string; // PhotoPrism photo/file identifier used for traceability
  terms: string[];
  decoType: "tape" | "pin" | "paperclip" | "washi";
  angle: number; // Random value from -3 to 3 for polaroid tilt styling
  createdAt: number;
}

export interface WeeklyNote {
  weekId: string;
  note: string;
  height: number;
}
