import "server-only";
import { recordAudit } from "@/server/audit";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import type { Actor } from "@/server/session";
import { assertCreatable, MANUAL_PROVENANCE, type Provenance } from "./provenance";
import { SECTION_SCHEMAS, type SectionKind } from "./schemas";
import { PROVENANCE_COLUMNS, SECTIONS } from "./sections";

/**
 * Generic use cases for every fact section (education, experience, skills…).
 * Ownership: every query is filtered by actor.userId AND runs under RLS.
 */

export type ActorRef = Pick<Actor, "userId">;

/** Use an existing transaction (composition) or open a user-scoped one. */
export function inUserTx<T>(actor: ActorRef, tx: Tx | undefined, fn: (tx: Tx) => Promise<T>) {
  return tx ? fn(tx) : withUserContext(actor.userId, fn);
}

export async function listFacts(actor: ActorRef, kind: SectionKind, tx?: Tx) {
  const section = SECTIONS[kind];
  return inUserTx(actor, tx, (t) =>
    section.delegate(t).findMany({
      where: { userId: actor.userId, deletedAt: null },
      orderBy: section.orderBy,
    }),
  );
}

export async function getFact(actor: ActorRef, kind: SectionKind, id: string, tx?: Tx) {
  return inUserTx(actor, tx, async (t) => {
    const record = await SECTIONS[kind]
      .delegate(t)
      .findFirst({ where: { id, userId: actor.userId, deletedAt: null } });
    if (!record) throw new AppError("NOT_FOUND");
    return record;
  });
}

async function assertReferences(
  t: Tx,
  actor: ActorRef,
  kind: SectionKind,
  data: Record<string, unknown>,
) {
  const owned = async (model: "experience" | "project", id: unknown) => {
    if (!id) return;
    const found = await SECTIONS[model]
      .delegate(t)
      .findFirst({ where: { id, userId: actor.userId, deletedAt: null }, select: { id: true } });
    if (!found) {
      throw new AppError("VALIDATION_ERROR", {
        details: [{ path: `${model}Id`, message: "Linked item not found" }],
      });
    }
  };
  if (kind === "achievement") {
    await owned("experience", data.experienceId);
    await owned("project", data.projectId);
  }
  if (kind === "portfolio") await owned("project", data.projectId);
  if (kind === "authorization") {
    const country = await t.country.findUnique({ where: { code: String(data.countryCode) } });
    if (!country) {
      throw new AppError("VALIDATION_ERROR", {
        details: [{ path: "countryCode", message: "Unknown country" }],
      });
    }
  }
}

export async function createFact(
  actor: ActorRef,
  kind: SectionKind,
  rawInput: unknown,
  provenance: Provenance = MANUAL_PROVENANCE,
  tx?: Tx,
) {
  assertCreatable(provenance);
  const input = SECTION_SCHEMAS[kind].parse(rawInput);
  const section = SECTIONS[kind];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry maps kind -> matching input type
  const data = (section.toData as (i: any) => Record<string, unknown>)(input);

  return inUserTx(actor, tx, async (t) => {
    await assertReferences(t, actor, kind, data);
    const record = await section.delegate(t).create({
      data: {
        ...data,
        userId: actor.userId,
        verificationStatus: provenance.verificationStatus,
        sourceType: provenance.sourceType,
        sourceDocumentId: provenance.sourceDocumentId ?? null,
        sourceFactCandidateId: provenance.sourceFactCandidateId ?? null,
        sourceExcerpt: provenance.sourceExcerpt ?? null,
        confidence: provenance.confidence ?? null,
        verifiedAt: null,
      },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: section.created,
      resourceType: section.resource,
      resourceId: record.id,
      metadata: {
        sourceType: provenance.sourceType,
        verificationStatus: provenance.verificationStatus,
      },
    });
    return record;
  });
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return (a instanceof Date ? a.getTime() : a) === (b instanceof Date ? b.getTime() : b);
  }
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return (a ?? null) === (b ?? null);
}

export async function updateFact(
  actor: ActorRef,
  kind: SectionKind,
  id: string,
  rawInput: unknown,
  tx?: Tx,
) {
  const input = SECTION_SCHEMAS[kind].parse(rawInput);
  const section = SECTIONS[kind];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see createFact
  const data = (section.toData as (i: any) => Record<string, unknown>)(input);

  return inUserTx(actor, tx, async (t) => {
    const existing = await getFact(actor, kind, id, t);
    await assertReferences(t, actor, kind, data);
    const changed = Object.keys(data).filter(
      (key) => !PROVENANCE_COLUMNS.has(key) && !sameValue(existing[key], data[key]),
    );
    if (changed.length === 0) return existing;
    const record = await section.delegate(t).update({
      where: { id: existing.id },
      data: {
        ...data,
        // Any content edit is a new user statement: verification must be redone.
        verificationStatus: "USER_PROVIDED",
        verifiedAt: null,
      },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: section.updated,
      resourceType: section.resource,
      resourceId: id,
      metadata: { fields: changed, previousStatus: existing.verificationStatus },
    });
    return record;
  });
}

/**
 * The ONLY way a fact becomes VERIFIED. Must be triggered by an explicit user
 * action in the UI — never called by AI or extraction code.
 */
export async function verifyFact(actor: ActorRef, kind: SectionKind, id: string, tx?: Tx) {
  const section = SECTIONS[kind];
  return inUserTx(actor, tx, async (t) => {
    const existing = await getFact(actor, kind, id, t);
    if (existing.verificationStatus === "VERIFIED") return existing;
    const record = await section.delegate(t).update({
      where: { id: existing.id },
      data: { verificationStatus: "VERIFIED", verifiedAt: new Date() },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "fact_verified",
      resourceType: section.resource,
      resourceId: id,
      metadata: { previousStatus: existing.verificationStatus },
    });
    return record;
  });
}

export async function deleteFact(actor: ActorRef, kind: SectionKind, id: string, tx?: Tx) {
  const section = SECTIONS[kind];
  return inUserTx(actor, tx, async (t) => {
    const existing = await getFact(actor, kind, id, t);
    await section
      .delegate(t)
      .update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    await recordAudit(t, {
      userId: actor.userId,
      action: "fact_deleted",
      resourceType: section.resource,
      resourceId: id,
    });
  });
}

export async function restoreFact(actor: ActorRef, kind: SectionKind, id: string, tx?: Tx) {
  const section = SECTIONS[kind];
  return inUserTx(actor, tx, async (t) => {
    const existing = await section
      .delegate(t)
      .findFirst({ where: { id, userId: actor.userId, deletedAt: { not: null } } });
    if (!existing) throw new AppError("NOT_FOUND");
    const record = await section.delegate(t).update({ where: { id }, data: { deletedAt: null } });
    await recordAudit(t, {
      userId: actor.userId,
      action: "fact_restored",
      resourceType: section.resource,
      resourceId: id,
    });
    return record;
  });
}
