import type { GoogleFormSyncPreview } from "@/lib/google-sheets/sync-service";

export interface GoogleFormSyncActionState {
  status: "idle" | "error" | "preview" | "success";
  message: string;
  preview?: GoogleFormSyncPreview;
}

export const initialGoogleFormSyncState: GoogleFormSyncActionState = { status: "idle", message: "" };
