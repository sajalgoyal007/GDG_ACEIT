export interface UnverifiedProgressPreviewState {
  status: "idle" | "error" | "preview" | "success";
  message: string;
  issues?: { rowNumber: number; kind: "invalid" | "duplicate"; message: string }[];
  rows?: {
    rowNumber: number;
    participantId: string;
    participantKey: string;
    profileUrl: string;
    normalizedProfileUrl: string;
    badgeCount: number;
    displayName: string;
  }[];
}

export const initialUnverifiedProgressPreviewState: UnverifiedProgressPreviewState = { status: "idle", message: "" };
