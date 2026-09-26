"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { ChipGroup } from "@/components/forms/chip-group";
import { inputClass } from "@/components/forms/field-control";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  EXPERIENCE_LABELS,
  EXPERIENCE_LEVELS,
  JOB_TYPE_LABELS,
  JOB_TYPES,
  PROFILE_SALARY_PERIODS,
  WORK_MODE_LABELS,
  WORK_MODES,
} from "@/modules/search-profiles/types";
import {
  EMPTY_SEARCH,
  FRESHNESS_DAYS,
  MATCH_FILTER_LABELS,
  MATCH_FILTERS,
  MAX_QUERY_LENGTH,
  searchHref,
  type JobSearchParams,
} from "../search/params";
import { JOB_STATUSES } from "../types";

export interface SearchFormOptions {
  countries: { code: string; name: string; isTargetMarket: boolean; jobs: number }[];
  locations: { id: string; countryCode: string; name: string; kind: string; own: boolean }[];
  categories: { id: string; name: string; own: boolean }[];
  profiles: { id: string; name: string; enabled: boolean }[];
  /** [sourceKey, label, count] — counts are real distinct matching jobs */
  sources: [string, string, number][];
}

const labelled = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value) => ({ value, label: labels[value] }));
const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  STALE: "Stale",
  CLOSED: "Closed",
  UNKNOWN: "Unknown",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="border-border flex min-w-0 flex-col gap-2 border-t pt-3 first-of-type:border-t-0 first-of-type:pt-0">
      <legend className="sr-only">{title}</legend>
      {children}
    </fieldset>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-fg-muted text-xs font-medium">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {children}
      </select>
    </label>
  );
}

export function JobSearchForm({
  basePath,
  params,
  options,
  savedId,
  activeCount,
}: {
  basePath: string;
  params: JobSearchParams;
  options: SearchFormOptions;
  savedId: string | null;
  activeCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState(params);
  const [open, setOpen] = useState(false);
  const set = <K extends keyof JobSearchParams>(key: K, value: JobSearchParams[K]) =>
    setV((prev) => ({ ...prev, [key]: value }));
  const go = (next: JobSearchParams) => {
    const href = searchHref(basePath, { ...next, page: 1 });
    startTransition(() =>
      router.push(savedId ? `${href}${href.includes("?") ? "&" : "?"}saved=${savedId}` : href),
    );
  };

  const shownCountries = options.countries.filter(
    (c) => c.isTargetMarket || c.jobs > 0 || v.country.includes(c.code),
  );
  const otherCountries = options.countries.filter((c) => !shownCountries.includes(c));
  const locationCountries = v.country.length
    ? v.country
    : [...new Set(options.locations.filter((l) => v.loc.includes(l.id)).map((l) => l.countryCode))];
  const countryName = new Map(options.countries.map((c) => [c.code, c.name]));
  const num = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.floor(Number(s))) || 0);

  return (
    <form
      role="search"
      aria-label="Search jobs"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        go(v);
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search jobs</span>
          <Search
            className="text-fg-subtle pointer-events-none absolute top-2 left-2.5 size-4"
            aria-hidden
          />
          <input
            type="search"
            value={v.q}
            onChange={(e) => set("q", e.target.value)}
            maxLength={MAX_QUERY_LENGTH}
            placeholder="Title, company, location or keyword — e.g. AI automation"
            className={cn(inputClass, "h-8 pl-8")}
          />
        </label>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="job-filters"
            className="xl:hidden"
          >
            <SlidersHorizontal className="size-3.5" aria-hidden /> Filters
            {activeCount > 0 && <span className="text-accent font-mono">{activeCount}</span>}
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Searching…" : "Search"}
          </Button>
        </div>
      </div>

      <div id="job-filters" className={cn("flex-col gap-3 xl:flex", open ? "flex" : "hidden")}>
        <Section title="Where">
          <ChipGroup
            name="country"
            legend="Country"
            options={shownCountries.map((c) => ({
              value: c.code,
              label: c.jobs ? `${c.name} · ${c.jobs}` : c.name,
            }))}
            selected={v.country}
            onChange={(next) => set("country", next)}
          />
          {otherCountries.length > 0 && (
            <Select
              label="Other country"
              value=""
              onChange={(code) => code && set("country", [...v.country, code])}
            >
              <option value="">Add a country…</option>
              {otherCountries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          {locationCountries.map((code) => {
            const locs = options.locations.filter((l) => l.countryCode === code);
            if (!locs.length) return null;
            return (
              <ChipGroup
                key={code}
                name="loc"
                legend={`Cities & regions — ${countryName.get(code) ?? code}`}
                options={locs.map((l) => ({
                  value: l.id,
                  label: l.own ? `${l.name} (mine)` : l.name,
                }))}
                selected={v.loc.filter((id) => locs.some((l) => l.id === id))}
                onChange={(next) =>
                  set("loc", [...v.loc.filter((id) => !locs.some((l) => l.id === id)), ...next])
                }
              />
            );
          })}
          {v.country.length === 0 && v.loc.length === 0 && (
            <p className="text-fg-subtle text-xs">Select a country to filter by city or region.</p>
          )}
          <ChipGroup
            name="mode"
            legend="Work mode"
            options={labelled(WORK_MODES, WORK_MODE_LABELS)}
            selected={v.mode}
            onChange={(next) => set("mode", next)}
            help="Unknown is only included when selected — it is never treated as remote."
          />
        </Section>

        <Section title="What">
          <ChipGroup
            name="cat"
            legend="Category"
            options={options.categories.map((c) => ({
              value: c.id,
              label: c.own ? `${c.name} (mine)` : c.name,
            }))}
            selected={v.cat}
            onChange={(next) => set("cat", next)}
          />
          <ChipGroup
            name="type"
            legend="Employment type"
            options={labelled(JOB_TYPES, JOB_TYPE_LABELS)}
            selected={v.type}
            onChange={(next) => set("type", next)}
          />
          <ChipGroup
            name="exp"
            legend="Experience level"
            options={labelled(EXPERIENCE_LEVELS, EXPERIENCE_LABELS)}
            selected={v.exp}
            onChange={(next) => set("exp", next)}
            help="From explicit title wording only — a catalog attribute, not an assessment of you."
          />
        </Section>

        <Section title="Salary">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted text-xs font-medium">Min</span>
              <input
                type="number"
                min={0}
                value={v.salMin ?? ""}
                onChange={(e) => set("salMin", num(e.target.value))}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted text-xs font-medium">Max</span>
              <input
                type="number"
                min={0}
                value={v.salMax ?? ""}
                onChange={(e) => set("salMax", num(e.target.value))}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted text-xs font-medium">Currency</span>
              <input
                value={v.cur ?? ""}
                onChange={(e) => set("cur", e.target.value.toUpperCase().slice(0, 3) || null)}
                placeholder="INR"
                maxLength={3}
                className={cn(inputClass, "font-mono uppercase")}
              />
            </label>
            <Select label="Period" value={v.per ?? ""} onChange={(p) => set("per", p || null)}>
              <option value="">Any period</option>
              {PROFILE_SALARY_PERIODS.map((p) => (
                <option key={p} value={p}>
                  Per {p.toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
          <label className="text-fg-muted flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={v.salOnly}
              onChange={(e) => set("salOnly", e.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
            Only jobs with a comparable salary
          </label>
          <p className="text-fg-subtle text-xs">
            Needs a currency. Other currencies are never converted — they are kept and marked “not
            comparable”; unknown salaries are never treated as zero.
          </p>
        </Section>

        <Section title="Source & freshness">
          <ChipGroup
            name="src"
            legend="Source"
            options={options.sources.map(([key, label, count]) => ({
              value: key,
              label: `${label} · ${count}`,
            }))}
            selected={v.src}
            onChange={(next) => set("src", next)}
            help={options.sources.length ? undefined : "No sources in the current results."}
          />
          <ChipGroup
            name="status"
            legend="Status"
            options={JOB_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
            selected={v.status}
            onChange={(next) => set("status", next)}
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-1">
            {(
              [
                ["posted", "Posted within"],
                ["disc", "Discovered within"],
                ["seen", "Last seen within"],
              ] as const
            ).map(([key, label]) => (
              <Select
                key={key}
                label={label}
                value={v[key] ? String(v[key]) : ""}
                onChange={(d) => set(key, d ? Number(d) : null)}
              >
                <option value="">Any time</option>
                {FRESHNESS_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? "24 hours" : `${d} days`}
                  </option>
                ))}
              </Select>
            ))}
          </div>
        </Section>

        <Section title="Match">
          <ChipGroup
            name="match"
            legend="Your match status"
            options={MATCH_FILTERS.map((m) => ({ value: m, label: MATCH_FILTER_LABELS[m] ?? m }))}
            selected={v.match}
            onChange={(next) => set("match", next)}
            help="Only jobs you matched explicitly have a status. Nothing is matched automatically."
          />
        </Section>

        {options.profiles.length > 0 && (
          <Section title="Search profile">
            <Select
              label="Found by search profile"
              value={v.profile ?? ""}
              onChange={(id) => set("profile", id || null)}
            >
              <option value="">Any (whole catalog)</option>
              {options.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.enabled ? "" : " (disabled)"}
                </option>
              ))}
            </Select>
          </Section>
        )}

        <div className="border-border flex gap-2 border-t pt-3">
          <Button type="submit" variant="primary" disabled={pending} className="flex-1">
            {pending ? "Searching…" : "Apply filters"}
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              const cleared = { ...EMPTY_SEARCH, sort: params.sort };
              setV(cleared);
              go(cleared);
            }}
          >
            <X className="size-3.5" aria-hidden /> Clear
          </Button>
        </div>
      </div>
    </form>
  );
}
