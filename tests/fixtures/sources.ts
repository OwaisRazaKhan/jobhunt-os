/**
 * Synthetic provider payloads for adapter tests. Field names mirror the real
 * public APIs (verified 2026-09-26); all values are invented test data.
 */

export const ASHBY_BOARD = {
  apiVersion: "1",
  jobs: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Marketing Operations Specialist",
      department: "Marketing",
      team: "Growth",
      employmentType: "FullTime",
      location: "Berlin, Germany",
      secondaryLocations: [{ location: "Amsterdam", address: { postalAddress: { addressLocality: "Amsterdam", addressCountry: "Netherlands" } } }],
      publishedAt: "2026-09-01T10:00:00.000+00:00",
      isListed: true,
      isRemote: false,
      workplaceType: "Hybrid",
      address: { postalAddress: { addressLocality: "Berlin", addressRegion: "Berlin", addressCountry: "Germany" } },
      jobUrl: "https://jobs.ashbyhq.com/testco/11111111-1111-4111-8111-111111111111",
      applyUrl: "https://jobs.ashbyhq.com/testco/11111111-1111-4111-8111-111111111111/application",
      descriptionHtml: "<p>Own our marketing operations.</p><p>Visa sponsorship is available for this role.</p>",
      descriptionPlain: "Own our marketing operations.\nVisa sponsorship is available for this role.",
      compensation: {
        compensationTierSummary: "€50K – €65K",
        scrapeableCompensationSalarySummary: "€50K - €65K",
        compensationTiers: [],
        summaryComponents: [
          { compensationType: "Salary", interval: "1 YEAR", currencyCode: "EUR", minValue: 50000, maxValue: 65000 },
          { compensationType: "EquityPercentage", interval: "NONE", currencyCode: null, minValue: null, maxValue: null },
        ],
      },
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      title: "AI Automation Engineer",
      department: "Engineering",
      team: null,
      employmentType: "Contract",
      location: "Remote - European Union",
      secondaryLocations: [],
      publishedAt: "2026-09-10T10:00:00.000+00:00",
      isListed: true,
      isRemote: true,
      workplaceType: "Remote",
      address: { postalAddress: { addressCountry: "European Union" } },
      jobUrl: "https://jobs.ashbyhq.com/testco/22222222-2222-4222-8222-222222222222",
      applyUrl: "https://jobs.ashbyhq.com/testco/22222222-2222-4222-8222-222222222222/application",
      descriptionPlain: "Build automations.",
      compensation: { compensationTierSummary: null, scrapeableCompensationSalarySummary: null, compensationTiers: [], summaryComponents: [] },
    },
    { id: "33333333-3333-4333-8333-333333333333", title: "Unlisted role", isListed: false, jobUrl: "https://jobs.ashbyhq.com/testco/3" },
  ],
};

export const leverPosting = (i: number, over: Record<string, unknown> = {}) => ({
  id: `lever-${String(i).padStart(4, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
  text: `Digital Marketing Manager ${i}`,
  categories: { commitment: "Full-time", department: "Marketing", location: "Dubai, UAE", team: "Brand", allLocations: ["Dubai, UAE"] },
  country: "AE",
  workplaceType: "onsite",
  createdAt: 1756700000000 + i,
  descriptionPlain: "Lead digital marketing.",
  lists: [{ text: "Requirements", content: "<li>3+ years experience</li><li>Arabic is a plus</li>" }],
  additionalPlain: "Applicants must already have the right to work in the UAE.",
  hostedUrl: `https://jobs.eu.lever.co/testco/lever-${i}`,
  applyUrl: `https://jobs.eu.lever.co/testco/lever-${i}/apply`,
  salaryRange: { min: 12000, max: 15000, currency: "AED", interval: "per-month-salary" },
  ...over,
});

export const GREENHOUSE_BOARD = {
  jobs: [
    {
      id: 4001,
      title: "Business Development Representative",
      absolute_url: "https://job-boards.greenhouse.io/testco/jobs/4001",
      location: { name: "Toronto, ON" },
      content: "&lt;p&gt;Grow our pipeline.&lt;/p&gt;&lt;p&gt;Must be authorized to work in Canada.&lt;/p&gt;",
      departments: [{ id: 1, name: "Sales" }],
      offices: [],
      metadata: [{ id: 9, name: "Employment Type", value: "Full-time", value_type: "single_select" }],
      pay_input_ranges: [{ min_cents: 6000000, max_cents: 7500000, currency_type: "CAD", title: "Canada Salary Range" }],
      company_name: "Test Company",
      first_published: "2026-08-20T09:00:00-04:00",
      updated_at: "2026-09-20T09:00:00-04:00",
    },
    {
      id: 4002,
      title: "Web Developer",
      absolute_url: "https://job-boards.greenhouse.io/testco/jobs/4002",
      location: { name: "Remote, United States" },
      content: "&lt;p&gt;Build websites.&lt;/p&gt;",
      departments: [],
      metadata: [],
      company_name: "Test Company",
      first_published: "2026-09-02T09:00:00-04:00",
      updated_at: "2026-09-21T09:00:00-04:00",
    },
  ],
  meta: { total: 2 },
};
