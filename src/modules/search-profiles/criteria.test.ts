import { describe, expect, it } from "vitest";
import {
  classifyJob,
  compareSalary,
  evaluateJob,
  experienceFromTitle,
  matchTerms,
  type EvaluableJob,
  type ProfileCriteria,
  type ProfileLocation,
} from "./criteria";

// Category ids and terms mirror the seeded configuration (ids are arbitrary in unit tests).
const AI = {
  id: "cat-ai",
  terms: ["AI Automation", "Automation Specialist", "AI Engineer", "n8n", "Zapier", "AI Agent"],
};
const MKT = {
  id: "cat-mkt",
  terms: [
    "Digital Marketing",
    "Marketing Intern",
    "Marketing Specialist",
    "SEO",
    "Performance Marketing",
  ],
};
const WEB = { id: "cat-web", terms: ["Web Developer", "Frontend", "Full Stack", "React"] };
const SALES = { id: "cat-sales", terms: ["SDR", "Lead Generation", "Inside Sales"] };
const CATEGORIES = [AI, MKT, WEB, SALES];

const loc = (
  countryCode: string,
  name: string,
  kind: ProfileLocation["kind"] = "CITY",
  aliases: string[] = [],
): ProfileLocation => ({
  id: `${countryCode}-${name}`,
  countryCode,
  name,
  kind,
  aliases,
});
const BENGALURU = loc("IN", "Bengaluru", "CITY", ["bangalore"]);
const HYDERABAD = loc("IN", "Hyderabad");
const PUNE = loc("IN", "Pune");
const KOLKATA = loc("IN", "Kolkata", "CITY", ["calcutta"]);
const REMOTE_IN = loc("IN", "Remote / Anywhere in India", "REMOTE_COUNTRY");
const DUBAI = loc("AE", "Dubai");

function criteria(over: Partial<ProfileCriteria> = {}): ProfileCriteria {
  return {
    countryCodes: [],
    locations: [],
    categoryIds: [],
    terms: [],
    workModes: [],
    employmentTypes: [],
    experienceLevels: [],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    visaPreference: "UNKNOWN",
    ...over,
  };
}

function job(over: Partial<EvaluableJob> = {}): EvaluableJob {
  const base: EvaluableJob = {
    title: "AI Automation Specialist",
    department: null,
    team: null,
    city: "Bengaluru",
    region: "Karnataka",
    countryCode: "IN",
    locationRaw: "Bengaluru, Karnataka, India",
    remoteStatus: "HYBRID",
    employmentType: "FULL_TIME",
    experienceLevel: "UNKNOWN",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    visaTextRaw: null,
    categoryIds: [],
    ...over,
  };
  // Classify like ingestion does, unless the test sets categories explicitly.
  if (!over.categoryIds) base.categoryIds = classifyJob(base, CATEGORIES).map((h) => h.categoryId);
  return base;
}

describe("experience level (explicit title wording only)", () => {
  it.each([
    ["AI Marketing Intern", "INTERNSHIP", "Intern"],
    ["Graduate Trainee — Operations", "GRADUATE", "Graduate"],
    ["Entry-Level Web Developer", "ENTRY_LEVEL", "Entry-Level"],
    ["Junior SEO Executive", "JUNIOR", "Junior"],
    ["Senior Product Manager", "SENIOR", "Senior"],
    ["Engineering Lead, Platform", "LEAD", "Lead"],
    ["Lead Generation Specialist", "UNKNOWN", null],
    ["Marketing Manager", "UNKNOWN", null],
    ["International Sales Executive", "UNKNOWN", null],
  ])("%s → %s", (title, level, raw) => {
    expect(experienceFromTitle(title)).toEqual({ level, raw });
  });
});

describe("category classification", () => {
  it("assigns every legitimate category and keeps the matched wording", () => {
    const hits = classifyJob({ title: "AI Automation & Digital Marketing Specialist" }, CATEGORIES);
    expect(hits.map((h) => h.categoryId).sort()).toEqual(["cat-ai", "cat-mkt"]);
    expect(hits.find((h) => h.categoryId === "cat-ai")!.matchedTerms).toContain("AI Automation");
  });
  it("uses whole words only (SEO does not match Seoul)", () => {
    expect(matchTerms("Office Manager, Seoul", ["SEO"])).toEqual([]);
    expect(matchTerms("SEO Executive", ["SEO"])).toEqual(["SEO"]);
    expect(matchTerms("Front-end engineer", ["Frontend"])).toEqual(["Frontend"]);
  });
  it("department-only matches have lower confidence", () => {
    const [hit] = classifyJob({ title: "Associate", department: "Digital Marketing" }, CATEGORIES);
    expect(hit).toMatchObject({ categoryId: "cat-mkt", confidence: 0.6 });
  });
  it("returns nothing rather than forcing a category", () => {
    expect(classifyJob({ title: "Warehouse Associate" }, CATEGORIES)).toEqual([]);
  });
});

describe("country and city selection", () => {
  it("India country selection includes Indian jobs and excludes others", () => {
    const c = criteria({ countryCodes: ["IN"] });
    expect(evaluateJob(c, job()).matched).toBe(true);
    expect(
      evaluateJob(c, job({ countryCode: "DE", city: "Berlin", locationRaw: "Berlin" })),
    ).toMatchObject({ matched: false, failed: "country" });
  });
  it("unknown country is not assumed to be in the profile", () => {
    const r = evaluateJob(criteria({ countryCodes: ["IN"] }), job({ countryCode: null }));
    expect(r).toMatchObject({ matched: false, failed: "country" });
    expect(r.reasons.country).toBe("Country not stated by source");
  });
  it("Indian city selection matches names and aliases (Bangalore = Bengaluru)", () => {
    const c = criteria({ countryCodes: ["IN"], locations: [BENGALURU, HYDERABAD] });
    expect(
      evaluateJob(c, job({ city: "Bangalore", locationRaw: "Bangalore" })).reasons.location,
    ).toBe("Bengaluru");
    expect(
      evaluateJob(c, job({ city: "Hyderabad", locationRaw: "Hyderabad, India" })).matched,
    ).toBe(true);
    expect(evaluateJob(c, job({ city: "Mumbai", locationRaw: "Mumbai" }))).toMatchObject({
      matched: false,
      failed: "location",
    });
  });
  it("matches the verbatim location text when the city was not parsed", () => {
    const c = criteria({ locations: [KOLKATA] });
    expect(
      evaluateJob(
        c,
        job({ city: null, region: null, locationRaw: "Calcutta (Kolkata), West Bengal" }),
      ).matched,
    ).toBe(true);
  });
  it("Remote / Anywhere in India matches remote Indian jobs only", () => {
    const c = criteria({ countryCodes: ["IN"], locations: [REMOTE_IN] });
    expect(evaluateJob(c, job({ remoteStatus: "REMOTE", city: null })).matched).toBe(true);
    expect(evaluateJob(c, job({ remoteStatus: "HYBRID" })).matched).toBe(false);
  });
  it("locations only constrain their own country", () => {
    const c = criteria({ countryCodes: ["IN", "DE"], locations: [BENGALURU] });
    expect(
      evaluateJob(c, job({ countryCode: "DE", city: "Munich", locationRaw: "Munich" })).matched,
    ).toBe(true);
  });
});

describe("work mode", () => {
  const modes = ["REMOTE", "HYBRID", "ONSITE", "UNKNOWN"];
  it.each([
    [["REMOTE"], ["REMOTE"]],
    [["HYBRID"], ["HYBRID"]],
    [["ONSITE"], ["ONSITE"]],
    [
      ["REMOTE", "HYBRID"],
      ["REMOTE", "HYBRID"],
    ],
    [
      ["HYBRID", "ONSITE"],
      ["HYBRID", "ONSITE"],
    ],
    [
      ["REMOTE", "HYBRID", "ONSITE"],
      ["REMOTE", "HYBRID", "ONSITE"],
    ],
  ])("selection %j includes exactly %j (UNKNOWN stays separate)", (selected, included) => {
    const c = criteria({ workModes: selected });
    const got = modes.filter((m) => evaluateJob(c, job({ remoteStatus: m })).matched);
    expect(got).toEqual(included);
  });
  it("UNKNOWN is included only when explicitly selected", () => {
    expect(
      evaluateJob(criteria({ workModes: ["REMOTE", "UNKNOWN"] }), job({ remoteStatus: "UNKNOWN" }))
        .matched,
    ).toBe(true);
  });
  it("no selection means any work mode", () => {
    expect(modes.every((m) => evaluateJob(criteria(), job({ remoteStatus: m })).matched)).toBe(
      true,
    );
  });
});

describe("employment type, experience level, categories", () => {
  it("employment type filter", () => {
    const c = criteria({ employmentTypes: ["FULL_TIME", "INTERNSHIP"] });
    expect(evaluateJob(c, job({ employmentType: "INTERNSHIP" })).matched).toBe(true);
    expect(evaluateJob(c, job({ employmentType: "CONTRACT" }))).toMatchObject({
      failed: "employmentType",
    });
    expect(evaluateJob(c, job({ employmentType: "UNKNOWN" })).matched).toBe(false);
  });
  it("experience level filter", () => {
    const c = criteria({ experienceLevels: ["ENTRY_LEVEL", "GRADUATE"] });
    expect(evaluateJob(c, job({ experienceLevel: "GRADUATE" })).matched).toBe(true);
    expect(evaluateJob(c, job({ experienceLevel: "SENIOR" }))).toMatchObject({
      failed: "experienceLevel",
    });
  });
  it("multiple categories: a job in any selected category matches", () => {
    const c = criteria({ categoryIds: ["cat-ai", "cat-mkt"] });
    expect(evaluateJob(c, job({ title: "Performance Marketing Executive" })).matched).toBe(true);
    expect(evaluateJob(c, job({ title: "React Developer" }))).toMatchObject({ failed: "category" });
  });
  it("profile search terms work on their own", () => {
    const c = criteria({ terms: ["Growth Associate"] });
    expect(evaluateJob(c, job({ title: "Growth Associate" })).reasons.category).toEqual({
      categoryIds: [],
      terms: ["Growth Associate"],
    });
  });
});

describe("salary (never compares different currencies)", () => {
  const inr = { salaryMin: 600000, salaryMax: null, salaryCurrency: "INR", salaryPeriod: "YEAR" };
  it.each([
    [
      { salaryMin: 700000, salaryMax: 900000, salaryCurrency: "INR", salaryPeriod: "YEAR" },
      "WITHIN_RANGE",
    ],
    [
      { salaryMin: 300000, salaryMax: 500000, salaryCurrency: "INR", salaryPeriod: "YEAR" },
      "BELOW_MINIMUM",
    ],
    [
      { salaryMin: 50000, salaryMax: 60000, salaryCurrency: "EUR", salaryPeriod: "YEAR" },
      "CURRENCY_NOT_COMPARABLE",
    ],
    [
      { salaryMin: 50000, salaryMax: 60000, salaryCurrency: "INR", salaryPeriod: "MONTH" },
      "PERIOD_NOT_COMPARABLE",
    ],
    [{ salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null }, "NOT_STATED"],
  ])("INR profile vs %j → %s", (jobSalary, expected) => {
    expect(compareSalary(inr, jobSalary)).toBe(expected);
  });
  it("keeps non-comparable and unstated salaries (labelled), excludes comparable below-minimum", () => {
    const c = criteria(inr);
    expect(
      evaluateJob(
        c,
        job({ salaryMin: 40000, salaryMax: 50000, salaryCurrency: "EUR", salaryPeriod: "YEAR" }),
      ),
    ).toMatchObject({ matched: true, reasons: { salary: "CURRENCY_NOT_COMPARABLE" } });
    expect(evaluateJob(c, job()).reasons.salary).toBe("NOT_STATED");
    expect(
      evaluateJob(
        c,
        job({ salaryMin: 200000, salaryMax: 300000, salaryCurrency: "INR", salaryPeriod: "YEAR" }),
      ),
    ).toMatchObject({ matched: false, failed: "salary" });
  });
});

describe("visa is informational, never a discovery filter", () => {
  it("annotates but does not exclude", () => {
    const c = criteria({ countryCodes: ["DE"], visaPreference: "SPONSORSHIP_PREFERRED" });
    const r = evaluateJob(c, job({ countryCode: "DE", city: "Berlin", locationRaw: "Berlin" }));
    expect(r.matched).toBe(true);
    expect(r.reasons.visa).toBe("Not stated by source");
  });
});

describe("required combinations", () => {
  it("India + AI & Automation + Remote", () => {
    const c = criteria({ countryCodes: ["IN"], categoryIds: ["cat-ai"], workModes: ["REMOTE"] });
    expect(
      evaluateJob(c, job({ remoteStatus: "REMOTE", city: null, locationRaw: "Remote, India" }))
        .matched,
    ).toBe(true);
    expect(evaluateJob(c, job({ remoteStatus: "HYBRID" })).matched).toBe(false);
    expect(evaluateJob(c, job({ remoteStatus: "REMOTE", title: "SEO Executive" })).matched).toBe(
      false,
    );
  });
  it("India + Digital Marketing + Bengaluru + Hybrid", () => {
    const c = criteria({
      countryCodes: ["IN"],
      locations: [BENGALURU],
      categoryIds: ["cat-mkt"],
      workModes: ["HYBRID"],
    });
    expect(evaluateJob(c, job({ title: "Digital Marketing Specialist" })).matched).toBe(true);
    expect(
      evaluateJob(
        c,
        job({ title: "Digital Marketing Specialist", city: "Pune", locationRaw: "Pune" }),
      ).matched,
    ).toBe(false);
  });
  it("India + Web Development + Pune + Onsite", () => {
    const c = criteria({
      countryCodes: ["IN"],
      locations: [PUNE],
      categoryIds: ["cat-web"],
      workModes: ["ONSITE"],
    });
    expect(
      evaluateJob(
        c,
        job({
          title: "Frontend Developer",
          city: "Pune",
          locationRaw: "Pune, Maharashtra",
          remoteStatus: "ONSITE",
        }),
      ).matched,
    ).toBe(true);
  });
  it("Germany + AI + Remote", () => {
    const c = criteria({ countryCodes: ["DE"], categoryIds: ["cat-ai"], workModes: ["REMOTE"] });
    expect(
      evaluateJob(
        c,
        job({
          title: "AI Engineer",
          countryCode: "DE",
          city: null,
          locationRaw: "Remote - Germany",
          remoteStatus: "REMOTE",
        }),
      ).matched,
    ).toBe(true);
    expect(
      evaluateJob(c, job({ title: "AI Engineer", countryCode: "IN", remoteStatus: "REMOTE" }))
        .matched,
    ).toBe(false);
  });
  it("UAE + Digital Marketing + Dubai + Onsite", () => {
    const c = criteria({
      countryCodes: ["AE"],
      locations: [DUBAI],
      categoryIds: ["cat-mkt"],
      workModes: ["ONSITE"],
    });
    const dubai = {
      countryCode: "AE",
      city: "Dubai",
      region: null,
      locationRaw: "Dubai, UAE",
      remoteStatus: "ONSITE",
    };
    expect(evaluateJob(c, job({ title: "Digital Marketing Specialist", ...dubai })).matched).toBe(
      true,
    );
    expect(
      evaluateJob(
        c,
        job({
          title: "Digital Marketing Specialist",
          ...dubai,
          city: "Abu Dhabi",
          locationRaw: "Abu Dhabi",
        }),
      ).matched,
    ).toBe(false);
  });
  it("India — AI Automation — Remote/Hybrid (full example profile)", () => {
    const c = criteria({
      countryCodes: ["IN"],
      locations: [BENGALURU, HYDERABAD, PUNE, KOLKATA, REMOTE_IN],
      categoryIds: ["cat-ai"],
      workModes: ["REMOTE", "HYBRID"],
      employmentTypes: ["FULL_TIME", "INTERNSHIP"],
      experienceLevels: ["ENTRY_LEVEL", "GRADUATE"],
    });
    expect(evaluateJob(c, job({ experienceLevel: "ENTRY_LEVEL" })).matched).toBe(true);
    expect(
      evaluateJob(
        c,
        job({
          experienceLevel: "GRADUATE",
          remoteStatus: "REMOTE",
          city: null,
          locationRaw: "India (Remote)",
        }),
      ).matched,
    ).toBe(true);
    expect(evaluateJob(c, job({ experienceLevel: "SENIOR" })).matched).toBe(false);
  });
  it("one job can satisfy several profiles", () => {
    const aiMarketingIntern = job({
      title: "AI Automation Marketing Intern",
      experienceLevel: "INTERNSHIP",
    });
    const profiles = [
      criteria({ countryCodes: ["IN"], categoryIds: ["cat-ai"] }),
      criteria({ countryCodes: ["IN"], categoryIds: ["cat-mkt"] }),
      criteria({ countryCodes: ["IN"], experienceLevels: ["INTERNSHIP"], terms: ["Marketing"] }),
    ];
    expect(profiles.map((p) => evaluateJob(p, aiMarketingIntern).matched)).toEqual([
      true,
      true,
      true,
    ]);
  });
});
