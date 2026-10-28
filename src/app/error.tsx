"use client";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="error-page" role="alert">
    <div className="error-card"><span className="error-mark">!</span><p className="eyebrow">LEADERBOARD UNAVAILABLE</p><h1>We couldn’t load the dashboard.</h1><p>Please try again. If the problem continues, contact your community leads.</p><button onClick={() => reset()}>Try again</button></div>
  </main>;
}
