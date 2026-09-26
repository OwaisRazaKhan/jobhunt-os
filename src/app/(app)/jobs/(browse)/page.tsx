import type { Metadata } from "next";
import { Alert } from "@/components/ui/primitives";
import { requireActorOrRedirect } from "@/server/session";
import { JobsWorkspace } from "./workspace";

export const metadata: Metadata = { title: "Jobs · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const actor = await requireActorOrRedirect();
  const raw = await searchParams;
  return (
    <>
      {raw.deleted === "1" && (
        <div className="mb-4">
          <Alert tone="success">Job deleted. It will be permanently purged after 30 days.</Alert>
        </div>
      )}
      <JobsWorkspace actor={actor} view="all" raw={withoutFlags(raw)} />
    </>
  );
}

/** One-off UI flags are not search parameters. */
function withoutFlags(raw: Record<string, string | string[] | undefined>) {
  const { deleted: _deleted, ...rest } = raw;
  return rest;
}
