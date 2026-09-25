import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getDocument } from "@/modules/candidate";
import { SECTION_META } from "@/modules/candidate/form-fields";
import { factLabel } from "@/modules/candidate/labels";
import { optionLabel } from "@/modules/candidate/options";
import { isSectionKind } from "@/modules/candidate/schemas";
import { VerificationBadge } from "@/modules/candidate/ui/badges";
import { DocumentActions } from "@/modules/candidate/ui/document-actions";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Document · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  UPLOADED: "neutral",
  PROCESSING: "info",
  PROCESSED: "success",
  FAILED: "danger",
} as const;
const CANDIDATE_TONE = { PENDING: "warning", APPROVED: "success", REJECTED: "neutral" } as const;

export default async function DocumentDetailPage({
  params,
}: PageProps<"/candidate/documents/[id]">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const result = await getDocument(actor, id).catch((error) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const { document, derivedFacts } = result;
  const pending = document.factCandidates.filter((c) => c.status === "PENDING").length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Document"
        title={document.fileName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[document.status]}>{optionLabel(document.status)}</Badge>
            <span>
              {optionLabel(document.documentType)} · uploaded{" "}
              {document.uploadedAt.toISOString().slice(0, 10)}
            </span>
            {document.processedAt && (
              <span>
                · processed {document.processedAt.toISOString().slice(0, 16).replace("T", " ")}
              </span>
            )}
            {document.aiStatus && (
              <span className="text-fg-subtle font-mono text-[11px]">
                AI: {optionLabel(document.aiStatus)}
              </span>
            )}
          </span>
        }
        actions={
          <>
            {pending > 0 && (
              <Link
                href={`/candidate/review?document=${document.id}`}
                className={buttonClass("primary", "sm")}
              >
                Review {pending} fact{pending === 1 ? "" : "s"}
              </Link>
            )}
            <DocumentActions
              id={document.id}
              fileName={document.fileName}
              afterDelete="/candidate/documents"
            />
          </>
        }
      />
      {document.status === "FAILED" && (
        <Alert tone="danger" title="Processing failed">
          {document.errorMessage}
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Facts in your profile from this document"
            count={derivedFacts.reduce((n, d) => n + d.records.length, 0)}
          />
          {derivedFacts.length === 0 ? (
            <EmptyState
              title="No approved facts yet"
              description="Approved facts keep a link to this document as their source."
            />
          ) : (
            <ul className="divide-border divide-y">
              {derivedFacts.flatMap(({ kind, records }) =>
                records.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 px-4 py-2 text-xs"
                  >
                    <span className="min-w-0">
                      <span className="text-fg-subtle font-mono text-[10px] uppercase">
                        {SECTION_META[kind].singular}
                      </span>
                      <span className="text-fg block truncate">{factLabel(kind, r)}</span>
                    </span>
                    <VerificationBadge status={r.verificationStatus} />
                  </li>
                )),
              )}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Extraction results" count={document.factCandidates.length} />
          {document.factCandidates.length === 0 ? (
            <EmptyState title="No possible facts identified" />
          ) : (
            <ul className="divide-border max-h-[480px] divide-y overflow-y-auto">
              {document.factCandidates.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 px-4 py-2 text-xs"
                >
                  <span className="min-w-0">
                    <span className="text-fg-subtle font-mono text-[10px] uppercase">
                      {c.category === "profile"
                        ? "profile"
                        : isSectionKind(c.category)
                          ? SECTION_META[c.category].singular
                          : c.category}{" "}
                      · {c.method.toLowerCase()}
                    </span>
                    <span className="text-fg block truncate">
                      {c.category === "profile"
                        ? String((c.payload as { value: unknown }).value)
                        : isSectionKind(c.category)
                          ? factLabel(c.category, c.payload as object)
                          : ""}
                    </span>
                  </span>
                  <Badge tone={CANDIDATE_TONE[c.status]}>{optionLabel(c.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {document.extractedText && (
        <Card>
          <details>
            <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold">
              Extracted text (private)
            </summary>
            <pre className="border-border text-fg-muted max-h-96 overflow-auto border-t px-4 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {document.extractedText}
            </pre>
          </details>
        </Card>
      )}
    </div>
  );
}
