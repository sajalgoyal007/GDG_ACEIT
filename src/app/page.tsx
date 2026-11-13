import { HomeHub } from "@/components/home-hub";
import { getLeaderboardProvider } from "@/lib/leaderboard-provider";

export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshot = await getLeaderboardProvider().getPublicSnapshot();
  return <HomeHub snapshot={snapshot} />;
}
