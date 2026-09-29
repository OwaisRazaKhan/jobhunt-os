/**
 * Deterministic hashes for the Application Engine (pure).
 *  - applicationContentHash: the normalized application state a human approves
 *    (candidate, job, locked versions, every field value + provenance, answer hashes, file hashes)
 *  - answerHash: one answer's content
 *  - formFingerprint: public form structure only (URL path, field ids/labels/types/required/options)
 *    — never candidate data
 */
import { createHash } from "node:crypto";

const stable = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v as object)
            .sort()
            .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
        )
      : (v ?? null);

const sha = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
const norm = (s: string) =>
  s
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();

export function answerHash(text: string): string {
  return sha(["answer", norm(text)]);
}

export interface ApplicationStateInput {
  candidateId: string;
  jobId: string;
  packageIntegrityHash: string;
  /** Exact asset versions: { RESUME: {versionId, contentHash}, ... } */
  assets: Record<string, { versionId: string; contentHash: string }>;
  fields: {
    fieldKey: string;
    mappingType: string;
    sourceRef: string | null;
    value: unknown;
  }[];
  answers: { questionKey: string; contentHash: string }[];
  files: { role: string; sha256: string }[];
  channel: { type: string; url: string | null; email: string | null } | null;
}

export function applicationContentHash(input: ApplicationStateInput): string {
  return sha({
    v: 1,
    candidateId: input.candidateId,
    jobId: input.jobId,
    packageIntegrityHash: input.packageIntegrityHash,
    assets: input.assets,
    fields: [...input.fields]
      .sort((a, b) => a.fieldKey.localeCompare(b.fieldKey))
      .map((f) => ({ ...f, value: typeof f.value === "string" ? norm(f.value) : f.value })),
    answers: [...input.answers].sort((a, b) => a.questionKey.localeCompare(b.questionKey)),
    files: [...input.files].sort((a, b) => a.role.localeCompare(b.role)),
    channel: input.channel,
  });
}

export interface FormStructureField {
  externalFieldId: string;
  label: string;
  fieldType: string;
  required: boolean;
  options: string[];
}

/** Normalized URL for fingerprinting: scheme + host + path (no query/hash, no candidate data). */
export function fingerprintUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url;
  }
}

export function fieldFingerprint(f: FormStructureField): string {
  return sha([
    "field",
    f.externalFieldId,
    norm(f.label).toLowerCase(),
    f.fieldType,
    f.required,
    [...f.options].map((o) => norm(o).toLowerCase()).sort(),
  ]);
}

export function formFingerprint(url: string, fields: FormStructureField[]): string {
  return sha(["form", fingerprintUrl(url), fields.map(fieldFingerprint).sort()]);
}

/**
 * How much two form structures differ (0 = identical, 1 = nothing in common). Used to decide
 * FORM_CHANGED: any removed/changed required field, or a large overall change, needs reinspection.
 */
export function formDrift(before: FormStructureField[], after: FormStructureField[]) {
  const a = new Map(before.map((f) => [f.externalFieldId, fieldFingerprint(f)]));
  const b = new Map(after.map((f) => [f.externalFieldId, fieldFingerprint(f)]));
  const removed = [...a.keys()].filter((k) => !b.has(k));
  const added = [...b.keys()].filter((k) => !a.has(k));
  const changed = [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k));
  const total = new Set([...a.keys(), ...b.keys()]).size || 1;
  const requiredTouched =
    before.some(
      (f) =>
        f.required && (removed.includes(f.externalFieldId) || changed.includes(f.externalFieldId)),
    ) || after.some((f) => f.required && added.includes(f.externalFieldId));
  const ratio = (removed.length + added.length + changed.length) / total;
  return { removed, added, changed, ratio, changedSignificantly: requiredTouched || ratio >= 0.2 };
}
