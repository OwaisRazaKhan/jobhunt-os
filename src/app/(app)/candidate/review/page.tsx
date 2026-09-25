import { FileSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { bulkSafetyIssue, listPendingCandidates } from "@/modules/candidate";
import { ReviewList, type ReviewCandidate } from "@/modules/candidate/ui/review-list";
import { requireActorOrRedirect } from "@/server/session";
import { loadCandidate } from "../load";

export const metadata: Metadata = { title: "Fact review · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: PageProps<"/candidate/review">) {
  const actor = await requireActorOrRedirect();
  const params = await searchParams;
  const documentId =
    typeof params.document === "string" && /^[0-9a-f-]{36}$/i.test(params.document)
      ? params.document
      : undefined;
  const [pending, { context }] = await Promise.all([
    listPendingCandidates(actor, { documentId }),
    loadCandidate(actor),
  ]);

  const candidates: ReviewCandidate[] = pending.map((c) => ({
    id: c.id,
    category: c.category,
    payload: c.payload as Record<string, unknown>,
    excerpt: c.excerpt,
    confidence: c.confidence,
    method: c.method,
    duplicateOf: (c.duplicateOf as ReviewCandidate["duplicateOf"]) ?? null,
    documentName: c.document.fileName,
    bulkIssue: bulkSafetyIssue(c),
  }));
  const documents = new Set(pending.map((c) => c.document.fileName));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Candidate"
        title="Review candidate facts"
        description={
          candidates.length > 0
            ? `We found ${candidates.length} possible fact${candidates.length === 1 ? "" : "s"} in ${documents.size} document${documents.size === 1 ? "" : "s"}. Approve, edit or reject each one — nothing is added to your profile until you do.`
            : "Facts extracted from your documents appear here for review."
        }
        actions={
          documentId ? (
            <Link href="/candidate/review" className={buttonClass("ghost", "sm")}>
              Show all documents
            </Link>
          ) : null
        }
      />
      {candidates.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileSearch className="size-6" />}
            title="Nothing to review"
            description="Upload a CV or another document to extract facts. You can always add information manually."
            action={
              <Link href="/candidate/documents" className={buttonClass("secondary", "sm")}>
                Go to documents
              </Link>
            }
          />
        </Card>
      ) : (
        <ReviewList candidates={candidates} context={context} />
      )}
    </div>
  );
}
