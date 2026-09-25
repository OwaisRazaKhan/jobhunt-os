import { FileUp, PenLine } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Welcome · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  await requireActorOrRedirect();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-6 md:py-12">
      <div>
        <p className="text-fg-subtle font-mono text-[11px] tracking-wide uppercase">
          Getting started
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Build your candidate profile</h1>
        <p className="text-fg-muted mt-2 text-sm">
          JOBHUNT OS uses this information as the source of truth when analyzing jobs and preparing
          applications. Nothing is invented: every fact comes from you or from a document you
          upload, and nothing extracted is added until you approve it.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/candidate/documents?import=cv"
          className="group border-border bg-surface-1 hover:border-accent/60 rounded-lg border p-4 transition-colors"
        >
          <FileUp className="text-accent size-5" aria-hidden />
          <h2 className="mt-3 text-sm font-semibold">Import CV</h2>
          <p className="text-fg-muted mt-1 text-xs">
            Upload a PDF, DOCX or TXT. We extract possible facts and you review each one.
          </p>
        </Link>
        <Link
          href="/candidate/onboarding?step=basic"
          className="group border-border bg-surface-1 hover:border-accent/60 rounded-lg border p-4 transition-colors"
        >
          <PenLine className="text-accent size-5" aria-hidden />
          <h2 className="mt-3 text-sm font-semibold">Build manually</h2>
          <p className="text-fg-muted mt-1 text-xs">
            Go step by step. Save a draft, skip anything, and continue later.
          </p>
        </Link>
      </div>
      <p className="text-fg-subtle text-xs">
        You can do both — import a CV and then complete missing sections manually. Your data is
        private to your account and can be exported or deleted at any time from Settings.
      </p>
    </div>
  );
}
