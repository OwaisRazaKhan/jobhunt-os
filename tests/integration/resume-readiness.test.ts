import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { parseResumeDocument } from "@/modules/resumes/document";
import {
  confirmSkillsForJob,
  getReadiness,
  missingSkillsForJob,
} from "@/modules/resumes/readiness.service";
import {
  approveVersion,
  createMasterResume,
  getResumeWorkspace,
} from "@/modules/resumes/resume.service";
import { tailorResumeToJob } from "@/modules/resumes/tailor.service";
import { updateProfile } from "@/modules/candidate/profile.service";
import { setProvidersForTests } from "@/server/ai/router";
import type { AiProvider, StructuredRequest } from "@/server/ai/types";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

/**
 * End-to-end: resume + job → complete rewrite → missing skills handled honestly → pass gate.
 * SYNTHETIC candidate and job (isolated test database only).
 */

let db: TestDb;
const fact = { verificationStatus: "USER_PROVIDED" as const, sourceType: "MANUAL_ENTRY" as const };

const JD = [
  "About the role",
  "We need a Marketing Automation Associate to help us build our automation function.",
  "Requirements",
  "• 2+ years of experience in digital marketing",
  "• Hands-on experience with Zapier",
  "• Experience with HubSpot",
  "• Google Analytics",
].join("\n");

async function setup(label: string) {
  const user = await createTestUser(db.prisma, label);
  await db.prisma.candidateProfile.create({
    data: {
      userId: user.userId,
      fullName: `${label} Person`,
      headline: "Digital marketing & automation",
      currentCity: "Kolkata",
      currentCountryCode: "IN",
      summary: "Digital marketing executive who automates marketing workflows.",
    },
  });
  await updateProfile(user, { professionalEmail: "synthetic.candidate@example.test" });
  await db.prisma.candidateExperience.create({
    data: {
      userId: user.userId,
      organization: "Test Agency",
      title: "Digital Marketing Executive",
      employmentType: "FULL_TIME",
      startDate: "2021-01",
      isCurrent: true,
      description: "Digital marketing for B2B clients",
      responsibilities: [
        "Ran digital marketing campaigns for client accounts",
        "Built Zapier workflows for lead routing",
        "Reported campaign results in Google Analytics",
      ],
      skillsUsed: ["Zapier", "Google Analytics"],
      ...fact,
    },
  });
  for (const name of ["Zapier", "Google Analytics"])
    await db.prisma.candidateSkill.create({
      data: {
        userId: user.userId,
        name,
        nameNormalized: name.toLowerCase(),
        category: "TOOL",
        ...fact,
      },
    });
  await db.prisma.candidateEducation.create({
    data: {
      userId: user.userId,
      institution: "Test University",
      degree: "BBA",
      fieldOfStudy: "Marketing",
      endDate: "2020",
      ...fact,
    },
  });
  const company = await db.prisma.company.upsert({
    where: { nameNormalized: "readiness test co" },
    create: { name: "Readiness Test Co", nameNormalized: "readiness test co" },
    update: {},
  });
  const job = await db.prisma.job.create({
    data: {
      companyId: company.id,
      sourceKey: "ASHBY",
      sourceType: "ATS_PUBLIC_API",
      sourceStatus: "DISCOVERED",
      title: "Marketing Automation Associate",
      normalizedTitle: "marketing automation associate",
      description: JD,
      locationRaw: "Kolkata, India",
      city: "Kolkata",
      countryCode: "IN",
      remoteStatus: "HYBRID",
      employmentType: "FULL_TIME",
      jobUrl: `https://example.test/readiness/${label.replace(/\W/g, "")}`,
      contentHash: "c".repeat(63) + String(label.length % 10),
      visibility: "PUBLIC",
    },
  });
  await db.prisma.candidatePreferences.create({
    data: { userId: user.userId, workModes: ["HYBRID"], employmentTypes: ["FULL_TIME"] },
  });
  return { user, jobId: job.id };
}

/** Fake local AI: rewrites EVERY bullet it is given (and injects an unsupported claim once). */
function fullRewriteProvider(): AiProvider & { calls: StructuredRequest[] } {
  const calls: StructuredRequest[] = [];
  return {
    id: "fake",
    local: true,
    calls,
    async generateStructured(req) {
      calls.push(req);
      const user = req.messages.find((m) => m.role === "user")!.content;
      const items = user
        .split("<resume_items>")[1]!
        .split("</resume_items>")[0]!
        .split("\n")
        .filter((l) => / \| cites: /.test(l))
        .map((l) => {
          const [id, cites, text] = l.split(" | ");
          return { id: id!.trim(), refs: cites!.replace("cites: ", "").split(", "), text: text! };
        });
      return {
        json: {
          summary: {
            text: "Digital marketing executive who builds Zapier workflows and reports results in Google Analytics.",
            supportingFactRefs: items[0]!.refs,
            reason: "Leads with the job's automation focus.",
          },
          bulletChanges: items.map((i) => ({
            itemId: i.id,
            proposed: i.text.includes("Zapier")
              ? "Automated lead routing by building Zapier workflows"
              : i.text.includes("Google Analytics")
                ? "Reported campaign results to clients using Google Analytics"
                : "Ran digital marketing campaigns for client accounts using HubSpot and Python",
            reason: "Aligned with the job.",
            supportingFactRefs: i.refs,
          })),
          warnings: [],
        },
        usage: {},
        model: "fake-model",
      };
    },
    async health() {
      return { ok: true, model: "fake-model", modelAvailable: true, status: "READY" as const };
    },
  };
}

beforeAll(async () => {
  db = await startTestDb();
});
afterEach(() => setProvidersForTests(undefined));
afterAll(async () => db.stop());

describe("tailor → complete rewrite → missing skills → pass gate", () => {
  it("rewrites the whole resume, never adds skills you don't have, and blocks approval until it passes", async () => {
    const { user, jobId } = await setup("Readiness A");
    const master = (await createMasterResume(user)).resume;
    const provider = fullRewriteProvider();
    setProvidersForTests([provider]);

    // 1. Complete rewrite (default rewriteDepth = full).
    const first = await tailorResumeToJob(user, { sourceResumeId: master.id, jobId });
    expect(provider.calls[0]!.messages[1]!.content).toContain("FULL REWRITE");
    expect(first.aiStatus).toBe("USED");
    const doc1 = (await getResumeWorkspace(user, first.resumeId)).doc!;
    const bullets = doc1.experience.flatMap((e) => e.bullets.map((b) => b.text));
    expect(bullets).toContain("Automated lead routing by building Zapier workflows");
    expect(bullets).toContain("Reported campaign results to clients using Google Analytics");
    expect(doc1.summary?.origin).toBe("AI_REWRITE");
    // The bullet that tried to add HubSpot + Python was rejected — never inserted.
    expect(JSON.stringify(doc1)).not.toMatch(/HubSpot|Python/);
    expect(first.changeSet.rejected.length + first.changeSet.needsReview.length).toBeGreaterThan(0);

    // 2. HubSpot is required but not in the profile → listed as missing, approval blocked.
    const missing = await missingSkillsForJob(user, jobId);
    expect(missing.map((m) => [m.name, m.requirementType])).toEqual([["HubSpot", "REQUIRED"]]);
    const blocked = await getReadiness(user, first.resumeVersionId);
    expect(blocked.ready).toBe(false);
    expect(blocked.blockers.join(" ")).toMatch(/HubSpot/);
    await expect(
      approveVersion(
        user,
        first.resumeVersionId,
        (await getResumeWorkspace(user, first.resumeId)).version!.contentHash,
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      publicMessage: expect.stringMatching(/Not ready for approval/),
    });

    // 3. Only skills the job lists can be confirmed; the candidate confirms HubSpot.
    await expect(confirmSkillsForJob(user, jobId, [])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      confirmSkillsForJob(user, jobId, ["00000000-0000-4000-8000-000000000000"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await confirmSkillsForJob(user, jobId, [missing[0]!.requirementId])).toEqual([
      "HubSpot",
    ]);
    const saved = await db.prisma.candidateSkill.findFirstOrThrow({
      where: { userId: user.userId, name: "HubSpot" },
    });
    expect(saved.verificationStatus).toBe("USER_PROVIDED");
    expect(await missingSkillsForJob(user, jobId)).toEqual([]);

    // 4. Re-tailor: a NEW draft (facts changed) that includes HubSpot as a fact-backed skill.
    const second = await tailorResumeToJob(user, { sourceResumeId: master.id, jobId });
    expect(second.resumeVersionId).not.toBe(first.resumeVersionId);
    const doc2 = (await getResumeWorkspace(user, second.resumeId)).doc!;
    const hub = doc2.skills.flatMap((g) => g.skills).find((s) => s.name === "HubSpot")!;
    expect(hub).toMatchObject({ origin: "FACT", hidden: false });
    expect(hub.factRefs).toEqual([`skill:${saved.id}`]);
    expect(
      second.changeSet.changes.some((c) => c.label.includes('"HubSpot" added from your profile')),
    ).toBe(true);

    // 5. Passes → can be approved.
    const ready = await getReadiness(user, second.resumeVersionId);
    expect(ready.blockers).toEqual([]);
    expect(ready.ready).toBe(true);
    const hash = (await getResumeWorkspace(user, second.resumeId)).version!.contentHash;
    const approved = await approveVersion(user, second.resumeVersionId, hash);
    expect(approved.created).toBe(true);
    expect(
      parseResumeDocument((await getResumeWorkspace(user, second.resumeId)).version!.content).skills
        .length,
    ).toBeGreaterThan(0);
  });

  it("a required experience gap blocks approval (Phase 4 engine), even with every skill present", async () => {
    const { user, jobId } = await setup("Readiness B");
    await db.prisma.candidateExperience.updateMany({
      where: { userId: user.userId },
      data: { startDate: "2026-06" },
    });
    await confirmSkillsForJob(
      user,
      jobId,
      (await missingSkillsForJob(user, jobId)).map((m) => m.requirementId),
    );
    const master = (await createMasterResume(user)).resume;
    const res = await tailorResumeToJob(user, {
      sourceResumeId: master.id,
      jobId,
      options: { useAi: false },
    });
    const readiness = await getReadiness(user, res.resumeVersionId);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.join(" ")).toMatch(/2\+ years/);
  });

  it("targeted mode does not ask for a full rewrite", async () => {
    const { user, jobId } = await setup("Readiness C");
    const master = (await createMasterResume(user)).resume;
    const provider = fullRewriteProvider();
    setProvidersForTests([provider]);
    await tailorResumeToJob(user, {
      sourceResumeId: master.id,
      jobId,
      options: { rewriteDepth: "targeted" },
    });
    expect(provider.calls[0]!.messages[1]!.content).not.toContain("FULL REWRITE");
  });
});
