import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  answerHash,
  applicationContentHash,
  fieldFingerprint,
  formDrift,
  formFingerprint,
  type FormStructureField,
} from "./hash";
import { canTransition, MANUAL_CONFIRM_FROM, TRANSITIONS } from "./state-machine";
import { APPLICATION_STATUSES, type ApplicationStatus } from "./types";
import { validateFieldValue, type FileValue } from "./validation";

/** The most recent migration that (re)defines the status trigger function. */
function latestGuardFunction(): string {
  const dir = "prisma/migrations";
  const defs = readdirSync(dir)
    .filter((m) => /^\d{14}_/.test(m))
    .sort()
    .map((m) => readFileSync(join(dir, m, "migration.sql"), "utf8"))
    .filter((sql) => sql.includes("FUNCTION applications_guard_status"));
  const sql = defs.at(-1)!;
  const from = sql.indexOf("FUNCTION applications_guard_status");
  return sql.slice(from, sql.indexOf("$;", from));
}

describe("state machine", () => {
  it("TypeScript transitions match the database trigger exactly (all pairs)", () => {
    const sql = latestGuardFunction();
    const dbTable = new Map<string, string[]>();
    for (const m of sql.matchAll(/WHEN '([A-Z_]+)' THEN ARRAY\[([^\]]*)\]/g))
      dbTable.set(
        m[1]!,
        [...m[2]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]!),
      );
    for (const from of APPLICATION_STATUSES)
      for (const to of APPLICATION_STATUSES) {
        if (from === to) continue;
        expect(canTransition(from, to), `${from} → ${to}`).toBe(
          (dbTable.get(from) ?? []).includes(to),
        );
      }
  });

  it("the manual confirmation path matches the database", () => {
    const sql = latestGuardFunction();
    const m = sql.match(/'USER_CONFIRMED'\s+AND OLD\."status" = ANY \(ARRAY\[([^\]]*)\]/);
    expect(m).toBeTruthy();
    const list = [...m![1]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort();
    expect(list).toEqual([...MANUAL_CONFIRM_FROM].sort());
  });

  it("rejects impossible transitions", () => {
    const bad: [ApplicationStatus, ApplicationStatus][] = [
      ["DRAFT", "SUBMITTED"],
      ["FAILED", "SUBMITTED"],
      ["READY", "SUBMITTING"],
      ["DRAFT", "READY_TO_SUBMIT"],
      ["SUBMITTED", "READY"],
      ["SUBMISSION_UNCERTAIN", "SUBMITTING"],
      ["ARCHIVED", "DRAFT"],
      ["CANCELLED", "IN_PROGRESS"],
    ];
    for (const [f, t] of bad) expect(canTransition(f, t), `${f} → ${t}`).toBe(false);
  });

  it("an uncertain submission can never go straight back to submitting", () => {
    expect(TRANSITIONS.SUBMISSION_UNCERTAIN).not.toContain("SUBMITTING");
    expect(TRANSITIONS.SUBMISSION_UNCERTAIN).not.toContain("READY_TO_SUBMIT");
    expect(TRANSITIONS.ARCHIVED).toEqual([]);
  });
});

describe("hashes", () => {
  const base = {
    candidateId: "c",
    jobId: "j",
    packageIntegrityHash: "p".repeat(64),
    assets: { RESUME: { versionId: "r", contentHash: "a".repeat(64) } },
    fields: [
      {
        fieldKey: "first_name",
        mappingType: "CANDIDATE_PROFILE",
        sourceRef: "profile:x",
        value: "Asha",
      },
      {
        fieldKey: "email",
        mappingType: "CANDIDATE_PROFILE",
        sourceRef: "profile:x",
        value: "asha@example.test",
      },
    ],
    answers: [{ questionKey: "q1", contentHash: answerHash("Because…") }],
    files: [{ role: "RESUME", sha256: "f".repeat(64) }],
    channel: { type: "ATS", url: "https://jobs.example/apply", email: null },
  };

  it("application hash is order-independent and changes with any field, answer or file", () => {
    const h = applicationContentHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(applicationContentHash({ ...base, fields: [...base.fields].reverse() })).toBe(h);
    expect(
      applicationContentHash({
        ...base,
        fields: [{ ...base.fields[0]!, value: "Asha R" }, base.fields[1]!],
      }),
    ).not.toBe(h);
    expect(
      applicationContentHash({
        ...base,
        answers: [{ questionKey: "q1", contentHash: answerHash("Because of X") }],
      }),
    ).not.toBe(h);
    expect(
      applicationContentHash({ ...base, files: [{ role: "RESUME", sha256: "e".repeat(64) }] }),
    ).not.toBe(h);
    expect(answerHash("  Because…  ")).toBe(answerHash("Because…"));
  });

  const fields: FormStructureField[] = [
    {
      externalFieldId: "first_name",
      label: "First name",
      fieldType: "TEXT",
      required: true,
      options: [],
    },
    { externalFieldId: "email", label: "Email", fieldType: "EMAIL", required: true, options: [] },
    {
      externalFieldId: "source",
      label: "How did you hear about us?",
      fieldType: "SELECT",
      required: false,
      options: ["LinkedIn", "Other"],
    },
  ];

  it("form fingerprint uses structure only (no query string, no values) and detects changes", () => {
    const fp = formFingerprint("https://jobs.example/apply?utm=x&candidate=asha", fields);
    expect(formFingerprint("https://JOBS.example/apply/", fields)).toBe(fp);
    expect(formFingerprint("https://jobs.example/apply", [...fields].reverse())).toBe(fp);
    expect(
      formFingerprint("https://jobs.example/apply", [
        ...fields,
        {
          externalFieldId: "salary",
          label: "Salary",
          fieldType: "NUMBER",
          required: true,
          options: [],
        },
      ]),
    ).not.toBe(fp);
    expect(fieldFingerprint(fields[0]!)).not.toBe(
      fieldFingerprint({ ...fields[0]!, required: false }),
    );
  });

  it("drift: a new/changed required field or a large change means FORM_CHANGED", () => {
    expect(formDrift(fields, fields).changedSignificantly).toBe(false);
    expect(
      formDrift(fields, [
        ...fields,
        {
          externalFieldId: "auth",
          label: "Work authorization",
          fieldType: "YES_NO",
          required: true,
          options: ["Yes", "No"],
        },
      ]).changedSignificantly,
    ).toBe(true);
    expect(
      formDrift(
        fields,
        fields.map((f) => (f.externalFieldId === "email" ? { ...f, label: "Work email" } : f)),
      ).changedSignificantly,
    ).toBe(true);
  });
});

describe("field validation", () => {
  const file = (over: Partial<FileValue> = {}): FileValue => ({
    kind: "file",
    fileName: "Resume.pdf",
    mimeType: "application/pdf",
    byteSize: 3000,
    sha256: "a".repeat(64),
    approvedSha256: "a".repeat(64),
    ownedByUser: true,
    ...over,
  });

  it("required, email, phone, url, date, number, options and limits", () => {
    expect(
      validateFieldValue({ label: "Email", fieldType: "EMAIL", required: true }, "")[0]?.code,
    ).toBe("REQUIRED");
    expect(
      validateFieldValue({ label: "Email", fieldType: "EMAIL", required: true }, "not-an-email")[0]
        ?.code,
    ).toBe("EMAIL");
    expect(
      validateFieldValue({ label: "Email", fieldType: "EMAIL", required: true }, "a@b.example"),
    ).toEqual([]);
    expect(
      validateFieldValue(
        { label: "Phone", fieldType: "PHONE", required: false },
        "+91 98747 43024",
      ),
    ).toEqual([]);
    expect(
      validateFieldValue({ label: "Phone", fieldType: "PHONE", required: false }, "123")[0]?.code,
    ).toBe("PHONE");
    expect(
      validateFieldValue(
        { label: "Site", fieldType: "URL", required: false },
        "javascript:alert(1)",
      )[0]?.code,
    ).toBe("URL");
    expect(
      validateFieldValue({ label: "Start", fieldType: "DATE", required: false }, "next week")[0]
        ?.code,
    ).toBe("DATE");
    expect(
      validateFieldValue({ label: "Years", fieldType: "NUMBER", required: false }, "three")[0]
        ?.code,
    ).toBe("NUMBER");
    expect(
      validateFieldValue(
        { label: "Source", fieldType: "SELECT", required: true, options: ["LinkedIn", "Other"] },
        "Twitter",
      )[0]?.code,
    ).toBe("OPTION");
    expect(
      validateFieldValue(
        { label: "Why", fieldType: "TEXTAREA", required: true, maxLength: 10 },
        "Too long for this field",
      )[0]?.code,
    ).toBe("MAX_LENGTH");
    expect(
      validateFieldValue({ label: "Optional", fieldType: "TEXT", required: false }, null),
    ).toEqual([]);
  });

  it("files must be an allowed type, within size, owned and exactly the approved version", () => {
    expect(
      validateFieldValue({ label: "Resume", fieldType: "FILE", required: true }, file()),
    ).toEqual([]);
    expect(
      validateFieldValue(
        { label: "Resume", fieldType: "FILE", required: true },
        file({ fileName: "run.exe", mimeType: "application/x-msdownload" }),
      )[0]?.code,
    ).toBe("FILE_TYPE");
    expect(
      validateFieldValue(
        { label: "Resume", fieldType: "FILE", required: true },
        file({ byteSize: 20 * 1024 * 1024 }),
      )[0]?.code,
    ).toBe("FILE_SIZE");
    expect(
      validateFieldValue(
        { label: "Resume", fieldType: "FILE", required: true },
        file({ sha256: "b".repeat(64) }),
      )[0]?.code,
    ).toBe("FILE_HASH");
    expect(
      validateFieldValue(
        { label: "Resume", fieldType: "FILE", required: true },
        file({ ownedByUser: false }),
      )[0]?.code,
    ).toBe("FILE_OWNER");
  });
});
