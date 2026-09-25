import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  createFact,
  deleteCandidateData,
  deleteFact,
  exportCandidateData,
  getCandidateOverview,
  getFact,
  getPreferences,
  getProfile,
  getUsableCandidateFacts,
  getVerifiedCandidateFacts,
  listActivity,
  listFacts,
  purgeUserFiles,
  resolveFactRefs,
  restoreFact,
  setTargetLocations,
  updateFact,
  updateOnboarding,
  updatePreferences,
  updateProfile,
  uploadDocument,
  verifyFact,
} from "@/modules/candidate";
import { ProvenanceViolation } from "@/modules/candidate/provenance";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

let db: TestDb;
let user: { userId: string };

beforeAll(async () => {
  db = await startTestDb();
  user = await createTestUser(db.prisma);
});
afterAll(async () => db.stop());

async function auditActions(userId: string) {
  return (
    await db.prisma.auditLog.findMany({ where: { userId }, orderBy: { createdAt: "asc" } })
  ).map((a) => a.action);
}

describe("candidate profile", () => {
  it("creates the profile on first update, encrypts contact fields, and audits field names only", async () => {
    const profile = await updateProfile(user, {
      fullName: "Test Candidate",
      headline: "Test Headline",
      phone: "+1 555 010 2030",
      professionalEmail: "test.candidate@example.com",
    });
    expect(profile?.fullName).toBe("Test Candidate");
    expect(profile?.phone).toBe("+1 555 010 2030");

    const raw = await db.prisma.candidateProfile.findUniqueOrThrow({
      where: { userId: user.userId },
    });
    expect(raw.phoneEnc).not.toContain("555");
    expect(raw.professionalEmailEnc).not.toContain("example.com");

    const audits = await db.prisma.auditLog.findMany({
      where: { userId: user.userId, action: "profile_updated" },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]!.metadata)).not.toContain("555");
    expect(audits[0]!.metadata).toMatchObject({
      fields: expect.arrayContaining(["fullName", "phone"]),
    });
    expect(await auditActions(user.userId)).toContain("profile_created");
  });

  it("updates only submitted fields and rejects invalid data", async () => {
    await updateProfile(user, { summary: "Synthetic summary." });
    const profile = await getProfile(user);
    expect(profile?.fullName).toBe("Test Candidate");
    expect(profile?.summary).toBe("Synthetic summary.");
    await expect(updateProfile(user, { professionalEmail: "not-an-email" })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      updateProfile(user, { linkedinUrl: "javascript:alert(1)" }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("tracks onboarding progress (complete / skip) and completion", async () => {
    await updateOnboarding(user, { step: "basic", action: "complete" });
    await updateOnboarding(user, { step: "certifications", action: "skip" });
    let profile = await getProfile(user);
    expect(profile?.onboarding.completed).toContain("basic");
    expect(profile?.onboarding.skipped).toContain("certifications");
    expect(profile?.profileStatus).toBe("DRAFT");
    await updateOnboarding(user, { step: "review", action: "complete" });
    profile = await getProfile(user);
    expect(profile?.profileStatus).toBe("ACTIVE");
    expect(profile?.onboardingCompletedAt).toBeInstanceOf(Date);
  });
});

describe("fact sections CRUD", () => {
  const cases = [
    [
      "education",
      { institution: "Test University", degree: "BBA", startDate: "2020", endDate: "2024" },
      { institution: "Test University 2" },
    ],
    [
      "experience",
      { organization: "Test Company", title: "Founder", startDate: "2022-01", isCurrent: true },
      { organization: "Test Company", title: "Co-founder", startDate: "2022-01", isCurrent: true },
    ],
    [
      "skill",
      { name: "Next.js", category: "WEB", proficiency: 4 },
      { name: "Next.js", category: "WEB", proficiency: 5 },
    ],
    [
      "project",
      { name: "Test Project", description: "A synthetic project", technologies: ["Next.js"] },
      { name: "Test Project", description: "Updated", technologies: ["Next.js", "Supabase"] },
    ],
    [
      "certification",
      { name: "Test Certification", issuer: "Test Issuer", issueDate: "2023" },
      { name: "Test Certification", issuer: "Other Issuer" },
    ],
    [
      "portfolio",
      { title: "Test Portfolio", type: "WEBSITE", url: "https://portfolio.example.com" },
      { title: "Test Portfolio", type: "CASE_STUDY", url: "portfolio.example.com/case" },
    ],
    [
      "language",
      { language: "English", proficiency: "C1" },
      { language: "English", proficiency: "C2" },
    ],
    [
      "authorization",
      { countryCode: "de", status: "SPONSORSHIP_REQUIRED" },
      { countryCode: "DE", status: "UNKNOWN" },
    ],
  ] as const;

  for (const [kind, createInput, updateInput] of cases) {
    it(`${kind}: create, read, update, soft delete, restore`, async () => {
      const created = await createFact(user, kind, createInput);
      expect(created.verificationStatus).toBe("USER_PROVIDED");
      expect(created.sourceType).toBe("MANUAL_ENTRY");
      expect((await listFacts(user, kind)).map((r) => r.id)).toContain(created.id);

      const updated = await updateFact(user, kind, created.id, updateInput);
      expect(updated.id).toBe(created.id);

      await deleteFact(user, kind, created.id);
      expect((await listFacts(user, kind)).map((r) => r.id)).not.toContain(created.id);
      await expect(getFact(user, kind, created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

      await restoreFact(user, kind, created.id);
      expect((await getFact(user, kind, created.id)).id).toBe(created.id);

      const actions = await auditActions(user.userId);
      expect(actions).toEqual(expect.arrayContaining(["fact_deleted", "fact_restored"]));
    });
  }

  it("achievements link only to the user's own experience and never invent metrics", async () => {
    const exp = await createFact(user, "experience", {
      organization: "Achieve Co",
      title: "Analyst",
    });
    const achievement = await createFact(user, "achievement", {
      statement: "Launched a synthetic campaign",
      experienceId: exp.id,
    });
    expect(achievement.metric).toBeNull();
    expect(achievement.experienceId).toBe(exp.id);
  });

  it("validation errors: dates in the wrong order, bad URLs, missing required fields", async () => {
    await expect(
      createFact(user, "experience", {
        organization: "X",
        title: "Y",
        startDate: "2022",
        endDate: "2021",
      }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      createFact(user, "experience", {
        organization: "X",
        title: "Y",
        isCurrent: true,
        endDate: "2021",
      }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      createFact(user, "project", { name: "P", liveUrl: "ftp://nope" }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      createFact(user, "education", { degree: "No institution" }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(createFact(user, "skill", { name: "Bad", proficiency: 9 })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      createFact(user, "education", { institution: "X", startDate: "2020-13" }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("duplicate skill names (case/format-insensitive) conflict", async () => {
    await createFact(user, "skill", { name: "Tailwind CSS" });
    await expect(createFact(user, "skill", { name: "tailwind css" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("rejects an unknown country for work authorization", async () => {
    await expect(
      createFact(user, "authorization", { countryCode: "XX", status: "UNKNOWN" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("fact provenance & verification", () => {
  it("facts can never be created as VERIFIED", async () => {
    await expect(
      // Deliberately bypassing the type to simulate a malicious/buggy caller (e.g. AI code).
      createFact(
        user,
        "skill",
        { name: "Forged" },
        { verificationStatus: "VERIFIED" as never, sourceType: "SYSTEM" },
      ),
    ).rejects.toBeInstanceOf(ProvenanceViolation);
  });

  it("the database refuses VERIFIED without a user verification timestamp", async () => {
    await expect(
      db.prisma.candidateSkill.create({
        data: {
          userId: user.userId,
          name: "Raw",
          nameNormalized: "raw",
          category: "OTHER",
          verificationStatus: "VERIFIED",
          sourceType: "SYSTEM",
        },
      }),
    ).rejects.toBeTruthy();
  });

  it("an AI_INFERRED fact stays AI_INFERRED until the user verifies it", async () => {
    const inferred = await createFact(
      user,
      "skill",
      { name: "Inferred Skill" },
      { verificationStatus: "AI_INFERRED", sourceType: "SYSTEM", confidence: 0.4 },
    );
    expect(inferred.verificationStatus).toBe("AI_INFERRED");
    expect((await getUsableCandidateFacts(user)).map((f) => f.id)).not.toContain(inferred.id);
    const verified = await verifyFact(user, "skill", inferred.id);
    expect(verified.verificationStatus).toBe("VERIFIED");
    expect(verified.verifiedAt).toBeInstanceOf(Date);
  });

  it("editing a verified fact resets it to USER_PROVIDED", async () => {
    const fact = await createFact(user, "language", { language: "Urdu", proficiency: "NATIVE" });
    await verifyFact(user, "language", fact.id);
    const edited = await updateFact(user, "language", fact.id, {
      language: "Urdu",
      proficiency: "C2",
    });
    expect(edited.verificationStatus).toBe("USER_PROVIDED");
    expect(edited.verifiedAt).toBeNull();
    // A no-op save keeps the status.
    await verifyFact(user, "language", fact.id);
    const same = await updateFact(user, "language", fact.id, {
      language: "Urdu",
      proficiency: "C2",
    });
    expect(same.verificationStatus).toBe("VERIFIED");
  });

  it("knowledge retrieval exposes stable fact refs with provenance", async () => {
    const verified = await getVerifiedCandidateFacts(user);
    expect(verified.length).toBeGreaterThan(0);
    expect(verified.every((f) => f.verificationStatus === "VERIFIED")).toBe(true);
    const first = verified[0]!;
    expect(first.ref).toBe(`${first.kind}:${first.id}`);
    expect(first.source.type).toBeDefined();
    const resolved = await resolveFactRefs(user, [
      first.ref,
      "skill:00000000-0000-7000-8000-000000000000",
      "bogus",
    ]);
    expect(resolved.map((f) => f.ref)).toEqual([first.ref]);
    const withoutSensitive = await getUsableCandidateFacts(user, { includeSensitive: false });
    expect(withoutSensitive.some((f) => f.kind === "authorization")).toBe(false);
  });
});

describe("preferences & target locations", () => {
  it("saves preferences, validates salary and currency, audits changes", async () => {
    await updatePreferences(user, {
      targetRoles: ["Marketing Specialist", "Web Developer"],
      workModes: ["REMOTE", "HYBRID"],
      employmentTypes: ["FULL_TIME"],
      salaryMin: "40000",
      salaryMax: "60000",
      salaryCurrency: "eur",
      salaryPeriod: "YEAR",
    });
    const { preferences } = await getPreferences(user);
    expect(preferences?.salaryCurrency).toBe("EUR");
    expect(preferences?.targetRoles).toHaveLength(2);
    await expect(
      updatePreferences(user, { salaryMin: 50000, salaryMax: 10000, salaryCurrency: "EUR" }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(updatePreferences(user, { salaryCurrency: "ZZZ" })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(updatePreferences(user, { workModes: ["TELEPORT"] })).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(await auditActions(user.userId)).toContain("preference_updated");
  });

  it("replaces target locations and rejects unknown countries", async () => {
    await setTargetLocations(user, {
      locations: [
        { countryCode: "DE", city: "Berlin" },
        { countryCode: "nl" },
        { countryCode: "DE", city: "berlin" },
      ],
    });
    const { targetLocations } = await getPreferences(user);
    expect(targetLocations.map((l) => l.countryCode)).toEqual(["DE", "NL"]);
    await expect(
      setTargetLocations(user, { locations: [{ countryCode: "QQ" }] }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("overview, export and deletion", () => {
  it("overview computes completeness, warnings and readiness deterministically", async () => {
    const overview = await getCandidateOverview(user);
    expect(overview.completeness.percent).toBeGreaterThan(0);
    expect(overview.completeness.percent).toBeLessThanOrEqual(100);
    const again = await getCandidateOverview(user);
    expect(again.completeness).toEqual(overview.completeness);
    expect(["READY", "NEEDS_REVIEW", "INCOMPLETE"]).toContain(overview.readiness.status);
  });

  it("export contains all candidate data and is audited", async () => {
    const data = await exportCandidateData(user);
    expect(data.format).toBe("jobhunt-os.candidate-export");
    expect(data.profile?.fullName).toBe("Test Candidate");
    expect(data.profile?.phone).toBe("+1 555 010 2030");
    expect(data.facts.skills.length).toBeGreaterThan(0);
    expect(data.preferences?.targetRoles).toContain("Web Developer");
    expect(data.auditLog.length).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toContain("storagePath");
    expect(await auditActions(user.userId)).toContain("data_exported");
    expect((await listActivity(user)).length).toBeGreaterThan(0);
  });

  it("deleting candidate data removes rows and files but keeps the account and shared catalog", async () => {
    const other = await createTestUser(db.prisma, "Test Other");
    await createFact(other, "skill", { name: "Other Skill" });
    await uploadDocument(user, {
      fileName: "notes.txt",
      bytes: new TextEncoder().encode("Synthetic notes for deletion testing only."),
      documentType: "OTHER",
    });
    expect(db.storage.files.size).toBe(1);
    const countriesBefore = await db.prisma.country.count();

    await deleteCandidateData(user);

    expect(db.storage.files.size).toBe(0);
    expect(await db.prisma.candidateSkill.count({ where: { userId: user.userId } })).toBe(0);
    expect(await db.prisma.candidateProfile.count({ where: { userId: user.userId } })).toBe(0);
    expect(await db.prisma.user.count({ where: { id: user.userId } })).toBe(1);
    expect(await db.prisma.country.count()).toBe(countriesBefore);
    expect(await db.prisma.candidateSkill.count({ where: { userId: other.userId } })).toBe(1);
  });

  it("account deletion purges files and cascades every user-owned row", async () => {
    const doomed = await createTestUser(db.prisma, "Test Doomed");
    await updateProfile(doomed, { fullName: "Test Doomed" });
    await createFact(doomed, "project", { name: "Doomed Project" });
    await uploadDocument(doomed, {
      fileName: "d.txt",
      bytes: new TextEncoder().encode("Synthetic document for account deletion test."),
      documentType: "OTHER",
    });
    const filesBefore = db.storage.files.size;

    await purgeUserFiles(doomed.userId);
    await db.prisma.user.delete({ where: { id: doomed.userId } });

    expect(db.storage.files.size).toBe(filesBefore - 1);
    for (const count of [
      db.prisma.candidateProfile.count({ where: { userId: doomed.userId } }),
      db.prisma.candidateProject.count({ where: { userId: doomed.userId } }),
      db.prisma.candidateDocument.count({ where: { userId: doomed.userId } }),
      db.prisma.auditLog.count({ where: { userId: doomed.userId } }),
    ]) {
      expect(await count).toBe(0);
    }
    expect(await db.prisma.country.count()).toBeGreaterThan(200);
  });
});
