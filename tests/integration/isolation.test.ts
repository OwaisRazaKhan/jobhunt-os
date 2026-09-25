import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFact,
  deleteFact,
  getCandidateOverview,
  getDocument,
  getFact,
  getProfile,
  listFacts,
  updateFact,
  updateProfile,
  uploadDocument,
  verifyFact,
} from "@/modules/candidate";
import { withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

/**
 * Security tests: cross-user isolation at BOTH layers —
 *   1. service layer (every query scoped by the authenticated actor), and
 *   2. database layer (RLS policies under the jobhunt_app role), proven by
 *      queries that deliberately omit the userId filter.
 */
let db: TestDb;
let userA: { userId: string };
let userB: { userId: string };

const TXT = (s: string) => new TextEncoder().encode(s);

beforeAll(async () => {
  db = await startTestDb();
  userA = await createTestUser(db.prisma, "Test Candidate A");
  userB = await createTestUser(db.prisma, "Test Candidate B");
});

afterAll(async () => {
  await db.stop();
});

async function expectNotFound(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ code: "NOT_FOUND" });
}

describe("cross-user isolation (service layer)", () => {
  it("User A cannot read User B's candidate profile", async () => {
    await updateProfile(userB, { fullName: "Test Candidate B", phone: "+1 555 000 1111" });
    const profileAsA = await getProfile(userA);
    expect(profileAsA).toBeNull();
    const overview = await getCandidateOverview(userA);
    expect(overview.profile).toBeNull();
  });

  it("User A cannot read, edit, verify or delete User B's experience by changing the id", async () => {
    const bExperience = await createFact(userB, "experience", {
      organization: "Test Company",
      title: "Tester",
    });
    await expectNotFound(getFact(userA, "experience", bExperience.id));
    await expectNotFound(
      updateFact(userA, "experience", bExperience.id, { organization: "Hacked", title: "Hacked" }),
    );
    await expectNotFound(verifyFact(userA, "experience", bExperience.id));
    await expectNotFound(deleteFact(userA, "experience", bExperience.id));
    const stillThere = await getFact(userB, "experience", bExperience.id);
    expect(stillThere.organization).toBe("Test Company");
    expect(stillThere.verificationStatus).toBe("USER_PROVIDED");
    expect(await listFacts(userA, "experience")).toEqual([]);
  });

  it("User A cannot access User B's documents", async () => {
    const doc = await uploadDocument(userB, {
      fileName: "b-notes.txt",
      bytes: TXT("Private notes for Test Candidate B. Nothing to see here at all."),
      documentType: "EXPERIENCE_NOTES",
    });
    await expectNotFound(getDocument(userA, doc.id));
  });

  it("User A cannot link their achievement to User B's experience", async () => {
    const bExperience = await createFact(userB, "experience", {
      organization: "Other Co",
      title: "Lead",
    });
    await expect(
      createFact(userA, "achievement", {
        statement: "Did something",
        experienceId: bExperience.id,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe("cross-user isolation (database RLS)", () => {
  it("queries without a userId filter only return the caller's rows", async () => {
    await createFact(userA, "skill", { name: "Test Skill A", category: "TECHNICAL" });
    await createFact(userB, "skill", { name: "Test Skill B", category: "TECHNICAL" });
    const visibleToA = await withUserContext(userA.userId, (tx) => tx.candidateSkill.findMany());
    expect(visibleToA.map((s) => s.name)).toEqual(["Test Skill A"]);
    const docsVisibleToA = await withUserContext(userA.userId, (tx) =>
      tx.candidateDocument.findMany(),
    );
    expect(docsVisibleToA).toEqual([]);
    const profilesVisibleToA = await withUserContext(userA.userId, (tx) =>
      tx.candidateProfile.findMany(),
    );
    expect(profilesVisibleToA.every((p) => p.userId === userA.userId)).toBe(true);
    const auditVisibleToA = await withUserContext(userA.userId, (tx) => tx.auditLog.findMany());
    expect(auditVisibleToA.every((a) => a.userId === userA.userId)).toBe(true);
  });

  it("RLS blocks writing rows for another user even with a forged user_id", async () => {
    await expect(
      withUserContext(userA.userId, (tx) =>
        tx.candidateSkill.create({
          data: {
            userId: userB.userId,
            name: "Injected",
            nameNormalized: "injected",
            category: "OTHER",
            verificationStatus: "USER_PROVIDED",
            sourceType: "MANUAL_ENTRY",
          },
        }),
      ),
    ).rejects.toBeTruthy();
  });

  it("RLS blocks updating another user's rows (0 rows affected)", async () => {
    const bSkill = await createFact(userB, "skill", { name: "Protected Skill" });
    const result = await withUserContext(userA.userId, (tx) =>
      tx.candidateSkill.updateMany({ where: { id: bSkill.id }, data: { name: "Hacked" } }),
    );
    expect(result.count).toBe(0);
    expect((await getFact(userB, "skill", bSkill.id)).name).toBe("Protected Skill");
  });

  it("audit log is append-only for the app role", async () => {
    await expect(
      withUserContext(userA.userId, (tx) =>
        tx.auditLog.deleteMany({ where: { userId: userA.userId } }),
      ),
    ).rejects.toBeTruthy();
    await expect(
      withUserContext(userA.userId, (tx) =>
        tx.auditLog.updateMany({ data: { action: "tampered" } }),
      ),
    ).rejects.toBeTruthy();
  });

  it("without a user context nothing is visible", async () => {
    const rows = await db.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE jobhunt_app");
      return tx.candidateSkill.findMany();
    });
    expect(rows).toEqual([]);
  });

  it("rejects a malformed user id before touching the database", async () => {
    await expect(withUserContext("not-a-uuid", async () => 1)).rejects.toMatchObject({
      code: "AUTH_ERROR",
    });
  });
});
