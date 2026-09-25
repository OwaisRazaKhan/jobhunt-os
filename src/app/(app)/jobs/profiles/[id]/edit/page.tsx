import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { buttonClass } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/primitives";
import { loadProfileFormOptions } from "@/modules/search-profiles/form-options";
import { getSearchProfile, profileFormValues } from "@/modules/search-profiles/profiles.service";
import { SearchProfileForm } from "@/modules/search-profiles/ui/profile-form";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Edit search profile · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function EditSearchProfilePage({
  params,
}: PageProps<"/jobs/profiles/[id]/edit">) {
  const actor = await requireActorOrRedirect();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [profile, options] = await Promise.all([
    getSearchProfile(actor, id.data).catch((error) => {
      if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
      throw error;
    }),
    loadProfileFormOptions(actor),
  ]);
  const values = profileFormValues(profile);
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Link href="/jobs/profiles" className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> Search profiles
      </Link>
      <PageHeader eyebrow="Search profile" title={`Edit “${profile.name}”`} />
      <Card className="p-4">
        <SearchProfileForm
          id={profile.id}
          initial={{
            ...values,
            salaryMin: String(values.salaryMin),
            salaryMax: String(values.salaryMax),
          }}
          options={options}
        />
      </Card>
    </div>
  );
}
