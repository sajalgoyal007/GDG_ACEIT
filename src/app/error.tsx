"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="error-page" role="alert">
    <div className="error-card"><span className="error-mark">!</span><p className="eyebrow">REQUEST UNAVAILABLE</p><h1>We couldn’t load this page.</h1><p>The request could not be completed, so no fallback or guessed values were substituted. Please try again, and share the diagnostic reference with the project maintainer if the issue continues.</p>{error.digest && <p className="error-diagnostic">Diagnostic reference: <code>{error.digest}</code></p>}<button onClick={() => reset()}>Try again</button></div>
  </main>;
}
