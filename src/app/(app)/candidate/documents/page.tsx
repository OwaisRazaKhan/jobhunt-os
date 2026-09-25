import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getServerEnv } from "@/config/env";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { listDocuments } from "@/modules/candidate";
import { SECTION_META } from "@/modules/candidate/form-fields";
import { optionLabel } from "@/modules/candidate/options";
import { isSectionKind } from "@/modules/candidate/schemas";
import { DocumentActions } from "@/modules/candidate/ui/document-actions";
import { DocumentUploader } from "@/modules/candidate/ui/document-uploader";
import { primaryProvider } from "@/server/ai/router";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Documents · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const STATUS_TONE = {
  UPLOADED: "neutral",
  PROCESSING: "info",
  PROCESSED: "success",
  FAILED: "danger",
} as const;

async function aiAvailable() {
  const choice = primaryProvider();
  if (!choice) return false;
  const health = await choice.provider.health(choice.model);
  return health.ok && health.modelAvailable;
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function DocumentsPage() {
  const actor = await requireActorOrRedirect();
  const [documents, ai] = await Promise.all([listDocuments(actor), aiAvailable()]);
  const maxMb = Math.round(getServerEnv().MAX_UPLOAD_BYTES / 1024 / 1024);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Candidate"
        title="Documents"
        description="Upload your CV, portfolio documents, old cover letters, experience notes or certificates. Extracted facts always go to review first."
      />
      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader title="Import a document" />
          <div className="p-4">
            <DocumentUploader maxMb={maxMb} aiAvailable={ai} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Library" count={documents.length} />
          {documents.length === 0 ? (
            <EmptyState
              icon={<FileText className="size-6" />}
              title="No documents yet"
              description="Your uploaded documents will appear here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="border-border text-fg-subtle border-b font-mono text-[10px] tracking-wide uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-normal">
                      File
                    </th>
                    <th scope="col" className="px-2 py-2 font-normal">
                      Uploaded
                    </th>
                    <th scope="col" className="px-2 py-2 font-normal">
                      Status
                    </th>
                    <th scope="col" className="px-2 py-2 font-normal">
                      Facts
                    </th>
                    <th scope="col" className="px-2 py-2 font-normal">
                      Sections
                    </th>
                    <th scope="col" className="px-2 py-2 font-normal">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {documents.map((doc) => (
                    <tr key={doc.id} className="hover:bg-surface-2/50">
                      <td className="max-w-64 px-4 py-2.5">
                        <Link
                          href={`/candidate/documents/${doc.id}`}
                          className="text-fg block truncate font-medium hover:underline"
                        >
                          {doc.fileName}
                        </Link>
                        <span className="text-fg-subtle">
                          {optionLabel(doc.documentType)} · {doc.fileType.toUpperCase()} ·{" "}
                          {formatSize(doc.sizeBytes)}
                        </span>
                      </td>
                      <td className="text-fg-muted px-2 py-2.5 font-mono whitespace-nowrap">
                        {doc.uploadedAt.toISOString().slice(0, 10)}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={STATUS_TONE[doc.status]}>{optionLabel(doc.status)}</Badge>
                          {doc.aiStatus &&
                            doc.aiStatus !== "COMPLETED" &&
                            doc.status === "PROCESSED" && (
                              <span className="text-fg-subtle text-[10px]">rules only</span>
                            )}
                        </div>
                      </td>
                      <td className="text-fg-muted px-2 py-2.5 font-mono whitespace-nowrap">
                        {doc.counts.pending > 0 ? (
                          <Link
                            href={`/candidate/review?document=${doc.id}`}
                            className="text-warning hover:underline"
                          >
                            {doc.counts.pending} to review
                          </Link>
                        ) : null}
                        {doc.counts.pending > 0 && doc.counts.approved > 0 ? " · " : null}
                        {doc.counts.approved > 0 ? (
                          <span className="text-success">{doc.counts.approved} approved</span>
                        ) : null}
                        {doc.counts.pending === 0 && doc.counts.approved === 0 ? "—" : null}
                      </td>
                      <td className="text-fg-muted px-2 py-2.5">
                        {doc.relatedSections
                          .map((s) => (isSectionKind(s) ? SECTION_META[s].title : "Profile"))
                          .join(", ") || "—"}
                      </td>
                      <td className="px-2 py-2.5">
                        <DocumentActions id={doc.id} fileName={doc.fileName} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
