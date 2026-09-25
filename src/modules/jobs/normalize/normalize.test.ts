import { describe, expect, it } from "vitest";
import { extractVisaWording, normalizeEmploymentType, normalizeInterval, normalizeWorkplace, parseSalaryText } from "./fields";
import { decodeEntities, htmlToText } from "./html";
import { countryCodeForName, normalizeLocation } from "./location";

describe("htmlToText", () => {
  it("converts HTML (and HTML-escaped HTML) to readable text without markup", () => {
    expect(htmlToText("<p>Hello <b>world</b></p><ul><li>One</li><li>Two &amp; three</li></ul>")).toBe("Hello world\n\n• One\n• Two & three");
    expect(htmlToText("&lt;p&gt;Escaped &amp;amp; ok&lt;/p&gt;")).toBe("Escaped & ok");
    expect(htmlToText("<script>alert(1)</script><p>Safe</p>")).toBe("Safe");
    expect(decodeEntities("&#8364;50k &euro;")).toBe("€50k €");
  });
});

describe("parseSalaryText (explicit statements only)", () => {
  it.each([
    ["€50,000–€65,000/year", { min: 50000, max: 65000, currency: "EUR", period: "YEAR" }],
    ["AED 12,000/month", { min: 12000, max: null, currency: "AED", period: "MONTH" }],
    ["€110K - €185K", { min: 110000, max: 185000, currency: "EUR", period: null }],
    ["$45 - $60 per hour", { min: 45, max: 60, currency: "USD", period: "HOUR" }],
    ["50,000 - 65,000 EUR annually", { min: 50000, max: 65000, currency: "EUR", period: "YEAR" }],
    ["USD 120000 to 150000 per annum", { min: 120000, max: 150000, currency: "USD", period: "YEAR" }],
  ])("%s", (text, expected) => {
    expect(parseSalaryText(text)).toEqual(expected);
  });

  it.each(["Competitive salary", "50,000 - 65,000", "Up to 10 days holiday", "", "€65,000 - €50,000"])("returns null for ambiguous: %s", (text) => {
    expect(parseSalaryText(text)).toBeNull();
  });
});

describe("normalizeLocation", () => {
  it("parses city/region/country from the job's own location", () => {
    expect(normalizeLocation("Dubai, UAE")).toMatchObject({ city: "Dubai", countryCode: "AE" });
    expect(normalizeLocation("Berlin, Germany")).toMatchObject({ city: "Berlin", countryCode: "DE" });
    expect(normalizeLocation("Arlington, TX")).toMatchObject({ city: "Arlington", region: "Texas", countryCode: "US" });
    expect(normalizeLocation("Toronto, ON")).toMatchObject({ city: "Toronto", region: "Ontario", countryCode: "CA" });
    expect(normalizeLocation("Remote, United States")).toMatchObject({ city: null, countryCode: "US", remoteWord: "REMOTE" });
    expect(normalizeLocation("Amsterdam")).toMatchObject({ city: "Amsterdam", countryCode: "NL" });
    expect(normalizeLocation("Hybrid - London, UK")).toMatchObject({ city: "London", countryCode: "GB", remoteWord: "HYBRID" });
  });

  it("keeps ambiguous and vague locations unknown", () => {
    expect(normalizeLocation("Europe")).toMatchObject({ city: null, countryCode: null });
    expect(normalizeLocation("Remote - European Union")).toMatchObject({ countryCode: null, remoteWord: "REMOTE" });
    // "IN" could be Indiana or India: not resolved without an explicit hint.
    expect(normalizeLocation("Springfield, IN").countryCode).toBeNull();
    expect(normalizeLocation("Springfield, IN", { countryCode: "US" })).toMatchObject({ countryCode: "US", region: "Indiana" });
    expect(normalizeLocation("")).toEqual({ city: null, region: null, countryCode: null, remoteWord: null });
  });

  it("uses explicit source hints", () => {
    expect(normalizeLocation("Spain", { countryName: "Spain" })).toMatchObject({ countryCode: "ES" });
    expect(countryCodeForName("Kingdom of Saudi Arabia")).toBe("SA");
    expect(countryCodeForName("European Union")).toBeNull();
  });
});

describe("field mappers", () => {
  it("maps employment types and workplaces, unknown stays UNKNOWN", () => {
    expect(normalizeEmploymentType("FullTime")).toBe("FULL_TIME");
    expect(normalizeEmploymentType("Part time")).toBe("PART_TIME");
    expect(normalizeEmploymentType("Intern")).toBe("INTERNSHIP");
    expect(normalizeEmploymentType("Contract")).toBe("CONTRACT");
    expect(normalizeEmploymentType("Temporary")).toBe("TEMPORARY");
    expect(normalizeEmploymentType("Mysterious")).toBe("UNKNOWN");
    expect(normalizeWorkplace("OnSite")).toBe("ONSITE");
    expect(normalizeWorkplace("unspecified")).toBe("UNKNOWN");
    expect(normalizeInterval("1 YEAR")).toBe("YEAR");
    expect(normalizeInterval("per-hour-wage")).toBe("HOUR");
    expect(normalizeInterval("NONE")).toBeNull();
  });

  it("captures explicit visa wording verbatim, nothing otherwise", () => {
    expect(extractVisaWording("Great team. Visa sponsorship is available for this role. Apply now.")).toBe("Visa sponsorship is available for this role.");
    expect(extractVisaWording("You must be authorized to work in the US without sponsorship.")).toBe("You must be authorized to work in the US without sponsorship.");
    expect(extractVisaWording("We build great software.")).toBeNull();
  });
});
