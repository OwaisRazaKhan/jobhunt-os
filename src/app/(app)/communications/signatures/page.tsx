import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import {
  listSignaturePresets,
  signatureText,
  type SignatureFields,
} from "@/modules/communications/communication.service";
import { DeleteSignatureButton, SignatureForm } from "@/modules/communications/ui/controls";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Signatures · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function SignaturesPage() {
  const actor = await requireActorOrRedirect();
  const presets = await listSignaturePresets(actor);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Communication Studio"
        title="Signature presets"
        description="Reusable signatures for emails and cover letters. You choose exactly which details appear — nothing is added automatically."
        actions={
          <Link href="/communications" className={buttonClass("secondary", "sm")}>
            Back to Communication Studio
          </Link>
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Add a signature" />
          <div className="px-4 py-4">
            <SignatureForm />
          </div>
        </Card>
        <div className="flex flex-col gap-3">
          {presets.length === 0 && (
            <p className="text-fg-muted text-sm">
              No presets yet. Without one, drafts are signed with your name only.
            </p>
          )}
          {presets.map((p) => {
            const fields = p.fields as SignatureFields;
            return (
              <Card key={p.id}>
                <CardHeader
                  title={p.name}
                  description={p.isDefault ? "Default" : undefined}
                  actions={<DeleteSignatureButton presetId={p.id} />}
                />
                <div className="flex flex-col gap-3 px-4 py-3">
                  <pre className="bg-surface-2 rounded-md px-3 py-2 text-xs whitespace-pre-wrap">
                    {signatureText(fields) || "(empty)"}
                  </pre>
                  {p.isDefault && <Badge tone="success">Used for new drafts</Badge>}
                  <details>
                    <summary className="cursor-pointer text-xs">Edit</summary>
                    <div className="pt-2">
                      <SignatureForm
                        preset={{
                          id: p.id,
                          name: p.name,
                          isDefault: p.isDefault,
                          fields: fields as Record<string, string | null>,
                        }}
                      />
                    </div>
                  </details>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
