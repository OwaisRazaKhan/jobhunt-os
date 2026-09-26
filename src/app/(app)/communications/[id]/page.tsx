import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  archiveAction,
  duplicateAction,
  revokeApprovalAction,
  runCheckAction,
  setStatusAction,
} from "@/app/(app)/communications/actions";
import { InlineAction } from "@/components/forms/inline-action";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/ids";
import {
  claimEvidence,
  getCommunicationWorkspace,
  listSignaturePresets,
} from "@/modules/communications/communication.service";
import { getGenerationAvailability } from "@/modules/communications/generation.service";
import { paragraphsOf } from "@/modules/communications/document";
import {
  SOURCE_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  type CommunicationType,
  type ContentSource,
  type VersionStatus,
} from "@/modules/communications/types";
import { ApproveForm, GenerateForm, SettingsForm } from "@/modules/communications/ui/controls";
import { ApplyRecipientForm } from "@/modules/communications/ui/package-controls";
import { listRecipientContexts } from "@/modules/communications/recipient.service";
import { CommunicationEditor } from "@/modules/communications/ui/editor";
import { ago, SOURCE_TONES, STATUS_TONES } from "@/modules/communications/ui/labels";
import {
  ChecksPanel,
  ClaimsPanel,
  ExportsPanel,
  Section,
  VersionHistory,
  type ClaimView,
} from "@/modules/communications/ui/panels";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Communication · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function CommunicationPage({
  params,
  searchParams,
}: PageProps<"/communications/[id]">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  const sp = await searchParams;
  const v = typeof sp.v === "string" ? sp.v : null;
  if (!isUuid(id) || (v && !isUuid(v))) notFound();
  let ws;
  try {
    ws = await getCommunicationWorkspace(actor, id, v);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { communication: c, version, doc } = ws;
  if (!version || !doc) notFound();
  const kind = c.kind as "EMAIL" | "COVER_LETTER";
  const [presets, ai, evidence, recipients] = await Promise.all([
    listSignaturePresets(actor),
    getGenerationAvailability(actor, kind),
    claimEvidence(actor, version.id),
    listRecipientContexts(actor, { companyId: c.companyId }),
  ]);

  const status = version.status as VersionStatus;
  const archived = c.status === "ARCHIVED";
  const readOnly = archived || !ws.isHead;
  const activeApproval = ws.approvals.find((a) => !a.revokedAt) ?? null;
  const approvedHere = Boolean(
    activeApproval && activeApproval.contentHash === version.contentHash,
  );
  const check = ws.latestCheck;
  const checkSummary = check ? (check.summary as Record<string, number>) : null;
  const checkStale = Boolean(check && check.contentHash !== version.contentHash);
  const generation = version.generation as Record<string, unknown>;
  const provider =
    typeof generation.providerKind === "string"
      ? `${generation.providerKind === "ollama" ? "Ollama" : "Gemini"}${typeof generation.model === "string" ? ` · ${generation.model}` : ""}`
      : null;
  const job = c.job && !c.job.deletedAt ? c.job : null;
  const unsupported = version.claims.filter((x) => x.status === "UNSUPPORTED").length;
  const genError = typeof sp.genError === "string" ? sp.genError : null;
  const changeSummary = version.changeSummary as {
    rejected?: { text: string; reasons: string[] }[];
    warnings?: string[];
  };

  const claims: ClaimView[] = version.claims.map((cl) => {
    const r = cl.reasons as { reasons?: string[]; basis?: string };
    return {
      id: cl.id,
      text: cl.text,
      claimKind: cl.claimKind,
      status: cl.status,
      reasons: r.reasons ?? [],
      basis: r.basis ?? null,
      sources: cl.sources.map((s) => {
        if (s.sourceKind === "CANDIDATE_FACT" && s.factRef) {
          const f = evidence.facts.get(s.factRef);
          const kindLabel = s.factRef.split(":")[0];
          return {
            kind: kindLabel === "resume" ? "Approved resume" : `Your ${kindLabel}`,
            label: f
              ? f.text.slice(0, 140) + (f.text.length > 140 ? "…" : "")
              : "(fact no longer usable)",
            href: kindLabel === "resume" ? null : "/candidate",
          };
        }
        if (s.sourceKind === "RESEARCH_CLAIM" && s.researchClaimId) {
          const rc = evidence.research.get(s.researchClaimId);
          return {
            kind: "Research",
            label: rc
              ? `${rc.text.slice(0, 140)}${rc.sourceTitle ? ` (${rc.sourceTitle})` : ""}`
              : "(research claim)",
            href: rc?.sourceUrl ?? null,
          };
        }
        return { kind: "Your context", label: (c.userContext ?? "").slice(0, 140), href: null };
      }),
    };
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={TYPE_LABELS[c.communicationType as CommunicationType]}
        title={c.title}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <span>v{version.versionNumber}</span>
            <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
            <Badge tone={SOURCE_TONES[version.contentSource as ContentSource]}>
              {SOURCE_LABELS[version.contentSource as ContentSource]}
              {provider ? ` · ${provider}` : ""}
            </Badge>
            {archived && <Badge>Archived</Badge>}
            <span>· updated {ago(version.updatedAt)}</span>
            {job && (
              <span>
                · for{" "}
                <Link href={`/jobs/${job.id}`} className="underline">
                  {job.title}
                  {c.company ? ` — ${c.company.name}` : ""}
                </Link>
              </span>
            )}
          </span>
        }
        actions={
          <>
            {version.parentVersionId && (
              <Link
                href={`/communications/${c.id}/compare?from=${version.parentVersionId}&to=${version.id}`}
                className={buttonClass("secondary", "sm")}
              >
                Compare with previous
              </Link>
            )}
            {approvedHere && c.jobId && (
              <Link
                href={`/communication-packages/new?jobId=${c.jobId}&${kind === "EMAIL" ? "emailVersionId" : "coverLetterVersionId"}=${version.id}`}
                className={buttonClass("primary", "sm")}
              >
                Add to communication package
              </Link>
            )}
            <InlineAction
              action={duplicateAction}
              hidden={{ communicationId: c.id }}
              variant="secondary"
            >
              Duplicate
            </InlineAction>
            <InlineAction
              action={archiveAction}
              hidden={{ communicationId: c.id, archived: archived ? "0" : "1" }}
              variant="ghost"
            >
              {archived ? "Restore from archive" : "Archive"}
            </InlineAction>
          </>
        }
      />

      {genError && (
        <Alert tone="warning" title="The AI draft was not created">
          {genError}
        </Alert>
      )}
      {!ws.isHead && (
        <Alert tone="info" title={`Viewing v${version.versionNumber} (history)`}>
          This version is read-only.{" "}
          <Link href={`/communications/${c.id}`} className="underline">
            Go to the current version
          </Link>{" "}
          or restore this one as a new version.
        </Alert>
      )}
      {approvedHere && ws.isHead && (
        <Alert tone="success" title="This exact version is approved">
          Editing will create a new version and the approval will not carry over.
        </Alert>
      )}
      {changeSummary.rejected && changeSummary.rejected.length > 0 && ws.isHead && (
        <Alert
          tone="info"
          title={`${changeSummary.rejected.length} statement${changeSummary.rejected.length === 1 ? " was" : "s were"} removed from the AI draft`}
        >
          <ul className="list-disc pl-4">
            {changeSummary.rejected.slice(0, 8).map((r, i) => (
              <li key={i}>
                <span className="line-through">{r.text}</span> — {r.reasons.join(" ")}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <p className="text-fg-subtle text-xs">
        Prepared here, never sent: copy or export an approved version and send it yourself.
      </p>

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-3">
          <Section title="Context (locked to this version)">
            <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-xs">
              <dt className="text-fg-muted">Job</dt>
              <dd>
                {job ? (
                  <Link href={`/jobs/${job.id}`} className="underline">
                    {job.title}
                  </Link>
                ) : (
                  "None"
                )}
                {version.requirementSet && (
                  <span className="text-fg-subtle">
                    {" "}
                    · requirements v{version.requirementSet.version}
                  </span>
                )}
              </dd>
              <dt className="text-fg-muted">Match</dt>
              <dd>
                {version.match ? (
                  <Link href={`/jobs/${c.jobId}/match`} className="underline">
                    {version.match.overallStatus.toLowerCase().replace(/_/g, " ")}
                  </Link>
                ) : (
                  "Not computed"
                )}
              </dd>
              <dt className="text-fg-muted">Research</dt>
              <dd>
                {version.jobResearch ? (
                  <Link href={`/jobs/${c.jobId}/research`} className="underline">
                    v{version.jobResearch.version} · {evidence.research.size} verified claims
                  </Link>
                ) : (
                  "None — no company claims allowed"
                )}
              </dd>
              <dt className="text-fg-muted">Resume</dt>
              <dd>
                {version.resumeVersion ? (
                  <Link
                    href={`/resumes/${version.resumeVersion.resume.id}?v=${version.resumeVersion.id}`}
                    className="underline"
                  >
                    {version.resumeVersion.resume.name} v{version.resumeVersion.versionNumber} (
                    {version.resumeVersion.status.toLowerCase().replace(/_/g, " ")})
                  </Link>
                ) : (
                  "None associated"
                )}
              </dd>
              <dt className="text-fg-muted">Facts</dt>
              <dd>{evidence.facts.size} usable</dd>
              <dt className="text-fg-muted">Recipient</dt>
              <dd>
                {c.recipientName ?? "Not named"}
                {c.recipientTitle ? `, ${c.recipientTitle}` : ""} ·{" "}
                {c.recipientType.toLowerCase().replace(/_/g, " ")}
                {c.recipientEmail && <span className="block">{c.recipientEmail}</span>}
              </dd>
              <dt className="text-fg-muted">Style</dt>
              <dd>
                {c.tone.toLowerCase()} · {c.length.toLowerCase()}
                {kind === "COVER_LETTER" ? ` · ${c.template.toLowerCase()} · ${c.pageFormat}` : ""}
              </dd>
            </dl>
          </Section>
          {!archived && ws.isHead && (
            <Section title="AI draft">
              <GenerateForm
                communicationId={c.id}
                hasContent={paragraphsOf(doc).some((p) => p.trim())}
                aiAvailable={ai.available}
                aiProvider={ai.provider}
                aiReason={ai.reason}
              />
            </Section>
          )}
          {!archived && (
            <details className="border-border bg-surface-1 rounded-lg border p-3">
              <summary className="text-fg cursor-pointer text-sm font-semibold">Settings</summary>
              <div className="pt-3">
                <SettingsForm
                  communicationId={c.id}
                  kind={kind}
                  signatures={presets.map((p) => ({
                    value: p.id,
                    label: p.name + (p.isDefault ? " (default)" : ""),
                  }))}
                  values={{
                    title: c.title,
                    recipientType: c.recipientType,
                    recipientName: c.recipientName,
                    recipientTitle: c.recipientTitle,
                    recipientCompany: c.recipientCompany,
                    recipientEmail: c.recipientEmail,
                    recipientSource: c.recipientSource,
                    tone: c.tone,
                    length: c.length,
                    template: c.template,
                    pageFormat: c.pageFormat,
                    signaturePresetId: c.signaturePresetId,
                    userContext: c.userContext,
                  }}
                  facts={[...evidence.facts.values()]
                    .filter((f) => !f.ref.startsWith("resume:") && !f.ref.startsWith("profile:"))
                    .map((f) => ({ value: f.ref, label: `${f.kind}: ${f.text.slice(0, 90)}` }))}
                  strategy={
                    c.strategy as {
                      requestedAction?: string | null;
                      primaryEvidence?: string[];
                      secondaryEvidence?: string[];
                      purpose?: string;
                    }
                  }
                />
                <div className="border-border mt-3 border-t pt-3">
                  <p className="text-fg-muted mb-1 text-xs font-medium">Saved recipient</p>
                  <ApplyRecipientForm
                    communicationId={c.id}
                    current={c.recipientContextId}
                    options={recipients.map((r) => ({
                      value: r.id,
                      label: `${r.name ?? r.email ?? r.title ?? r.company}${r.verificationStatus === "SOURCE_VERIFIED" ? " · source verified" : ""}`,
                    }))}
                  />
                </div>
                <p className="text-fg-subtle flex gap-3 pt-2 text-[11px]">
                  <Link href="/communications/signatures" className="underline">
                    Signature profiles
                  </Link>
                  <Link href="/communications/recipients" className="underline">
                    Recipients
                  </Link>
                  <Link href="/communications/preferences" className="underline">
                    Preferences
                  </Link>
                </p>
              </div>
            </details>
          )}
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <CommunicationEditor
            key={`${version.id}:${version.contentHash}`}
            communicationId={c.id}
            initialDoc={doc}
            initialHash={version.contentHash}
            readOnly={readOnly}
            readOnlyReason={
              archived
                ? "Archived — restore it to edit."
                : !ws.isHead
                  ? "Historical version — restore it to edit."
                  : null
            }
            versionLabel={`v${version.versionNumber} · ${STATUS_LABELS[status]}`}
            recipientEmail={c.recipientEmail}
            template={c.template}
          />

          <div className="grid gap-4 xl:grid-cols-2">
            <Section
              title="Quality check"
              actions={
                <InlineAction
                  action={runCheckAction}
                  hidden={{ versionId: version.id, communicationId: c.id }}
                  variant="secondary"
                >
                  Run check
                </InlineAction>
              }
            >
              <ChecksPanel
                findings={check?.findings ?? []}
                summary={checkSummary}
                stale={checkStale}
              />
            </Section>
            <Section title="Statements & evidence">
              <ClaimsPanel claims={claims} communicationId={c.id} canAddFacts={!readOnly} />
            </Section>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Section title="Review & approval">
              {approvedHere ? (
                <div className="flex flex-col gap-2 text-xs">
                  <p>
                    Approved {ago(activeApproval!.approvedAt)} · content hash{" "}
                    <span className="font-mono">{activeApproval!.contentHash.slice(0, 16)}…</span>
                  </p>
                  <InlineAction
                    action={revokeApprovalAction}
                    hidden={{
                      versionId: version.id,
                      communicationId: c.id,
                      reason: "Withdrawn by the candidate",
                    }}
                    confirm="Withdraw the approval of this version?"
                  >
                    Withdraw approval
                  </InlineAction>
                </div>
              ) : readOnly ? (
                <p className="text-fg-muted text-xs">
                  Only the current version of an active communication can be approved.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {status === "DRAFT" && (
                    <InlineAction
                      action={setStatusAction}
                      hidden={{
                        versionId: version.id,
                        communicationId: c.id,
                        status: "READY_FOR_REVIEW",
                      }}
                      variant="secondary"
                    >
                      Mark ready for review
                    </InlineAction>
                  )}
                  {(status === "DRAFT" || status === "READY_FOR_REVIEW") && (
                    <ApproveForm
                      communicationId={c.id}
                      versionId={version.id}
                      contentHash={version.contentHash}
                      summary={{
                        target: job?.title ?? null,
                        company: c.company?.name ?? c.recipientCompany ?? null,
                        resume: version.resumeVersion
                          ? `${version.resumeVersion.resume.name} v${version.resumeVersion.versionNumber}`
                          : null,
                        research: version.jobResearch ? `v${version.jobResearch.version}` : null,
                        critical: checkStale ? 0 : (checkSummary?.critical ?? 0),
                        warnings: checkStale ? 0 : (checkSummary?.warnings ?? 0),
                        info: checkStale ? 0 : (checkSummary?.info ?? 0),
                        unsupported: checkStale ? 0 : unsupported,
                        checked: Boolean(checkSummary && !checkStale),
                      }}
                    />
                  )}
                  {status === "REJECTED" && (
                    <InlineAction
                      action={setStatusAction}
                      hidden={{ versionId: version.id, communicationId: c.id, status: "DRAFT" }}
                      variant="secondary"
                    >
                      Back to draft
                    </InlineAction>
                  )}
                </div>
              )}
            </Section>
            <Section title="Copy & export">
              <ExportsPanel
                kind={kind}
                versionId={version.id}
                communicationId={c.id}
                exports={ws.exports.map((e) => ({
                  id: e.id,
                  format: e.format,
                  status: e.status,
                  fileName: e.fileName,
                  byteSize: e.byteSize,
                  matchesApproval: e.matchesApproval,
                  createdAt: e.createdAt,
                  error: e.error,
                }))}
              />
            </Section>
          </div>

          <Section title="Version history">
            <VersionHistory
              communicationId={c.id}
              selectedId={version.id}
              headId={c.currentVersionId}
              canRestore={!archived}
              versions={c.versions.map((x) => {
                const g = x.generation as Record<string, unknown>;
                return {
                  id: x.id,
                  versionNumber: x.versionNumber,
                  status: x.status,
                  versionType: x.versionType,
                  contentSource: x.contentSource,
                  createdAt: x.createdAt,
                  parentVersionId: x.parentVersionId,
                  approved: x.approvals.length > 0,
                  provider:
                    typeof g.providerKind === "string"
                      ? g.providerKind === "ollama"
                        ? "Ollama"
                        : "Gemini"
                      : null,
                };
              })}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
