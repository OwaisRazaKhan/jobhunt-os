import { Briefcase, Plug, Plus, Radar } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Alert, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { listJobs } from "@/modules/jobs/jobs.service";
import { JobsTable } from "@/modules/jobs/ui/jobs-table";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Jobs · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const actor = await requireActorOrRedirect();
  const [jobs, params] = await Promise.all([listJobs(actor), searchParams]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Discovery"
        title="Jobs"
        description="Jobs discovered from legitimate sources or added by you. Every job keeps its source attribution; unknown details stay unknown."
        actions={
          <>
            <Link href="/jobs/profiles" className={buttonClass("secondary", "sm")}>
              <Radar className="size-3.5" aria-hidden /> Search profiles
            </Link>
            <Link href="/jobs/sources" className={buttonClass("secondary", "sm")}>
              <Plug className="size-3.5" aria-hidden /> Sources
            </Link>
            <Link href="/jobs/new" className={buttonClass("primary", "sm")}>
              <Plus className="size-3.5" aria-hidden /> Add job
            </Link>
          </>
        }
      />
      {params.deleted === "1" && (
        <Alert tone="success">Job deleted. It will be permanently purged after 30 days.</Alert>
      )}
      <Card>
        <CardHeader title="All jobs" count={jobs.length} />
        {jobs.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="size-6" />}
            title="No jobs yet"
            description="Add a job you found yourself. Automated sources such as Ashby and Lever come later."
            action={
              <Link href="/jobs/new" className={buttonClass("primary", "sm")}>
                <Plus className="size-3.5" aria-hidden /> Add job
              </Link>
            }
          />
        ) : (
          <JobsTable jobs={jobs} />
        )}
      </Card>
    </div>
  );
}
