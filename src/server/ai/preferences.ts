import "server-only";
import { z } from "zod";
import { getServerEnv } from "@/config/env";
import { recordAudit } from "@/server/audit";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";

/** User AI preferences (user-owned, RLS). Missing row = safe defaults. */
export interface AiPreferencesView {
  primaryProvider: "auto" | "ollama" | "gemini";
  geminiForPublic: boolean;
  allowPrivateCloud: boolean;
  privateCloudConsentedAt: Date | null;
  autoFallback: boolean;
}

export const DEFAULT_AI_PREFERENCES: AiPreferencesView = {
  primaryProvider: "auto",
  geminiForPublic: true,
  allowPrivateCloud: false,
  privateCloudConsentedAt: null,
  autoFallback: false,
};

export async function getAiPreferences(userId: string, tx?: Tx): Promise<AiPreferencesView> {
  const run = (t: Tx) => t.aiPreferences.findUnique({ where: { userId } });
  const row = await (tx ? run(tx) : withUserContext(userId, run));
  if (!row) return { ...DEFAULT_AI_PREFERENCES };
  return {
    primaryProvider: (["auto", "ollama", "gemini"].includes(row.primaryProvider)
      ? row.primaryProvider
      : "auto") as AiPreferencesView["primaryProvider"],
    geminiForPublic: row.geminiForPublic,
    allowPrivateCloud: row.allowPrivateCloud,
    privateCloudConsentedAt: row.privateCloudConsentedAt,
    autoFallback: row.autoFallback,
  };
}

const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());
export const aiPreferencesInput = z.object({
  primaryProvider: z.enum(["auto", "ollama", "gemini"]).default("auto"),
  geminiForPublic: checkbox,
  allowPrivateCloud: checkbox,
  autoFallback: checkbox,
});

/**
 * Saves preferences. Enabling private cloud processing is refused server-side unless the
 * operator switch AI_ALLOW_PRIVATE_GEMINI is on — a frontend value can never override it.
 */
export async function saveAiPreferences(userId: string, raw: unknown) {
  const input = aiPreferencesInput.parse(raw);
  const env = getServerEnv();
  if (input.allowPrivateCloud && !env.AI_ALLOW_PRIVATE_GEMINI) {
    throw new AppError("VALIDATION_ERROR", {
      publicMessage:
        "Cloud processing of private candidate data is disabled on this server (AI_ALLOW_PRIVATE_GEMINI=false).",
      details: [{ path: "allowPrivateCloud", message: "Disabled by the server configuration" }],
    });
  }
  return withUserContext(userId, async (t) => {
    const before = await getAiPreferences(userId, t);
    const consentedAt = input.allowPrivateCloud
      ? before.allowPrivateCloud
        ? (before.privateCloudConsentedAt ?? new Date())
        : new Date()
      : null;
    const data = { ...input, privateCloudConsentedAt: consentedAt };
    await t.aiPreferences.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    const changed = (Object.keys(input) as (keyof typeof input)[]).filter(
      (k) => before[k] !== input[k],
    );
    if (changed.length) {
      await recordAudit(t, {
        userId,
        action: "ai_preferences_updated",
        resourceType: "ai_preferences",
        resourceId: userId,
        metadata: { fields: changed },
      });
    }
    if (input.allowPrivateCloud !== before.allowPrivateCloud) {
      await recordAudit(t, {
        userId,
        action: input.allowPrivateCloud ? "private_cloud_ai_enabled" : "private_cloud_ai_disabled",
        resourceType: "ai_preferences",
        resourceId: userId,
      });
    }
    return getAiPreferences(userId, t);
  });
}
