"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ActionForm } from "@/components/forms/action-form";
import type { FieldContext } from "@/components/forms/field-control";
import {
  completeOnboardingStepAction,
  savePreferencesAction,
  saveProfileAction,
} from "@/app/(app)/candidate/actions";
import type { FieldDef } from "../form-fields";
import { TargetLocationsEditor } from "./profile-editors";

/** A form step that saves, marks the step complete, then moves to the next step. */
export function OnboardingFormStep({
  step,
  target,
  fields,
  values,
  context,
}: {
  step: string;
  target: "profile" | "preferences";
  fields: FieldDef[];
  values: Record<string, unknown>;
  context?: FieldContext;
}) {
  const router = useRouter();
  const [navigating, startTransition] = useTransition();
  return (
    <ActionForm
      action={target === "profile" ? saveProfileAction : savePreferencesAction}
      fields={fields}
      values={values}
      context={context}
      submitLabel={navigating ? "Continuing…" : "Save & continue"}
      onSuccess={() =>
        startTransition(async () => {
          router.push(await completeOnboardingStepAction(step));
        })
      }
    />
  );
}

export function OnboardingLocationsStep({
  initial,
  countries,
}: {
  initial: { countryCode: string; city: string | null }[];
  countries: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <TargetLocationsEditor
      initial={initial}
      countries={countries}
      onSaved={() =>
        startTransition(async () => {
          router.push(await completeOnboardingStepAction("countries"));
        })
      }
    />
  );
}
