export default function AdminLoading() {
  return <main className="admin-loading dark-community" aria-busy="true" aria-live="polite">
    <span className="admin-loading-mark" aria-hidden="true" />
    <p>Checking administrator access…</p>
  </main>;
}
