export default function JobsLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading jobs">
      <div className="bg-surface-2 h-6 w-40 animate-pulse rounded" />
      <div className="bg-surface-1 h-8 animate-pulse rounded-md" />
      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="bg-surface-1 hidden h-96 animate-pulse rounded-lg xl:block" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="bg-surface-1 h-12 animate-pulse rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}
