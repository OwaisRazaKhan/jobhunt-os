import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { listSignaturePresets } from "@/modules/communications/communication.service";
import { getCommunicationPreferences } from "@/modules/communications/recipient.service";
import { PreferencesForm } from "@/modules/communications/ui/package-controls";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Communication preferences · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  const actor = await requireActorOrRedirect();
  const [prefs, presets] = await Promise.all([
    getCommunicationPreferences(actor),
    listSignaturePresets(actor),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Communication Studio"
        title="Communication preferences"
        description="Your defaults for new emails and cover letters. AI drafts follow them; you can still change anything per communication."
        actions={
          <>
            <Link href="/communications/signatures" className={buttonClass("secondary", "sm")}>
              Signature profiles
            </Link>
            <Link href="/communications" className={buttonClass("ghost", "sm")}>
              Back
            </Link>
          </>
        }
      />
      <Card>
        <CardHeader title="Personalization" />
        <div className="px-4 py-4">
          <PreferencesForm
            values={prefs}
            signatures={presets.map((p) => ({ value: p.id, label: p.name }))}
            defaultSignatureId={presets.find((p) => p.isDefault)?.id ?? null}
          />
        </div>
      </Card>
    </div>
  );
}
