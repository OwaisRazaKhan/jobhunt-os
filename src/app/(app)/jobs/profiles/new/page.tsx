import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/primitives";
import { loadProfileFormOptions } from "@/modules/search-profiles/form-options";
import { EMPTY_PROFILE, SearchProfileForm } from "@/modules/search-profiles/ui/profile-form";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "New search profile · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function NewSearchProfilePage() {
  const actor = await requireActorOrRedirect();
  const options = await loadProfileFormOptions(actor);
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Link href="/jobs/profiles" className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> Search profiles
      </Link>
      <PageHeader
        eyebrow="Search profile"
        title="New search profile"
        description="Anything left empty means “any”. Unknown values from sources are only included when you explicitly select Unknown."
      />
      <Card className="p-4">
        <SearchProfileForm initial={EMPTY_PROFILE} options={options} />
      </Card>
    </div>
  );
}
