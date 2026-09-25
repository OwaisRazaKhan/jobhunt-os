import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/forms/action-form";
import { buttonClass } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/primitives";
import { listCountries } from "@/modules/candidate";
import { MANUAL_JOB_FIELDS } from "@/modules/jobs/job-form-fields";
import { requireActorOrRedirect } from "@/server/session";
import { createJobAction } from "../actions";

export const metadata: Metadata = { title: "Add job · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function NewJobPage() {
  const actor = await requireActorOrRedirect();
  const countries = await listCountries(actor);
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Link href="/jobs" className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> All jobs
      </Link>
      <PageHeader
        eyebrow="Manual entry"
        title="Add a job"
        description="Saved to your jobs as a Manual Entry, visible only to you. Leave anything you don't know empty — it stays unknown."
      />
      <Card className="p-4">
        <ActionForm
          action={createJobAction}
          fields={MANUAL_JOB_FIELDS}
          context={{ countries: countries.map((c) => ({ value: c.code, label: c.name })) }}
          submitLabel="Save job"
        />
      </Card>
    </div>
  );
}
