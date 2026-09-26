import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  archivePackageAction,
  duplicatePackageAction,
  recheckPackageAction,
} from "@/app/(app)/communication-packages/actions";
import { InlineAction } from "@/components/forms/inline-action";
import { Alert, Badge, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/ids";
import {
  ASSET_LABELS,
  FROZEN_STATUSES,
  PACKAGE_STATUS_LABELS,
  type AssetType,
  type PackageStatus,
} from "@/modules/communications/package";
import { getPackageView, listPackageOptions } from "@/modules/communications/package.service";
import { SOURCE_LABELS } from "@/modules/communications/recipient.service";
import { ago, PACKAGE_STATUS_TONES } from "@/modules/communications/ui/labels";
import { MarkReadyForm, PackageForm } from "@/modules/communications/ui/package-controls";
import { Section } from "@/modules/communications/ui/panels";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Communication package · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const ITEM_TONE = {
  PASS: "text-success",
  FAIL: "text-danger",
  WARN: "text-warning",
  NA: "text-fg-subtle",
} as const;
const ITEM_MARK = { PASS: "✓", FAIL: "✕", WARN: "!", NA: "–" } as const;

export default async function PackagePage({ params }: PageProps<"/communication-packages/[id]">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  let view;
  try {
    view = await getPackageView(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { pkg, evaluation, required } = view;
  const status = pkg.status as PackageStatus;
  const frozen = (FROZEN_STATUSES as readonly string[]).includes(status);
  const options = !frozen ? await listPackageOptions(actor, pkg.jobId) : null;
  const recipient = pkg.recipientSnapshot as Record<string, string | null>;
  const strategy = pkg.strategySnapshot as Record<string, Record<string, unknown>>;
  const fails = evaluation.items.filter((i) => i.status === "FAIL");
  const assetRow = (type: AssetType) => pkg.assets.find((a) => a.assetType === type) ?? null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Communication package"
        title={pkg.title}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={PACKAGE_STATUS_TONES[status]}>{PACKAGE_STATUS_LABELS[status]}</Badge>
            <span>{pkg.channel === "EMAIL" ? "Email application" : "Portal application"}</span>
            <span>· updated {ago(pkg.updatedAt)}</span>
            <span>
              · for{" "}
              <Link href={`/jobs/${pkg.jobId}`} className="underline">
                {pkg.job.title}
                {pkg.company ? ` — ${pkg.company.name}` : ""}
              </Link>
            </span>
          </span>
        }
        actions={
          <>
            <InlineAction
              action={recheckPackageAction}
              hidden={{ packageId: pkg.id }}
              variant="secondary"
            >
              Re-check readiness
            </InlineAction>
            <InlineAction
              action={duplicatePackageAction}
              hidden={{ packageId: pkg.id, refresh: "0" }}
              variant="secondary"
            >
              Duplicate
            </InlineAction>
            {status !== "ARCHIVED" && (
              <InlineAction
                action={archivePackageAction}
                hidden={{ packageId: pkg.id }}
                variant="ghost"
                confirm="Archive this package? It stays in history."
              >
                Archive
              </InlineAction>
            )}
          </>
        }
      />

      {status === "READY_FOR_APPLICATION" && (
        <Alert tone="success" title="Ready for application — prepared, not submitted">
          These exact approved versions are locked for the application step. Nothing has been
          submitted or sent. Any later change to an underlying asset marks this package stale
          instead of changing it.
        </Alert>
      )}
      {status === "STALE" && (
        <Alert
          tone="warning"
          title="Stale — this package no longer reflects your current approved assets"
        >
          <ul className="list-disc pl-4">
            {(pkg.staleReasons as string[]).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          <div className="mt-2">
            <InlineAction
              action={duplicatePackageAction}
              hidden={{ packageId: pkg.id, refresh: "1" }}
              variant="primary"
            >
              Create updated package (latest approved versions)
            </InlineAction>
          </div>
        </Alert>
      )}
      {status === "INVALID" && (
        <Alert tone="danger" title="Invalid — integrity problem">
          {pkg.invalidReason ?? "A referenced asset failed an integrity check."}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            title={`Readiness check — ${evaluation.ready ? (status === "READY_FOR_APPLICATION" ? "ready for application" : "every check passes") : "not ready"}`}
          >
            <ul className="flex flex-col gap-1 text-xs">
              {evaluation.items.map((i) => (
                <li key={i.key} className="flex items-start gap-2">
                  <span className={`${ITEM_TONE[i.status]} w-3 font-mono`} aria-label={i.status}>
                    {ITEM_MARK[i.status]}
                  </span>
                  <span>
                    <span className="text-fg font-medium">{i.label}</span>{" "}
                    <span className="text-fg-muted">— {i.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            {status === "READY_FOR_REVIEW" && (
              <div className="border-border mt-3 border-t pt-3">
                <MarkReadyForm packageId={pkg.id} />
              </div>
            )}
            {status === "INCOMPLETE" && fails.length > 0 && (
              <p className="text-fg-muted mt-2 text-xs">
                Fix the ✕ items (approve assets, choose versions, add a recipient you know), then
                re-check.
              </p>
            )}
          </Section>

          <Section title="Assets (exact versions)">
            <table className="w-full text-left text-xs">
              <thead className="text-fg-muted">
                <tr>
                  <th className="py-1 font-medium">Asset</th>
                  <th className="py-1 font-medium">Version</th>
                  <th className="py-1 font-medium">Status</th>
                  <th className="py-1 font-medium" />
                </tr>
              </thead>
              <tbody>
                {(["RESUME", "EMAIL", "COVER_LETTER"] as const).map((type) => {
                  const a = assetRow(type);
                  const isRequired = required.includes(type);
                  if (!a && !isRequired) return null;
                  const rv = a?.resumeVersion;
                  const cv = a?.communicationVersion;
                  return (
                    <tr key={type} className="border-border border-t">
                      <td className="py-1.5">{ASSET_LABELS[type]}</td>
                      <td className="py-1.5">
                        {rv ? (
                          `${rv.resume.name} · v${rv.versionNumber}`
                        ) : cv ? (
                          `${cv.communication.title} · v${cv.versionNumber}`
                        ) : (
                          <span className="text-danger">not selected</span>
                        )}
                      </td>
                      <td className="py-1.5">{rv?.status ?? cv?.status ?? "—"}</td>
                      <td className="py-1.5 text-right">
                        {rv && (
                          <Link href={`/resumes/${rv.resumeId}?v=${rv.id}`} className="underline">
                            Open resume
                          </Link>
                        )}
                        {cv && (
                          <Link
                            href={`/communications/${cv.communicationId}?v=${cv.id}`}
                            className="underline"
                          >
                            Open {type === "EMAIL" ? "email" : "cover letter"}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <details className="mt-2 text-xs">
              <summary className="text-fg-muted cursor-pointer">Integrity details</summary>
              <dl className="mt-1 grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1 font-mono text-[11px] break-all">
                {pkg.assets.map((a) => (
                  <div key={a.id} className="contents">
                    <dt className="text-fg-muted font-sans">
                      {ASSET_LABELS[a.assetType as AssetType]}
                    </dt>
                    <dd>sha256 {a.contentHash}</dd>
                  </div>
                ))}
                <dt className="text-fg-muted font-sans">Package</dt>
                <dd>
                  {pkg.integrityHash ? `sha256 ${pkg.integrityHash}` : "computed when marked ready"}
                </dd>
              </dl>
            </details>
          </Section>

          {!frozen && options && (
            <Section title="Selection">
              <PackageForm
                jobId={pkg.jobId}
                packageId={pkg.id}
                options={{
                  resumes: options.resumes,
                  emails: options.emails.map(({ value, label }) => ({ value, label })),
                  coverLetters: options.coverLetters.map(({ value, label }) => ({ value, label })),
                  recipients: options.recipients,
                }}
                values={{
                  channel: pkg.channel,
                  includeEmail: pkg.includeEmail,
                  includeCoverLetter: pkg.includeCoverLetter,
                  resumeVersionId: assetRow("RESUME")?.resumeVersionId ?? null,
                  emailVersionId: assetRow("EMAIL")?.communicationVersionId ?? null,
                  coverLetterVersionId: assetRow("COVER_LETTER")?.communicationVersionId ?? null,
                  recipientContextId: pkg.recipientContextId,
                  title: pkg.title,
                }}
              />
            </Section>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-3">
          <Section title="Context (locked when ready)">
            <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-xs">
              <dt className="text-fg-muted">Job</dt>
              <dd>
                <Link href={`/jobs/${pkg.jobId}`} className="underline">
                  {pkg.job.title}
                </Link>
                {pkg.requirementSet && (
                  <span className="text-fg-subtle">
                    {" "}
                    · requirements v{pkg.requirementSet.version}
                  </span>
                )}
              </dd>
              <dt className="text-fg-muted">Match</dt>
              <dd>
                {pkg.match ? (
                  <Link href={`/jobs/${pkg.jobId}/match`} className="underline">
                    {pkg.match.overallStatus.toLowerCase().replace(/_/g, " ")} ·{" "}
                    {pkg.match.computedAt.toISOString().slice(0, 10)}
                  </Link>
                ) : (
                  "None"
                )}
                {pkg.match && !pkg.match.isCurrent && <Badge tone="warning">superseded</Badge>}
              </dd>
              <dt className="text-fg-muted">Research</dt>
              <dd>
                {pkg.jobResearch ? `v${pkg.jobResearch.version}` : "None"}
                {pkg.jobResearch && !pkg.jobResearch.isCurrent && (
                  <Badge tone="warning">superseded</Badge>
                )}
              </dd>
              <dt className="text-fg-muted">Ready at</dt>
              <dd>
                {pkg.readyAt ? pkg.readyAt.toISOString().replace("T", " ").slice(0, 16) : "—"}
              </dd>
            </dl>
          </Section>
          <Section title="Recipient">
            {recipient.id ? (
              <div className="flex flex-col gap-0.5 text-xs">
                <p className="text-fg font-medium">{recipient.name ?? "—"}</p>
                {recipient.title && <p>{recipient.title}</p>}
                {recipient.company && <p>{recipient.company}</p>}
                <p>{recipient.email ?? <span className="text-fg-subtle">No email</span>}</p>
                <p
                  className={
                    recipient.verificationStatus === "SOURCE_VERIFIED"
                      ? "text-success"
                      : "text-warning"
                  }
                >
                  {recipient.verificationStatus === "SOURCE_VERIFIED"
                    ? "✓ Source verified"
                    : `Not source-verified (${(recipient.verificationStatus ?? "unverified").toLowerCase()})`}{" "}
                  ·{" "}
                  {SOURCE_LABELS[recipient.source as keyof typeof SOURCE_LABELS] ??
                    recipient.source}
                </p>
                {recipient.sourceUrl && (
                  <a
                    href={recipient.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="underline"
                  >
                    Source
                  </a>
                )}
              </div>
            ) : (
              <p className="text-fg-muted text-xs">
                {pkg.channel === "EMAIL"
                  ? "Required for an email application."
                  : "None (not required for a portal application)."}
              </p>
            )}
            <Link
              href="/communications/recipients"
              className="text-fg-subtle text-[11px] underline"
            >
              Manage recipients
            </Link>
          </Section>
          <Section title="Strategy">
            {Object.keys(strategy).length ? (
              <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-xs">
                {Object.entries(strategy).map(([k, s]) => (
                  <div key={k} className="contents">
                    <dt className="text-fg-muted">{k === "email" ? "Email" : "Cover letter"}</dt>
                    <dd>
                      {String(s.purpose ?? "")
                        .toLowerCase()
                        .replace(/_/g, " ")}{" "}
                      · {String(s.tone ?? "").toLowerCase()} ·{" "}
                      {String(s.length ?? "").toLowerCase()}
                      {s.requestedAction ? (
                        <span className="block">Ask: {String(s.requestedAction)}</span>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-fg-muted text-xs">No email or cover letter in this package.</p>
            )}
          </Section>
          {(pkg.previousPackage || pkg.nextPackages.length > 0) && (
            <Section title="Lineage">
              <ul className="text-xs">
                {pkg.previousPackage && (
                  <li>
                    Updated from{" "}
                    <Link
                      href={`/communication-packages/${pkg.previousPackage.id}`}
                      className="underline"
                    >
                      {pkg.previousPackage.title}
                    </Link>{" "}
                    ({PACKAGE_STATUS_LABELS[pkg.previousPackage.status as PackageStatus]})
                  </li>
                )}
                {pkg.nextPackages.map((n) => (
                  <li key={n.id}>
                    Superseded by{" "}
                    <Link href={`/communication-packages/${n.id}`} className="underline">
                      {n.title}
                    </Link>{" "}
                    ({PACKAGE_STATUS_LABELS[n.status as PackageStatus]})
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}
