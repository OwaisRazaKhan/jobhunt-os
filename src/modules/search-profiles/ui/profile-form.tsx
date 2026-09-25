"use client";

import { useActionState, useMemo, useState } from "react";
import { ChipGroup } from "@/components/forms/chip-group";
import { inputClass } from "@/components/forms/field-control";
import { Button } from "@/components/ui/button";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { saveSearchProfileAction } from "@/app/(app)/jobs/profiles/actions";
import { SCHEDULE_OPTIONS } from "../schemas";
import {
  EXPERIENCE_LABELS,
  EXPERIENCE_LEVELS,
  JOB_TYPE_LABELS,
  JOB_TYPES,
  LOCATION_KIND_LABELS,
  PROFILE_SALARY_PERIODS,
  PROFILE_SOURCE_KEYS,
  VISA_LABELS,
  VISA_PREFERENCES,
  WORK_MODE_LABELS,
  WORK_MODES,
  type LocationKind,
} from "../types";

/** Options come from the database (countries, locations, categories) — nothing hard-coded. */
export interface ProfileFormOptions {
  countries: { code: string; name: string; isTargetMarket: boolean }[];
  locations: { id: string; countryCode: string; name: string; kind: LocationKind; own: boolean }[];
  categories: { id: string; name: string; termCount: number; own: boolean }[];
  sources: { key: string; name: string; enabled: boolean; boards: number }[];
}

export interface ProfileFormValues {
  name: string;
  countryCodes: string[];
  locationIds: string[];
  categoryIds: string[];
  searchTerms: string;
  workModes: string[];
  employmentTypes: string[];
  experienceLevels: string[];
  salaryMin: string | number;
  salaryMax: string | number;
  salaryCurrency: string;
  salaryPeriod: string;
  visaPreference: string;
  sourceKeys: string[];
  scheduleIntervalHours: string;
}

export const EMPTY_PROFILE: ProfileFormValues = {
  name: "",
  countryCodes: [],
  locationIds: [],
  categoryIds: [],
  searchTerms: "",
  workModes: [],
  employmentTypes: [],
  experienceLevels: [],
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "",
  salaryPeriod: "",
  visaPreference: "UNKNOWN",
  sourceKeys: [],
  scheduleIntervalHours: "",
};

const ARRAYS = [
  "countryCodes",
  "locationIds",
  "categoryIds",
  "workModes",
  "employmentTypes",
  "experienceLevels",
  "sourceKeys",
];

const labelled = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value) => ({ value, label: labels[value] }));

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border flex flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {hint && <p className="text-fg-muted mt-0.5 text-xs">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function TextField({
  label,
  name,
  value,
  onChange,
  error,
  help,
  ...rest
}: {
  label: string;
  name: string;
  value: string | number;
  onChange: (v: string) => void;
  error?: string;
  help?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-fg-muted text-xs font-medium">{label}</span>
      <input
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        className={inputClass}
        {...rest}
      />
      {help && !error && <span className="text-fg-subtle text-xs">{help}</span>}
      {error && (
        <span role="alert" className="text-danger text-xs">
          {error}
        </span>
      )}
    </label>
  );
}

export function SearchProfileForm({
  id,
  initial,
  options,
}: {
  id?: string;
  initial: ProfileFormValues;
  options: ProfileFormOptions;
}) {
  const [state, formAction, pending] = useActionState(
    saveSearchProfileAction,
    INITIAL_ACTION_STATE,
  );
  const [v, setV] = useState<ProfileFormValues>(initial);
  const set =
    <K extends keyof ProfileFormValues>(key: K) =>
    (value: ProfileFormValues[K]) =>
      setV((prev) => ({ ...prev, [key]: value }));
  const err = (key: string) => state.fieldErrors?.[key];

  const countryName = useMemo(
    () => new Map(options.countries.map((c) => [c.code, c.name])),
    [options.countries],
  );
  const targetMarkets = options.countries.filter((c) => c.isTargetMarket);
  const otherSelected = v.countryCodes.filter(
    (code) => !targetMarkets.some((c) => c.code === code),
  );
  const addableCountries = options.countries.filter(
    (c) => !c.isTargetMarket && !v.countryCodes.includes(c.code),
  );

  // Locations are offered for the selected countries only (they only constrain their own country).
  const locationGroups = v.countryCodes
    .map((code) => ({
      code,
      locations: options.locations.filter((l) => l.countryCode === code),
    }))
    .filter((g) => g.locations.length > 0);
  const visibleLocationIds = new Set(locationGroups.flatMap((g) => g.locations.map((l) => l.id)));

  const setCountries = (codes: string[]) =>
    setV((prev) => ({
      ...prev,
      countryCodes: codes,
      // Drop locations that no longer belong to a selected country.
      locationIds: prev.locationIds.filter((lid) => {
        const loc = options.locations.find((l) => l.id === lid);
        return loc ? codes.includes(loc.countryCode) : false;
      }),
    }));

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {id && <input type="hidden" name="_id" value={id} />}
      <input type="hidden" name="__arrays" value={ARRAYS.join(",")} />

      <Section title="Profile">
        <TextField
          label="Name *"
          name="name"
          value={v.name}
          onChange={set("name")}
          error={err("name")}
          placeholder="e.g. India — AI Automation — Remote/Hybrid"
          maxLength={100}
        />
      </Section>

      <Section
        title="Where"
        hint="No country selected = any country. Jobs whose country the source does not state are not assumed to match a country filter."
      >
        <ChipGroup
          name="countryCodes"
          legend="Target markets"
          options={targetMarkets.map((c) => ({ value: c.code, label: c.name }))}
          selected={v.countryCodes.filter((c) => targetMarkets.some((t) => t.code === c))}
          onChange={(next) => setCountries([...next, ...otherSelected])}
          error={err("countryCodes")}
        />
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-56 flex-col gap-1">
            <span className="text-fg-muted text-xs font-medium">Add another country</span>
            <select
              value=""
              onChange={(e) => e.target.value && setCountries([...v.countryCodes, e.target.value])}
              className={inputClass}
            >
              <option value="">Select a country…</option>
              {addableCountries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {otherSelected.map((code) => (
            <span
              key={code}
              className="border-accent bg-accent/10 flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs"
            >
              {countryName.get(code) ?? code}
              <input type="hidden" name="countryCodes[]" value={code} />
              <button
                type="button"
                className="text-fg-muted hover:text-fg"
                aria-label={`Remove ${countryName.get(code) ?? code}`}
                onClick={() => setCountries(v.countryCodes.filter((c) => c !== code))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        {v.countryCodes.length === 0 ? (
          <p className="text-fg-subtle text-xs">
            Select a country to choose its cities and regions.
          </p>
        ) : locationGroups.length === 0 ? (
          <p className="text-fg-subtle text-xs">
            No locations are configured for the selected countries yet. Add them in Search
            configuration. Without locations the whole country is searched.
          </p>
        ) : (
          locationGroups.map((g) => (
            <ChipGroup
              key={g.code}
              name="locationIds"
              legend={`Locations in ${countryName.get(g.code) ?? g.code}`}
              options={g.locations.map((l) => ({
                value: l.id,
                label: l.own ? `${l.name} (mine)` : l.name,
                title: LOCATION_KIND_LABELS[l.kind],
              }))}
              selected={v.locationIds.filter((lid) => g.locations.some((l) => l.id === lid))}
              onChange={(next) =>
                set("locationIds")([
                  ...v.locationIds.filter((lid) => !g.locations.some((l) => l.id === lid)),
                  ...next,
                ])
              }
              help="None selected = anywhere in this country."
            />
          ))
        )}
        {v.locationIds
          .filter((lid) => !visibleLocationIds.has(lid))
          .map((lid) => (
            <input key={lid} type="hidden" name="locationIds[]" value={lid} />
          ))}
        {err("locationIds") && (
          <p role="alert" className="text-danger text-xs">
            {err("locationIds")}
          </p>
        )}
        <ChipGroup
          name="workModes"
          legend="Work mode"
          options={labelled(WORK_MODES, WORK_MODE_LABELS)}
          selected={v.workModes}
          onChange={set("workModes")}
          help="None = any. “Unknown” jobs are included only when you select Unknown."
          error={err("workModes")}
        />
      </Section>

      <Section
        title="What"
        hint="Categories and terms are search keywords, not claims about your skills."
      >
        <ChipGroup
          name="categoryIds"
          legend="Job categories"
          options={options.categories.map((c) => ({
            value: c.id,
            label: c.own ? `${c.name} (mine)` : c.name,
            title: `${c.termCount} search terms`,
          }))}
          selected={v.categoryIds}
          onChange={set("categoryIds")}
          help="A job matches if it is in any selected category or mentions any of their terms."
          error={err("categoryIds")}
        />
        <label className="flex flex-col gap-1">
          <span className="text-fg-muted text-xs font-medium">Extra search terms</span>
          <textarea
            name="searchTerms"
            value={v.searchTerms}
            onChange={(e) => set("searchTerms")(e.target.value)}
            rows={3}
            placeholder="One per line, e.g. Growth Associate"
            aria-invalid={err("searchTerms") ? true : undefined}
            className={cn(inputClass, "h-auto min-h-16 py-1.5 font-mono text-xs leading-relaxed")}
          />
          {err("searchTerms") ? (
            <span role="alert" className="text-danger text-xs">
              {err("searchTerms")}
            </span>
          ) : (
            <span className="text-fg-subtle text-xs">Matched as whole words in the title.</span>
          )}
        </label>
        <ChipGroup
          name="employmentTypes"
          legend="Job type"
          options={labelled(JOB_TYPES, JOB_TYPE_LABELS)}
          selected={v.employmentTypes}
          onChange={set("employmentTypes")}
          error={err("employmentTypes")}
        />
        <ChipGroup
          name="experienceLevels"
          legend="Experience level"
          options={labelled(EXPERIENCE_LEVELS, EXPERIENCE_LABELS)}
          selected={v.experienceLevels}
          onChange={set("experienceLevels")}
          help="Read only from explicit title wording (e.g. “Intern”, “Senior”). Most jobs are Unknown."
          error={err("experienceLevels")}
        />
      </Section>

      <Section
        title="Salary & visa"
        hint="Salaries in a different currency or period are never converted; those jobs are kept and labelled “not comparable”."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TextField
            label="Minimum"
            name="salaryMin"
            type="number"
            min={0}
            value={v.salaryMin}
            onChange={set("salaryMin")}
            error={err("salaryMin")}
          />
          <TextField
            label="Maximum"
            name="salaryMax"
            type="number"
            min={0}
            value={v.salaryMax}
            onChange={set("salaryMax")}
            error={err("salaryMax")}
          />
          <TextField
            label="Currency"
            name="salaryCurrency"
            value={v.salaryCurrency}
            onChange={(x) => set("salaryCurrency")(x.toUpperCase())}
            placeholder="INR"
            maxLength={3}
            error={err("salaryCurrency")}
          />
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted text-xs font-medium">Period</span>
            <select
              name="salaryPeriod"
              value={v.salaryPeriod}
              onChange={(e) => set("salaryPeriod")(e.target.value)}
              className={inputClass}
            >
              <option value="">Any period</option>
              {PROFILE_SALARY_PERIODS.map((p) => (
                <option key={p} value={p}>
                  Per {p.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex max-w-sm flex-col gap-1">
          <span className="text-fg-muted text-xs font-medium">Visa sponsorship</span>
          <select
            name="visaPreference"
            value={v.visaPreference}
            onChange={(e) => set("visaPreference")(e.target.value)}
            className={inputClass}
          >
            {VISA_PREFERENCES.map((p) => (
              <option key={p} value={p}>
                {VISA_LABELS[p]}
              </option>
            ))}
          </select>
          <span className="text-fg-subtle text-xs">
            Informational only. It labels jobs but never filters them out.
          </span>
        </label>
      </Section>

      <Section
        title="Sources & schedule"
        hint="Sources are your enabled Ashby / Lever / Greenhouse boards. None selected = every enabled source."
      >
        <ChipGroup
          name="sourceKeys"
          legend="Sources"
          options={PROFILE_SOURCE_KEYS.map((key) => {
            const s = options.sources.find((x) => x.key === key);
            const state = !s
              ? "not set up"
              : !s.enabled
                ? "disabled"
                : `${s.boards} board${s.boards === 1 ? "" : "s"}`;
            return { value: key, label: `${s?.name ?? key} · ${state}` };
          })}
          selected={v.sourceKeys}
          onChange={set("sourceKeys")}
          error={err("sourceKeys")}
        />
        <label className="flex max-w-sm flex-col gap-1">
          <span className="text-fg-muted text-xs font-medium">Automatic runs</span>
          <select
            name="scheduleIntervalHours"
            value={v.scheduleIntervalHours}
            onChange={(e) => set("scheduleIntervalHours")(e.target.value)}
            className={inputClass}
          >
            {SCHEDULE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {err("scheduleIntervalHours") && (
            <span role="alert" className="text-danger text-xs">
              {err("scheduleIntervalHours")}
            </span>
          )}
        </label>
      </Section>

      {state.error && (
        <p
          role="alert"
          className="border-danger/30 bg-danger/5 text-danger rounded-md border px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      )}
      <div className="border-border flex justify-end gap-2 border-t pt-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : id ? "Save profile" : "Create profile"}
        </Button>
      </div>
    </form>
  );
}
