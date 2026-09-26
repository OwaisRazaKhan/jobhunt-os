import { describe, expect, it } from "vitest";
import { defaultGreeting } from "./types";
import {
  evaluatePackage,
  nextStatus,
  packageIntegrityHash,
  requiredAssets,
  type AssetState,
  type PackageEvaluationInput,
} from "./package";

const H = (c: string) => c.repeat(64);
const asset = (type: AssetState["type"], over: Partial<AssetState> = {}): AssetState => ({
  type,
  versionId: `${type}-v`,
  versionNumber: 2,
  selectedHash: H("a"),
  storedHash: H("a"),
  recomputedHash: H("a"),
  status: "APPROVED",
  activeApproval: { id: `${type}-appr`, contentHash: H("a") },
  recordedApprovalId: null,
  jobConsistent: true,
  check: type === "RESUME" ? null : { critical: 0, unsupported: 0 },
  newerApprovedVersion: null,
  editedAfterApproval: false,
  ...over,
});
const base = (over: Partial<PackageEvaluationInput> = {}): PackageEvaluationInput => ({
  channel: "PORTAL",
  includeEmail: true,
  includeCoverLetter: true,
  frozen: false,
  candidate: { exists: true, usableFacts: 10 },
  job: { exists: true, deleted: false, contentHash: H("j"), packagedContentHash: H("j") },
  match: { id: "m", isCurrent: true, jobMatches: true },
  requirementSet: { id: "rs", isCurrent: true },
  research: { id: "r", version: 1, isCurrent: true },
  assets: { RESUME: asset("RESUME"), EMAIL: asset("EMAIL"), COVER_LETTER: asset("COVER_LETTER") },
  resumeVersionId: "RESUME-v",
  recipient: null,
  ...over,
});
const failing = (input: PackageEvaluationInput) =>
  evaluatePackage(input)
    .items.filter((i) => i.status === "FAIL")
    .map((i) => i.key);

describe("readiness (deterministic, no scores)", () => {
  it("all approved + consistent → ready; no percentage anywhere", () => {
    const e = evaluatePackage(base());
    expect(e.ready).toBe(true);
    expect(JSON.stringify(e)).not.toMatch(/%|score/i);
    expect(nextStatus("INCOMPLETE", e)).toBe("READY_FOR_REVIEW");
  });

  it("required assets follow the channel", () => {
    expect(requiredAssets("EMAIL", false, false)).toEqual(["RESUME", "EMAIL"]);
    expect(requiredAssets("PORTAL", false, true)).toEqual(["RESUME", "COVER_LETTER"]);
    expect(failing(base({ assets: { RESUME: asset("RESUME") } }))).toEqual([
      "email_selected",
      "cover_letter_selected",
    ]);
  });

  it("unapproved, critical, unsupported, wrong job and mismatched resume all block", () => {
    expect(
      failing(
        base({
          assets: {
            ...base().assets,
            EMAIL: asset("EMAIL", { status: "DRAFT", activeApproval: null }),
          },
        }),
      ),
    ).toContain("email_approved");
    expect(
      failing(
        base({
          assets: {
            ...base().assets,
            EMAIL: asset("EMAIL", { check: { critical: 1, unsupported: 0 } }),
          },
        }),
      ),
    ).toContain("email_critical");
    expect(
      failing(
        base({
          assets: {
            ...base().assets,
            EMAIL: asset("EMAIL", { check: { critical: 0, unsupported: 2 } }),
          },
        }),
      ),
    ).toContain("email_claims");
    expect(
      failing(
        base({
          assets: {
            ...base().assets,
            COVER_LETTER: asset("COVER_LETTER", { jobConsistent: false }),
          },
        }),
      ),
    ).toContain("cover_letter_job");
    expect(
      failing(
        base({ assets: { ...base().assets, EMAIL: asset("EMAIL", { resumeVersionId: "other" }) } }),
      ),
    ).toContain("email_resume");
  });

  it("email channel needs a known recipient email; unverified is a warning, invalid blocks", () => {
    const email = { channel: "EMAIL" as const, includeCoverLetter: false };
    expect(failing(base(email))).toContain("recipient");
    const r = {
      email: "p@x.example",
      name: "P",
      verificationStatus: "UNVERIFIED",
      changedSinceSnapshot: false,
    };
    const withR = evaluatePackage(base({ ...email, recipient: r }));
    expect(withR.ready).toBe(true);
    expect(withR.items.find((i) => i.key === "recipient")?.status).toBe("WARN");
    expect(
      failing(base({ ...email, recipient: { ...r, verificationStatus: "INVALID" } })),
    ).toContain("recipient");
    expect(failing(base({ ...email, recipient: { ...r, email: null } }))).toContain("recipient");
  });
});

describe("stale & integrity", () => {
  const frozen = (over: Partial<PackageEvaluationInput> = {}) => base({ frozen: true, ...over });

  it("frozen: superseded match / research / newer approval / edit after approval → STALE", () => {
    for (const input of [
      frozen({ match: { id: "m", isCurrent: false, jobMatches: true } }),
      frozen({ research: { id: "r", version: 1, isCurrent: false } }),
      frozen({
        job: { exists: true, deleted: false, contentHash: H("k"), packagedContentHash: H("j") },
      }),
      frozen({
        assets: { ...base().assets, RESUME: asset("RESUME", { newerApprovedVersion: 3 }) },
      }),
      frozen({
        assets: { ...base().assets, EMAIL: asset("EMAIL", { editedAfterApproval: true }) },
      }),
      frozen({
        assets: {
          ...base().assets,
          EMAIL: asset("EMAIL", { activeApproval: null, status: "READY_FOR_REVIEW" }),
        },
      }),
      frozen({
        assets: { ...base().assets, EMAIL: asset("EMAIL", { recordedApprovalId: "old" }) },
      }),
    ]) {
      const e = evaluatePackage(input);
      expect(e.staleReasons.length).toBeGreaterThan(0);
      expect(nextStatus("READY_FOR_APPLICATION", e)).toBe("STALE");
    }
  });

  it("a hash mismatch or missing job is INVALID; a newer DRAFT elsewhere changes nothing", () => {
    const tampered = evaluatePackage(
      frozen({ assets: { ...base().assets, RESUME: asset("RESUME", { selectedHash: H("b") }) } }),
    );
    expect(nextStatus("READY_FOR_APPLICATION", tampered)).toBe("INVALID");
    expect(
      nextStatus(
        "READY_FOR_APPLICATION",
        evaluatePackage(
          frozen({
            job: { exists: false, deleted: false, contentHash: null, packagedContentHash: H("j") },
          }),
        ),
      ),
    ).toBe("INVALID");
    expect(nextStatus("READY_FOR_APPLICATION", evaluatePackage(frozen()))).toBe(
      "READY_FOR_APPLICATION",
    );
  });

  it("stale / invalid / archived never move back to an editable state", () => {
    const ok = evaluatePackage(base());
    for (const s of ["STALE", "INVALID", "ARCHIVED"] as const) expect(nextStatus(s, ok)).toBe(s);
  });

  it("integrity hash is reproducible and sensitive to every reference", () => {
    const input = {
      jobId: "j",
      jobContentHash: H("j"),
      channel: "PORTAL" as const,
      includeEmail: true,
      includeCoverLetter: false,
      matchId: "m",
      requirementSetId: "rs",
      jobResearchId: null,
      candidateSnapshotHash: H("c"),
      assets: [
        { type: "EMAIL" as const, versionId: "e", contentHash: H("e") },
        { type: "RESUME" as const, versionId: "r", contentHash: H("r") },
      ],
      recipient: { email: "p@x.example", name: "P" },
      strategy: { email: { tone: "NATURAL" } },
    };
    const h = packageIntegrityHash(input);
    expect(
      packageIntegrityHash({
        ...input,
        assets: [...input.assets].reverse(),
        recipient: { name: "P", email: "p@x.example" },
      }),
    ).toBe(h);
    expect(
      packageIntegrityHash({
        ...input,
        assets: [{ ...input.assets[0]!, contentHash: H("f") }, input.assets[1]!],
      }),
    ).not.toBe(h);
    expect(packageIntegrityHash({ ...input, matchId: "m2" })).not.toBe(h);
  });
});

describe("personalization", () => {
  it("preferred greeting word, never an invented name", () => {
    expect(defaultGreeting(null, "UNKNOWN", "Hi")).toBe("Hi Hiring Team,");
    expect(defaultGreeting("Priya", "HR", "Hello,")).toBe("Hello Priya,");
    expect(defaultGreeting(null, "RECRUITER")).toBe("Dear Recruiter,");
  });
});
