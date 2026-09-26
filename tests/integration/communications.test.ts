import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveCommunicationVersion,
  archiveCommunication,
  createCommunication,
  deleteSignaturePreset,
  getCommunicationWorkspace,
  listCommunications,
  listSignaturePresets,
  restoreCommunicationVersion,
  revokeCommunicationApproval,
  runCommunicationCheck,
  saveCommunicationContent,
  saveSignaturePreset,
  setCommunicationVersionStatus,
  updateCommunicationSettings,
} from "@/modules/communications/communication.service";
import { parseCommunicationDocument, type EmailDocument } from "@/modules/communications/document";
import { encryptField } from "@/server/crypto";
import { withUserContext } from "@/server/db";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

let db: TestDb;
let a: { userId: string };
let b: { userId: string };
let jobId = "";

// Synthetic, isolated test users + job (test database only).
async function candidate(label: string) {
  const user = await createTestUser(db.prisma, label);
  await db.prisma.candidateProfile.create({
    data: {
      userId: user.userId,
      fullName: `${label} Person`,
      professionalEmailEnc: encryptField(`${label.replace(/\s/g, "").toLowerCase()}@example.test`),
    },
  });
  await db.prisma.candidateSkill.create({
    data: {
      userId: user.userId,
      name: "React",
      nameNormalized: "react",
      category: "WEB",
      verificationStatus: "USER_PROVIDED",
      sourceType: "MANUAL_ENTRY",
    },
  });
  return user;
}

beforeAll(async () => {
  db = await startTestDb();
  a = await candidate("Comm A");
  b = await candidate("Comm B");
  const company = await db.prisma.company.create({
    data: { name: "Comm Test Co", nameNormalized: "comm test co" },
  });
  jobId = (
    await db.prisma.job.create({
      data: {
        companyId: company.id,
        sourceKey: "ASHBY",
        sourceType: "ATS_PUBLIC_API",
        sourceStatus: "DISCOVERED",
        title: "Frontend Engineer",
        normalizedTitle: "frontend engineer",
        description: "Requirements\n• React",
        locationRaw: "Remote",
        remoteStatus: "REMOTE",
        employmentType: "FULL_TIME",
        jobUrl: "https://example.test/comm-job/1",
        contentHash: "c".repeat(64),
        visibility: "PUBLIC",
      },
    })
  ).id;
});
afterAll(async () => db.stop());

const completeBody = [
  "I build React interfaces, which is the core of the Frontend Engineer role at Comm Test Co.",
  "I would welcome the chance to talk about the role.",
];

describe("create & read", () => {
  it("creates an email with a neutral skeleton, locked context and no invented recipient", async () => {
    const c = await createCommunication(a, { communicationType: "APPLICATION_EMAIL", jobId });
    expect(c).toMatchObject({
      kind: "EMAIL",
      recipientType: "UNKNOWN",
      recipientName: null,
      recipientCompany: "Comm Test Co",
      tone: "NATURAL",
    });
    const ws = await getCommunicationWorkspace(a, c.id);
    expect(ws.version).toMatchObject({
      versionNumber: 1,
      status: "DRAFT",
      contentSource: "USER_AUTHORED",
    });
    expect(ws.version!.contextHash).toMatch(/^[0-9a-f]{64}$/);
    const doc = ws.doc as EmailDocument;
    expect(doc).toMatchObject({
      subject: "Application — Frontend Engineer",
      greeting: "Dear Hiring Team,",
      bodyParagraphs: [],
      signature: "Comm A Person",
    });
  });

  it("creates a cover letter whose header uses only profile facts", async () => {
    const c = await createCommunication(a, {
      communicationType: "COVER_LETTER",
      jobId,
      recipientName: "Priya Shah",
      recipientType: "HIRING_MANAGER",
    });
    const ws = await getCommunicationWorkspace(a, c.id);
    expect(ws.communication.template).toBe("CLASSIC");
    expect(ws.doc).toMatchObject({
      kind: "COVER_LETTER",
      greeting: "Dear Priya Shah,",
      header: { name: "Comm A Person", email: "comma@example.test", phone: null },
      recipient: { company: "Comm Test Co" },
    });
  });

  it("lists by filter; another user sees nothing and cannot open or edit it", async () => {
    expect((await listCommunications(a, "emails")).every((c) => c.kind === "EMAIL")).toBe(true);
    expect((await listCommunications(a, "cover-letters")).length).toBeGreaterThan(0);
    expect(await listCommunications(b)).toHaveLength(0);
    const [mine] = await listCommunications(a);
    await expect(getCommunicationWorkspace(b, mine!.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      saveCommunicationContent(b, mine!.id, { content: {}, expectedHash: "0".repeat(64) }),
    ).rejects.toBeTruthy();
    // RLS: even a raw query in B's context returns nothing.
    expect(
      await withUserContext(b.userId, (t) =>
        t.communicationVersion.count({ where: { communicationId: mine!.id } }),
      ),
    ).toBe(0);
  });

  it("rejects an invalid recipient email and a foreign resume version", async () => {
    await expect(
      createCommunication(a, {
        communicationType: "RECRUITER_OUTREACH",
        recipientEmail: "not-an-email",
      }),
    ).rejects.toBeTruthy();
    await expect(
      createCommunication(a, {
        communicationType: "RECRUITER_OUTREACH",
        resumeVersionId: "01a0ddbc-89e7-70bb-ad18-c604607771f9",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("versioning & approval", () => {
  it("edits drafts in place with optimistic concurrency, gates approval, locks approved content", async () => {
    const c = await createCommunication(a, { communicationType: "APPLICATION_EMAIL", jobId });
    let ws = await getCommunicationWorkspace(a, c.id);
    const v1 = ws.version!;

    // An incomplete draft cannot be approved.
    await expect(approveCommunicationVersion(a, v1.id, v1.contentHash)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const doc = { ...(ws.doc as EmailDocument), bodyParagraphs: completeBody };
    await expect(
      saveCommunicationContent(a, c.id, { content: doc, expectedHash: "f".repeat(64) }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const saved = await saveCommunicationContent(a, c.id, {
      content: doc,
      expectedHash: v1.contentHash,
    });
    expect(saved).toMatchObject({ created: false, unchanged: false });
    expect(saved.version.id).toBe(v1.id);

    const check = await runCommunicationCheck(a, v1.id);
    expect(check.cached).toBe(false);
    expect((check.check.summary as { critical: number }).critical).toBe(0);
    expect((await runCommunicationCheck(a, v1.id)).cached).toBe(true);

    await setCommunicationVersionStatus(a, v1.id, "READY_FOR_REVIEW");
    await expect(approveCommunicationVersion(a, v1.id, v1.contentHash)).rejects.toMatchObject({
      code: "CONFLICT",
    }); // stale hash
    const first = await approveCommunicationVersion(a, v1.id, saved.version.contentHash);
    const again = await approveCommunicationVersion(a, v1.id, saved.version.contentHash);
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);

    // Direct mutation of approved content is blocked by the database trigger.
    await expect(
      withUserContext(a.userId, (t) =>
        t.communicationVersion.update({
          where: { id: v1.id },
          data: { plainText: "tampered", contentHash: "e".repeat(64) },
        }),
      ),
    ).rejects.toBeTruthy();
    // No DELETE grant on versions.
    await expect(
      withUserContext(a.userId, (t) => t.communicationVersion.delete({ where: { id: v1.id } })),
    ).rejects.toBeTruthy();

    // Editing an approved version creates a new DRAFT version; the approval stays on v1.
    const edited = await saveCommunicationContent(a, c.id, {
      content: { ...doc, closing: "Best regards," },
      expectedHash: saved.version.contentHash,
    });
    expect(edited.created).toBe(true);
    expect(edited.version).toMatchObject({
      versionNumber: 2,
      status: "DRAFT",
      parentVersionId: v1.id,
      versionType: "MANUAL_EDIT",
    });
    ws = await getCommunicationWorkspace(a, c.id, v1.id);
    expect(ws.version!.status).toBe("APPROVED");
    expect(ws.isHead).toBe(false);

    // Restore v1 as a new version (never overwrites history).
    const restored = await restoreCommunicationVersion(a, v1.id);
    expect(restored).toMatchObject({
      versionNumber: 3,
      versionType: "RESTORED",
      contentHash: saved.version.contentHash,
      status: "DRAFT",
    });

    await revokeCommunicationApproval(a, v1.id, "changed my mind");
    expect(
      await withUserContext(a.userId, (t) =>
        t.communicationApproval.count({ where: { versionId: v1.id, revokedAt: null } }),
      ),
    ).toBe(0);
  });

  it("an unsupported statement in the text blocks approval (claims are re-derived from the text)", async () => {
    const c = await createCommunication(a, { communicationType: "APPLICATION_EMAIL", jobId });
    const ws = await getCommunicationWorkspace(a, c.id);
    const saved = await saveCommunicationContent(a, c.id, {
      content: {
        ...(ws.doc as EmailDocument),
        bodyParagraphs: [...completeBody, "I led a team of 12 engineers."],
      },
      expectedHash: ws.version!.contentHash,
    });
    await expect(
      approveCommunicationVersion(a, saved.version.id, saved.version.contentHash),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const claims = await withUserContext(a.userId, (t) =>
      t.communicationClaim.findMany({
        where: { versionId: saved.version.id, status: "UNSUPPORTED" },
      }),
    );
    expect(claims.map((x) => x.text)).toEqual(["I led a team of 12 engineers."]);
  });

  it("archived communications are read-only until restored", async () => {
    const c = await createCommunication(a, { communicationType: "CUSTOM_EMAIL" });
    const ws = await getCommunicationWorkspace(a, c.id);
    await archiveCommunication(a, c.id, true);
    expect((await listCommunications(a, "archived")).some((x) => x.id === c.id)).toBe(true);
    await expect(
      saveCommunicationContent(a, c.id, {
        content: { ...(ws.doc as EmailDocument), subject: "x" },
        expectedHash: ws.version!.contentHash,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await archiveCommunication(a, c.id, false);
    await updateCommunicationSettings(a, c.id, { tone: "DIRECT", recipientName: "Priya" });
    expect((await getCommunicationWorkspace(a, c.id)).communication).toMatchObject({
      tone: "DIRECT",
      recipientName: "Priya",
      status: "ACTIVE",
    });
  });
});

describe("signature presets", () => {
  it("one default per user; fields chosen by the user feed new drafts", async () => {
    const p1 = await saveSignaturePreset(a, {
      name: "Short",
      isDefault: true,
      fields: { name: "Comm A Person", email: "comma@example.test" },
    });
    const p2 = await saveSignaturePreset(a, {
      name: "Full",
      isDefault: true,
      fields: { name: "Comm A Person", phone: "+91 90000 00000" },
    });
    const presets = await listSignaturePresets(a);
    expect(presets.filter((p) => p.isDefault).map((p) => p.id)).toEqual([p2.id]);
    const c = await createCommunication(a, { communicationType: "APPLICATION_EMAIL" });
    const doc = parseCommunicationDocument(
      (await getCommunicationWorkspace(a, c.id)).version!.content,
    );
    expect(doc.signature).toBe("Comm A Person\n+91 90000 00000");
    await expect(deleteSignaturePreset(b, p1.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deleteSignaturePreset(a, p1.id);
    expect(await listSignaturePresets(a)).toHaveLength(1);
  });
});
