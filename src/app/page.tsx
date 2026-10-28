import { Dashboard } from "@/components/dashboard";
import { getLeaderboardProvider } from "@/lib/leaderboard-provider";

export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshot = await getLeaderboardProvider().getPublicSnapshot();
  return <Dashboard snapshot={snapshot} />;
}
