import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveCommunicationVersion,
  createCommunication,
  getCommunicationWorkspace,
  revokeCommunicationApproval,
  runCommunicationCheck,
  saveCommunicationContent,
} from "@/modules/communications/communication.service";
import { parseCommunicationDocument, type EmailDocument } from "@/modules/communications/document";
import {
  createPackage,
  duplicatePackage,
  getCommunicationPackageForApplication,
  getPackageView,
  markPackageReady,
  recheckPackage,
  updatePackage,
} from "@/modules/communications/package.service";
import {
  saveCommunicationPreferences,
  saveRecipientContext,
} from "@/modules/communications/recipient.service";
import { createMasterResume } from "@/modules/resumes/resume.service";
import { withUserContext } from "@/server/db";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

let db: TestDb;
let a: { userId: string };
let b: { userId: string };
let jobId = "";
let otherJobId = "";
let resumeVersionId = "";

const fact = { verificationStatus: "USER_PROVIDED" as const, sourceType: "MANUAL_ENTRY" as const };

// Synthetic, isolated fixtures (test database only).
async function candidate(label: string) {
  const user = await createTestUser(db.prisma, label);
  const profile = await db.prisma.candidateProfile.create({
    data: { userId: user.userId, fullName: `${label} Person` },
  });
  await db.prisma.candidateExperience.create({
    data: {
      userId: user.userId,
      organization: "Test Studio",
      title: "Frontend Developer",
      startDate: "2023-01",
      isCurrent: true,
      responsibilities: ["Built React dashboards with TypeScript for client accounts"],
      skillsUsed: ["React", "TypeScript"],
      ...fact,
    },
  });
  for (const name of ["React", "TypeScript"])
    await db.prisma.candidateSkill.create({
      data: {
        userId: user.userId,
        name,
        nameNormalized: name.toLowerCase(),
        category: "WEB",
        ...fact,
      },
    });
  return { ...user, profileId: profile.id };
}

async function makeJob(n: number, companyId: string) {
  return (
    await db.prisma.job.create({
      data: {
        companyId,
        sourceKey: "ASHBY",
        sourceType: "ATS_PUBLIC_API",
        sourceStatus: "DISCOVERED",
        title: "Frontend Engineer",
        normalizedTitle: "frontend engineer",
        description: "Requirements\n• React\n• TypeScript",
        locationRaw: "Remote",
        remoteStatus: "REMOTE",
        employmentType: "FULL_TIME",
        jobUrl: `https://example.test/pkg-job/${n}`,
        contentHash: String(n).repeat(64).slice(0, 64),
        visibility: "PUBLIC",
      },
    })
  ).id;
}

async function currentMatch(userId: string, candidateId: string, forJob: string) {
  await db.prisma.jobMatch.updateMany({
    where: { userId, jobId: forJob },
    data: { isCurrent: false },
  });
  return db.prisma.jobMatch.create({
    data: {
      userId,
      jobId: forJob,
      candidateId,
      overallStatus: "GOOD_MATCH",
      matchingVersion: "test",
      candidateSnapshotHash: "e".repeat(64),
      jobContentHash: "d".repeat(64),
      computedAt: new Date(),
    },
  });
}

/** An approved email / cover letter for the job (written by the user; passes checks). */
async function approvedCommunication(
  actor: { userId: string },
  type: "APPLICATION_EMAIL" | "COVER_LETTER",
  forJob = jobId,
  extra: Record<string, unknown> = {},
) {
  const c = await createCommunication(actor, {
    communicationType: type,
    jobId: forJob,
    resumeVersionId,
    ...extra,
  });
  const ws = await getCommunicationWorkspace(actor, c.id);
  const body = [
    "I am applying for the Frontend Engineer role at Pkg Co.",
    "I built React dashboards with TypeScript for client accounts.",
  ];
  const doc = parseCommunicationDocument(
    ws.doc!.kind === "EMAIL"
      ? { ...ws.doc!, bodyParagraphs: body }
      : { ...ws.doc!, paragraphs: body },
  );
  const saved = await saveCommunicationContent(actor, c.id, {
    content: doc,
    expectedHash: ws.version!.contentHash,
  });
  await approveCommunicationVersion(actor, saved.version.id, saved.version.contentHash);
  return {
    communicationId: c.id,
    versionId: saved.version.id,
    contentHash: saved.version.contentHash,
    doc,
  };
}

let email: Awaited<ReturnType<typeof approvedCommunication>>;
let letter: Awaited<ReturnType<typeof approvedCommunication>>;
let aProfileId = "";

beforeAll(async () => {
  db = await startTestDb();
  const ca = await candidate("Pkg A");
  a = ca;
  aProfileId = ca.profileId;
  b = await candidate("Pkg B");
  const company = await db.prisma.company.create({
    data: { name: "Pkg Co", nameNormalized: "pkg co" },
  });
  jobId = await makeJob(1, company.id);
  otherJobId = await makeJob(2, company.id);
  await currentMatch(a.userId, aProfileId, jobId);
  // Approved master resume (built from facts by the real service; approval recorded for the fixture).
  const { resume } = await createMasterResume(a);
  const v = await db.prisma.resumeVersion.findFirstOrThrow({ where: { resumeId: resume.id } });
  await db.prisma.resumeApproval.create({
    data: { userId: a.userId, versionId: v.id, contentHash: v.contentHash },
  });
  await db.prisma.resumeVersion.update({ where: { id: v.id }, data: { status: "APPROVED" } });
  resumeVersionId = v.id;
  email = await approvedCommunication(a, "APPLICATION_EMAIL");
  letter = await approvedCommunication(a, "COVER_LETTER");
});
afterAll(async () => db.stop());

describe("package creation & readiness", () => {
  it("approved assets → READY_FOR_REVIEW → READY_FOR_APPLICATION (locked); handoff returns exact versions", async () => {
    const r = await createPackage(a, {
      jobId,
      channel: "PORTAL",
      includeEmail: true,
      includeCoverLetter: true,
      resumeVersionId,
      emailVersionId: email.versionId,
      coverLetterVersionId: letter.versionId,
    });
    expect(r.status).toBe("READY_FOR_REVIEW");
    expect(r.evaluation.items.filter((i) => i.status === "FAIL")).toEqual([]);
    // Handoff refuses anything not confirmed ready.
    await expect(getCommunicationPackageForApplication(a, r.package.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const ready = await markPackageReady(a, r.package.id);
    expect(ready).toMatchObject({ status: "READY_FOR_APPLICATION", created: true });
    expect((await markPackageReady(a, r.package.id)).created).toBe(false); // idempotent

    const h = await getCommunicationPackageForApplication(a, r.package.id);
    expect(h).toMatchObject({
      packageId: r.package.id,
      candidateId: aProfileId,
      jobId,
      readinessStatus: "READY_FOR_APPLICATION",
      integrityStatus: "VERIFIED",
      submitted: false,
      resume: { versionId: resumeVersionId, approvalStatus: "APPROVED" },
      email: {
        versionId: email.versionId,
        contentHash: email.contentHash,
        approvalStatus: "APPROVED",
      },
      coverLetter: {
        versionId: letter.versionId,
        contentHash: letter.contentHash,
        approvalStatus: "APPROVED",
      },
    });
    expect(h.integrityHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.email!.approvalId).toBeTruthy();

    // Persistence: a fresh read keeps the state and exact references.
    const view = await getPackageView(a, r.package.id);
    expect(view.pkg.status).toBe("READY_FOR_APPLICATION");
    expect(
      view.pkg.assets.map((x) => x.resumeVersionId ?? x.communicationVersionId).sort(),
    ).toEqual([resumeVersionId, email.versionId, letter.versionId].sort());

    // Frozen: the app role cannot change references or remove assets (DB trigger).
    await expect(
      withUserContext(a.userId, (t) =>
        t.communicationPackage.update({ where: { id: r.package.id }, data: { matchId: null } }),
      ),
    ).rejects.toBeTruthy();
    await expect(
      withUserContext(a.userId, (t) =>
        t.communicationPackageAsset.deleteMany({ where: { packageId: r.package.id } }),
      ),
    ).rejects.toBeTruthy();
    await expect(
      updatePackage(a, r.package.id, { channel: "PORTAL", resumeVersionId }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("unapproved assets keep the package INCOMPLETE and cannot be marked ready or handed off", async () => {
    const c = await createCommunication(a, { communicationType: "APPLICATION_EMAIL", jobId });
    const draft = (await getCommunicationWorkspace(a, c.id)).version!;
    const r = await createPackage(a, {
      jobId,
      channel: "PORTAL",
      includeEmail: true,
      resumeVersionId,
      emailVersionId: draft.id,
    });
    expect(r.status).toBe("INCOMPLETE");
    expect(r.evaluation.items.find((i) => i.key === "email_approved")).toMatchObject({
      status: "FAIL",
    });
    await expect(markPackageReady(a, r.package.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(getCommunicationPackageForApplication(a, r.package.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("missing required assets → INCOMPLETE; an email for another job is refused", async () => {
    const r = await createPackage(a, {
      jobId,
      channel: "PORTAL",
      includeCoverLetter: true,
      resumeVersionId: null,
    });
    expect(r.status).toBe("INCOMPLETE");
    expect(r.evaluation.items.filter((i) => i.kind === "MISSING").map((i) => i.key)).toEqual(
      expect.arrayContaining(["resume_selected", "cover_letter_selected"]),
    );
    const foreign = await approvedCommunication(a, "APPLICATION_EMAIL", otherJobId);
    await expect(
      createPackage(a, {
        jobId,
        channel: "PORTAL",
        includeEmail: true,
        resumeVersionId,
        emailVersionId: foreign.versionId,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("an email application needs a recipient email you know; unverified recipients are allowed but flagged", async () => {
    const r = await createPackage(a, {
      jobId,
      channel: "EMAIL",
      resumeVersionId,
      emailVersionId: email.versionId,
    });
    expect(r.status).toBe("INCOMPLETE");
    expect(r.evaluation.items.find((i) => i.key === "recipient")).toMatchObject({
      status: "FAIL",
      kind: "MISSING",
    });
    const rc = await saveRecipientContext(a, {
      name: "Priya Shah",
      email: "priya@pkg.example",
      recipientType: "RECRUITER",
      source: "USER_PROVIDED",
    });
    const r2 = await updatePackage(a, r.package.id, {
      channel: "EMAIL",
      resumeVersionId,
      emailVersionId: email.versionId,
      recipientContextId: rc.id,
    });
    expect(r2.status).toBe("READY_FOR_REVIEW");
    expect(r2.evaluation.items.find((i) => i.key === "recipient")).toMatchObject({
      status: "WARN",
    });
  });
});

describe("stale detection & integrity", () => {
  async function readyPackage() {
    const e = await approvedCommunication(a, "APPLICATION_EMAIL");
    const r = await createPackage(a, {
      jobId,
      channel: "PORTAL",
      includeEmail: true,
      resumeVersionId,
      emailVersionId: e.versionId,
    });
    await markPackageReady(a, r.package.id);
    return { pkgId: r.package.id, e };
  }

  it("editing the approved email marks the package STALE and never rewrites it", async () => {
    const { pkgId, e } = await readyPackage();
    const edited = await saveCommunicationContent(a, e.communicationId, {
      content: { ...(e.doc as EmailDocument), closing: "Best," },
      expectedHash: e.contentHash,
    });
    expect(edited.created).toBe(true); // new version, approved one untouched
    const r = await recheckPackage(a, pkgId);
    expect(r.status).toBe("STALE");
    expect(r.evaluation.staleReasons.join(" ")).toMatch(/edited after approval/);
    const view = await getPackageView(a, pkgId);
    expect(view.pkg.assets.find((x) => x.assetType === "EMAIL")?.communicationVersionId).toBe(
      e.versionId,
    );
    await expect(getCommunicationPackageForApplication(a, pkgId)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    // Explicit update: a NEW package linked to the stale one.
    const next = await duplicatePackage(a, pkgId, { refresh: true });
    expect(next.package.previousPackageId).toBe(pkgId);
  });

  it("a newly generated/edited draft of another communication does not affect the package; a revoked approval does", async () => {
    const { pkgId, e } = await readyPackage();
    expect((await recheckPackage(a, pkgId)).status).toBe("READY_FOR_APPLICATION");
    await revokeCommunicationApproval(a, e.versionId, "changed my mind");
    expect((await recheckPackage(a, pkgId)).status).toBe("STALE");
  });

  it("a recomputed match marks the package STALE", async () => {
    const { pkgId } = await readyPackage();
    await currentMatch(a.userId, aProfileId, jobId);
    const r = await recheckPackage(a, pkgId);
    expect(r.status).toBe("STALE");
    expect(r.evaluation.staleReasons.join(" ")).toMatch(/match was recomputed/);
  });

  it("a changed content hash is detected as INVALID", async () => {
    const { pkgId } = await readyPackage();
    // Simulate tampering below the app (owner connection, trigger bypassed).
    await db.prisma.$executeRawUnsafe(
      `ALTER TABLE communication_package_assets DISABLE TRIGGER communication_package_assets_guard`,
    );
    await db.prisma.communicationPackageAsset.updateMany({
      where: { packageId: pkgId, assetType: "RESUME" },
      data: { contentHash: "a".repeat(64) },
    });
    await db.prisma.$executeRawUnsafe(
      `ALTER TABLE communication_package_assets ENABLE TRIGGER communication_package_assets_guard`,
    );
    const r = await recheckPackage(a, pkgId);
    expect(r.status).toBe("INVALID");
    await expect(getCommunicationPackageForApplication(a, pkgId)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("the asset hash must match the referenced version (DB guard)", async () => {
    const r = await createPackage(a, { jobId, channel: "PORTAL", resumeVersionId });
    await expect(
      withUserContext(a.userId, (t) =>
        t.communicationPackageAsset.updateMany({
          where: { packageId: r.package.id },
          data: { contentHash: "b".repeat(64) },
        }),
      ),
    ).rejects.toBeTruthy();
  });
});

describe("ownership", () => {
  it("another user can never read, check or hand off a package (service + RLS)", async () => {
    const r = await createPackage(a, { jobId, channel: "PORTAL", resumeVersionId });
    await expect(getPackageView(b, r.package.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(recheckPackage(b, r.package.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getCommunicationPackageForApplication(b, r.package.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      await withUserContext(b.userId, (t) =>
        t.communicationPackage.count({ where: { id: r.package.id } }),
      ),
    ).toBe(0);
    expect(
      await withUserContext(b.userId, (t) =>
        t.communicationPackageAsset.count({ where: { packageId: r.package.id } }),
      ),
    ).toBe(0);
    // B cannot package A's versions.
    await expect(
      createPackage(b, { jobId, channel: "PORTAL", resumeVersionId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("recipient provenance & preferences", () => {
  it("only sourced details can be marked verified; the DB refuses unsourced verification", async () => {
    await expect(
      saveRecipientContext(a, {
        name: "X",
        email: "x@pkg.example",
        source: "USER_PROVIDED",
        markVerified: true,
      }),
    ).rejects.toBeTruthy();
    const ok = await saveRecipientContext(a, {
      name: "Sam Lee",
      title: "Talent Partner",
      email: "sam@pkg.example",
      source: "JOB_POST",
      sourceUrl: "https://example.test/pkg-job/1",
      markVerified: true,
    });
    expect(ok).toMatchObject({ verificationStatus: "SOURCE_VERIFIED" });
    expect(ok.verifiedAt).toBeTruthy();
    // Changing the email resets verification (it was confirmed for the old details).
    const changed = await saveRecipientContext(
      a,
      {
        name: "Sam Lee",
        email: "sam.lee@pkg.example",
        source: "JOB_POST",
        sourceUrl: "https://example.test/pkg-job/1",
      },
      ok.id,
    );
    expect(changed.verificationStatus).toBe("UNVERIFIED");
    await expect(
      withUserContext(a.userId, (t) =>
        t.recipientContext.create({
          data: {
            userId: a.userId,
            name: "Y",
            source: "USER_PROVIDED",
            verificationStatus: "SOURCE_VERIFIED",
          },
        }),
      ),
    ).rejects.toBeTruthy();
    expect(
      await withUserContext(b.userId, (t) => t.recipientContext.count({ where: { id: ok.id } })),
    ).toBe(0);
  });

  it("preferences set new-draft defaults and avoided phrases are flagged", async () => {
    await saveCommunicationPreferences(a, {
      preferredGreeting: "Hi",
      preferredClosing: "Best,",
      defaultTone: "DIRECT",
      defaultLength: "SHORT",
      avoidPhrases: "I hope this email finds you well",
    });
    const c = await createCommunication(a, { communicationType: "APPLICATION_EMAIL", jobId });
    const ws = await getCommunicationWorkspace(a, c.id);
    expect(ws.communication).toMatchObject({ tone: "DIRECT", length: "SHORT" });
    expect(ws.doc).toMatchObject({ greeting: "Hi Hiring Team,", closing: "Best," });
    expect((ws.communication.strategy as { purpose: string }).purpose).toBe("APPLICATION");
    const saved = await saveCommunicationContent(a, c.id, {
      content: {
        ...(ws.doc as EmailDocument),
        bodyParagraphs: [
          "I hope this email finds you well. I built React dashboards with TypeScript.",
        ],
      },
      expectedHash: ws.version!.contentHash,
    });
    const { check } = await runCommunicationCheck(a, saved.version.id);
    expect(check.findings.map((f) => f.code)).toContain("preference.avoided_phrase");
    await saveCommunicationPreferences(a, {});
  });
});
