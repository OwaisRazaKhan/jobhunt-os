import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/ids";
import { listJobOptions } from "@/modules/communications/communication.service";
import { listPackageOptions } from "@/modules/communications/package.service";
import { PackageForm } from "@/modules/communications/ui/package-controls";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "New communication package · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function NewPackagePage({
  searchParams,
}: PageProps<"/communication-packages/new">) {
  const actor = await requireActorOrRedirect();
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return typeof v === "string" && isUuid(v) ? v : null;
  };
  const jobId = one("jobId");
  if (!jobId) {
    const jobs = await listJobOptions(actor, null);
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          eyebrow="Communication packages"
          title="New communication package"
          description="Pick the job the package is for."
        />
        <Card>
          <CardHeader title="Your jobs" />
          <ul className="divide-border divide-y text-sm">
            {jobs.map((j) => (
              <li key={j.value} className="px-4 py-2">
                <Link
                  href={`/communication-packages/new?jobId=${j.value}`}
                  className="hover:underline"
                >
                  {j.label}
                </Link>
              </li>
            ))}
            {jobs.length === 0 && (
              <li className="text-fg-muted px-4 py-3 text-xs">
                No jobs yet — open a job from Jobs first.
              </li>
            )}
          </ul>
        </Card>
      </div>
    );
  }
  const options = await listPackageOptions(actor, jobId).catch(() => null);
  if (!options) redirect("/communication-packages/new");
  const [job] = (await listJobOptions(actor, jobId)).filter((j) => j.value === jobId);
  // Preselect the exact versions passed in (e.g. from Resume Studio / a communication), else the newest approved.
  const pick = (param: string, list: { value: string }[]) => {
    const v = one(param);
    return v && list.some((o) => o.value === v) ? v : (list[0]?.value ?? null);
  };
  const emailVersionId = one("emailVersionId");
  const coverLetterVersionId = one("coverLetterVersionId");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Communication packages"
        title="New communication package"
        description={`For ${job?.label ?? "this job"}. Choose the exact approved versions; the readiness check runs as soon as you create it.`}
      />
      {options.resumes.length === 0 && (
        <Alert tone="warning" title="No approved resume for this job yet">
          A package needs an approved resume version.{" "}
          <Link href={`/resumes/tailor?job=${jobId}`} className="underline">
            Tailor and approve one
          </Link>
          .
        </Alert>
      )}
      <Card>
        <CardHeader
          title="Assets"
          description="Only approved versions are listed. Drafts can't be packaged."
        />
        <div className="px-4 py-4">
          <PackageForm
            jobId={jobId}
            options={{
              resumes: options.resumes,
              emails: options.emails.map(({ value, label }) => ({ value, label })),
              coverLetters: options.coverLetters.map(({ value, label }) => ({ value, label })),
              recipients: options.recipients,
            }}
            values={{
              resumeVersionId: pick("resumeVersionId", options.resumes),
              emailVersionId: emailVersionId ?? options.emails[0]?.value ?? null,
              coverLetterVersionId: coverLetterVersionId ?? options.coverLetters[0]?.value ?? null,
              includeEmail:
                Boolean(emailVersionId) || (!coverLetterVersionId && options.emails.length > 0),
              includeCoverLetter:
                Boolean(coverLetterVersionId) ||
                (!emailVersionId && options.coverLetters.length > 0),
              recipientContextId:
                options.emails.find((e) => e.value === emailVersionId)?.recipientContextId ?? null,
            }}
          />
        </div>
      </Card>
    </div>
  );
}
