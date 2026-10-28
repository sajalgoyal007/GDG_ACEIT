import type { CsvIssue } from "@/lib/participants/csv";

export interface AdminActionState {
  status: "idle" | "success" | "error";
  message: string;
  issues?: CsvIssue[];
}

export const initialAdminActionState: AdminActionState = { status: "idle", message: "" };
