"use client";

import { Button } from "@/components/ui/button";

/** Jobs workspace failure: safe message + retry (no internal details). */
export default function JobsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      role="alert"
      className="border-border bg-surface-1 mx-auto mt-16 max-w-md rounded-lg border p-6"
    >
      <h1 className="text-sm font-semibold">Could not load jobs.</h1>
      <p className="text-fg-muted mt-1 text-sm">
        The job search did not complete. Your filters, bookmarks and saved searches are safe.
      </p>
      {error.digest && (
        <p className="text-fg-subtle mt-2 font-mono text-[11px]">Reference: {error.digest}</p>
      )}
      <Button variant="primary" size="sm" className="mt-4" onClick={reset}>
        Retry
      </Button>
    </div>
  );
}
