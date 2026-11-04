import type {
  ResolvedClassifiedBadgeCsvRow,
  ClassifiedBadgeCsvIssue,
} from "@/lib/participants/classified-badge-csv";

export type ClassifiedBadgeImportRow = ResolvedClassifiedBadgeCsvRow;

export interface ClassifiedBadgeImportResult {
  rowNumber: number;
  participantId: string;
  skillBadgeCount: number;
  arcadeGameBadgeCount: number;
  totalBadgeCount: number;
  status: "success" | "skipped" | "failed";
  reason: string;
}

export interface ClassifiedBadgeImportState {
  status: "idle" | "error" | "preview" | "success";
  message: string;
  issues?: ClassifiedBadgeCsvIssue[];
  rows?: ClassifiedBadgeImportRow[];
  results?: ClassifiedBadgeImportResult[];
}

export const initialClassifiedBadgeImportState: ClassifiedBadgeImportState = {
  status: "idle",
  message: "",
};

