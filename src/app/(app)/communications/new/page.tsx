import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/ids";
import { getProfile } from "@/modules/candidate/profile.service";
import {
  listJobOptions,
  listResumeVersionOptions,
  listSignaturePresets,
} from "@/modules/communications/communication.service";
import { getGenerationAvailability } from "@/modules/communications/generation.service";
import { COMMUNICATION_TYPES, type CommunicationType } from "@/modules/communications/types";
import { NewCommunicationForm } from "@/modules/communications/ui/controls";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "New communication · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function NewCommunicationPage({
  searchParams,
}: PageProps<"/communications/new">) {
  const actor = await requireActorOrRedirect();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const rawType = one(sp.type);
  const type: CommunicationType = (COMMUNICATION_TYPES as readonly string[]).includes(rawType ?? "")
    ? (rawType as CommunicationType)
    : one(sp.kind) === "cover-letter"
      ? "COVER_LETTER"
      : "APPLICATION_EMAIL";
  const kind = type === "COVER_LETTER" ? "COVER_LETTER" : "EMAIL";
  const jobId = isUuid(one(sp.jobId) ?? "") ? one(sp.jobId)! : null;
  const resumeParam = isUuid(one(sp.resumeVersionId) ?? "") ? one(sp.resumeVersionId)! : null;

  const [jobs, resumes, presets, ai, profile] = await Promise.all([
    listJobOptions(actor, jobId),
    listResumeVersionOptions(actor),
    listSignaturePresets(actor),
    getGenerationAvailability(actor, kind),
    getProfile(actor),
  ]);
  // Prefer the approved resume tailored for this job, else the most recent approved version.
  const resumeVersionId =
    resumeParam ??
    resumes.find((r) => r.approved && jobId && r.targetJobId === jobId)?.value ??
    resumes.find((r) => r.approved)?.value ??
    null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Communication Studio"
        title={kind === "EMAIL" ? "New email" : "New cover letter"}
        description="Choose the job and resume, say who it's for (only what you know), then draft with AI from your facts, write it yourself, or import an existing draft. Nothing is sent from JOBHUNT OS."
        actions={
          <Link
            href={
              kind === "EMAIL" ? "/communications/new?kind=cover-letter" : "/communications/new"
            }
            className="text-fg-muted text-xs underline"
          >
            {kind === "EMAIL" ? "Write a cover letter instead" : "Write an email instead"}
          </Link>
        }
      />
      {!profile && (
        <Alert tone="info" title="Build your candidate profile first">
          Drafts are written only from your candidate facts.{" "}
          <Link href="/welcome" className="underline">
            Start your profile
          </Link>
          .
        </Alert>
      )}
      <Card>
        <CardHeader
          title="Setup"
          description="The job's requirements, your match and the job research are locked to each version you create."
        />
        <div className="px-4 py-4">
          <NewCommunicationForm
            kind={kind}
            type={type}
            jobs={jobs}
            resumes={resumes.map((r) => ({ value: r.value, label: r.label }))}
            signatures={presets.map((p) => ({
              value: p.id,
              label: p.name + (p.isDefault ? " (default)" : ""),
            }))}
            defaults={{ jobId, resumeVersionId }}
            aiAvailable={ai.available}
            aiProvider={ai.provider}
            aiReason={ai.reason}
          />
        </div>
      </Card>
    </div>
  );
}
