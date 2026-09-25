"use client";

import { Button } from "@/components/ui/button";

export default function AppError({
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
      <h1 className="text-sm font-semibold">Something went wrong</h1>
      <p className="text-fg-muted mt-1 text-sm">
        The page could not be loaded. Your data is safe — please try again.
      </p>
      {error.digest && (
        <p className="text-fg-subtle mt-2 font-mono text-[11px]">Reference: {error.digest}</p>
      )}
      <Button variant="secondary" size="sm" className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
