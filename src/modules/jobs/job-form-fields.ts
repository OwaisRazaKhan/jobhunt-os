import type { FieldDef } from "@/modules/candidate/form-fields";
import { optionLabel } from "@/modules/candidate/options";
import {
  EMPLOYMENT_TYPES,
  RELOCATION_OPTIONS,
  REMOTE_STATUSES,
  SALARY_PERIODS,
} from "./jobs.schemas";

/** Manual job form (client-safe). Matches manualJobInput on the server. */

const opts = (values: readonly string[]) =>
  values.map((value) => ({
    value,
    label: value === "UNKNOWN" ? "Unknown / not stated" : optionLabel(value),
  }));

export const MANUAL_JOB_FIELDS: FieldDef[] = [
  { name: "title", label: "Job title", type: "text", required: true },
  { name: "company", label: "Company", type: "text", required: true },
  {
    name: "jobUrl",
    label: "Job URL",
    type: "url",
    required: true,
    help: "The job posting link, starting with https://",
  },
  {
    name: "applicationUrl",
    label: "Application URL",
    type: "url",
    help: "Only if different from the job URL",
  },
  {
    name: "locationRaw",
    label: "Location",
    type: "text",
    required: true,
    placeholder: "e.g. Berlin, Germany · Remote (EU)",
    help: "As written in the posting",
  },
  { name: "countryCode", label: "Country", type: "country", required: true },
  {
    name: "employmentType",
    label: "Employment type",
    type: "select",
    options: opts(EMPLOYMENT_TYPES),
  },
  {
    name: "remoteStatus",
    label: "Work mode",
    type: "select",
    options: opts(REMOTE_STATUSES),
    help: "Only what the posting states",
  },
  { name: "salaryMin", label: "Salary minimum", type: "number", min: 0 },
  { name: "salaryMax", label: "Salary maximum", type: "number", min: 0 },
  {
    name: "salaryCurrency",
    label: "Currency",
    type: "text",
    placeholder: "EUR",
    help: "3-letter code, e.g. EUR, USD, AED",
  },
  { name: "salaryPeriod", label: "Salary period", type: "select", options: opts(SALARY_PERIODS) },
  {
    name: "relocationAvailable",
    label: "Relocation available",
    type: "select",
    options: opts(RELOCATION_OPTIONS),
  },
  { name: "postedAt", label: "Posted date", type: "date" },
  {
    name: "description",
    label: "Description",
    type: "textarea",
    required: true,
    wide: true,
    help: "Paste the job description. It is stored and shown as plain text.",
  },
  {
    name: "visaTextRaw",
    label: "Visa / work authorization wording",
    type: "textarea",
    wide: true,
    help: "Copy the posting's exact words, if any. No eligibility analysis is made.",
  },
  {
    name: "notes",
    label: "Private notes",
    type: "textarea",
    wide: true,
    help: "Only visible to you",
  },
];
