import { describe, expect, it } from "vitest";
import { formDataToObject } from "@/lib/form-data";
import { searchProfileInput } from "./schemas";

/** Mirrors what the Search Profile form submits (chip groups send `name[]`). */
function formPayload(entries: [string, string][]) {
  const fd = new FormData();
  fd.append(
    "__arrays",
    "countryCodes,locationIds,categoryIds,workModes,employmentTypes,experienceLevels,sourceKeys",
  );
  for (const [k, v] of entries) fd.append(k, v);
  return formDataToObject(fd);
}

describe("search profile form payload", () => {
  it("parses a full form submission", () => {
    const loc = "0199a000-0000-7000-8000-000000000001";
    const cat = "0199a000-0000-7000-8000-000000000002";
    const input = searchProfileInput.parse(
      formPayload([
        ["name", "  India — AI Automation — Remote/Hybrid "],
        ["countryCodes[]", "IN"],
        ["locationIds[]", loc],
        ["categoryIds[]", cat],
        ["searchTerms", "Automation Analyst\nAutomation Analyst\n\nGrowth Associate"],
        ["workModes[]", "REMOTE"],
        ["workModes[]", "HYBRID"],
        ["employmentTypes[]", "FULL_TIME"],
        ["experienceLevels[]", "ENTRY_LEVEL"],
        ["salaryMin", "600000"],
        ["salaryMax", ""],
        ["salaryCurrency", "inr"],
        ["salaryPeriod", "YEAR"],
        ["visaPreference", "UNKNOWN"],
        ["sourceKeys[]", "LEVER"],
        ["scheduleIntervalHours", "24"],
      ]),
    );
    expect(input).toMatchObject({
      name: "India — AI Automation — Remote/Hybrid",
      countryCodes: ["IN"],
      locationIds: [loc],
      categoryIds: [cat],
      searchTerms: ["Automation Analyst", "Growth Associate"],
      workModes: ["REMOTE", "HYBRID"],
      salaryMin: 600000,
      salaryMax: null,
      salaryCurrency: "INR",
      sourceKeys: ["LEVER"],
      scheduleIntervalHours: 24,
    });
  });

  it("empty selections mean 'any' and an empty schedule means manual only", () => {
    const input = searchProfileInput.parse(
      formPayload([
        ["name", "Anything"],
        ["searchTerms", ""],
        ["salaryMin", ""],
        ["salaryMax", ""],
        ["salaryCurrency", ""],
        ["salaryPeriod", ""],
        ["visaPreference", "UNKNOWN"],
        ["scheduleIntervalHours", ""],
      ]),
    );
    expect(input).toMatchObject({
      countryCodes: [],
      locationIds: [],
      workModes: [],
      searchTerms: [],
      salaryMin: null,
      salaryCurrency: null,
      scheduleIntervalHours: null,
    });
  });

  it("rejects a salary without currency and an unknown schedule", () => {
    const result = searchProfileInput.safeParse(
      formPayload([
        ["name", "Bad"],
        ["salaryMin", "1000"],
        ["salaryCurrency", ""],
        ["scheduleIntervalHours", "5"],
      ]),
    );
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["salaryCurrency", "scheduleIntervalHours"]));
  });
});
