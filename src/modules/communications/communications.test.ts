import { describe, expect, it } from "vitest";
import { parseCommunicationDocument, toPlainText } from "./document";
import { communicationContentHash, contextHash } from "./hash";
import { runQualityChecks, summarizeQuality, type QualityInput } from "./quality";
import { defaultGreeting, kindOf } from "./types";

const email = (over: Record<string, unknown> = {}) =>
  parseCommunicationDocument({
    kind: "EMAIL",
    subject: "Application — Frontend Engineer",
    greeting: "Dear Hiring Team,",
    bodyParagraphs: [
      "I build React interfaces with TypeScript and integrate REST APIs, which is the core of the Frontend Engineer role at Acme.",
      "At my current job I shipped a dashboard used by the sales team every day.",
    ],
    closing: "Kind regards,",
    signature: "Asha Rao",
    ...over,
  });

const ctx: QualityInput["context"] = {
  jobTitle: "Frontend Engineer",
  companyName: "Acme",
  candidateName: "Asha Rao",
  recipientName: null,
  length: "SHORT",
  resumeAssociated: false,
};

const codes = (input: Partial<QualityInput> & { doc: QualityInput["doc"] }) =>
  runQualityChecks({ context: ctx, claims: [], ...input }).map((f) => `${f.severity}:${f.code}`);

describe("communication document", () => {
  it("strips control characters, normalizes line endings and defaults schemaVersion", () => {
    const d = email({ subject: "Hi\u0007 there\r\n", bodyParagraphs: ["a\r\nb"] });
    expect(d.schemaVersion).toBe(1);
    expect(d.kind === "EMAIL" && d.subject).toBe("Hi there");
    expect(d.kind === "EMAIL" && d.bodyParagraphs[0]).toBe("a\nb");
  });

  it("rejects non-http links in a cover letter header and an unknown kind", () => {
    expect(() =>
      parseCommunicationDocument({
        kind: "COVER_LETTER",
        header: { links: ["javascript:alert(1)"] },
        greeting: "",
        closing: "",
        signature: "",
      }),
    ).toThrow();
    expect(() => parseCommunicationDocument({ kind: "SMS" })).toThrow();
  });

  it("renders clean plain text, with or without the subject", () => {
    const d = email();
    expect(toPlainText(d)).toMatch(
      /^Subject: Application — Frontend Engineer\n\nDear Hiring Team,/,
    );
    expect(toPlainText(d, { includeSubject: false })).not.toContain("Subject:");
    expect(toPlainText(d)).toMatch(/Kind regards,\nAsha Rao$/);
  });
});

describe("hashing", () => {
  it("ignores cosmetic whitespace but changes on any wording change", () => {
    const h = communicationContentHash(email());
    expect(communicationContentHash(email({ signature: "  Asha   Rao " }))).toBe(h);
    expect(communicationContentHash(email({ signature: "Asha R." }))).not.toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("context hash is key-order independent", () => {
    expect(contextHash({ a: 1, b: "x" })).toBe(contextHash({ b: "x", a: 1 }));
    expect(contextHash({ a: 1 })).not.toBe(contextHash({ a: 2 }));
  });
});

describe("greetings & kinds", () => {
  it("never invents a name", () => {
    expect(defaultGreeting(null, "UNKNOWN")).toBe("Dear Hiring Team,");
    expect(defaultGreeting("  ", "RECRUITER")).toBe("Dear Recruiter,");
    expect(defaultGreeting("Priya Shah", "HR")).toBe("Dear Priya Shah,");
    expect(kindOf("COVER_LETTER")).toBe("COVER_LETTER");
    expect(kindOf("RECRUITER_OUTREACH")).toBe("EMAIL");
  });
});

describe("quality engine", () => {
  it("a complete, grounded email has no critical findings", () => {
    const s = summarizeQuality(runQualityChecks({ doc: email(), context: ctx, claims: [] }));
    expect(s.critical).toBe(0);
    expect(s.passed).toBeGreaterThan(4);
  });

  it("missing subject, body and signature are critical", () => {
    const c = codes({ doc: email({ subject: "", bodyParagraphs: [], signature: "" }) });
    expect(c).toEqual(
      expect.arrayContaining([
        "CRITICAL:subject.missing",
        "CRITICAL:body.missing",
        "CRITICAL:signature.missing",
      ]),
    );
  });

  it("flags a greeting name the user never entered, fake familiarity and attachment claims", () => {
    const c = codes({
      doc: email({
        greeting: "Dear Rahul,",
        bodyParagraphs: [
          "As we discussed, I have attached my resume for the Frontend Engineer role at Acme.",
        ],
      }),
    });
    expect(c).toEqual(
      expect.arrayContaining([
        "CRITICAL:recipient.name_unknown",
        "CRITICAL:relationship.claim",
        "CRITICAL:attachment.claim",
      ]),
    );
    expect(
      codes({
        doc: email({ greeting: "Dear Rahul,", bodyParagraphs: ["x"] }),
        context: { ...ctx, recipientName: "Rahul" },
      }),
    ).toContain("PASS:recipient.name");
  });

  it("unsupported claims and unsourced company claims block; partial claims warn", () => {
    const c = codes({
      doc: email(),
      claims: [
        {
          location: "body:0",
          text: "Led a team of 12",
          claimKind: "CANDIDATE",
          status: "UNSUPPORTED",
        },
        { location: "body:1", text: "Acme raised $50M", claimKind: "COMPANY", status: "UNKNOWN" },
        {
          location: "body:1",
          text: "Shipped a dashboard",
          claimKind: "CANDIDATE",
          status: "PARTIALLY_SUPPORTED",
        },
      ],
    });
    expect(c).toEqual(
      expect.arrayContaining([
        "CRITICAL:claim.unsupported",
        "CRITICAL:company.unsourced",
        "WARNING:claim.partial",
      ]),
    );
  });

  it("reports generic openings, filler, missing company/role and length — never a 'human score'", () => {
    const findings = runQualityChecks({
      doc: email({
        subject: "Hello",
        bodyParagraphs: ["I am writing to express my interest. I am a results-driven team player."],
      }),
      context: { ...ctx, length: "STANDARD" },
      claims: [],
    });
    const c = findings.map((f) => f.code);
    expect(c).toEqual(
      expect.arrayContaining([
        "opening.generic",
        "filler",
        "company.missing",
        "role.missing",
        "length.short",
      ]),
    );
    expect(JSON.stringify(findings)).not.toMatch(/human|detector|ai[- ]?detect/i);
  });
});
