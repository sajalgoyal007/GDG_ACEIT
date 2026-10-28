export default function Loading() {
  return <main className="community-loading" aria-busy="true" aria-label="Loading community leaderboard">
    <div className="loading-topline" aria-hidden="true" />
    <div className="loading-heading-block" aria-hidden="true"><span/><span/><span/></div>
    <div className="loading-demo-banner" aria-hidden="true" />
    <div className="loading-summary-grid" aria-hidden="true">{[0,1,2,3].map(item=><div className="loading-summary-card" key={item} />)}</div>
    <div className="loading-board" aria-hidden="true" />
    <p className="sr-only" role="status">Loading leaderboard data…</p>
  </main>;
}
