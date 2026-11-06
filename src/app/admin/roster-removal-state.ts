export interface RosterRemovalCandidate {
  id: string;
  displayName: string;
  profileUrl: string;
  registrationStatus: "registered" | "pending";
  verifiedBadgeCount: number;
  lastVerifiedAt: string | null;
}

export interface RosterRemovalPreviewState {
  status: "idle" | "preview" | "success" | "error";
  message: string;
  issues?: { rowNumber: number; kind: string; message: string }[];
  rows?: RosterRemovalCandidate[];
  authoritativeUrls?: string[];
  authoritativeCount?: number;
  matchedCount?: number;
  missingAuthoritativeCount?: number;
}

export const initialRosterRemovalPreviewState: RosterRemovalPreviewState = {
  status: "idle",
  message: "",
};

export const initialRosterRemovalApplyState: RosterRemovalPreviewState = {
  status: "idle",
  message: "",
};
