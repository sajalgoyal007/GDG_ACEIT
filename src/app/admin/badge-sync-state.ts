import type { BadgeSyncSnapshot } from "@/lib/badges/snapshot";
import type { CatalogCategory } from "@/lib/badges/catalog";

export interface BadgeCatalogRow {
  badgeKey: string;
  displayName: string;
  category: CatalogCategory;
  source: string;
}

export interface BadgeCatalogActionState {
  status: "idle" | "error" | "success";
  message: string;
  entries?: BadgeCatalogRow[];
}

export interface BadgeSyncActionState {
  status: "idle" | "error" | "success";
  message: string;
  snapshot?: BadgeSyncSnapshot;
}

export const initialBadgeCatalogActionState: BadgeCatalogActionState = { status: "idle", message: "" };
export const initialBadgeSyncActionState: BadgeSyncActionState = { status: "idle", message: "" };
