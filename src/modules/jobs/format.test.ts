import { describe, expect, it } from "vitest";
import { formatAge, formatLocation, formatSalary } from "./format";

const salary = (s: Partial<Parameters<typeof formatSalary>[0]>) =>
  formatSalary({
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    salaryRaw: null,
    ...s,
  });

describe("formatSalary", () => {
  it("formats explicit ranges and single values", () => {
    expect(
      salary({ salaryMin: 50000, salaryMax: 65000, salaryCurrency: "EUR", salaryPeriod: "YEAR" }),
    ).toBe("EUR 50k–65k /yr");
    expect(salary({ salaryMin: 12000, salaryCurrency: "AED", salaryPeriod: "MONTH" })).toBe(
      "AED 12k /mo",
    );
    expect(
      salary({ salaryMin: 45, salaryMax: 45, salaryCurrency: "USD", salaryPeriod: "HOUR" }),
    ).toBe("USD 45 /hr");
  });

  it("falls back to the raw text and never invents numbers", () => {
    expect(salary({ salaryRaw: "Competitive" })).toBe("Competitive");
    expect(salary({})).toBeNull();
    expect(salary({ salaryMin: 60000 })).toBe("60k");
  });
});

describe("formatLocation", () => {
  it("prefers normalized city + country, then the raw location", () => {
    expect(formatLocation({ city: "Dubai", countryCode: "AE", locationRaw: "Dubai, UAE" })).toBe(
      "Dubai, United Arab Emirates",
    );
    expect(formatLocation({ city: null, countryCode: null, locationRaw: "Remote — EMEA" })).toBe(
      "Remote — EMEA",
    );
    expect(formatLocation({ city: null, countryCode: null, locationRaw: null })).toBeNull();
  });
});

describe("formatAge", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  it("renders relative ages and unknowns", () => {
    expect(formatAge(new Date("2026-09-26T08:00:00Z"), now)).toBe("today");
    expect(formatAge(new Date("2026-09-23T12:00:00Z"), now)).toBe("3d ago");
    expect(formatAge(new Date("2026-08-01T12:00:00Z"), now)).toBe("8w ago");
    expect(formatAge(new Date("2024-01-01T12:00:00Z"), now)).toBe("2024-01-01");
    expect(formatAge(null, now)).toBeNull();
  });
});
