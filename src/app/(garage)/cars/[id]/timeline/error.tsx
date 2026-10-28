"use client";

export default function TimelineError({ reset }: { reset: () => void }) {
  return <main className="page"><h1 className="page-title">Timeline unavailable</h1><p role="alert">The recorded history could not be loaded. Try again.</p><button className="button" onClick={reset}>Try again</button></main>;
}
