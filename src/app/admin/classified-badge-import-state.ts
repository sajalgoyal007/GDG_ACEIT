import type {
  ResolvedClassifiedBadgeCsvRow,
  ClassifiedBadgeCsvIssue,
} from "@/lib/participants/classified-badge-csv";

export type ClassifiedBadgePreviewStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "ignored"
  | "unclassified";

/**
 * Rows come either from a parsed CSV (all counts present) or from a server
 * snapshot, where blocked/incomplete rows intentionally carry NULL counts.
 * NULL means "not applicable / not known" and must render as an em dash, never
 * as zero.
 */
export interface ClassifiedBadgeImportRow
  extends Omit<
    ResolvedClassifiedBadgeCsvRow,
    "skillBadgeCount" | "arcadeGameBadgeCount" | "totalBadgeCount"
  > {
  skillBadgeCount: number | null;
  arcadeGameBadgeCount: number | null;
  totalBadgeCount: number | null;
  previewStatus?: ClassifiedBadgePreviewStatus;
  delta?: number | null;
  pendingBadgeCount?: number;
  unclassifiedBadgeCount?: number;
  isRemoved?: boolean;
  isRegression?: boolean;
  isStale?: boolean;
  blockingReason?: string | null;
}

export interface ClassifiedBadgeImportResult {
  rowNumber: number;
  participantId: string;
  /** NULL means the row was not applied (blocked, skipped or failed). */
  skillBadgeCount: number | null;
  arcadeGameBadgeCount: number | null;
  totalBadgeCount: number | null;
  status: "success" | "skipped" | "failed";
  reason: string;
}

export interface ClassifiedBadgePreviewTotals {
  participants: number;
  skill: number;
  arcade: number;
  total: number;
  unclassified: number;
  pending: number;
  blocked: number;
}

export interface ClassifiedBadgeImportState {
  status: "idle" | "error" | "preview" | "success";
  message: string;
  issues?: ClassifiedBadgeCsvIssue[];
  rows?: ClassifiedBadgeImportRow[];
  results?: ClassifiedBadgeImportResult[];
  /** Persistent server-side run identity. Never trusted as authorization. */
  runId?: string;
  /** Server-generated preview fingerprint validated again during apply. */
  previewFingerprint?: string;
  runStatus?: string;
  blockedCount?: number;
  totals?: ClassifiedBadgePreviewTotals;
}

export const initialClassifiedBadgeImportState: ClassifiedBadgeImportState = {
  status: "idle",
  message: "",
};
