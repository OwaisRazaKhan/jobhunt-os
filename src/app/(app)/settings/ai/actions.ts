"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { testProvider } from "@/server/ai/orchestrator";
import { saveAiPreferences } from "@/server/ai/preferences";
import { runAction } from "@/server/action";
import { formDataToObject } from "@/lib/form-data";
import { requireActor } from "@/server/session";

/* Thin transport: authenticate -> parse -> service. Provider choice and privacy are enforced server-side. */

export async function saveAiPreferencesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await saveAiPreferences(actor.userId, formDataToObject(formData));
    revalidatePath("/settings/ai");
    return { message: "AI preferences saved." };
  });
}

export async function testProviderAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const kind = z.enum(["ollama", "gemini"]).parse(formData.get("provider"));
    const result = await testProvider(actor.userId, kind);
    revalidatePath("/settings/ai");
    if (!result.ok)
      return { ok: false, error: `${result.message} (${result.kind}, ${result.latencyMs} ms)` };
    return {
      message: `Real generation succeeded with ${result.model} in ${(result.latencyMs / 1000).toFixed(1)} s and passed schema validation.`,
    };
  });
}
