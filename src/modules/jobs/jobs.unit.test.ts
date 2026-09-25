import { describe, expect, it } from "vitest";
import { checkPublicHttpUrl, isPublicHttpUrl } from "@/lib/safe-url";
import { normalizeOrganization, normalizeTitle } from "@/lib/text-normalize";
import { manualJobInput } from "./jobs.schemas";
import { sourceConfigInput } from "./sources.schemas";

const valid = {
  title: "Test Role",
  company: "Test Company",
  jobUrl: "https://jobs.example.com/123",
  locationRaw: "Berlin, Germany",
  countryCode: "DE",
  description: "Synthetic description.",
};

const errorsFor = (input: Record<string, unknown>) => {
  const r = manualJobInput.safeParse(input);
  return r.success
    ? {}
    : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe("checkPublicHttpUrl (SSRF / unsafe URL protection)", () => {
  it("accepts public http(s) URLs", () => {
    expect(isPublicHttpUrl("https://jobs.ashbyhq.com/acme/123")).toBe(true);
    expect(isPublicHttpUrl("http://careers.example.co.uk/role?id=1")).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "data:text/html,<script>",
    "https://localhost/admin",
    "http://127.0.0.1:8080",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5/",
    "http://[::1]/",
    "http://2130706433/",
    "http://0x7f000001/",
    "https://metadata.google.internal/",
    "https://printer.local/",
    "https://intranet/",
    "https://user:pass@example.com/",
    "example.com/no-protocol",
    `https://example.com/${"a".repeat(2100)}`,
  ])("rejects %s", (url) => {
    expect(checkPublicHttpUrl(url).ok).toBe(false);
  });
});

describe("normalisation", () => {
  it("normalises companies and titles deterministically", () => {
    expect(normalizeOrganization("Acme GmbH")).toBe(normalizeOrganization("ACME"));
    expect(normalizeOrganization("Lead Zing Ltd.")).toBe("leadzing");
    expect(normalizeOrganization("Co.")).toBe("co");
    expect(normalizeOrganization("Acme Pvt. Ltd.")).toBe("acme");
    expect(normalizeOrganization("The Coffee Company")).not.toBe(
      normalizeOrganization("The Coffee"),
    );
    expect(normalizeOrganization("Coca Cola")).toBe("cocacola");
    expect(normalizeTitle("  Marketing   Manager (m/w/d) ")).toBe("marketing manager");
  });
});

describe("manualJobInput validation", () => {
  it("accepts a minimal valid job and defaults unknowns to UNKNOWN", () => {
    const r = manualJobInput.parse(valid);
    expect(r).toMatchObject({
      employmentType: "UNKNOWN",
      remoteStatus: "UNKNOWN",
      relocationAvailable: "UNKNOWN",
      salaryMin: null,
      applicationUrl: null,
    });
  });

  it("requires title, company, job URL, location, country and description", () => {
    const e = errorsFor({});
    for (const f of ["title", "company", "jobUrl", "locationRaw", "countryCode", "description"])
      expect(e[f]).toBeDefined();
  });

  it("does not silently correct URLs", () => {
    expect(errorsFor({ ...valid, jobUrl: "jobs.example.com/123" }).jobUrl).toMatch(/https:\/\//);
    expect(errorsFor({ ...valid, applicationUrl: "javascript:alert(1)" }).applicationUrl).toMatch(
      /http/,
    );
    expect(errorsFor({ ...valid, jobUrl: "http://192.168.1.1/job" }).jobUrl).toMatch(/IP/);
  });

  it("validates salary logic", () => {
    expect(
      errorsFor({ ...valid, salaryMin: "70000", salaryMax: "50000", salaryCurrency: "EUR" })
        .salaryMin,
    ).toMatch(/exceed/);
    expect(errorsFor({ ...valid, salaryMin: "50000" }).salaryCurrency).toMatch(/currency/);
    expect(errorsFor({ ...valid, salaryMin: "-5", salaryCurrency: "EUR" }).salaryMin).toBeDefined();
    expect(errorsFor({ ...valid, salaryMin: "50k", salaryCurrency: "EUR" }).salaryMin).toMatch(
      /whole number/,
    );
    expect(
      errorsFor({ ...valid, salaryMin: "50000", salaryCurrency: "eur" }).salaryCurrency,
    ).toMatch(/capitals/);
    expect(
      errorsFor({ ...valid, salaryMin: "50000", salaryCurrency: "ZZQ" }).salaryCurrency,
    ).toMatch(/Unknown/);
    expect(errorsFor({ ...valid, salaryCurrency: "EUR" }).salaryMin).toMatch(/amount/);
    expect(
      manualJobInput.parse({
        ...valid,
        salaryMin: "50,000",
        salaryMax: "65000",
        salaryCurrency: "EUR",
        salaryPeriod: "YEAR",
      }),
    ).toMatchObject({ salaryMin: 50000, salaryMax: 65000 });
  });

  it("validates enums, dates and sizes", () => {
    expect(errorsFor({ ...valid, employmentType: "GIG" }).employmentType).toBeDefined();
    expect(errorsFor({ ...valid, remoteStatus: "MOON" }).remoteStatus).toBeDefined();
    expect(errorsFor({ ...valid, salaryPeriod: "DECADE" }).salaryPeriod).toBeDefined();
    expect(errorsFor({ ...valid, postedAt: "2999-01-01" }).postedAt).toMatch(/future/);
    expect(errorsFor({ ...valid, countryCode: "Germany" }).countryCode).toBeDefined();
    expect(errorsFor({ ...valid, description: "x".repeat(50_001) }).description).toMatch(/at most/);
    expect(errorsFor({ ...valid, title: "x".repeat(301) }).title).toMatch(/at most/);
  });

  it("strips control characters but keeps text (HTML stays literal text)", () => {
    const r = manualJobInput.parse({
      ...valid,
      description: "Line 1\u0000\nLine 2 <script>alert(1)</script>",
    });
    expect(r.description).toBe("Line 1\nLine 2 <script>alert(1)</script>");
  });
});

describe("source configuration schema", () => {
  it("applies default rate limits and rejects URLs as identifiers", () => {
    expect(sourceConfigInput("ASHBY").parse({ boards: "acme" })).toMatchObject({
      boards: ["acme"],
      requestsPerMinute: 30,
      maxPagesPerSync: 10,
    });
    expect(
      sourceConfigInput("ASHBY").safeParse({ boards: "https://jobs.ashbyhq.com/acme" }).success,
    ).toBe(false);
  });
});
