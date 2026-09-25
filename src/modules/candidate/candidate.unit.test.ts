import { describe, expect, it } from "vitest";
import {
  duplicateScore,
  findBestDuplicate,
  normalizeKey,
  similarity,
  type Comparable,
} from "./duplicates";
import { AI_OUTPUT_SCHEMA, draftsFromAiOutput, isGrounded } from "./extraction/ai-extract";
import { assertCreatable, ProvenanceViolation, sourceTypeForApproval } from "./provenance";
import { bulkSafetyIssue } from "./review.service";
import { experienceInput, preferencesInput, profileUpdateInput, skillInput } from "./schemas";
import {
  COMPLETENESS_WEIGHTS,
  computeCompleteness,
  computeReadiness,
  computeWarnings,
  findOverlappingExperiences,
  type CandidateSnapshot,
} from "./scoring";

const emptySnapshot = (): CandidateSnapshot => ({
  profile: null,
  education: [],
  experiences: [],
  skills: [],
  projects: [],
  certifications: [],
  portfolio: [],
  languages: [],
  authorizations: [],
  achievements: [],
  preferences: null,
  targetLocations: [],
  pendingReview: 0,
});

const fact = (
  id: string,
  status: "VERIFIED" | "USER_PROVIDED" | "NEEDS_REVIEW" | "AI_INFERRED" = "USER_PROVIDED",
) => ({ id, verificationStatus: status });

function fullSnapshot(): CandidateSnapshot {
  return {
    profile: {
      fullName: "Test Candidate",
      headline: "Test Headline",
      currentCity: "Test City",
      currentCountryCode: "DE",
      phone: null,
      professionalEmail: "t@example.com",
      summary: "Synthetic",
      careerGoal: "Synthetic goal",
      websiteUrl: null,
      githubUrl: "https://github.com/test",
      portfolioUrl: null,
      verificationStatus: "USER_PROVIDED",
    },
    education: [{ ...fact("e1"), institution: "Test University", degree: "BBA" }],
    experiences: [
      {
        ...fact("x1"),
        title: "Founder",
        organization: "Test Company",
        startDate: "2022-01",
        endDate: null,
        isCurrent: true,
        skillsUsed: ["Next.js"],
      },
    ],
    skills: ["Next.js", "React", "SEO", "Figma", "Excel"].map((name, i) => ({
      ...fact(`s${i}`),
      name,
      nameNormalized: normalizeKey(name),
      proficiency: null,
      sourceType: "CV_IMPORT",
    })),
    projects: [
      {
        ...fact("p1"),
        name: "Test Project",
        description: "Synthetic",
        technologies: ["React"],
        skills: [],
      },
    ],
    certifications: [],
    portfolio: [{ ...fact("f1"), title: "Site", url: "https://example.com" }],
    languages: [{ ...fact("l1"), language: "English", proficiency: "C1" }],
    authorizations: [{ ...fact("a1"), countryCode: "DE", status: "SPONSORSHIP_REQUIRED" }],
    achievements: [],
    preferences: {
      targetRoles: ["Web Developer"],
      workModes: ["REMOTE"],
      employmentTypes: ["FULL_TIME"],
    },
    targetLocations: [{ countryCode: "DE", city: null }],
    pendingReview: 0,
  };
}

describe("profile completeness", () => {
  it("weights sum to 100", () => {
    expect(Object.values(COMPLETENESS_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("empty profile is 0%, full profile is 100%", () => {
    expect(computeCompleteness(emptySnapshot()).percent).toBe(0);
    const full = computeCompleteness(fullSnapshot());
    expect(full.percent).toBe(100);
    expect(full.items.every((i) => i.status === "complete")).toBe(true);
  });

  it("gives deterministic partial credit", () => {
    const s = fullSnapshot();
    s.skills = s.skills.slice(0, 2); // 2/5 skills -> 4 of 10 points
    s.preferences = { ...s.preferences!, employmentTypes: [] }; // half of work preferences
    const result = computeCompleteness(s);
    expect(result.items.find((i) => i.key === "skills")).toMatchObject({
      earned: 4,
      status: "partial",
    });
    expect(result.items.find((i) => i.key === "workPreferences")).toMatchObject({
      earned: 2.5,
      status: "partial",
    });
    expect(result.percent).toBe(Math.round(100 - 6 - 2.5));
    expect(computeCompleteness(s)).toEqual(result);
  });
});

describe("readiness (separate from completeness)", () => {
  it("INCOMPLETE when core information is missing", () => {
    const r = computeReadiness(emptySnapshot(), computeCompleteness(emptySnapshot()));
    expect(r.status).toBe("INCOMPLETE");
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("NEEDS_REVIEW when facts are pending even if 100% complete", () => {
    const s = fullSnapshot();
    s.pendingReview = 2;
    const r = computeReadiness(s, computeCompleteness(s));
    expect(computeCompleteness(s).percent).toBe(100);
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.reasons[0]).toBe("2 candidate facts need verification.");
  });

  it("NEEDS_REVIEW when saved facts are AI_INFERRED; READY otherwise", () => {
    const s = fullSnapshot();
    expect(computeReadiness(s, computeCompleteness(s)).status).toBe("READY");
    s.skills[0] = { ...s.skills[0]!, verificationStatus: "AI_INFERRED" };
    expect(computeReadiness(s, computeCompleteness(s)).status).toBe("NEEDS_REVIEW");
  });
});

describe("profile warnings", () => {
  it("reports the core missing-information warnings", () => {
    const codes = computeWarnings(emptySnapshot()).map((w) => w.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "NO_EDUCATION",
        "NO_TARGET_ROLES",
        "NO_TARGET_COUNTRIES",
        "NO_PORTFOLIO_URL",
        "NO_WORK_AUTHORIZATION",
      ]),
    );
  });

  it("detects overlaps, missing descriptions, sourceless skills and uncovered target countries", () => {
    const s = fullSnapshot();
    s.experiences.push({
      ...fact("x2"),
      title: "Intern",
      organization: "Other Co",
      startDate: "2023-01",
      endDate: "2023-06",
      isCurrent: false,
      skillsUsed: [],
    });
    s.projects.push({
      ...fact("p2"),
      name: "Empty Project",
      description: null,
      technologies: [],
      skills: [],
    });
    s.skills.push({
      ...fact("s9"),
      name: "Juggling",
      nameNormalized: "juggling",
      proficiency: null,
      sourceType: "MANUAL_ENTRY",
    });
    s.targetLocations.push({ countryCode: "AE", city: null });
    const messages = computeWarnings(s).map((w) => w.message);
    expect(messages.some((m) => m.startsWith("Experience dates overlap"))).toBe(true);
    expect(messages).toContain('Project "Empty Project" has no description.');
    expect(messages.some((m) => m.includes('Skill "Juggling" exists without a source'))).toBe(true);
    expect(messages).toContain("Work authorization for United Arab Emirates not specified.");
  });

  it("does not flag back-to-back year-only roles as overlapping", () => {
    const base = { ...fact("a"), title: "A", organization: "A", isCurrent: false, skillsUsed: [] };
    expect(
      findOverlappingExperiences([
        { ...base, id: "a", startDate: "2019-01", endDate: "2020-06" },
        { ...base, id: "b", organization: "B", startDate: "2020-07", endDate: "2021-01" },
      ]),
    ).toEqual([]);
  });
});

describe("duplicate detection", () => {
  const c = (
    id: string,
    kind: Comparable["kind"],
    primary: string,
    secondary?: string,
  ): Comparable => ({ id, kind, label: primary, primary, secondary });

  it("treats spacing/case/legal-suffix variants as duplicates", () => {
    expect(normalizeKey("Lead Zing")).toBe(normalizeKey("LeadZing"));
    expect(
      duplicateScore(
        c("1", "experience", "LeadZing", "Founder"),
        c("2", "experience", "Lead Zing Ltd", "Founder"),
      ),
    ).toBeGreaterThan(0.9);
    expect(duplicateScore(c("1", "skill", "Next.js"), c("2", "skill", "NextJS"))).toBe(1);
  });

  it("keeps different things apart", () => {
    expect(duplicateScore(c("1", "skill", "C#"), c("2", "skill", "C++"))).toBe(0);
    expect(
      duplicateScore(
        c("1", "experience", "Test Company", "Founder"),
        c("2", "experience", "Test Company", "Accountant"),
      ),
    ).toBe(0);
    expect(duplicateScore(c("1", "skill", "React"), c("2", "project", "React"))).toBe(0);
    expect(similarity("abc", "xyz")).toBe(0);
  });

  it("finds the best existing match", () => {
    const match = findBestDuplicate(c("n", "project", "Test Projects"), [
      c("a", "project", "Other"),
      c("b", "project", "Test Project"),
    ]);
    expect(match?.id).toBe("b");
  });
});

describe("provenance rules", () => {
  it("blocks creation as VERIFIED", () => {
    expect(() => assertCreatable({ verificationStatus: "VERIFIED" })).toThrow(ProvenanceViolation);
    expect(() => assertCreatable({ verificationStatus: "AI_INFERRED" })).not.toThrow();
  });

  it("maps approval source types", () => {
    expect(sourceTypeForApproval("CV_RESUME", "RULE")).toBe("CV_IMPORT");
    expect(sourceTypeForApproval("PORTFOLIO", "RULE")).toBe("PORTFOLIO_IMPORT");
    expect(sourceTypeForApproval("OTHER", "RULE")).toBe("DOCUMENT_IMPORT");
    expect(sourceTypeForApproval("CV_RESUME", "AI")).toBe("USER_APPROVED_AI_EXTRACTION");
  });

  it("bulk approval safety", () => {
    const ok = { status: "PENDING", category: "skill", confidence: 0.8, duplicateOf: null };
    expect(bulkSafetyIssue(ok)).toBeNull();
    expect(bulkSafetyIssue({ ...ok, category: "profile" })).toMatch(/individually/);
    expect(bulkSafetyIssue({ ...ok, duplicateOf: { id: "x" } })).toMatch(/duplicate/);
    expect(bulkSafetyIssue({ ...ok, confidence: 0.3 })).toMatch(/Low confidence/);
    expect(bulkSafetyIssue({ ...ok, status: "APPROVED" })).toMatch(/reviewed/);
  });
});

describe("AI output schema & grounding", () => {
  const doc = "Founder - Test Company\nJan 2022 - Present\n* Built websites for local clients";
  const base = {
    category: "experience" as const,
    title: "Founder",
    organization: "Test Company",
    field: null,
    location: null,
    startDate: "2022-01",
    endDate: null,
    isCurrent: true,
    description: null,
    items: [],
    url: null,
    level: null,
    excerpt: "Founder - Test Company",
    confidence: 0.9,
  };

  it("rejects output that does not match the schema (e.g. an AI trying to set VERIFIED)", () => {
    expect(
      AI_OUTPUT_SCHEMA.safeParse({
        facts: [{ ...base, verificationStatus: "VERIFIED", confidence: 3 }],
      }).success,
    ).toBe(false);
    expect(AI_OUTPUT_SCHEMA.safeParse({ facts: "nope" }).success).toBe(false);
    expect(AI_OUTPUT_SCHEMA.safeParse({ facts: [base] }).success).toBe(true);
  });

  it("grounding: excerpts must appear in the document", () => {
    expect(isGrounded("Founder - Test Company", doc)).toBe(true);
    expect(isGrounded("founder   -  test company", doc)).toBe(true);
    expect(isGrounded("CEO of Google", doc)).toBe(false);
  });

  it("drops ungrounded facts and dates that are not in the text; caps confidence", () => {
    const { drafts, discarded } = draftsFromAiOutput(
      {
        facts: [
          base,
          { ...base, title: "Invented", excerpt: "Senior VP at Megacorp" },
          {
            ...base,
            category: "skill",
            title: "Kubernetes",
            excerpt: "Built websites",
            startDate: "1999",
          },
        ],
      },
      doc,
    );
    expect(discarded).toBe(1);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]!.confidence).toBe(0.8);
    expect(drafts[0]!.payload).toMatchObject({ startDate: "2022-01", isCurrent: true });
  });
});

describe("input schemas", () => {
  it("normalises form-style input", () => {
    const exp = experienceInput.parse({
      organization: " Test Co ",
      title: "Dev",
      isCurrent: "on",
      responsibilities: "• one\n\n- two\none",
      startDate: "",
    });
    expect(exp).toMatchObject({
      organization: "Test Co",
      isCurrent: true,
      responsibilities: ["one", "two"],
      startDate: null,
    });
    expect(skillInput.parse({ name: "X", proficiency: "" }).proficiency).toBeNull();
    expect(profileUpdateInput.parse({ websiteUrl: "example.com" }).websiteUrl).toBe(
      "https://example.com",
    );
    expect(profileUpdateInput.parse({})).toEqual({});
    expect(preferencesInput.parse({ workModes: "REMOTE" }).workModes).toEqual(["REMOTE"]);
  });
});
