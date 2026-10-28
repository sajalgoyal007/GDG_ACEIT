import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard";
import { getLeaderboardProvider } from "@/lib/leaderboard-provider";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Community Progress | GDG On Campus ACEIT",
  description: "Provider-backed participant badge progress and historical GDG ACEIT community highlights.",
};

export default async function ProgressPage() {
  const snapshot = await getLeaderboardProvider().getPublicSnapshot();
  return <Dashboard snapshot={snapshot} view="progress" />;
}
