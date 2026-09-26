import { describe, expect, it } from "vitest";
import {
  EMPTY_SEARCH,
  hasFilters,
  parseSearchParams,
  savedParams,
  searchHref,
  searchTokens,
  toSearchParams,
} from "./params";

const fromUrl = (qs: string) => {
  const raw: Record<string, string[]> = {};
  for (const [k, v] of new URLSearchParams(qs)) (raw[k] ??= []).push(v);
  return parseSearchParams(raw);
};

describe("job search URL state", () => {
  it("round-trips every filter through the URL (shareable, reproducible)", () => {
    const qs =
      "q=ai+automation&country=IN&country=DE&loc=0199a000-0000-7000-8000-000000000001&cat=0199a000-0000-7000-8000-000000000002&mode=REMOTE&mode=HYBRID&type=FULL_TIME&exp=ENTRY_LEVEL&salMin=300000&salMax=800000&cur=INR&per=YEAR&salOnly=1&src=ASHBY&status=OPEN&posted=7&disc=30&seen=14&profile=0199a000-0000-7000-8000-000000000003&sort=salary&page=3";
    const { params, invalid } = fromUrl(qs);
    expect(invalid).toEqual([]);
    const entries = (x: string) => [...new URLSearchParams(x)].map((e) => e.join("=")).sort();
    expect(entries(toSearchParams(params).toString())).toEqual(entries(qs));
    expect(fromUrl(toSearchParams(params).toString()).params).toEqual(params);
  });

  it("omits defaults so an empty search is just /jobs", () => {
    expect(searchHref("/jobs", EMPTY_SEARCH)).toBe("/jobs");
    expect(hasFilters(EMPTY_SEARCH)).toBe(false);
    expect(hasFilters({ ...EMPTY_SEARCH, sort: "title", page: 4 })).toBe(false);
    expect(hasFilters({ ...EMPTY_SEARCH, mode: ["REMOTE"] })).toBe(true);
  });

  it("saved searches store filters without the page", () => {
    const { params } = fromUrl("country=IN&mode=REMOTE&mode=HYBRID&page=5");
    expect(savedParams(params)).toEqual({ country: "IN", mode: ["REMOTE", "HYBRID"] });
  });

  it("accepts comma lists and lower-case enum values from hand-written URLs", () => {
    expect(fromUrl("mode=remote,hybrid&country=in").params).toMatchObject({
      mode: ["REMOTE", "HYBRID"],
      country: ["IN"],
    });
  });

  it("drops invalid freshness, currency and inverted salary ranges", () => {
    const { params, invalid } = fromUrl("posted=2&cur=RUPEES&salMin=10&salMax=5");
    expect(params).toMatchObject({ posted: null, cur: null, salMin: null, salMax: null });
    expect(invalid).toEqual(expect.arrayContaining(["posted", "cur"]));
    const inverted = fromUrl("cur=INR&salMin=10&salMax=5");
    expect(inverted.params).toMatchObject({ salMin: 10, salMax: null });
    expect(inverted.invalid).toEqual(["salMax"]);
  });

  it("caps list sizes", () => {
    const many = Array.from(
      { length: 40 },
      (_, i) =>
        `country=${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`,
    ).join("&");
    const { params, invalid } = fromUrl(many);
    expect(params.country).toHaveLength(30);
    expect(invalid).toContain("country");
  });
});

describe("search tokens", () => {
  it("keeps only letters, digits and inner dots; folds accents; max 8 tokens", () => {
    expect(searchTokens("  AI  Automation ")).toEqual(["ai", "automation"]);
    expect(searchTokens("Make.com / n8n")).toEqual(["make.com", "n8n"]);
    expect(searchTokens("Düsseldorf café")).toEqual(["dusseldorf", "cafe"]);
    expect(searchTokens("'; DROP TABLE jobs; -- :* & |")).toEqual(["drop", "table", "jobs"]);
    expect(searchTokens("a b c d e f g h i j")).toHaveLength(8);
    expect(searchTokens("...")).toEqual([]);
  });
});
