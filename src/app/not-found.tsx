import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <p className="text-fg-subtle font-mono text-xs">404</p>
        <h1 className="mt-1 text-lg font-semibold">Not found</h1>
        <p className="text-fg-muted mt-1 text-sm">
          This page does not exist or you do not have access to it.
        </p>
        <Link href="/candidate" className="text-accent mt-4 inline-block text-sm hover:underline">
          Back to your profile
        </Link>
      </div>
    </main>
  );
}
