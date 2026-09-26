import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/ids";
import { listResumes } from "@/modules/resumes/resume.service";
import { getTailoringPreview } from "@/modules/resumes/tailor.service";
import { ALIGNMENT_LABELS, ALIGNMENT_TONES } from "@/modules/resumes/ui/labels";
import { missingSkillsForJob } from "@/modules/resumes/readiness.service";
import { ConfirmSkillsForm, TailorForm } from "@/modules/resumes/ui/resume-controls";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Tailor resume · JOBHUNT OS" };
export const dynamic = "force-dynamic";
/** Local AI wording can take a while on modest hardware. */
export const maxDuration = 300;

export default async function TailorPage({ searchParams }: PageProps<"/resumes/tailor">) {
  const actor = await requireActorOrRedirect();
  const sp = await searchParams;
  const jobId = typeof sp.job === "string" && isUuid(sp.job) ? sp.job : null;
  const preferred = typeof sp.resume === "string" && isUuid(sp.resume) ? sp.resume : null;
  if (!jobId) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          eyebrow="Resume Studio"
          title="Tailor a resume"
          description="Tailoring starts from a job. Open a job and choose “Tailor resume”."
        />
        <Link href="/jobs" className="text-accent text-sm underline">
          Browse jobs
        </Link>
      </div>
    );
  }
  const resumes = (await listResumes(actor)).filter((r) => r.currentVersion);
  const ordered = [
    ...resumes.filter((r) => r.id === preferred),
    ...resumes.filter((r) => r.kind === "MASTER" && r.id !== preferred),
    ...resumes.filter((r) => r.kind !== "MASTER" && r.id !== preferred),
  ];
  const sources = ordered.map((r) => ({
    resumeId: r.id,
    versionId: r.currentVersion!.id,
    label: `${r.name} · v${r.currentVersion!.versionNumber}${r.kind === "MASTER" ? " (master)" : ""}`,
  }));

  let preview;
  try {
    preview = await getTailoringPreview(actor, jobId, sources[0]?.versionId ?? null);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { ctx, alignment, aiConfigured } = preview;
  const missingSkills = await missingSkillsForJob(actor, jobId);
  const content = ctx.requirements.filter(
    (r) =>
      !["LOCATION", "WORK_MODE", "EMPLOYMENT", "SALARY", "AUTHORIZATION"].includes(r.category) &&
      !r.id.startsWith("research:"),
  );
  const required = content.filter((r) => r.requirementType === "REQUIRED");
  const preferredReqs = content.filter((r) => r.requirementType === "PREFERRED");
  const statusOf = new Map((alignment ?? []).map((a) => [a.requirementId, a]));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Tailor resume"
        title={ctx.job.title}
        description={
          <span>
            {ctx.job.company ?? "Unknown company"} · {ctx.job.locationRaw} ·{" "}
            <Link href={`/jobs/${ctx.job.id}`} className="underline">
              Job detail
            </Link>{" "}
            ·{" "}
            <Link href={`/jobs/${ctx.job.id}/match`} className="underline">
              Match
            </Link>{" "}
            ·{" "}
            <Link href={`/jobs/${ctx.job.id}/research`} className="underline">
              Research
            </Link>
          </span>
        }
      />
      {sources.length === 0 && (
        <Alert tone="info" title="No resume yet">
          <Link href="/resumes" className="underline">
            Build your master resume
          </Link>{" "}
          from your candidate facts first.
        </Alert>
      )}
      {content.some((r) => r.category === "SKILL") && (
        <Card>
          <CardHeader
            title="Skills this job asks for"
            description={
              missingSkills.length
                ? "Not in your profile yet. Confirm the ones you have before tailoring; the rest stay honest gaps."
                : "All of them are in your profile."
            }
          />
          <div className="px-4 py-3">
            <ConfirmSkillsForm jobId={jobId} missing={missingSkills} />
          </div>
        </Card>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Tailor for this job"
            description="Creates a new, job-linked resume. Your source resume is not changed."
          />
          <div className="px-4 py-3">
            <TailorForm
              jobId={ctx.job.id}
              sources={sources}
              aiConfigured={aiConfigured}
              aiProvider={preview.aiProvider}
              aiUnavailableReason={preview.aiUnavailableReason}
            />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="3. Detected job priorities"
            description={`From the job's own text (Phase 4 requirement extraction)${alignment ? `, compared with ${sources[0]?.label}` : ""}.`}
          />
          <div className="flex flex-col gap-3 px-4 py-3 text-xs">
            {ctx.match && (
              <p className="text-fg-muted">
                Your latest match:{" "}
                <span className="text-fg">
                  {ctx.match.overallStatus.replaceAll("_", " ").toLowerCase()}
                </span>
              </p>
            )}
            {[
              { title: "Required", list: required },
              { title: "Preferred", list: preferredReqs },
            ].map((g) => (
              <div key={g.title}>
                <p className="text-fg mb-1 font-medium">
                  {g.title} ({g.list.length})
                </p>
                {g.list.length === 0 ? (
                  <p className="text-fg-muted">None stated.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {g.list.slice(0, 25).map((r) => {
                      const a = statusOf.get(r.id);
                      return (
                        <li key={r.id} className="flex items-start justify-between gap-2">
                          <span>
                            <span className="text-fg-subtle">{r.category.toLowerCase()} · </span>
                            <span className="text-fg">{r.text}</span>
                          </span>
                          {a && (
                            <Badge tone={ALIGNMENT_TONES[a.status]} title={a.note}>
                              {ALIGNMENT_LABELS[a.status]}
                            </Badge>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
            {ctx.researchSignals.length > 0 && (
              <p className="text-fg-muted">
                Research emphasis (company/job facts, not yours):{" "}
                {ctx.researchSignals.map((s) => s.skill).join(", ")}.
              </p>
            )}
            <p className="text-fg-subtle">
              Requirements marked “Not in profile” are never added on their own. If you have a
              missing skill, confirm it above; other gaps (experience, education) are added in your
              candidate profile.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
