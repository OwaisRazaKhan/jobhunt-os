import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  approveCandidate,
  bulkApproveCandidates,
  bulkRejectCandidates,
  createFact,
  deleteDocument,
  getCandidateOverview,
  getDocument,
  getDocumentDownload,
  getProfile,
  listDocuments,
  listFacts,
  listPendingCandidates,
  processDocument,
  rejectCandidate,
  uploadDocument,
} from "@/modules/candidate";
import { setProvidersForTests } from "@/server/ai/router";
import { AppError } from "@/server/errors";
import type { AiProvider, StructuredRequest } from "@/server/ai/types";
import { makeDocx, makePdf, SYNTHETIC_CV_LINES } from "../support/fixtures";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

let db: TestDb;
const enc = (s: string) => new TextEncoder().encode(s);
const CV_TEXT = SYNTHETIC_CV_LINES.join("\n");

beforeAll(async () => {
  db = await startTestDb();
});
afterAll(async () => db.stop());
afterEach(() => setProvidersForTests(undefined));

function fakeProvider(
  respond: (req: StructuredRequest) => unknown,
): AiProvider & { calls: StructuredRequest[] } {
  const calls: StructuredRequest[] = [];
  return {
    id: "fake",
    local: true,
    calls,
    async generateStructured(req) {
      calls.push(req);
      const json = respond(req);
      if (json instanceof Error) throw json;
      return { json, usage: { inputTokens: 10, outputTokens: 5 }, model: req.model };
    },
    async health(model) {
      return { ok: true, model, modelAvailable: true, status: "READY" as const };
    },
  };
}

describe("document upload validation", () => {
  it("stores the file under a server-generated key and records metadata", async () => {
    const user = await createTestUser(db.prisma);
    const doc = await uploadDocument(user, {
      fileName: "../../etc/My CV.txt",
      bytes: enc(CV_TEXT),
      documentType: "CV_RESUME",
    });
    expect(doc.fileName).toBe("My CV.txt");
    expect(doc.fileType).toBe("txt");
    expect(doc.status).toBe("UPLOADED");
    const profile = await getProfile(user);
    expect(doc.storagePath).toBe(`${user.userId}/${profile!.id}/${doc.id}/original`);
    expect(db.storage.files.has(doc.storagePath)).toBe(true);
  });

  it("rejects unsupported, spoofed, empty, oversized and duplicate files", async () => {
    const user = await createTestUser(db.prisma);
    const upload = (fileName: string, bytes: Uint8Array) =>
      uploadDocument(user, { fileName, bytes, documentType: "CV_RESUME" });
    await expect(upload("cv.exe", enc("MZ binary"))).rejects.toMatchObject({
      publicMessage: expect.stringMatching(/Unsupported file type/),
    });
    await expect(upload("cv.pdf", enc("not really a pdf"))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(upload("cv.txt", new Uint8Array([0x00, 0x01, 0x02]))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(upload("cv.txt", new Uint8Array())).rejects.toMatchObject({
      publicMessage: "The file is empty.",
    });
    await expect(upload("cv.txt", new Uint8Array(11 * 1024 * 1024).fill(65))).rejects.toMatchObject(
      { publicMessage: expect.stringMatching(/too large/) },
    );
    await upload("cv.txt", enc("Synthetic duplicate check content."));
    await expect(
      upload("copy.txt", enc("Synthetic duplicate check content.")),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      uploadDocument(user, {
        fileName: "x.txt",
        bytes: enc("abc def ghi jkl"),
        documentType: "PASSPORT",
      }),
    ).rejects.toBeTruthy();
  });
});

describe("document processing (rule-based, AI offline)", () => {
  it("extracts TXT and stages facts as NEEDS_REVIEW without touching the profile", async () => {
    const user = await createTestUser(db.prisma);
    const doc = await uploadDocument(user, {
      fileName: "cv.txt",
      bytes: enc(CV_TEXT),
      documentType: "CV_RESUME",
    });
    const result = await processDocument(user, doc.id);
    expect(result.status).toBe("PROCESSED");
    expect(result.aiStatus).toBe("DISABLED");
    expect(result.aiMessage).toMatch(/AI extraction is currently unavailable/);
    expect(result.candidates).toBeGreaterThan(5);

    const pending = await listPendingCandidates(user);
    expect(
      pending.every((c) => c.proposedStatus === "NEEDS_REVIEW" && c.status === "PENDING"),
    ).toBe(true);
    expect(pending.map((c) => c.category)).toEqual(
      expect.arrayContaining(["profile", "experience", "education", "skill", "language"]),
    );
    // Nothing enters the knowledge base before review.
    expect(await listFacts(user, "skill")).toEqual([]);
    expect((await getProfile(user))?.fullName ?? null).toBeNull();

    const { document } = await getDocument(user, doc.id);
    expect(document.status).toBe("PROCESSED");
    expect(document.extractedText).toContain("Test University");
  });

  it("extracts real PDF and DOCX files", async () => {
    const user = await createTestUser(db.prisma);
    const pdf = await uploadDocument(user, {
      fileName: "cv.pdf",
      bytes: makePdf(SYNTHETIC_CV_LINES),
      documentType: "CV_RESUME",
    });
    const pdfResult = await processDocument(user, pdf.id);
    expect(pdfResult.status).toBe("PROCESSED");
    const docx = await uploadDocument(user, {
      fileName: "cv.docx",
      bytes: await makeDocx(SYNTHETIC_CV_LINES),
      documentType: "CV_RESUME",
    });
    const docxResult = await processDocument(user, docx.id);
    expect(docxResult.status).toBe("PROCESSED");
    const pending = await listPendingCandidates(user, { documentId: docx.id });
    expect(pending.some((c) => c.category === "education")).toBe(true);
    expect((await getDocument(user, pdf.id)).document.extractedText).toContain("Test University");
  });

  it("fails clearly (no invented content) when no text can be extracted", async () => {
    const user = await createTestUser(db.prisma);
    const doc = await uploadDocument(user, {
      fileName: "blank.pdf",
      bytes: makePdf([" "]),
      documentType: "CV_RESUME",
    });
    const result = await processDocument(user, doc.id);
    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toMatch(/No readable text/);
    expect(await listPendingCandidates(user)).toEqual([]);
    const { document } = await getDocument(user, doc.id);
    expect(document.status).toBe("FAILED");
    expect(document.errorCode).toBe("EMPTY_TEXT");
  });

  it("reprocessing replaces pending candidates instead of duplicating them", async () => {
    const user = await createTestUser(db.prisma);
    const doc = await uploadDocument(user, {
      fileName: "cv.txt",
      bytes: enc(CV_TEXT),
      documentType: "CV_RESUME",
    });
    const first = await processDocument(user, doc.id);
    const second = await processDocument(user, doc.id);
    expect(second.candidates).toBe(first.candidates);
    expect((await listPendingCandidates(user)).length).toBe(first.candidates);
  });

  it("flags likely duplicates of existing records (LeadZing vs Lead Zing)", async () => {
    const user = await createTestUser(db.prisma);
    await createFact(user, "experience", { organization: "Test  company", title: "Founder" });
    const doc = await uploadDocument(user, {
      fileName: "cv.txt",
      bytes: enc(CV_TEXT),
      documentType: "CV_RESUME",
    });
    await processDocument(user, doc.id);
    const exp = (await listPendingCandidates(user)).find((c) => c.category === "experience");
    expect(exp?.duplicateOf).toMatchObject({
      kind: "experience",
      label: "Founder — Test  company",
    });
  });

  it("download returns bytes (local/memory storage) and delete removes file but keeps approved facts", async () => {
    const user = await createTestUser(db.prisma);
    const doc = await uploadDocument(user, {
      fileName: "cv.txt",
      bytes: enc(CV_TEXT),
      documentType: "CV_RESUME",
    });
    await processDocument(user, doc.id);
    const skill = (await listPendingCandidates(user)).find((c) => c.category === "skill")!;
    await approveCandidate(user, skill.id, { mode: "verify" });

    const download = await getDocumentDownload(user, doc.id);
    expect(download.kind).toBe("bytes");

    await deleteDocument(user, doc.id);
    expect(db.storage.files.has(doc.storagePath)).toBe(false);
    expect((await listDocuments(user)).length).toBe(0);
    const [fact] = await listFacts(user, "skill");
    expect(fact.sourceDocumentId).toBeNull();
    expect(fact.sourceType).toBe("CV_IMPORT");
    expect(fact.sourceExcerpt).toBeTruthy();
  });
});

describe("fact review center", () => {
  it("approve -> VERIFIED with CV provenance; edit -> edited values; reject -> nothing saved", async () => {
    const user = await createTestUser(db.prisma);
    const doc = await uploadDocument(user, {
      fileName: "cv.txt",
      bytes: enc(CV_TEXT),
      documentType: "CV_RESUME",
    });
    await processDocument(user, doc.id);
    const pending = await listPendingCandidates(user);

    const edu = pending.find((c) => c.category === "education")!;
    await approveCandidate(user, edu.id, { mode: "verify" });
    const [education] = await listFacts(user, "education");
    expect(education).toMatchObject({
      institution: "Test University",
      verificationStatus: "VERIFIED",
      sourceType: "CV_IMPORT",
      sourceDocumentId: doc.id,
      sourceFactCandidateId: edu.id,
    });
    expect(education.sourceExcerpt).toContain("Test University");

    const exp = pending.find((c) => c.category === "experience")!;
    await approveCandidate(user, exp.id, {
      mode: "verify",
      editedPayload: {
        ...(exp.payload as object),
        title: "Co-founder",
        organization: "Test Company",
      },
    });
    expect((await listFacts(user, "experience"))[0]).toMatchObject({
      title: "Co-founder",
      verificationStatus: "VERIFIED",
    });

    const name = pending.find(
      (c) => c.category === "profile" && (c.payload as { field: string }).field === "fullName",
    )!;
    await approveCandidate(user, name.id, { mode: "verify" });
    expect((await getProfile(user))?.fullName).toBe("Test Candidate");

    const lang = pending.find((c) => c.category === "language")!;
    await rejectCandidate(user, lang.id);
    expect(await listFacts(user, "language")).toEqual([]);

    await expect(approveCandidate(user, lang.id, { mode: "verify" })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    const actions = (await db.prisma.auditLog.findMany({ where: { userId: user.userId } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        "document_uploaded",
        "document_processed",
        "fact_created",
        "fact_approved",
        "fact_edited",
        "fact_rejected",
        "fact_verified",
      ]),
    );
  });

  it("invalid edits are rejected and nothing is saved", async () => {
    const user = await createTestUser(db.prisma);
    const doc = await uploadDocument(user, {
      fileName: "cv.txt",
      bytes: enc(CV_TEXT),
      documentType: "CV_RESUME",
    });
    await processDocument(user, doc.id);
    const exp = (await listPendingCandidates(user)).find((c) => c.category === "experience")!;
    await expect(
      approveCandidate(user, exp.id, { mode: "verify", editedPayload: { title: "" } }),
    ).rejects.toBeTruthy();
    expect(await listFacts(user, "experience")).toEqual([]);
    expect((await listPendingCandidates(user)).some((c) => c.id === exp.id)).toBe(true);
  });

  it("bulk add only approves safe candidates, as USER_PROVIDED (never VERIFIED)", async () => {
    const user = await createTestUser(db.prisma);
    await createFact(user, "skill", { name: "React" });
    const doc = await uploadDocument(user, {
      fileName: "cv.txt",
      bytes: enc(CV_TEXT),
      documentType: "CV_RESUME",
    });
    await processDocument(user, doc.id);
    const pending = await listPendingCandidates(user);
    const result = await bulkApproveCandidates(
      user,
      pending.map((c) => c.id),
    );

    expect(result.approved.length).toBeGreaterThan(0);
    const skipped = new Map(result.skipped.map((s) => [s.id, s.reason]));
    for (const c of pending) {
      if (c.category === "profile") expect(skipped.get(c.id)).toMatch(/individually/);
      if (c.duplicateOf) expect(skipped.get(c.id)).toMatch(/duplicate/);
    }
    const skills = await listFacts(user, "skill");
    const added = skills.filter((s) => s.sourceType === "CV_IMPORT");
    expect(added.length).toBeGreaterThan(0);
    expect(
      added.every((s) => s.verificationStatus === "USER_PROVIDED" && s.verifiedAt === null),
    ).toBe(true);

    const remaining = await listPendingCandidates(user);
    expect(
      (
        await bulkRejectCandidates(
          user,
          remaining.map((c) => c.id),
        )
      ).rejected,
    ).toBe(remaining.length);
    expect(await listPendingCandidates(user)).toEqual([]);
  });

  it("completeness and readiness update after review", async () => {
    const user = await createTestUser(db.prisma);
    const doc = await uploadDocument(user, {
      fileName: "cv.txt",
      bytes: enc(CV_TEXT),
      documentType: "CV_RESUME",
    });
    await processDocument(user, doc.id);
    const before = await getCandidateOverview(user);
    expect(before.pendingReview).toBeGreaterThan(0);
    expect(before.completeness.percent).toBe(0);
    for (const c of await listPendingCandidates(user))
      await approveCandidate(user, c.id, { mode: "verify" });
    const after = await getCandidateOverview(user);
    expect(after.pendingReview).toBe(0);
    expect(after.completeness.percent).toBeGreaterThan(before.completeness.percent);
    expect(after.warnings.some((w) => w.code === "PENDING_REVIEW")).toBe(false);
  });
});

describe("AI extraction (provider abstraction, Ollama-compatible)", () => {
  const validFact = {
    category: "project",
    title: "Test Project",
    organization: null,
    field: null,
    location: null,
    startDate: "2023",
    endDate: null,
    isCurrent: false,
    description: "Synthetic project described in the CV",
    items: ["Next.js"],
    url: null,
    level: null,
    excerpt: "Built websites for local clients",
    confidence: 0.95,
  };

  it("adds grounded AI facts as NEEDS_REVIEW candidates and records the generation", async () => {
    const provider = fakeProvider(() => ({ facts: [validFact] }));
    setProvidersForTests([provider]);
    const user = await createTestUser(db.prisma);
    const doc = await uploadDocument(user, {
      fileName: "cv.txt",
      bytes: enc(CV_TEXT),
      documentType: "CV_RESUME",
    });
    const result = await processDocument(user, doc.id);
    expect(result.aiStatus).toBe("COMPLETED");
    expect(provider.calls[0]!.jsonSchema).toHaveProperty("properties.facts");

    const ai = (await listPendingCandidates(user)).filter((c) => c.method === "AI");
    expect(ai).toHaveLength(1);
    expect(ai[0]).toMatchObject({ category: "project", proposedStatus: "NEEDS_REVIEW" });
    expect(ai[0]!.confidence).toBeLessThanOrEqual(0.8);
    const generation = await db.prisma.aiGeneration.findFirstOrThrow({
      where: { userId: user.userId },
    });
    expect(generation).toMatchObject({
      status: "SUCCEEDED",
      provider: "fake",
      agent: "CANDIDATE_EXTRACTION",
    });

    await approveCandidate(user, ai[0]!.id, { mode: "verify" });
    expect((await listFacts(user, "project"))[0]).toMatchObject({
      sourceType: "USER_APPROVED_AI_EXTRACTION",
    });
  });

  it("discards AI facts whose excerpt is not in the document (invented content)", async () => {
    setProvidersForTests([
      fakeProvider(() => ({
        facts: [{ ...validFact, excerpt: "Won a Nobel prize for marketing" }],
      })),
    ]);
    const user = await createTestUser(db.prisma);
    const doc = await uploadDocument(user, {
      fileName: "cv.txt",
      bytes: enc(CV_TEXT),
      documentType: "CV_RESUME",
    });
    await processDocument(user, doc.id);
    expect((await listPendingCandidates(user)).filter((c) => c.method === "AI")).toEqual([]);
  });

  it("schema-invalid AI output never enters the database as a fact; rule extraction still works", async () => {
    setProvidersForTests([
      fakeProvider(() => ({ facts: [{ category: "experience", verificationStatus: "VERIFIED" }] })),
    ]);
    const user = await createTestUser(db.prisma);
    const doc = await uploadDocument(user, {
      fileName: "cv.txt",
      bytes: enc(CV_TEXT),
      documentType: "CV_RESUME",
    });
    const result = await processDocument(user, doc.id);
    expect(result.status).toBe("PROCESSED");
    expect(result.aiStatus).toBe("SCHEMA_INVALID");
    expect(result.candidates).toBeGreaterThan(0);
    const pending = await listPendingCandidates(user);
    expect(pending.every((c) => c.method === "RULE")).toBe(true);
    const generation = await db.prisma.aiGeneration.findFirstOrThrow({
      where: { userId: user.userId },
    });
    expect(generation.status).toBe("SCHEMA_INVALID");
    expect(generation.output).toBeNull();
    expect(await db.prisma.candidateExperience.count({ where: { userId: user.userId } })).toBe(0);
  });

  it("AI offline: processing still succeeds with a clear message", async () => {
    setProvidersForTests([
      fakeProvider(
        () =>
          new AppError("AI_ERROR", {
            publicMessage:
              "AI extraction is currently unavailable. You can enter the information manually.",
          }),
      ),
    ]);
    const user = await createTestUser(db.prisma);
    const doc = await uploadDocument(user, {
      fileName: "cv.txt",
      bytes: enc(CV_TEXT),
      documentType: "CV_RESUME",
    });
    const result = await processDocument(user, doc.id);
    expect(result.status).toBe("PROCESSED");
    expect(result.aiStatus).toBe("UNAVAILABLE");
    expect(result.aiMessage).toMatch(/enter the information manually/);
  });

  it("private document content is never written to application logs", async () => {
    setProvidersForTests([fakeProvider(() => ({ facts: [validFact] }))]);
    const spies = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "info"),
    ];
    const previous = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "debug";
    try {
      const user = await createTestUser(db.prisma);
      const secretLine = "Unique private marker 7F3A9Q in candidate history";
      const doc = await uploadDocument(user, {
        fileName: "private.txt",
        bytes: enc(`${CV_TEXT}\n${secretLine}\n`),
        documentType: "CV_RESUME",
      });
      await processDocument(user, doc.id);
      const blank = await uploadDocument(user, {
        fileName: "blank.txt",
        bytes: enc(`${secretLine.slice(0, 5)}`.padEnd(3, " ") + "\n\n"),
        documentType: "OTHER",
      }).catch(() => null);
      if (blank) await processDocument(user, blank.id);
      const output = spies.flatMap((s) => s.mock.calls.map((call) => call.join(" "))).join("\n");
      expect(output).not.toContain("7F3A9Q");
      expect(output).not.toContain("test.candidate@example.com");
      expect(output).not.toContain("555 010");
    } finally {
      process.env.LOG_LEVEL = previous;
      spies.forEach((s) => s.mockRestore());
    }
  });
});
