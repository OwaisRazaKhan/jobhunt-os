import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import {
  listCategories,
  listCountries,
  listLocations,
} from "@/modules/search-profiles/config.service";
import {
  AddCategoryButton,
  AddLocationButton,
  AddTermForm,
  RemoveCategoryButton,
  RemoveLocationButton,
  TermChip,
} from "@/modules/search-profiles/ui/config-controls";
import { LOCATION_KIND_LABELS } from "@/modules/search-profiles/types";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Search configuration · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function SearchConfigurationPage() {
  const actor = await requireActorOrRedirect();
  const [countries, locations, categories] = await Promise.all([
    listCountries(actor),
    listLocations(actor),
    listCategories(actor),
  ]);
  const countryName = new Map(countries.map((c) => [c.code, c.name]));
  const byCountry = [...new Set(locations.map((l) => l.countryCode))]
    .map((code) => ({
      code,
      name: countryName.get(code) ?? code,
      locations: locations.filter((l) => l.countryCode === code),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const termCount = categories.reduce((n, c) => n + c.terms.length, 0);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/jobs/profiles" className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> Search profiles
      </Link>
      <PageHeader
        eyebrow="Discovery"
        title="Locations & categories"
        description="The options your search profiles choose from. System defaults are read-only; anything you add is yours alone and can be removed."
      />

      <Card>
        <CardHeader
          title="Locations"
          count={locations.length}
          description="Cities, regions and metro areas per country, with alternative spellings used for matching."
          actions={
            <AddLocationButton
              countries={countries.map((c) => ({ value: c.code, label: c.name }))}
            />
          }
        />
        <div className="divide-border divide-y">
          {byCountry.map((group) => (
            <div key={group.code} className="flex flex-col gap-2 px-4 py-3 sm:flex-row">
              <p className="text-fg w-40 shrink-0 text-xs font-medium">
                {group.name} <span className="text-fg-subtle font-mono">{group.code}</span>
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {group.locations.map((l) => (
                  <li
                    key={l.id}
                    className="border-border-strong flex items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2 text-xs"
                    title={[
                      LOCATION_KIND_LABELS[l.kind],
                      l.aliases.length ? `also: ${l.aliases.join(", ")}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    {l.name}
                    {l.own ? (
                      <>
                        <Badge tone="accent">mine</Badge>
                        <RemoveLocationButton id={l.id} name={l.name} />
                      </>
                    ) : (
                      <span className="pr-1.5" />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Job categories"
          count={categories.length}
          description={`${termCount} search terms. Terms are keywords matched as whole words in job titles — never claims about your skills.`}
          actions={<AddCategoryButton />}
        />
        <div className="divide-border divide-y">
          {categories.map((c) => (
            <div key={c.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-fg text-xs font-medium">{c.name}</p>
                {c.own ? <Badge tone="accent">mine</Badge> : <Badge tone="neutral">system</Badge>}
                <span className="text-fg-subtle font-mono text-[11px]">{c.terms.length} terms</span>
                {c.own && (
                  <div className="ml-auto">
                    <RemoveCategoryButton id={c.id} name={c.name} />
                  </div>
                )}
              </div>
              {c.description && <p className="text-fg-muted text-xs">{c.description}</p>}
              <div className="flex flex-wrap gap-1">
                {c.terms.map((t) => (
                  <TermChip key={t.id} id={t.id} term={t.term} own={t.own} />
                ))}
                {c.terms.length === 0 && (
                  <span className="text-fg-subtle text-xs">No terms yet.</span>
                )}
              </div>
              <AddTermForm categoryId={c.id} categoryName={c.name} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
