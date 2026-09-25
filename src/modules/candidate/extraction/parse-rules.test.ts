import { describe, expect, it } from "vitest";
import {
  categorizeSkill,
  findDateRange,
  parseCvText,
  parsePartialDate,
  splitTitleOrganization,
  type FactDraft,
} from "./parse-rules";

// Clearly synthetic test data — never real candidate information.
export const SYNTHETIC_CV = `Test Candidate
Digital Marketing Specialist | Web Developer
test.candidate@example.com | +1 555 010 2030 | linkedin.com/in/test-candidate | github.com/testcandidate

SUMMARY
Marketing specialist and web developer building websites and campaigns for small businesses.

EXPERIENCE
Founder — Test Company
Jan 2022 – Present
• Built websites for local clients using Next.js
• Ran social media marketing campaigns
Marketing Intern at Example Agency, Remote
06/2021 - 08/2021
• Assisted with SEO audits

EDUCATION
BBA in Marketing
Test University
2020 – 2024

SKILLS
Web: Next.js, React, Tailwind CSS
Marketing: SEO, Social Media Marketing, Google Ads
Communication, Teamwork

PROJECTS
Test Project — Lead Developer
Portfolio website for a bakery. https://test-project.example.com
Tech: Next.js, Supabase

LANGUAGES
English (C1), Urdu (Native), German - Beginner

CERTIFICATIONS
Google Analytics Certification — Google, 2023

INTERESTS
Chess
`;

const byCategory = (drafts: FactDraft[], category: string) =>
  drafts.filter((d) => d.category === category);

describe("date parsing", () => {
  it("keeps year-only dates year-only (never invents months)", () => {
    expect(parsePartialDate("2020")).toBe("2020");
    expect(parsePartialDate("Jan 2022")).toBe("2022-01");
    expect(parsePartialDate("September 2019")).toBe("2019-09");
    expect(parsePartialDate("06/2021")).toBe("2021-06");
    expect(parsePartialDate("13/2021")).toBe("2021");
  });

  it("finds ranges including present", () => {
    expect(findDateRange("Jan 2022 – Present")).toMatchObject({
      startDate: "2022-01",
      endDate: null,
      isCurrent: true,
    });
    expect(findDateRange("2019-2021")).toMatchObject({
      startDate: "2019",
      endDate: "2021",
      isCurrent: false,
    });
    expect(findDateRange("2021 - 2019")).toBeNull();
    expect(findDateRange("No dates here")).toBeNull();
  });
});

describe("title / organization split", () => {
  it("handles 'at', dashes and keyword ordering", () => {
    expect(splitTitleOrganization(["Marketing Intern at Example Agency"])).toMatchObject({
      title: "Marketing Intern",
      organization: "Example Agency",
    });
    expect(splitTitleOrganization(["Test Company — Founder"])).toMatchObject({
      title: "Founder",
      organization: "Test Company",
    });
    expect(splitTitleOrganization(["Founder", "Test Company"])).toMatchObject({
      title: "Founder",
      organization: "Test Company",
    });
  });
});

describe("parseCvText", () => {
  const drafts = parseCvText(SYNTHETIC_CV);

  it("extracts contact details and name from the header", () => {
    const profile = Object.fromEntries(
      byCategory(drafts, "profile").map((d) => [d.payload.field, d.payload.value]),
    );
    expect(profile.fullName).toBe("Test Candidate");
    expect(profile.professionalEmail).toBe("test.candidate@example.com");
    expect(profile.phone).toBe("+1 555 010 2030");
    expect(profile.linkedinUrl).toBe("https://linkedin.com/in/test-candidate");
    expect(profile.githubUrl).toBe("https://github.com/testcandidate");
    expect(profile.summary).toMatch(/^Marketing specialist/);
  });

  it("extracts experience entries with dates and bullets", () => {
    const exp = byCategory(drafts, "experience");
    expect(exp).toHaveLength(2);
    expect(exp[0]!.payload).toMatchObject({
      title: "Founder",
      organization: "Test Company",
      startDate: "2022-01",
      isCurrent: true,
    });
    expect(exp[0]!.payload.responsibilities).toEqual([
      "Built websites for local clients using Next.js",
      "Ran social media marketing campaigns",
    ]);
    expect(exp[1]!.payload).toMatchObject({
      title: "Marketing Intern",
      organization: "Example Agency",
      location: "Remote",
      startDate: "2021-06",
      endDate: "2021-08",
    });
  });

  it("extracts education without inventing months", () => {
    const edu = byCategory(drafts, "education");
    expect(edu).toHaveLength(1);
    expect(edu[0]!.payload).toMatchObject({
      institution: "Test University",
      degree: "BBA",
      fieldOfStudy: "Marketing",
      startDate: "2020",
      endDate: "2024",
    });
  });

  it("extracts skills with deterministic categories and no proficiency", () => {
    const skills = byCategory(drafts, "skill");
    const names = skills.map((s) => s.payload.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Next.js",
        "React",
        "Tailwind CSS",
        "SEO",
        "Google Ads",
        "Communication",
        "Teamwork",
      ]),
    );
    expect(skills.every((s) => s.payload.proficiency === null)).toBe(true);
    expect(skills.find((s) => s.payload.name === "SEO")!.payload.category).toBe("MARKETING");
    expect(skills.find((s) => s.payload.name === "React")!.payload.category).toBe("WEB");
  });

  it("extracts projects with URLs and technologies", () => {
    const projects = byCategory(drafts, "project");
    expect(projects).toHaveLength(1);
    expect(projects[0]!.payload).toMatchObject({
      name: "Test Project",
      role: "Lead Developer",
      liveUrl: "https://test-project.example.com",
      technologies: ["Next.js", "Supabase"],
    });
  });

  it("maps only explicit language levels", () => {
    const langs = Object.fromEntries(
      byCategory(drafts, "language").map((d) => [d.payload.language, d.payload.proficiency]),
    );
    expect(langs).toEqual({ English: "C1", Urdu: "NATIVE", German: null });
  });

  it("extracts certifications with issuer and year", () => {
    const certs = byCategory(drafts, "certification");
    expect(certs[0]!.payload).toMatchObject({
      name: "Google Analytics Certification",
      issuer: "Google",
      issueDate: "2023",
    });
  });

  it("ignores interests and every draft carries an excerpt from the source text", () => {
    expect(drafts.some((d) => JSON.stringify(d.payload).includes("Chess"))).toBe(false);
    for (const draft of drafts) {
      expect(draft.excerpt.length).toBeGreaterThan(0);
      expect(draft.confidence).toBeGreaterThan(0);
      expect(draft.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("returns nothing for text without recognizable content", () => {
    expect(
      parseCvText("lorem ipsum dolor sit amet").filter((d) => d.category !== "profile"),
    ).toEqual([]);
  });
});

describe("categorizeSkill", () => {
  it("uses the label first, then keywords, else OTHER", () => {
    expect(categorizeSkill("Photoshop", "Marketing")).toBe("MARKETING");
    expect(categorizeSkill("Figma")).toBe("DESIGN");
    expect(categorizeSkill("Underwater basket weaving")).toBe("OTHER");
  });
});
