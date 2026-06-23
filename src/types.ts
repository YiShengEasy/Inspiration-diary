export interface ImageCard {
  id: string;
  weekId: string;
  dayIndex: number; // 0: Mon, 1: Tue, 2: Wed, 3: Thu, 4: Fri, 5: Weekend
  imageUrl: string; // Compressed base64 string
  terms: string[];
  decoType: "tape" | "pin" | "paperclip" | "washi";
  angle: number; // Random value from -3 to 3 for polaroid tilt styling
  createdAt: number;
  userId?: string; 
  userName?: string;
  isPublic?: boolean;
  likes?: number;
  type?: "image" | "md";
  mdContent?: string;
  mdSummary?: string;
  mdName?: string;
}

export interface WeeklyNote {
  weekId: string;
  note: string;
  height: number;
  moodColor?: string;
}
