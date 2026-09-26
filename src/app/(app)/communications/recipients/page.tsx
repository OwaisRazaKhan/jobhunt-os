import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import {
  listCompanyOptions,
  listRecipientContexts,
  RECIPIENT_SOURCES,
  SOURCE_LABELS,
} from "@/modules/communications/recipient.service";
import { RECIPIENT_LABELS, type RecipientType } from "@/modules/communications/types";
import { DeleteRecipientButton, RecipientForm } from "@/modules/communications/ui/package-controls";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Recipients · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const TONE = {
  SOURCE_VERIFIED: "success",
  UNVERIFIED: "neutral",
  INVALID: "danger",
  STALE: "warning",
} as const;

export default async function RecipientsPage() {
  const actor = await requireActorOrRedirect();
  const [recipients, companies] = await Promise.all([
    listRecipientContexts(actor),
    listCompanyOptions(actor),
  ]);
  // Phase 8 discovery is not part of Phase 7: the candidate cannot select it by hand.
  const sources = RECIPIENT_SOURCES.filter((s) => s !== "PHASE_8_DISCOVERY").map((s) => ({
    value: s,
    label: SOURCE_LABELS[s],
  }));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Communication Studio"
        title="Recipients"
        description="People you already know to address, with where the details came from. JOBHUNT OS never searches for contacts or guesses email addresses; only details with a public source link can be marked source verified."
        actions={
          <Link href="/communications" className={buttonClass("secondary", "sm")}>
            Back to Communication Studio
          </Link>
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Add a recipient" />
          <div className="px-4 py-4">
            <RecipientForm companies={companies} sources={sources} />
          </div>
        </Card>
        <div className="flex flex-col gap-3">
          {recipients.length === 0 && (
            <p className="text-fg-muted text-sm">
              No recipients yet. Communications use a generic greeting until you add one.
            </p>
          )}
          {recipients.map((r) => (
            <Card key={r.id}>
              <CardHeader
                title={r.name ?? r.email ?? r.title ?? r.company ?? "Recipient"}
                description={[r.title, r.company, r.email].filter(Boolean).join(" · ")}
                actions={<DeleteRecipientButton recipientId={r.id} />}
              />
              <div className="flex flex-col gap-2 px-4 py-3 text-xs">
                <p className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={TONE[r.verificationStatus as keyof typeof TONE]}>
                    {r.verificationStatus === "SOURCE_VERIFIED"
                      ? "Source verified"
                      : r.verificationStatus.toLowerCase()}
                  </Badge>
                  <span>{SOURCE_LABELS[r.source as keyof typeof SOURCE_LABELS]}</span>
                  <span>· {RECIPIENT_LABELS[r.recipientType as RecipientType]}</span>
                  <span>· confidence {r.confidence.toLowerCase()}</span>
                  {r.sourceUrl && (
                    <a
                      href={r.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="underline"
                    >
                      source
                    </a>
                  )}
                </p>
                <details>
                  <summary className="cursor-pointer">Edit</summary>
                  <div className="pt-2">
                    <RecipientForm
                      companies={companies}
                      sources={sources}
                      recipient={{
                        id: r.id,
                        name: r.name,
                        title: r.title,
                        company: r.company,
                        email: r.email,
                        recipientType: r.recipientType,
                        source: r.source,
                        sourceUrl: r.sourceUrl,
                        verificationStatus: r.verificationStatus,
                        confidence: r.confidence,
                        notes: r.notes,
                        companyId: r.companyId,
                      }}
                    />
                  </div>
                </details>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
