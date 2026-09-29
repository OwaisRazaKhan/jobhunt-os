import { describe, expect, it } from "vitest";
import type { EvidenceCorpus } from "@/modules/communications/claims";
import { detectSubmissionOutcome } from "@/server/browser/dom";
import { checkNavigationTarget, checkUrlSyntax } from "@/server/browser/navigation";
import { parseGreenhouseQuestions, selectAdapter } from "./adapters";
import { detectChannels, extractEmails, providerFromUrl } from "./channel";
import { formDrift } from "./hash";
import { mapField, type CandidateData } from "./mapping";
import { auditAnswer, classifyQuestion, fitToLimit } from "./questions";

const candidate: CandidateData = {
  profile: {
    id: "p1",
    fullName: "Asha Rao",
    email: "asha@example.test",
    phone: "+91 90000 00000",
    city: "Pune",
    countryName: "India",
    linkedinUrl: "https://www.linkedin.com/in/asha-example",
    githubUrl: null,
    portfolioUrl: null,
    websiteUrl: null,
    availableFrom: null,
    noticePeriodWeeks: null,
    yearsOfExperience: null,
  },
  preferences: null,
  authorizations: [],
  skills: [{ ref: "skill:1", name: "React" }],
  experiences: [],
  education: [],
  files: { RESUME: { exportId: "e1", fileName: "Asha_Rao_Resume.pdf", versionId: "v1" } },
  coverLetterText: null,
};
const field = (
  label: string,
  fieldType: Parameters<typeof mapField>[0]["fieldType"] = "TEXT",
  extra: Partial<Parameters<typeof mapField>[0]> = {},
) => ({
  externalFieldId: label.toLowerCase().replace(/\W+/g, "_"),
  label,
  fieldType,
  required: true,
  options: [],
  maxLength: null,
  ...extra,
});

describe("channel discovery", () => {
  it("ranks the ATS API channel first and recognises ATS hosts", () => {
    expect(providerFromUrl("https://jobs.ashbyhq.com/sarvam/123")).toBe("ASHBY");
    expect(providerFromUrl("https://boards.greenhouse.io/figma/jobs/1")).toBe("GREENHOUSE");
    const channels = detectChannels({
      sourceKey: "GREENHOUSE",
      jobUrl: "https://boards.greenhouse.io/x/jobs/1",
      applicationUrl: null,
      description: null,
      officialPages: [],
    });
    expect(channels[0]).toMatchObject({
      channelType: "ATS",
      provider: "GREENHOUSE",
      verificationStatus: "SOURCE_VERIFIED",
    });
  });

  it("uses only emails the posting presents as the way to apply", () => {
    const found = extractEmails(
      "To apply, send your CV to careers@fixture.test. For privacy requests write to privacy@fixture.test.",
    );
    expect(found.find((f) => f.email === "careers@fixture.test")?.kind).toBe("APPLICATION");
    expect(found.find((f) => f.email === "privacy@fixture.test")?.kind).not.toBe("APPLICATION");
  });

  it("falls back to manual when nothing is known (never invents a channel)", () => {
    const channels = detectChannels({
      sourceKey: null,
      jobUrl: null,
      applicationUrl: null,
      description: "Great team.",
      officialPages: [],
    });
    expect(
      channels.every((c) => c.channelType === "MANUAL_APPLICATION" || c.channelType === "UNKNOWN"),
    ).toBe(true);
  });

  it("the test adapter is only chosen for the configured fixture origin", () => {
    const ch = {
      channelType: "APPLICATION_FORM",
      provider: "OTHER",
      url: "http://127.0.0.1:4010/apply",
    };
    expect(selectAdapter(ch, "http://127.0.0.1:4010").id).toBe("TEST_FIXTURE");
    expect(selectAdapter(ch, null).id).toBe("GENERIC_WEB_FORM");
    expect(
      selectAdapter(
        { channelType: "ATS", provider: "ASHBY", url: "https://jobs.ashbyhq.com/x" },
        "http://127.0.0.1:4010",
      ).id,
    ).toBe("ASHBY");
  });
});

describe("field mapping", () => {
  it("fills identity fields from the profile and files from the approved export", () => {
    expect(mapField(field("First name"), candidate)).toMatchObject({
      value: "Asha",
      status: "MAPPED",
    });
    expect(mapField(field("Email", "EMAIL"), candidate)).toMatchObject({
      value: "asha@example.test",
      confidence: "EXACT",
    });
    expect(mapField(field("Resume/CV", "FILE"), candidate)).toMatchObject({
      mappingType: "RESUME",
      value: { exportId: "e1" },
    });
  });

  it("never guesses legal, salary, demographic or consent answers", () => {
    const auth = mapField(
      field("Are you legally authorized to work in Germany?", "YES_NO", { options: ["Yes", "No"] }),
      candidate,
    );
    expect(auth.value).toBeNull();
    expect(auth.status).toBe("NEEDS_USER_INPUT");
    expect(mapField(field("Expected salary"), candidate).value).toBeNull();
    expect(
      mapField(
        field("Gender", "SELECT", { options: ["Woman", "Man"], classificationHint: "DEMOGRAPHIC" }),
        candidate,
      ).value,
    ).toBeNull();
    expect(
      mapField(
        field("I certify the information is accurate", "CHECKBOX", {
          classificationHint: "CONSENT",
        }),
        candidate,
      ).value,
    ).toBeNull();
  });

  it("routes custom questions to the question engine and never rates skills", () => {
    expect(
      mapField(field("Why do you want to work on this team?", "TEXTAREA"), candidate),
    ).toMatchObject({ mappingType: "GENERATED_ANSWER", needsQuestion: true });
    const rating = mapField(
      field("How would you rate your Python proficiency?", "SELECT", {
        options: ["Beginner", "Expert"],
        required: false,
      }),
      candidate,
    );
    expect(rating.value).toBeNull();
  });
});

describe("question engine", () => {
  it("classifies sensitive questions as not generatable", () => {
    expect(classifyQuestion("Do you require visa sponsorship?").generatable).toBe(false);
    expect(classifyQuestion("What are your salary expectations?").generatable).toBe(false);
    expect(classifyQuestion("What is your gender?").generatable).toBe(false);
    expect(classifyQuestion("Why do you want to work on this role?").generatable).toBe(true);
    expect(classifyQuestion("Tell us about a project you are proud of").generatable).toBe(true);
  });

  it("fits answers to limits at sentence boundaries only", () => {
    expect(fitToLimit("First sentence here. Second sentence is longer.", 25)).toBe(
      "First sentence here.",
    );
    expect(fitToLimit("One very long sentence without an early stop at all", 10)).toBeNull();
    expect(fitToLimit("Short.", 100)).toBe("Short.");
  });

  it("drops unsupported sentences (fabricated metrics, unconfirmed skills) from drafts", () => {
    const corpus: EvidenceCorpus = {
      facts: [
        {
          ref: "experience:1",
          kind: "experience",
          text: "Frontend Developer at Test Studio. Built React dashboards with TypeScript for client accounts.",
        },
      ],
      research: [],
      job: { title: "Frontend Engineer", company: "Fixture Co", text: "React" },
      userContext: null,
      candidateName: "Asha Rao",
      recipient: { name: null, title: null, company: null },
    };
    const r = auditAnswer(
      "I built React dashboards with TypeScript for client accounts. I increased revenue by 300% using AWS.",
      corpus,
      { drop: true, maxLength: 600 },
    );
    expect(r.text).toContain("React dashboards");
    expect(r.text).not.toContain("300%");
    expect(r.text).not.toContain("AWS");
    expect(r.dropped.length).toBe(1);
  });
});

describe("Greenhouse (official Job Board API)", () => {
  it("maps questions, skips hidden inputs and marks compliance as demographic", () => {
    const r = parseGreenhouseQuestions({
      absolute_url: "https://boards.greenhouse.io/x/jobs/1",
      questions: [
        {
          label: "First Name",
          required: true,
          fields: [{ name: "first_name", type: "input_text", values: [] }],
        },
        {
          label: "Resume/CV",
          required: true,
          fields: [
            { name: "resume", type: "input_file", values: [] },
            { name: "resume_text", type: "textarea", values: [] },
          ],
        },
        {
          label: "Hidden",
          required: false,
          fields: [{ name: "token", type: "input_hidden", values: [] }],
        },
      ],
      compliance: [
        {
          type: "eeoc",
          questions: [
            {
              label: "Gender",
              required: false,
              fields: [
                {
                  name: "gender",
                  type: "multi_value_single_select",
                  values: [{ label: "Female", value: 1 }],
                },
              ],
            },
          ],
        },
      ],
    } as never);
    expect(r.fields.map((f) => f.externalFieldId)).toEqual(
      expect.arrayContaining(["first_name", "resume", "gender"]),
    );
    expect(r.fields.find((f) => f.externalFieldId === "token")).toBeUndefined();
    expect(r.fields.find((f) => f.externalFieldId === "gender")?.classificationHint).toBe(
      "DEMOGRAPHIC",
    );
    expect(r.fields.find((f) => f.externalFieldId === "resume_text")?.required).toBe(false);
  });
});

describe("form drift", () => {
  it("a new required field or relabelled question is a significant change", () => {
    const base = [
      {
        externalFieldId: "why",
        label: "Why this team?",
        fieldType: "TEXTAREA",
        required: true,
        options: [],
      },
    ];
    expect(formDrift(base, base).changedSignificantly).toBe(false);
    expect(
      formDrift(base, [
        ...base,
        {
          externalFieldId: "salary",
          label: "Salary",
          fieldType: "TEXT",
          required: true,
          options: [],
        },
      ]).changedSignificantly,
    ).toBe(true);
    expect(
      formDrift(base, [{ ...base[0]!, label: "What excites you about this role?" }])
        .changedSignificantly,
    ).toBe(true);
  });
});

describe("browser safety", () => {
  it("blocks private, local and non-web targets unless the origin is the trusted fixture", async () => {
    expect(checkUrlSyntax("file:///etc/passwd").ok).toBe(false);
    expect(checkUrlSyntax("javascript:alert(1)").ok).toBe(false);
    expect(checkUrlSyntax("http://localhost:3000/").ok).toBe(false);
    expect(checkUrlSyntax("http://169.254.169.254/latest/meta-data").ok).toBe(false);
    expect(checkUrlSyntax("http://10.0.0.5/").ok).toBe(false);
    expect(checkUrlSyntax("https://user:pw@example.com/").ok).toBe(false);
    expect(checkUrlSyntax("https://example.com:8443/").ok).toBe(false);
    expect(checkUrlSyntax("https://jobs.ashbyhq.com/x").ok).toBe(true);
    expect(
      checkUrlSyntax("http://127.0.0.1:4010/apply", { trustedOrigins: ["http://127.0.0.1:4010"] })
        .ok,
    ).toBe(true);
    expect(
      (
        await checkNavigationTarget("http://127.0.0.1:4011/apply", {
          trustedOrigins: ["http://127.0.0.1:4010"],
        })
      ).ok,
    ).toBe(false);
  });

  it("detects confirmations, rejections and unknown outcomes from the page", () => {
    expect(
      detectSubmissionOutcome({
        url: "https://x/thanks",
        previousUrl: "https://x/apply",
        text: "Thank you for applying! Application ID: FIX-1001",
        invalidFields: 0,
      }),
    ).toMatchObject({ outcome: "CONFIRMED", confirmationId: "FIX-1001" });
    expect(
      detectSubmissionOutcome({
        url: "https://x/apply",
        previousUrl: "https://x/apply",
        text: "Please correct the errors: email is required.",
        invalidFields: 0,
      }).outcome,
    ).toBe("REJECTED");
    expect(
      detectSubmissionOutcome({
        url: "https://x/apply",
        previousUrl: "https://x/apply",
        text: "Loading…",
        invalidFields: 0,
      }).outcome,
    ).toBe("UNKNOWN");
  });
});
