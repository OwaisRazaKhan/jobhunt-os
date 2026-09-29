/**
 * Application adapters (Phase 8). Each adapter declares only what it genuinely supports and how
 * that support was verified. The UI never talks to a provider directly: services pick an adapter
 * for the resolved channel; browser work happens in the worker.
 *
 *   TEST_FIXTURE      controlled local test form — inspection, autofill, upload, submission verified
 *                     by automated browser tests (TEST ADAPTER: never used for a real job)
 *   GREENHOUSE        inspection through the official public Job Board API (verified live, read-only);
 *                     browser autofill/submission not verified against a real employer form
 *   LEVER / ASHBY     browser inspection of the public apply page; autofill/submission not verified
 *                     against a real employer form
 *   GENERIC_WEB_FORM  cautious browser inspection/autofill of other forms; not verified live
 *   EMAIL             builds the email application payload; delivery needs a Phase 10 connector
 *   MANUAL            prepared checklist; the candidate applies and confirms
 */
import type { AtsProvider, ChannelType, FieldType } from "../types";

export const ADAPTER_IDS = [
  "TEST_FIXTURE",
  "GREENHOUSE",
  "LEVER",
  "ASHBY",
  "GENERIC_WEB_FORM",
  "EMAIL",
  "MANUAL",
] as const;
export type AdapterId = (typeof ADAPTER_IDS)[number];

export interface AdapterCapabilities {
  supportsInspection: boolean;
  supportsAutofill: boolean;
  supportsFileUpload: boolean;
  supportsSubmission: boolean;
  supportsPause: boolean;
  supportsResume: boolean;
  /** How the capability claims were verified */
  verification: "AUTOMATED_TESTS" | "LIVE_READ_ONLY" | "NOT_VERIFIED_LIVE" | "NOT_APPLICABLE";
}

export interface InspectedField {
  externalFieldId: string;
  selector: string | null;
  label: string;
  fieldType: FieldType;
  required: boolean;
  options: string[];
  optionValues: string[];
  maxLength: number | null;
  pageUrl: string | null;
  /** DEMOGRAPHIC when the provider marks it as voluntary self-identification */
  classificationHint?: "DEMOGRAPHIC" | "CONSENT" | null;
}

export interface InspectionResult {
  url: string;
  source: "API" | "BROWSER" | "FIXTURE";
  fields: InspectedField[];
  deadlineAt: Date | null;
  notes: string[];
}

export interface AdapterDefinition {
  id: AdapterId;
  version: string;
  label: string;
  isTest: boolean;
  usesBrowser: boolean;
  capabilities: AdapterCapabilities;
  limitations: string;
}

const BROWSER_CAPS = {
  supportsInspection: true,
  supportsAutofill: true,
  supportsFileUpload: true,
  supportsSubmission: true,
  supportsPause: true,
  supportsResume: true,
} as const;

export const ADAPTERS: Record<AdapterId, AdapterDefinition> = {
  TEST_FIXTURE: {
    id: "TEST_FIXTURE",
    version: "1",
    label: "Test fixture (TEST ADAPTER)",
    isTest: true,
    usesBrowser: true,
    capabilities: { ...BROWSER_CAPS, verification: "AUTOMATED_TESTS" },
    limitations: "Controlled local test form only. Never used for a real job or company.",
  },
  GREENHOUSE: {
    id: "GREENHOUSE",
    version: "1",
    label: "Greenhouse",
    isTest: false,
    usesBrowser: true,
    capabilities: { ...BROWSER_CAPS, verification: "LIVE_READ_ONLY" },
    limitations:
      "Form inspection uses the official public Job Board API (verified live, read-only). Filling and submitting run in your browser session and have not been verified against a real employer's form — you watch and approve every step.",
  },
  LEVER: {
    id: "LEVER",
    version: "1",
    label: "Lever",
    isTest: false,
    usesBrowser: true,
    capabilities: { ...BROWSER_CAPS, verification: "NOT_VERIFIED_LIVE" },
    limitations:
      "Browser inspection of the public apply page (robots.txt respected). Not verified against a real employer's form; Lever forms often include a CAPTCHA, which you complete yourself.",
  },
  ASHBY: {
    id: "ASHBY",
    version: "1",
    label: "Ashby",
    isTest: false,
    usesBrowser: true,
    capabilities: { ...BROWSER_CAPS, verification: "NOT_VERIFIED_LIVE" },
    limitations:
      "Browser inspection of the public application page (robots.txt respected). Not verified against a real employer's form; any CAPTCHA or sign-in is left to you.",
  },
  GENERIC_WEB_FORM: {
    id: "GENERIC_WEB_FORM",
    version: "1",
    label: "Generic web form",
    isTest: false,
    usesBrowser: true,
    capabilities: { ...BROWSER_CAPS, verification: "NOT_VERIFIED_LIVE" },
    limitations:
      "Cautious inspection of accessible fields; ambiguous fields always need your review. Not verified live.",
  },
  EMAIL: {
    id: "EMAIL",
    version: "1",
    label: "Email application",
    isTest: false,
    usesBrowser: false,
    capabilities: {
      supportsInspection: false,
      supportsAutofill: false,
      supportsFileUpload: true,
      supportsSubmission: false,
      supportsPause: false,
      supportsResume: false,
      verification: "NOT_APPLICABLE",
    },
    limitations:
      "Prepares the exact email application (recipient, subject, body, approved attachments). Sending needs an email connector (Phase 10); until then you send it yourself and confirm.",
  },
  MANUAL: {
    id: "MANUAL",
    version: "1",
    label: "Manual application",
    isTest: false,
    usesBrowser: false,
    capabilities: {
      supportsInspection: false,
      supportsAutofill: false,
      supportsFileUpload: false,
      supportsSubmission: false,
      supportsPause: false,
      supportsResume: false,
      verification: "NOT_APPLICABLE",
    },
    limitations: "JOBHUNT OS prepares the checklist and answers; you apply and confirm.",
  },
};

export function selectAdapter(
  channel: {
    channelType: ChannelType | string;
    provider: AtsProvider | string;
    url: string | null;
  },
  fixtureOrigin?: string | null,
): AdapterDefinition {
  if (channel.url && fixtureOrigin) {
    try {
      if (new URL(channel.url).origin === new URL(fixtureOrigin).origin)
        return ADAPTERS.TEST_FIXTURE;
    } catch {
      // fall through
    }
  }
  if (channel.channelType === "EMAIL_APPLICATION") return ADAPTERS.EMAIL;
  if (
    channel.channelType === "MANUAL_APPLICATION" ||
    channel.channelType === "UNKNOWN" ||
    !channel.url
  )
    return ADAPTERS.MANUAL;
  if (channel.provider === "GREENHOUSE") return ADAPTERS.GREENHOUSE;
  if (channel.provider === "LEVER") return ADAPTERS.LEVER;
  if (channel.provider === "ASHBY") return ADAPTERS.ASHBY;
  return ADAPTERS.GENERIC_WEB_FORM;
}

// --- Greenhouse: official public Job Board API ------------------------------------------------

interface GhField {
  name: string;
  type: string;
  values?: { label: string; value: string | number }[];
}
interface GhQuestion {
  label: string;
  required: boolean;
  fields: GhField[];
}

const GH_TYPE: Record<string, FieldType> = {
  input_text: "TEXT",
  input_file: "FILE",
  textarea: "TEXTAREA",
  multi_value_single_select: "SELECT",
  multi_value_multi_select: "MULTISELECT",
};

function ghFieldType(f: GhField): FieldType {
  if (f.name === "email") return "EMAIL";
  if (f.name === "phone") return "PHONE";
  const t = GH_TYPE[f.type] ?? "UNKNOWN";
  if (
    t === "SELECT" &&
    f.values?.length === 2 &&
    f.values.every((v) => /^(yes|no)$/i.test(v.label))
  )
    return "YES_NO";
  return t;
}

/** Parses the Greenhouse `?questions=true` payload into the normalized field model (pure). */
export function parseGreenhouseQuestions(payload: {
  absolute_url?: string;
  application_deadline?: string | null;
  questions?: GhQuestion[];
  compliance?: { type: string; questions: GhQuestion[] }[] | null;
  demographic_questions?: {
    questions?: {
      label: string;
      required: boolean;
      answer_options?: { label: string; id: number }[];
      id: number;
    }[];
  } | null;
}): InspectionResult {
  const url = payload.absolute_url ?? "";
  const fields: InspectedField[] = [];
  const push = (
    q: GhQuestion,
    f: GhField,
    hint: InspectedField["classificationHint"] = null,
    requiredOverride?: boolean,
  ) => {
    if (f.type === "input_hidden") return;
    const values = f.values ?? [];
    fields.push({
      externalFieldId: f.name,
      selector: `[name="${f.name.replace(/"/g, '\\"')}"]`,
      label: q.label.replace(/\s+/g, " ").trim(),
      fieldType: ghFieldType(f),
      required: requiredOverride ?? q.required,
      options: values.map((v) => v.label),
      optionValues: values.map((v) => String(v.value)),
      maxLength: null,
      pageUrl: url || null,
      classificationHint: hint,
    });
  };
  for (const q of payload.questions ?? []) {
    // Resume/cover letter: file upload is the primary field; the "paste text" alternative is optional.
    q.fields.forEach((f, i) => push(q, f, null, i === 0 ? q.required : false));
  }
  for (const block of payload.compliance ?? [])
    for (const q of block.questions) for (const f of q.fields) push(q, f, "DEMOGRAPHIC", false);
  for (const q of payload.demographic_questions?.questions ?? [])
    fields.push({
      externalFieldId: `demographic_${q.id}`,
      selector: null,
      label: q.label,
      fieldType: "SELECT",
      required: false,
      options: (q.answer_options ?? []).map((o) => o.label),
      optionValues: (q.answer_options ?? []).map((o) => String(o.id)),
      maxLength: null,
      pageUrl: url || null,
      classificationHint: "DEMOGRAPHIC",
    });
  const deadline = payload.application_deadline ? new Date(payload.application_deadline) : null;
  return {
    url,
    source: "API",
    fields,
    deadlineAt: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
    notes: ["Fields from the official Greenhouse Job Board API (questions=true)."],
  };
}

export function greenhouseQuestionsUrl(board: string, externalJobId: string) {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(externalJobId)}?questions=true`;
}
