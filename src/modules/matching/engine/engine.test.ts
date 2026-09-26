import { describe, expect, it } from "vitest";
import { extractRequirements, type ExtractableJob } from "../requirements/extract";
import { computeMatch } from "./aggregate";
import { mergedMonths, rolePeriod } from "./experience";
import type { CandidateEvidence, RequirementLike } from "./types";

const NOW = new Date("2026-09-01T00:00:00Z");
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function candidate(over: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return {
    profile: {
      id: id(),
      currentCountryCode: "IN",
      currentCity: "Bengaluru",
      portfolioUrl: null,
      verification: "USER_PROVIDED",
    },
    preferences: {
      employmentTypes: ["FULL_TIME"],
      workModes: ["HYBRID", "REMOTE"],
      relocation: "NO",
      needsSponsorship: "NO",
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
    },
    targetLocations: [],
    skills: [],
    experiences: [],
    education: [],
    projects: [],
    certifications: [],
    portfolio: [],
    languages: [],
    authorizations: [],
    ...over,
  };
}

const skill = (
  name: string,
  verification: CandidateEvidence["skills"][number]["verification"] = "USER_PROVIDED",
) => ({
  id: id(),
  verification,
  name,
  yearsUsed: null,
});

const exp = (
  o: Partial<CandidateEvidence["experiences"][number]>,
): CandidateEvidence["experiences"][number] => ({
  id: id(),
  verification: "USER_PROVIDED",
  title: "Digital Marketing Executive",
  organization: "Acme",
  employmentType: "FULL_TIME",
  startDate: "2022-01",
  endDate: null,
  isCurrent: true,
  description: "Digital marketing campaigns",
  responsibilities: [],
  skillsUsed: [],
  ...o,
});

const req = (
  category: string,
  requirementType: string,
  normalizedValue: Record<string, unknown>,
  text = category,
): RequirementLike => ({
  id: id(),
  category,
  requirementType,
  text,
  normalizedValue,
  sourceText: text,
});

const job: ExtractableJob = {
  title: "Digital Marketing Associate",
  description: [
    "Requirements",
    "• 2+ years of experience in digital marketing",
    "• Hands-on experience with Google Analytics 4 and Google Tag Manager",
    "• Bachelor's degree in Marketing or Business",
    "• Fluent English",
    "Nice to have",
    "• HubSpot",
  ].join("\n"),
  locationRaw: "Bengaluru, India",
  city: "Bengaluru",
  region: null,
  countryCode: "IN",
  remoteStatus: "HYBRID",
  remoteStatusRaw: "Hybrid",
  employmentType: "FULL_TIME",
  employmentTypeRaw: "Full-time",
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  salaryRaw: null,
  experienceLevel: "UNKNOWN",
  experienceLevelRaw: null,
  visaTextRaw: null,
};

const asReqs = (j: ExtractableJob): RequirementLike[] =>
  extractRequirements(j).map((r) => ({
    ...r,
    id: id(),
    normalizedValue: r.normalizedValue as Record<string, unknown>,
  }));

const strongCandidate = () =>
  candidate({
    skills: [skill("GA4"), skill("Google Tag Manager"), skill("HubSpot")],
    experiences: [exp({ startDate: "2021-06" })],
    education: [
      {
        id: id(),
        verification: "USER_PROVIDED",
        institution: "Uni",
        degree: "Bachelor of Business Administration",
        fieldOfStudy: "Marketing",
        endDate: "2021",
        isCurrent: false,
      },
    ],
    languages: [
      { id: id(), verification: "USER_PROVIDED", language: "English", proficiency: "C1" },
    ],
  });

function statusOf(
  result: ReturnType<typeof computeMatch>,
  reqs: RequirementLike[],
  category: string,
  text?: RegExp,
) {
  const r = reqs.find((q) => q.category === category && (!text || text.test(q.text)))!;
  return result.results.find((x) => x.requirementId === r.id)!;
}

describe("matching engine — cases A–H", () => {
  it("A: strong alignment → STRONG_MATCH with evidence for every matched requirement", () => {
    const reqs = asReqs(job);
    const m = computeMatch({
      requirements: reqs,
      candidate: strongCandidate(),
      now: NOW,
      jobCountryCode: "IN",
    });
    expect(m.overallStatus).toBe("STRONG_MATCH");
    expect(m.counts.requiredGaps).toBe(0);
    for (const r of m.results.filter((x) => x.status === "MATCHED"))
      expect(r.evidence.length).toBeGreaterThan(0);
    expect(m.hardBlockReason).toBeNull();
  });

  it("B: required experience gap → GAP (required), never a hard block", () => {
    const reqs = asReqs(job);
    const c = strongCandidate();
    c.experiences = [exp({ startDate: "2026-03" })]; // 6 months
    const m = computeMatch({ requirements: reqs, candidate: c, now: NOW, jobCountryCode: "IN" });
    const r = statusOf(m, reqs, "EXPERIENCE");
    expect(r.status).toBe("GAP");
    expect(r.gapKind).toBe("REQUIRED");
    expect(r.isHardBlock).toBe(false);
    expect(m.overallStatus).not.toBe("BLOCKED");
    expect(m.counts.requiredGaps).toBe(1);
  });

  it("C: unknown work authorization stays UNKNOWN", () => {
    const r = req("AUTHORIZATION", "REQUIRED", { kind: "AUTHORIZATION_REQUIRED", region: "DE" });
    const m = computeMatch({ requirements: [r], candidate: candidate(), now: NOW });
    expect(m.results[0]!.status).toBe("UNKNOWN");
    expect(m.results[0]!.explanation).toMatch(/No verified work authorization/);
  });

  it("D: preferred skill missing → preferred gap, not a required gap", () => {
    const reqs = asReqs(job);
    const c = strongCandidate();
    c.skills = c.skills.filter((s) => s.name !== "HubSpot");
    const m = computeMatch({ requirements: reqs, candidate: c, now: NOW, jobCountryCode: "IN" });
    const r = statusOf(m, reqs, "SKILL", /hubspot/i);
    expect(r.status).toBe("GAP");
    expect(r.gapKind).toBe("PREFERRED");
    expect(m.counts.requiredGaps).toBe(0);
    expect(m.counts.preferredGaps).toBe(1);
  });

  it("E: remote-only candidate vs on-site job → BLOCKED only when set as mandatory", () => {
    const r = req("WORK_MODE", "REQUIRED", { mode: "ONSITE" }, "On-site");
    const c = candidate({ preferences: { ...candidate().preferences!, workModes: ["REMOTE"] } });
    const soft = computeMatch({ requirements: [r], candidate: c, now: NOW });
    expect(soft.results[0]!.status).toBe("GAP");
    expect(soft.results[0]!.gapKind).toBe("PREFERENCE");
    const hard = computeMatch({
      requirements: [r],
      candidate: c,
      now: NOW,
      settings: {
        workModeHard: true,
        employmentTypeHard: false,
        locationHard: false,
        salaryMinHard: false,
      },
    });
    expect(hard.results[0]!.status).toBe("BLOCKED");
    expect(hard.overallStatus).toBe("BLOCKED");
    expect(hard.hardBlockReason).toMatch(/on-site/);
    expect(hard.results[0]!.evidence.length).toBeGreaterThan(0);
  });

  it("F: GA4 ↔ Google Analytics 4 is an EXACT match", () => {
    const r = req("SKILL", "REQUIRED", { skill: "google_analytics_4" }, "Google Analytics 4");
    const m = computeMatch({
      requirements: [r],
      candidate: candidate({ skills: [skill("GA4")] }),
      now: NOW,
    });
    expect(m.results[0]!.status).toBe("MATCHED");
    expect(m.results[0]!.relationship).toBe("EXACT");
  });

  it("G: Python vs Photoshop is no match", () => {
    const r = req("SKILL", "REQUIRED", { skill: "python" }, "Python");
    const m = computeMatch({
      requirements: [r],
      candidate: candidate({ skills: [skill("Photoshop")] }),
      now: NOW,
    });
    expect(m.results[0]!.status).toBe("GAP");
    expect(m.results[0]!.relationship).toBe("NONE");
  });

  it("H: conflicting candidate data → CONFLICT, surfaced", () => {
    const r = req("LANGUAGE", "REQUIRED", { language: "German", level: "C1" }, "German (C1)");
    const c = candidate({
      languages: [
        { id: id(), verification: "USER_PROVIDED", language: "German", proficiency: "B1" },
        { id: id(), verification: "VERIFIED", language: "German", proficiency: "C1" },
      ],
    });
    const m = computeMatch({ requirements: [r], candidate: c, now: NOW });
    expect(m.results[0]!.status).toBe("CONFLICT");
    expect(m.counts.conflicts).toBe(1);
    expect(m.results[0]!.evidence).toHaveLength(2);
  });
});

describe("matching engine — rules", () => {
  it("never lets NEEDS_REVIEW / AI_INFERRED facts satisfy a requirement", () => {
    const r = req("SKILL", "REQUIRED", { skill: "python" }, "Python");
    for (const v of ["NEEDS_REVIEW", "AI_INFERRED"] as const) {
      const m = computeMatch({
        requirements: [r],
        candidate: candidate({ skills: [skill("Python", v)] }),
        now: NOW,
      });
      expect(m.results[0]!.status).toBe("UNVERIFIED");
    }
  });

  it("related skills are RELATED, never exact", () => {
    const r = req("SKILL", "REQUIRED", { skill: "google_analytics_4" }, "Google Analytics 4");
    const m = computeMatch({
      requirements: [r],
      candidate: candidate({ skills: [skill("Universal Analytics")] }),
      now: NOW,
    });
    expect(["RELATED", "GAP"]).toContain(m.results[0]!.status);
    expect(m.results[0]!.relationship).not.toBe("EXACT");
  });

  it("overlapping roles are not double counted", () => {
    const a = rolePeriod({ startDate: "2020-01", endDate: "2021-12", isCurrent: false }, NOW)!;
    const b = rolePeriod({ startDate: "2021-01", endDate: "2022-12", isCurrent: false }, NOW)!;
    expect(mergedMonths([a, b])).toBe(36);
  });

  it("projects are not professional experience; volunteer work is not professional", () => {
    const r = req(
      "EXPERIENCE",
      "REQUIRED",
      { minYears: 1, maxYears: null, domain: null, professional: true, domainSkills: [] },
      "1+ years professional",
    );
    const c = candidate({
      projects: [
        {
          id: id(),
          verification: "USER_PROVIDED",
          name: "Big project",
          description: "3 years",
          technologies: [],
          skills: [],
        },
      ],
      experiences: [exp({ employmentType: "VOLUNTEER", startDate: "2020-01" })],
    });
    const m = computeMatch({ requirements: [r], candidate: c, now: NOW });
    expect(m.results[0]!.status).toBe("GAP");
  });

  it("an in-progress degree is not a completed degree", () => {
    const r = req("EDUCATION", "REQUIRED", { level: "BACHELOR", field: null }, "Bachelor's degree");
    const c = candidate({
      education: [
        {
          id: id(),
          verification: "USER_PROVIDED",
          institution: "Uni",
          degree: "B.Tech",
          fieldOfStudy: "CS",
          endDate: "2027",
          isCurrent: true,
        },
      ],
    });
    const m = computeMatch({ requirements: [r], candidate: c, now: NOW });
    expect(m.results[0]!.status).toBe("PARTIAL");
    expect(m.results[0]!.explanation).toMatch(/in progress/);
  });

  it("degree level matches but field does not → PARTIAL", () => {
    const r = req(
      "EDUCATION",
      "REQUIRED",
      { level: "BACHELOR", field: "Computer Science" },
      "Bachelor's in CS",
    );
    const c = candidate({
      education: [
        {
          id: id(),
          verification: "USER_PROVIDED",
          institution: "Uni",
          degree: "Bachelor of Arts",
          fieldOfStudy: "History",
          endDate: "2020",
          isCurrent: false,
        },
      ],
    });
    expect(computeMatch({ requirements: [r], candidate: c, now: NOW }).results[0]!.status).toBe(
      "PARTIAL",
    );
  });

  it("either/or skills are assessed once", () => {
    const a = req("SKILL", "PREFERRED", { skill: "hubspot", anyOf: ["hubspot", "crm"] }, "HubSpot");
    const b = req("SKILL", "PREFERRED", { skill: "crm", anyOf: ["hubspot", "crm"] }, "CRM");
    const none = computeMatch({
      requirements: [a, b],
      candidate: candidate({ skills: [skill("Python")] }),
      now: NOW,
    });
    expect(none.results.map((r) => r.status)).toEqual(["GAP", "NOT_APPLICABLE"]);
    expect(none.counts.preferredGaps).toBe(1);
    const crm = computeMatch({
      requirements: [a, b],
      candidate: candidate({ skills: [skill("CRM")] }),
      now: NOW,
    });
    expect(crm.results.map((r) => r.status)).toEqual(["MATCHED", "NOT_APPLICABLE"]);
  });

  it("field lists are split correctly (Marketing, Business)", () => {
    const r = req(
      "EDUCATION",
      "REQUIRED",
      { level: "BACHELOR", field: "Marketing, Business" },
      "Bachelor's in Marketing, Business",
    );
    const c = candidate({
      education: [
        {
          id: id(),
          verification: "USER_PROVIDED",
          institution: "Uni",
          degree: "BBA",
          fieldOfStudy: "Marketing",
          endDate: "2022",
          isCurrent: false,
        },
      ],
    });
    expect(computeMatch({ requirements: [r], candidate: c, now: NOW }).results[0]!.status).toBe(
      "MATCHED",
    );
  });

  it("sponsorship unavailable + needs sponsorship → hard block with evidence", () => {
    const r = req("AUTHORIZATION", "REQUIRED", { kind: "SPONSORSHIP_UNAVAILABLE", region: "US" });
    const c = candidate({
      authorizations: [
        {
          id: id(),
          verification: "USER_PROVIDED",
          countryCode: "US",
          status: "SPONSORSHIP_REQUIRED",
        },
      ],
    });
    const m = computeMatch({ requirements: [r], candidate: c, now: NOW });
    expect(m.overallStatus).toBe("BLOCKED");
    expect(m.results[0]!.evidence[0]!.ref).toMatch(/^authorization:/);
  });

  it("salary: different currencies are never converted; hourly is never compared with yearly", () => {
    const prefs = {
      ...candidate().preferences!,
      salaryMin: 50000,
      salaryCurrency: "EUR",
      salaryPeriod: "YEAR",
    };
    const usd = req("SALARY", "INFORMATIONAL", {
      min: 10,
      max: 90000,
      currency: "USD",
      period: "YEAR",
    });
    const hourly = req("SALARY", "INFORMATIONAL", {
      min: 30,
      max: 40,
      currency: "EUR",
      period: "HOUR",
    });
    const m = computeMatch({
      requirements: [usd, hourly],
      candidate: candidate({ preferences: prefs }),
      now: NOW,
    });
    expect(m.results.map((r) => r.status)).toEqual(["UNKNOWN", "UNKNOWN"]);
    const low = req("SALARY", "INFORMATIONAL", {
      min: 30000,
      max: 40000,
      currency: "EUR",
      period: "YEAR",
    });
    const g = computeMatch({
      requirements: [low],
      candidate: candidate({ preferences: prefs }),
      now: NOW,
    });
    expect(g.results[0]!.status).toBe("GAP");
    expect(g.results[0]!.gapKind).toBe("PREFERENCE");
  });

  it("GitHub / LinkedIn are not treated as a portfolio", () => {
    const r = req("PORTFOLIO", "REQUIRED", { kind: "PORTFOLIO" });
    expect(
      computeMatch({ requirements: [r], candidate: candidate(), now: NOW }).results[0]!.status,
    ).toBe("GAP");
  });

  it("language proficiency is never inferred", () => {
    const r = req("LANGUAGE", "REQUIRED", { language: "English", level: "FLUENT" });
    const c = candidate({ profile: { ...candidate().profile, currentCountryCode: "GB" } });
    expect(computeMatch({ requirements: [r], candidate: c, now: NOW }).results[0]!.status).toBe(
      "UNKNOWN",
    );
  });

  it("empty profile → INSUFFICIENT_DATA; tiny job → INSUFFICIENT_DATA (JOB)", () => {
    const reqs = asReqs(job);
    const m = computeMatch({
      requirements: reqs,
      candidate: candidate({ preferences: null }),
      now: NOW,
      jobCountryCode: "IN",
    });
    expect(m.overallStatus).toBe("INSUFFICIENT_DATA");
    expect(m.insufficient).toBe("CANDIDATE");
    const tiny = computeMatch({
      requirements: [req("WORK_MODE", "REQUIRED", { mode: "HYBRID" })],
      candidate: strongCandidate(),
      now: NOW,
    });
    expect(tiny.overallStatus).toBe("INSUFFICIENT_DATA");
    expect(tiny.insufficient).toBe("JOB");
  });

  it("is deterministic", () => {
    const reqs = asReqs(job);
    const c = strongCandidate();
    const a = computeMatch({ requirements: reqs, candidate: c, now: NOW, jobCountryCode: "IN" });
    const b = computeMatch({ requirements: reqs, candidate: c, now: NOW, jobCountryCode: "IN" });
    expect(a).toEqual(b);
  });

  it("never outputs a numeric score or probability wording", () => {
    const m = computeMatch({
      requirements: asReqs(job),
      candidate: strongCandidate(),
      now: NOW,
      jobCountryCode: "IN",
    });
    const text = JSON.stringify(m);
    expect(text).not.toMatch(/probab|likel|chance|%/i);
  });
});
