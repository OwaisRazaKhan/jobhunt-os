import "server-only";
import { recordAudit } from "@/server/audit";
import { decryptField, encryptField } from "@/server/crypto";
import { inSequence, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { inUserTx, type ActorRef } from "./facts.service";
import {
  ONBOARDING_STEPS,
  onboardingStepInput,
  preferencesInput,
  profileUpdateInput,
  targetLocationsInput,
  type OnboardingStep,
  type ProfileField,
} from "./schemas";

export interface OnboardingState {
  completed: OnboardingStep[];
  skipped: OnboardingStep[];
  lastStep?: OnboardingStep;
}

export function parseOnboardingState(value: unknown): OnboardingState {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<OnboardingState>;
  const valid = (steps: unknown) =>
    Array.isArray(steps)
      ? steps.filter((s): s is OnboardingStep => ONBOARDING_STEPS.includes(s))
      : [];
  return {
    completed: valid(raw.completed),
    skipped: valid(raw.skipped),
    lastStep: raw.lastStep && ONBOARDING_STEPS.includes(raw.lastStep) ? raw.lastStep : undefined,
  };
}

/** Decrypted view of the profile for the owner. */
export type ProfileView = Awaited<ReturnType<typeof getProfile>>;

export async function getProfile(actor: ActorRef, tx?: Tx) {
  return inUserTx(actor, tx, async (t) => {
    const profile = await t.candidateProfile.findUnique({ where: { userId: actor.userId } });
    if (!profile) return null;
    const { phoneEnc, professionalEmailEnc, ...rest } = profile;
    return {
      ...rest,
      phone: decryptField(phoneEnc),
      professionalEmail: decryptField(professionalEmailEnc),
      onboarding: parseOnboardingState(profile.onboardingState),
    };
  });
}

/** Create the (empty) profile on first use. Never pre-fills content. */
export async function ensureProfile(actor: ActorRef, tx?: Tx) {
  return inUserTx(actor, tx, async (t) => {
    const existing = await t.candidateProfile.findUnique({ where: { userId: actor.userId } });
    if (existing) return existing;
    const created = await t.candidateProfile.create({ data: { userId: actor.userId } });
    await recordAudit(t, {
      userId: actor.userId,
      action: "profile_created",
      resourceType: "candidate_profile",
      resourceId: created.id,
    });
    return created;
  });
}

const ENCRYPTED: Partial<Record<ProfileField, "phoneEnc" | "professionalEmailEnc">> = {
  phone: "phoneEnc",
  professionalEmail: "professionalEmailEnc",
};

export async function updateProfile(
  actor: ActorRef,
  rawInput: unknown,
  options: { auditAction?: "profile_updated" | "fact_approved"; tx?: Tx } = {},
) {
  const input = profileUpdateInput.parse(rawInput);
  return inUserTx(actor, options.tx, async (t) => {
    const profile = await ensureProfile(actor, t);
    const current = await getProfile(actor, t);
    const data: Record<string, unknown> = {};
    const changed: string[] = [];

    for (const [key, value] of Object.entries(input) as [ProfileField, unknown][]) {
      if (value === undefined) continue;
      const currentValue = (current as Record<string, unknown> | null)?.[key] ?? null;
      const normalizedCurrent =
        currentValue instanceof Date ? currentValue.toISOString().slice(0, 10) : currentValue;
      if ((normalizedCurrent ?? null) === (value ?? null)) continue;
      changed.push(key);
      const encryptedColumn = ENCRYPTED[key];
      if (encryptedColumn) data[encryptedColumn] = encryptField(value as string | null);
      else if (key === "availableFrom")
        data[key] = value ? new Date(`${value as string}T00:00:00.000Z`) : null;
      else data[key] = value;
    }

    if (changed.length === 0) return getProfile(actor, t);
    await t.candidateProfile.update({
      where: { id: profile.id },
      data: { ...data, verificationStatus: "USER_PROVIDED", verifiedAt: null },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: options.auditAction ?? "profile_updated",
      resourceType: "candidate_profile",
      resourceId: profile.id,
      metadata: { fields: changed },
    });
    return getProfile(actor, t);
  });
}

/** Explicit user attestation that the basic profile information is accurate. */
export async function verifyProfile(actor: ActorRef) {
  return inUserTx(actor, undefined, async (t) => {
    const profile = await t.candidateProfile.findUnique({ where: { userId: actor.userId } });
    if (!profile) throw new AppError("NOT_FOUND");
    await t.candidateProfile.update({
      where: { id: profile.id },
      data: { verificationStatus: "VERIFIED", verifiedAt: new Date() },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "profile_verified",
      resourceType: "candidate_profile",
      resourceId: profile.id,
    });
  });
}

export async function updateOnboarding(actor: ActorRef, rawInput: unknown) {
  const { step, action } = onboardingStepInput.parse(rawInput);
  return inUserTx(actor, undefined, async (t) => {
    const profile = await ensureProfile(actor, t);
    const state = parseOnboardingState(profile.onboardingState);
    const without = (steps: OnboardingStep[]) => steps.filter((s) => s !== step);
    const next: OnboardingState = {
      completed: action === "complete" ? [...without(state.completed), step] : state.completed,
      skipped:
        action === "skip"
          ? [...without(state.skipped), step]
          : action === "complete"
            ? without(state.skipped)
            : state.skipped,
      lastStep: step,
    };
    const finishing = step === "review" && action === "complete";
    await t.candidateProfile.update({
      where: { id: profile.id },
      data: {
        onboardingState: next as unknown as object,
        ...(finishing ? { onboardingCompletedAt: new Date(), profileStatus: "ACTIVE" } : {}),
      },
    });
    if (action !== "visit") {
      await recordAudit(t, {
        userId: actor.userId,
        action: finishing ? "onboarding_completed" : "onboarding_updated",
        resourceType: "candidate_profile",
        resourceId: profile.id,
        metadata: { step, action },
      });
    }
    return next;
  });
}

// --- Preferences ----------------------------------------------------------------

export async function getPreferences(actor: ActorRef, tx?: Tx) {
  return inUserTx(actor, tx, async (t) => {
    const [preferences, targetLocations] = await inSequence([
      () => t.candidatePreferences.findUnique({ where: { userId: actor.userId } }),
      () =>
        t.candidateTargetLocation.findMany({
          where: { userId: actor.userId },
          orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        }),
    ] as const);
    return { preferences, targetLocations };
  });
}

export async function updatePreferences(actor: ActorRef, rawInput: unknown) {
  const input = preferencesInput.parse(rawInput);
  return inUserTx(actor, undefined, async (t) => {
    const existing = await t.candidatePreferences.findUnique({ where: { userId: actor.userId } });
    const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const changed = Object.keys(data).filter(
      (key) =>
        JSON.stringify((existing as Record<string, unknown> | null)?.[key] ?? null) !==
        JSON.stringify(data[key] ?? null),
    );
    const saved = existing
      ? await t.candidatePreferences.update({ where: { id: existing.id }, data })
      : await t.candidatePreferences.create({ data: { ...data, userId: actor.userId } });
    if (changed.length > 0) {
      await recordAudit(t, {
        userId: actor.userId,
        action: "preference_updated",
        resourceType: "candidate_preferences",
        resourceId: saved.id,
        metadata: { fields: changed },
      });
    }
    return saved;
  });
}

export async function setTargetLocations(actor: ActorRef, rawInput: unknown) {
  const { locations } = targetLocationsInput.parse(rawInput);
  const unique = new Map<string, { countryCode: string; city: string | null }>();
  for (const loc of locations)
    unique.set(`${loc.countryCode}|${(loc.city ?? "").toLowerCase()}`, loc);
  return inUserTx(actor, undefined, async (t) => {
    const codes = Array.from(new Set(Array.from(unique.values(), (l) => l.countryCode)));
    const known = await t.country.count({ where: { code: { in: codes } } });
    if (known !== codes.length) {
      throw new AppError("VALIDATION_ERROR", {
        details: [{ path: "locations", message: "Unknown country" }],
      });
    }
    await t.candidateTargetLocation.deleteMany({ where: { userId: actor.userId } });
    let priority = 0;
    for (const loc of unique.values()) {
      await t.candidateTargetLocation.create({
        data: {
          userId: actor.userId,
          countryCode: loc.countryCode,
          city: loc.city,
          priority: priority++,
        },
      });
    }
    await recordAudit(t, {
      userId: actor.userId,
      action: "target_locations_updated",
      resourceType: "candidate_preferences",
      metadata: { count: unique.size, countries: codes },
    });
    return getPreferences(actor, t);
  });
}

export async function listCountries(actor: ActorRef) {
  return inUserTx(actor, undefined, (t) =>
    t.country.findMany({
      where: { isEnabled: true },
      orderBy: [{ isTargetMarket: "desc" }, { name: "asc" }],
      select: { code: true, name: true, isTargetMarket: true },
    }),
  );
}
