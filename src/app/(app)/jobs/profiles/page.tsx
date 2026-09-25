import { ArrowLeft, Pencil, Plus, Radar, SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { listCountries } from "@/modules/search-profiles/config.service";
import { listSearchProfiles } from "@/modules/search-profiles/profiles.service";
import {
  DeleteProfileButton,
  DuplicateProfileButton,
  ProfileEnabledToggle,
} from "@/modules/search-profiles/ui/profile-controls";
import { ProfileSummary } from "@/modules/search-profiles/ui/profile-summary";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Search profiles · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const when = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "—");

export default async function SearchProfilesPage({ searchParams }: PageProps<"/jobs/profiles">) {
  const actor = await requireActorOrRedirect();
  const [profiles, countries, params] = await Promise.all([
    listSearchProfiles(actor),
    listCountries(actor),
    searchParams,
  ]);
  const countryNames = new Map(countries.map((c) => [c.code, c.name]));

  return (
    <div className="flex flex-col gap-5">
      <Link href="/jobs" className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> All jobs
      </Link>
      <PageHeader
        eyebrow="Discovery"
        title="Search profiles"
        description="What you want to find. A search profile only decides which discovered jobs are linked to it — it is not your candidate profile and not a fit score."
        actions={
          <>
            <Link href="/jobs/profiles/configuration" className={buttonClass("secondary", "sm")}>
              <SlidersHorizontal className="size-3.5" aria-hidden /> Locations & categories
            </Link>
            <Link href="/jobs/profiles/new" className={buttonClass("primary", "sm")}>
              <Plus className="size-3.5" aria-hidden /> New profile
            </Link>
          </>
        }
      />
      {params.saved === "1" && <Alert tone="success">Search profile saved.</Alert>}
      {params.deleted === "1" && (
        <Alert tone="success">Search profile deleted. Discovered jobs were kept.</Alert>
      )}

      {profiles.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Radar className="size-6" />}
            title="No search profiles yet"
            description="Create one, e.g. “India — AI Automation — Remote/Hybrid”, then run discovery with it."
            action={
              <Link href="/jobs/profiles/new" className={buttonClass("primary", "sm")}>
                <Plus className="size-3.5" aria-hidden /> New profile
              </Link>
            }
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {profiles.map((p) => (
            <li key={p.id}>
              <Card className={p.enabled ? undefined : "opacity-80"}>
                <CardHeader
                  title={p.name}
                  description={`Last run ${when(p.lastRunAt)} · Next run ${p.enabled ? when(p.nextRunAt) : "—"}`}
                  actions={
                    <Badge tone="info" title="Jobs linked to this profile">
                      {p._count.hits} jobs
                    </Badge>
                  }
                />
                <div className="flex flex-col gap-4 px-4 py-3">
                  <ProfileSummary profile={p} countryNames={countryNames} />
                  <div className="border-border flex flex-wrap items-center gap-2 border-t pt-3">
                    <ProfileEnabledToggle id={p.id} name={p.name} enabled={p.enabled} />
                    <div className="ml-auto flex flex-wrap items-start gap-1.5">
                      {p.enabled && (
                        <Link
                          href={`/jobs/discovery?profile=${p.id}`}
                          className={buttonClass("secondary", "sm")}
                        >
                          <Radar className="size-3.5" aria-hidden /> Run
                        </Link>
                      )}
                      <Link
                        href={`/jobs/profiles/${p.id}/edit`}
                        className={buttonClass("ghost", "sm")}
                        aria-label={`Edit ${p.name}`}
                      >
                        <Pencil className="size-3.5" aria-hidden /> Edit
                      </Link>
                      <DuplicateProfileButton id={p.id} name={p.name} />
                      <DeleteProfileButton id={p.id} name={p.name} />
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
