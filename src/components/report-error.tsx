"use client";

export default function ReportError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="page"><h1 className="page-title">Costs unavailable</h1>
    <p className="notice notice--error" role="alert">The costs could not be loaded. Try again to load the latest records.</p>
    <button className="button" onClick={reset}>Try again</button>
  </main>;
}
