import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  beginSubmission,
  getApplicationWorkspace,
  listApplications,
  recordSubmissionOutcome,
  resolveUncertainSubmission,
  sanitizePayload,
  startAttempt,
  transitionApplication,
  updateAttempt,
} from "@/modules/applications/application.service";
import { answerHash } from "@/modules/applications/hash";
import { withUserContext } from "@/server/db";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

let db: TestDb;
let a: { userId: string; profileId: string };
let b: { userId: string; profileId: string };
let n = 0;

// Synthetic, isolated fixtures (test database only). Application creation from a package is
// checkpoint 2; here records are inserted directly to exercise the data model and services.
async function user(label: string) {
  const u = await createTestUser(db.prisma, label);
  const p = await db.prisma.candidateProfile.create({
    data: { userId: u.userId, fullName: `${label} Person` },
  });
  return { ...u, profileId: p.id };
}

async function application(owner: { userId: string; profileId: string }, status = "DRAFT") {
  const company = await db.prisma.company.upsert({
    where: { nameNormalized: "app co" },
    create: { name: "App Co", nameNormalized: "app co" },
    update: {},
  });
  const job = await db.prisma.job.create({
    data: {
      companyId: company.id,
      sourceKey: "GREENHOUSE",
      sourceType: "ATS_PUBLIC_API",
      sourceStatus: "DISCOVERED",
      title: "Frontend Engineer",
      normalizedTitle: "frontend engineer",
      description: "React",
      locationRaw: "Remote",
      remoteStatus: "REMOTE",
      employmentType: "FULL_TIME",
      jobUrl: `https://boards.example.test/app-co/jobs/${++n}`,
      contentHash: String(n).padStart(64, "0"),
      visibility: "PUBLIC",
    },
  });
  const pkg = await db.prisma.communicationPackage.create({
    data: { userId: owner.userId, jobId: job.id, companyId: company.id, title: "pkg" },
  });
  const app = await db.prisma.application.create({
    data: {
      userId: owner.userId,
      candidateId: owner.profileId,
      jobId: job.id,
      companyId: company.id,
      communicationPackageId: pkg.id,
      status,
      packageIntegrityHash: "c".repeat(64),
      snapshot: { resume: { versionId: "r", contentHash: "a".repeat(64) } },
      jobUrl: job.jobUrl,
    },
  });
  return { app, job, pkg };
}

/** Walks an application to READY_TO_SUBMIT with an approval of its current hash (fixture). */
async function approved(owner: { userId: string; profileId: string }) {
  const { app } = await application(owner, "READY");
  const hash = "d".repeat(64);
  await db.prisma.application.update({ where: { id: app.id }, data: { applicationHash: hash } });
  await db.prisma.applicationApproval.create({
    data: {
      userId: owner.userId,
      applicationId: app.id,
      applicationHash: hash,
      payload: { fields: 1 },
    },
  });
  await db.prisma.application.update({
    where: { id: app.id },
    data: { status: "READY_TO_SUBMIT" },
  });
  return app;
}

beforeAll(async () => {
  db = await startTestDb();
  a = await user("App A");
  b = await user("App B");
});
afterAll(async () => db.stop());

describe("state machine & locking", () => {
  it("valid transitions work, impossible ones are refused by the service and the database", async () => {
    const { app } = await application(a);
    await transitionApplication(a, app.id, "IN_PROGRESS");
    await transitionApplication(a, app.id, "READY");
    await expect(transitionApplication(a, app.id, "DRAFT")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    // Gated targets need their own validated path.
    await expect(transitionApplication(a, app.id, "SUBMITTED")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(transitionApplication(a, app.id, "READY_TO_SUBMIT")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    // Database trigger: DRAFT → SUBMITTED is impossible even for a direct write (and needs evidence anyway).
    const { app: other } = await application(a);
    await expect(
      withUserContext(a.userId, (t) =>
        t.application.update({ where: { id: other.id }, data: { status: "READY_TO_SUBMIT" } }),
      ),
    ).rejects.toBeTruthy();
    const ws = await getApplicationWorkspace(a, app.id);
    expect(ws.events.map((e) => e.eventType)).toEqual(["STATUS_CHANGED", "STATUS_CHANGED"]);
  });

  it("blocking needs a reason; the locked package and versions can never change", async () => {
    const { app } = await application(a);
    await expect(transitionApplication(a, app.id, "BLOCKED")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const blocked = await transitionApplication(a, app.id, "BLOCKED", {
      reason: "Job application endpoint is no longer available.",
    });
    expect(blocked).toMatchObject({ status: "BLOCKED", readiness: "BLOCKED" });
    await expect(
      withUserContext(a.userId, (t) =>
        t.application.update({
          where: { id: app.id },
          data: { snapshot: { resume: { versionId: "other" } } },
        }),
      ),
    ).rejects.toBeTruthy();
    await expect(
      withUserContext(a.userId, (t) =>
        t.application.update({
          where: { id: app.id },
          data: { packageIntegrityHash: "e".repeat(64) },
        }),
      ),
    ).rejects.toBeTruthy();
  });

  it("one active application per job; archiving frees the slot; no delete", async () => {
    const { app, job, pkg } = await application(a);
    await expect(
      db.prisma.application.create({
        data: {
          userId: a.userId,
          candidateId: a.profileId,
          jobId: job.id,
          communicationPackageId: pkg.id,
          packageIntegrityHash: "c".repeat(64),
        },
      }),
    ).rejects.toBeTruthy();
    await transitionApplication(a, app.id, "ARCHIVED");
    await db.prisma.application.create({
      data: {
        userId: a.userId,
        candidateId: a.profileId,
        jobId: job.id,
        communicationPackageId: pkg.id,
        packageIntegrityHash: "c".repeat(64),
      },
    });
    await expect(
      withUserContext(a.userId, (t) => t.application.delete({ where: { id: app.id } })),
    ).rejects.toBeTruthy();
  });
});

describe("attempts", () => {
  it("one active attempt at a time; finished attempts record errors; leases are per worker", async () => {
    const { app } = await application(a);
    const first = await startAttempt(a, app.id, {
      adapter: "TEST_FIXTURE",
      adapterVersion: "1",
      leaseOwner: "worker-1",
    });
    expect(first).toMatchObject({ attemptNumber: 1, status: "RUNNING" });
    await expect(
      startAttempt(a, app.id, {
        adapter: "TEST_FIXTURE",
        adapterVersion: "1",
        leaseOwner: "worker-2",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const done = await updateAttempt(a, first.id, {
      status: "FAILED",
      errorCode: "NETWORK_ERROR",
      errorMessage: "timeout",
      steps: [{ step: "open", status: "failed" }],
    });
    expect(done.completedAt).toBeTruthy();
    expect(done.leaseOwner).toBeNull();
    const second = await startAttempt(a, app.id, {
      adapter: "TEST_FIXTURE",
      adapterVersion: "1",
      leaseOwner: "worker-2",
    });
    expect(second.attemptNumber).toBe(2);
    await expect(updateAttempt(a, first.id, { status: "RUNNING" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("submission — never fake, never twice", () => {
  it("success needs confirming evidence; a second submission is refused", async () => {
    const app = await approved(a);
    const sub = await beginSubmission(a, app.id, null);
    await expect(beginSubmission(a, app.id, null)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    }); // status is SUBMITTING
    await expect(
      recordSubmissionOutcome(a, sub.id, {
        result: "SUBMITTED",
        confirmationSource: "CONFIRMATION_PAGE",
        evidence: [{ evidenceType: "SCREENSHOT" }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await recordSubmissionOutcome(a, sub.id, {
      result: "SUBMITTED",
      confirmationSource: "CONFIRMATION_ID",
      externalApplicationId: "APP-12345",
      evidence: [
        { evidenceType: "CONFIRMATION_ID", textExcerpt: "Your application ID is APP-12345" },
      ],
    });
    const ws = await getApplicationWorkspace(a, app.id);
    expect(ws).toMatchObject({
      status: "SUBMITTED",
      confirmationSource: "CONFIRMATION_ID",
      externalApplicationId: "APP-12345",
    });
    expect(ws.submissions[0]!.evidence[0]).toMatchObject({
      evidenceType: "CONFIRMATION_ID",
      source: "AUTOMATED",
    });
    // The recorded submission cannot be rewritten or downgraded.
    await expect(
      withUserContext(a.userId, (t) =>
        t.applicationSubmission.update({ where: { id: sub.id }, data: { status: "FAILED" } }),
      ),
    ).rejects.toBeTruthy();
    expect(ws.events.map((e) => e.eventType)).toEqual(["SUBMISSION_STARTED", "SUBMITTED"]);
  });

  it("the database refuses a success state without evidence and a second live submission", async () => {
    const app = await approved(a);
    await expect(
      withUserContext(a.userId, (t) =>
        t.applicationSubmission.create({
          data: {
            userId: a.userId,
            applicationId: app.id,
            channelType: "ATS",
            status: "SUBMITTED",
            applicationHash: "d".repeat(64),
            submissionFingerprint: "1".repeat(64),
          },
        }),
      ),
    ).rejects.toBeTruthy();
    await withUserContext(a.userId, (t) =>
      t.applicationSubmission.create({
        data: {
          userId: a.userId,
          applicationId: app.id,
          channelType: "ATS",
          status: "SUBMITTING",
          applicationHash: "d".repeat(64),
          submissionFingerprint: "2".repeat(64),
        },
      }),
    );
    await expect(
      withUserContext(a.userId, (t) =>
        t.applicationSubmission.create({
          data: {
            userId: a.userId,
            applicationId: app.id,
            channelType: "ATS",
            status: "SUBMITTING",
            applicationHash: "d".repeat(64),
            submissionFingerprint: "3".repeat(64),
          },
        }),
      ),
    ).rejects.toBeTruthy();
    await expect(
      withUserContext(a.userId, (t) =>
        t.application
          .update({ where: { id: app.id }, data: { status: "SUBMITTING" } })
          .then(() =>
            t.application.update({ where: { id: app.id }, data: { status: "SUBMITTED" } }),
          ),
      ),
    ).rejects.toBeTruthy();
  });

  it("an approval of an older state does not allow submission", async () => {
    const app = await approved(a);
    await db.prisma.application.update({
      where: { id: app.id },
      data: { applicationHash: "e".repeat(64) },
    });
    await expect(beginSubmission(a, app.id, null)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("an uncertain result stops (no new attempt, no resubmission) until the user resolves it — labelled USER_CONFIRMED", async () => {
    const app = await approved(a);
    const sub = await beginSubmission(a, app.id, null);
    await recordSubmissionOutcome(a, sub.id, {
      result: "UNCERTAIN",
      reason: "Browser connection ended after submit",
    });
    await expect(
      startAttempt(a, app.id, { adapter: "TEST_FIXTURE", adapterVersion: "1", leaseOwner: "w" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(beginSubmission(a, app.id, null)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await resolveUncertainSubmission(a, app.id, {
      submitted: true,
      note: "Confirmation email received",
    });
    const ws = await getApplicationWorkspace(a, app.id);
    expect(ws).toMatchObject({ status: "SUBMITTED", confirmationSource: "USER_CONFIRMED" });
    expect(ws.submissions[0]!.evidence.map((e) => [e.evidenceType, e.source])).toEqual([
      ["USER_CONFIRMED", "USER"],
    ]);
  });

  it("a failed submission keeps the approved package and allows a new controlled attempt", async () => {
    const app = await approved(a);
    const sub = await beginSubmission(a, app.id, null);
    await recordSubmissionOutcome(a, sub.id, {
      result: "FAILED",
      errorCode: "FORM_CHANGED",
      reason: "Expected field not found",
    });
    expect((await getApplicationWorkspace(a, app.id)).status).toBe("FAILED");
    await transitionApplication(a, app.id, "IN_PROGRESS");
  });
});

describe("immutability", () => {
  it("approvals can only be revoked once; approved answers cannot change; events are append-only", async () => {
    const app = await approved(a);
    const approval = await db.prisma.applicationApproval.findFirstOrThrow({
      where: { applicationId: app.id },
    });
    await expect(
      withUserContext(a.userId, (t) =>
        t.applicationApproval.update({
          where: { id: approval.id },
          data: { applicationHash: "f".repeat(64) },
        }),
      ),
    ).rejects.toBeTruthy();
    await withUserContext(a.userId, (t) =>
      t.applicationApproval.update({
        where: { id: approval.id },
        data: { revokedAt: new Date(), revokeReason: "field edited" },
      }),
    );
    await expect(
      withUserContext(a.userId, (t) =>
        t.applicationApproval.update({
          where: { id: approval.id },
          data: { revokeReason: "other" },
        }),
      ),
    ).rejects.toBeTruthy();

    const q = await withUserContext(a.userId, (t) =>
      t.applicationQuestion.create({
        data: { userId: a.userId, applicationId: app.id, questionText: "Why this role?" },
      }),
    );
    await expect(
      withUserContext(a.userId, (t) =>
        t.applicationAnswer.create({
          data: {
            userId: a.userId,
            questionId: q.id,
            versionNumber: 1,
            answerText: "x",
            contentHash: answerHash("x"),
            contentSource: "AI_GENERATED",
            validationStatus: "UNSUPPORTED",
            approvalStatus: "APPROVED",
            approvedAt: new Date(),
          },
        }),
      ),
    ).rejects.toBeTruthy(); // unsupported can never be approved
    const ans = await withUserContext(a.userId, (t) =>
      t.applicationAnswer.create({
        data: {
          userId: a.userId,
          questionId: q.id,
          versionNumber: 1,
          answerText: "Because of X",
          contentHash: answerHash("Because of X"),
          contentSource: "USER_AUTHORED",
          validationStatus: "SUPPORTED",
          approvalStatus: "APPROVED",
          approvedAt: new Date(),
        },
      }),
    );
    await expect(
      withUserContext(a.userId, (t) =>
        t.applicationAnswer.update({ where: { id: ans.id }, data: { answerText: "Because of Y" } }),
      ),
    ).rejects.toBeTruthy();
    await withUserContext(a.userId, (t) =>
      t.applicationAnswer.update({
        where: { id: ans.id },
        data: { approvalStatus: "SUPERSEDED", isCurrent: false },
      }),
    );

    const ev = await db.prisma.applicationEvent
      .findFirstOrThrow({ where: { applicationId: app.id } })
      .catch(() => null);
    if (ev)
      await expect(
        withUserContext(a.userId, (t) =>
          t.applicationEvent.update({ where: { id: ev.id }, data: { payload: {} } }),
        ),
      ).rejects.toBeTruthy();
  });

  it("mapping rules: auto-fill only for exact/high confidence; unknown mappings carry no value; channels are never 'verified' without a source", async () => {
    const { app } = await application(a);
    const form = await withUserContext(a.userId, (t) =>
      t.applicationForm.create({
        data: {
          userId: a.userId,
          applicationId: app.id,
          url: "https://boards.example.test/apply",
          provider: "GREENHOUSE",
          adapter: "TEST_FIXTURE",
          adapterVersion: "1",
          formFingerprint: "a".repeat(64),
        },
      }),
    );
    const field = await withUserContext(a.userId, (t) =>
      t.applicationField.create({
        data: {
          userId: a.userId,
          formId: form.id,
          externalFieldId: "auth",
          label: "Work authorization",
          fieldType: "YES_NO",
          classification: "LEGAL",
          fieldFingerprint: "b".repeat(64),
        },
      }),
    );
    await expect(
      withUserContext(a.userId, (t) =>
        t.applicationFieldMapping.create({
          data: {
            userId: a.userId,
            fieldId: field.id,
            version: 1,
            mappingType: "CANDIDATE_PROFILE",
            confidence: "LOW",
            policy: "AUTO_FILL",
            status: "MAPPED",
          },
        }),
      ),
    ).rejects.toBeTruthy();
    await expect(
      withUserContext(a.userId, (t) =>
        t.applicationFieldMapping.create({
          data: {
            userId: a.userId,
            fieldId: field.id,
            version: 1,
            mappingType: "UNKNOWN",
            value: "Yes",
            policy: "REQUIRE_USER_INPUT",
            status: "NEEDS_USER_INPUT",
          },
        }),
      ),
    ).rejects.toBeTruthy();
    await withUserContext(a.userId, (t) =>
      t.applicationFieldMapping.create({
        data: {
          userId: a.userId,
          fieldId: field.id,
          version: 1,
          mappingType: "UNKNOWN",
          policy: "REQUIRE_USER_INPUT",
          status: "NEEDS_USER_INPUT",
        },
      }),
    );
    await expect(
      withUserContext(a.userId, (t) =>
        t.applicationField.update({ where: { id: field.id }, data: { label: "changed" } }),
      ),
    ).rejects.toBeTruthy(); // form snapshot immutable
    await expect(
      withUserContext(a.userId, (t) =>
        t.applicationChannel.create({
          data: {
            userId: a.userId,
            applicationId: app.id,
            channelType: "EMAIL_APPLICATION",
            email: "careers@app-co.example",
            source: "USER_PROVIDED",
            verificationStatus: "SOURCE_VERIFIED",
          },
        }),
      ),
    ).rejects.toBeTruthy();
    await withUserContext(a.userId, (t) =>
      t.applicationChannel.create({
        data: {
          userId: a.userId,
          applicationId: app.id,
          channelType: "EMAIL_APPLICATION",
          email: "careers@app-co.example",
          source: "JOB_POST",
          sourceUrl: "https://boards.example.test/app-co/jobs/1",
          verificationStatus: "SOURCE_VERIFIED",
          isPrimary: true,
        },
      }),
    );
  });
});

describe("ownership (service + RLS)", () => {
  it("user B can never see or change user A's application or any of its records", async () => {
    const app = await approved(a);
    const sub = await beginSubmission(a, app.id, null);
    await expect(getApplicationWorkspace(b, app.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(transitionApplication(b, app.id, "CANCELLED")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      recordSubmissionOutcome(b, sub.id, {
        result: "FAILED",
        errorCode: "INTERNAL_ERROR",
        reason: "x",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listApplications(b)).length).toBe(0);
    const counts = await withUserContext(b.userId, async (t) => [
      await t.application.count({ where: { id: app.id } }),
      await t.applicationSubmission.count({ where: { applicationId: app.id } }),
      await t.applicationApproval.count({ where: { applicationId: app.id } }),
      await t.applicationEvent.count({ where: { applicationId: app.id } }),
    ]);
    expect(counts).toEqual([0, 0, 0, 0]);
    // B cannot attach records to A's application.
    await expect(
      withUserContext(b.userId, (t) =>
        t.applicationEvent.create({
          data: { userId: b.userId, applicationId: app.id, eventType: "STATUS_CHANGED" },
        }),
      ),
    ).rejects.toBeTruthy();
  });

  it("event payloads are sanitized (no secrets, bounded size)", () => {
    const p = sanitizePayload({
      cookie: "abc",
      sessionToken: "t",
      note: "x".repeat(1000),
      nested: { password: "p", ok: 1 },
    }) as Record<string, unknown>;
    expect(Object.keys(p)).toEqual(["note", "nested"]);
    expect((p.note as string).length).toBeLessThanOrEqual(301);
    expect(p.nested).toEqual({ ok: 1 });
  });

  it("search and filters list only real records", async () => {
    expect(
      (await listApplications(a, { filter: "submitted" })).every((x) =>
        ["SUBMITTED", "SUBMISSION_CONFIRMED"].includes(x.status),
      ),
    ).toBe(true);
    expect((await listApplications(a, { q: "App Co" })).length).toBeGreaterThan(0);
    expect((await listApplications(a, { q: "No Such Company" })).length).toBe(0);
  });
});
