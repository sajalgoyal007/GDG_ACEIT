import type { ResolvedVerifiedBadgeCsvRow, VerifiedBadgeCsvIssue } from "@/lib/participants/verified-badge-csv";

export type VerifiedBadgeImportRow = ResolvedVerifiedBadgeCsvRow;

export interface VerifiedBadgeImportResult {
  rowNumber: number;
  participantId: string;
  badgeCount: number;
  status: "success" | "skipped" | "failed";
  reason: string;
}

export interface VerifiedBadgeImportState {
  status: "idle" | "error" | "preview" | "success";
  message: string;
  issues?: VerifiedBadgeCsvIssue[];
  rows?: VerifiedBadgeImportRow[];
  results?: VerifiedBadgeImportResult[];
}

export const initialVerifiedBadgeImportState: VerifiedBadgeImportState = { status: "idle", message: "" };
