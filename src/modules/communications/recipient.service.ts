import "server-only";
import { z } from "zod";
import { recordAudit } from "@/server/audit";
import { withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { RECIPIENT_TYPES, TONES, LENGTHS } from "./types";

/**
 * Recipient contexts (reusable, owner-only) and communication preferences.
 * Recipient details are only what the candidate already knows or a legitimate source supplied —
 * never discovered, inferred or generated. "Source verified" requires a citable public source.
 */

export type ActorRef = { userId: string };

export const RECIPIENT_SOURCES = [
  "JOB_POST",
  "OFFICIAL_COMPANY_PAGE",
  "USER_PROVIDED",
  "PUBLIC_PROFESSIONAL_SOURCE",
  "PHASE_8_DISCOVERY",
  "UNKNOWN",
] as const;
export const VERIFIABLE_SOURCES = [
  "JOB_POST",
  "OFFICIAL_COMPANY_PAGE",
  "PUBLIC_PROFESSIONAL_SOURCE",
] as const;
export const VERIFICATION_STATUSES = ["SOURCE_VERIFIED", "UNVERIFIED", "INVALID", "STALE"] as const;
export const CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;

export const SOURCE_LABELS: Record<(typeof RECIPIENT_SOURCES)[number], string> = {
  JOB_POST: "Job post",
  OFFICIAL_COMPANY_PAGE: "Official company page",
  USER_PROVIDED: "Provided by you",
  PUBLIC_PROFESSIONAL_SOURCE: "Public professional source",
  PHASE_8_DISCOVERY: "Phase 8 discovery",
  UNKNOWN: "Unknown",
};

const opt = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullable().default(null),
  );

export const recipientContextInput = z
  .object({
    name: opt(200),
    title: opt(200),
    company: opt(200),
    email: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(254).email("Enter a valid email").nullable().default(null),
    ),
    recipientType: z.enum(RECIPIENT_TYPES).default("UNKNOWN"),
    source: z.enum(RECIPIENT_SOURCES).default("USER_PROVIDED"),
    sourceUrl: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z
        .url({ protocol: /^https?$/ })
        .max(2048)
        .nullable()
        .default(null),
    ),
    /** The candidate confirms they saw these exact details at the source URL */
    markVerified: z
      .preprocess((v) => v === true || v === "on" || v === "true", z.boolean())
      .default(false),
    verificationStatus: z.enum(["UNVERIFIED", "INVALID", "STALE"]).optional(),
    confidence: z.enum(CONFIDENCES).default("MEDIUM"),
    notes: opt(2000),
    companyId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()).default(null),
  })
  .refine((v) => v.name || v.email || v.title || v.company, {
    message: "Enter at least a name, title, company or email",
    path: ["name"],
  })
  .refine(
    (v) =>
      !v.markVerified ||
      ((VERIFIABLE_SOURCES as readonly string[]).includes(v.source) && v.sourceUrl),
    {
      message:
        "Only details from a job post, official company page or public professional source — with its link — can be marked verified",
      path: ["markVerified"],
    },
  );

export async function listRecipientContexts(
  actor: ActorRef,
  opts: { companyId?: string | null } = {},
) {
  return withUserContext(actor.userId, (t) =>
    t.recipientContext.findMany({
      where: {
        userId: actor.userId,
        ...(opts.companyId ? { OR: [{ companyId: opts.companyId }, { companyId: null }] } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  );
}

export async function getRecipientContext(actor: ActorRef, id: string) {
  const r = await withUserContext(actor.userId, (t) =>
    t.recipientContext.findFirst({ where: { id, userId: actor.userId } }),
  );
  if (!r) throw new AppError("NOT_FOUND");
  return r;
}

export async function saveRecipientContext(actor: ActorRef, raw: unknown, id?: string | null) {
  const input = recipientContextInput.parse(raw);
  return withUserContext(actor.userId, async (t) => {
    const existing = id
      ? await t.recipientContext.findFirst({ where: { id, userId: actor.userId } })
      : null;
    if (id && !existing) throw new AppError("NOT_FOUND");
    if (
      input.companyId &&
      !(await t.company.findFirst({ where: { id: input.companyId }, select: { id: true } }))
    )
      throw new AppError("NOT_FOUND");
    const identityChanged =
      existing &&
      (existing.email !== input.email ||
        existing.name !== input.name ||
        existing.sourceUrl !== input.sourceUrl ||
        existing.source !== input.source);
    // Verification is an explicit confirmation of these exact details; changing them resets it.
    const verificationStatus = input.markVerified
      ? "SOURCE_VERIFIED"
      : (input.verificationStatus ??
        (existing && !identityChanged && existing.verificationStatus !== "SOURCE_VERIFIED"
          ? existing.verificationStatus
          : "UNVERIFIED"));
    const data = {
      name: input.name,
      title: input.title,
      company: input.company,
      email: input.email?.toLowerCase() ?? null,
      recipientType: input.recipientType,
      source: input.source,
      sourceUrl: input.sourceUrl,
      verificationStatus,
      verifiedAt:
        verificationStatus === "SOURCE_VERIFIED"
          ? existing?.verificationStatus === "SOURCE_VERIFIED" && !identityChanged
            ? existing.verifiedAt
            : new Date()
          : null,
      confidence: input.confidence,
      notes: input.notes,
      companyId: input.companyId,
    };
    const saved = existing
      ? await t.recipientContext.update({ where: { id: existing.id }, data })
      : await t.recipientContext.create({ data: { ...data, userId: actor.userId } });
    await recordAudit(t, {
      userId: actor.userId,
      action: "recipient_context_saved",
      resourceType: "recipient_context",
      resourceId: saved.id,
      metadata: {
        source: saved.source,
        verificationStatus: saved.verificationStatus,
        created: !existing,
      },
    });
    return saved;
  });
}

export async function deleteRecipientContext(actor: ActorRef, id: string) {
  return withUserContext(actor.userId, async (t) => {
    const { count } = await t.recipientContext.deleteMany({ where: { id, userId: actor.userId } });
    if (!count) throw new AppError("NOT_FOUND");
    await recordAudit(t, {
      userId: actor.userId,
      action: "recipient_context_deleted",
      resourceType: "recipient_context",
      resourceId: id,
    });
  });
}

/** Addresses a communication to a saved recipient (inline fields mirror it; links the context). */
export async function applyRecipientToCommunication(
  actor: ActorRef,
  communicationId: string,
  recipientContextId: string | null,
) {
  return withUserContext(actor.userId, async (t) => {
    const c = await t.communication.findFirst({
      where: { id: communicationId, userId: actor.userId },
    });
    if (!c) throw new AppError("NOT_FOUND");
    if (!recipientContextId) {
      return t.communication.update({ where: { id: c.id }, data: { recipientContextId: null } });
    }
    const r = await t.recipientContext.findFirst({
      where: { id: recipientContextId, userId: actor.userId },
    });
    if (!r) throw new AppError("NOT_FOUND");
    const updated = await t.communication.update({
      where: { id: c.id },
      data: {
        recipientContextId: r.id,
        recipientType: r.recipientType,
        recipientName: r.name,
        recipientTitle: r.title,
        recipientCompany: r.company ?? c.recipientCompany,
        recipientEmail: r.email,
        recipientSource:
          r.sourceUrl ?? SOURCE_LABELS[r.source as (typeof RECIPIENT_SOURCES)[number]],
        recipientVerification: r.source === "USER_PROVIDED" ? "USER_PROVIDED" : "UNVERIFIED",
      },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "communication_edited",
      resourceType: "communication",
      resourceId: c.id,
      metadata: { recipientContextId: r.id },
    });
    return updated;
  });
}

// --- Communication preferences ---------------------------------------------------------------

export const preferencesInput = z.object({
  preferredGreeting: opt(40),
  preferredClosing: opt(60),
  defaultTone: z.preprocess((v) => (v === "" ? null : v), z.enum(TONES).nullable()).default(null),
  defaultLength: z
    .preprocess((v) => (v === "" ? null : v), z.enum(LENGTHS).nullable())
    .default(null),
  avoidPhrases: z
    .preprocess(
      (v) =>
        typeof v === "string"
          ? v
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : v,
      z.array(z.string().max(200)).max(30),
    )
    .default([]),
});

export interface CommunicationPreferencesView {
  preferredGreeting: string | null;
  preferredClosing: string | null;
  defaultTone: string | null;
  defaultLength: string | null;
  avoidPhrases: string[];
}

export const EMPTY_PREFERENCES: CommunicationPreferencesView = {
  preferredGreeting: null,
  preferredClosing: null,
  defaultTone: null,
  defaultLength: null,
  avoidPhrases: [],
};

export async function getCommunicationPreferences(
  actor: ActorRef,
): Promise<CommunicationPreferencesView> {
  const row = await withUserContext(actor.userId, (t) =>
    t.communicationPreference.findUnique({ where: { userId: actor.userId } }),
  );
  return row
    ? {
        preferredGreeting: row.preferredGreeting,
        preferredClosing: row.preferredClosing,
        defaultTone: row.defaultTone,
        defaultLength: row.defaultLength,
        avoidPhrases: row.avoidPhrases,
      }
    : EMPTY_PREFERENCES;
}

export async function saveCommunicationPreferences(actor: ActorRef, raw: unknown) {
  const input = preferencesInput.parse(raw);
  return withUserContext(actor.userId, async (t) => {
    const saved = await t.communicationPreference.upsert({
      where: { userId: actor.userId },
      create: { ...input, userId: actor.userId },
      update: input,
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "communication_preferences_saved",
      resourceType: "communication_preferences",
      resourceId: saved.id,
    });
    return saved;
  });
}

/** Companies the user works with (matched jobs, communications, packages) for linking recipients. */
export async function listCompanyOptions(actor: ActorRef) {
  return withUserContext(actor.userId, async (t) => {
    const [matches, comms, pkgs] = [
      await t.jobMatch.findMany({
        where: { userId: actor.userId, isCurrent: true },
        select: { job: { select: { companyId: true } } },
        take: 100,
      }),
      await t.communication.findMany({
        where: { userId: actor.userId, companyId: { not: null } },
        select: { companyId: true },
        take: 100,
      }),
      await t.communicationPackage.findMany({
        where: { userId: actor.userId, companyId: { not: null } },
        select: { companyId: true },
        take: 100,
      }),
    ];
    const ids = [
      ...new Set([
        ...matches.map((m) => m.job.companyId),
        ...comms.map((c) => c.companyId!),
        ...pkgs.map((p) => p.companyId!),
      ]),
    ];
    const companies = await t.company.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return companies.map((c) => ({ value: c.id, label: c.name }));
  });
}
