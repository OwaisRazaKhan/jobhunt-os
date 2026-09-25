import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/forms/action-form";
import { buttonClass } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/primitives";
import { listCountries } from "@/modules/candidate";
import { MANUAL_JOB_FIELDS } from "@/modules/jobs/job-form-fields";
import { getJob } from "@/modules/jobs/jobs.service";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";
import { updateJobAction } from "../../actions";

export const metadata: Metadata = { title: "Edit job · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function EditJobPage({ params }: PageProps<"/jobs/[id]/edit">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const result = await getJob(actor, id).catch((error) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  // Only the creator of a manual job may edit it.
  if (!result.canEdit) notFound();
  const { job } = result;
  const countries = await listCountries(actor);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Link href={`/jobs/${job.id}`} className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> Back to job
      </Link>
      <PageHeader eyebrow="Manual entry" title="Edit job" description={job.title} />
      <Card className="p-4">
        <ActionForm
          action={updateJobAction}
          fields={MANUAL_JOB_FIELDS}
          hidden={{ _id: job.id }}
          values={{ ...job, company: job.company.name }}
          context={{ countries: countries.map((c) => ({ value: c.code, label: c.name })) }}
          submitLabel="Save changes"
        />
      </Card>
    </div>
  );
}
