export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <div className="bg-surface-2 h-6 w-48 animate-pulse rounded" />
      <div className="bg-surface-1 h-32 animate-pulse rounded-lg" />
      <div className="bg-surface-1 h-48 animate-pulse rounded-lg" />
    </div>
  );
}
