import { CheckCircle2, Circle, CircleSlash } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, ProgressBar } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import {
  PREFERENCE_FIELDS,
  PROFILE_BASIC_FIELDS,
  PROFILE_GOAL_FIELDS,
  ROLE_FIELDS,
} from "@/modules/candidate/form-fields";
import { ONBOARDING_STEPS, type OnboardingStep } from "@/modules/candidate/schemas";
import { FactSection, SkillsSection } from "@/modules/candidate/ui/fact-sections";
import {
  OnboardingFormStep,
  OnboardingLocationsStep,
} from "@/modules/candidate/ui/onboarding-form-step";
import {
  CompletenessCard,
  ReadinessCard,
  WarningsCard,
} from "@/modules/candidate/ui/profile-panels";
import { requireActorOrRedirect } from "@/server/session";
import { onboardingAction } from "../actions";
import { loadCandidate } from "../load";

export const metadata: Metadata = { title: "Onboarding · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const STEP_INFO: Record<OnboardingStep, { title: string; description: string }> = {
  basic: {
    title: "Basic professional information",
    description: "Name, headline, location, contact details and links.",
  },
  education: {
    title: "Education",
    description:
      "Degrees, diplomas and current studies. Leave dates empty if you are unsure — never guess.",
  },
  experience: {
    title: "Experience",
    description: "Jobs, freelance work, internships and businesses you have run.",
  },
  skills: {
    title: "Skills",
    description: "Add skills and rate your own proficiency. Nothing is inferred for you.",
  },
  projects: {
    title: "Projects",
    description:
      "Projects are key evidence for tailored applications later. Add real outcomes only.",
  },
  certifications: {
    title: "Certifications",
    description: "Optional. Add only certifications you actually hold.",
  },
  portfolio: {
    title: "Portfolio",
    description: "Websites, repositories, case studies, campaigns, designs, videos.",
  },
  languages: {
    title: "Languages",
    description: "Your own assessment of each language (CEFR A1–C2 or native).",
  },
  goals: {
    title: "Career goals",
    description: "What you are aiming for, and when you are available.",
  },
  countries: {
    title: "Target countries",
    description: "Where you want to work. You can add cities too.",
  },
  roles: { title: "Target roles", description: "The roles and industries you are targeting." },
  preferences: {
    title: "Work preferences",
    description: "Work mode, employment type, level, company preferences and salary.",
  },
  authorization: {
    title: "Work authorization",
    description: "Your stated situation per country. This is not an eligibility assessment.",
  },
  review: {
    title: "Review",
    description: "Check completeness and resolve anything that needs attention.",
  },
};

export default async function OnboardingPage({ searchParams }: PageProps<"/candidate/onboarding">) {
  const actor = await requireActorOrRedirect();
  const params = await searchParams;
  const requested = typeof params.step === "string" ? params.step : undefined;
  const { overview, context, countryOptions } = await loadCandidate(actor);
  const state = overview.profile?.onboarding ?? { completed: [], skipped: [] };
  const step: OnboardingStep = ONBOARDING_STEPS.includes(requested as OnboardingStep)
    ? (requested as OnboardingStep)
    : (ONBOARDING_STEPS.find((s) => !state.completed.includes(s) && !state.skipped.includes(s)) ??
      "review");
  const index = ONBOARDING_STEPS.indexOf(step);
  const done = state.completed.length;
  const info = STEP_INFO[step];
  const profile = (overview.profile ?? {}) as Record<string, unknown>;
  const prefs = (overview.preferences ?? {}) as Record<string, unknown>;

  const content: Record<OnboardingStep, ReactNode> = {
    basic: (
      <OnboardingFormStep
        step="basic"
        target="profile"
        fields={PROFILE_BASIC_FIELDS}
        values={profile}
        context={context}
      />
    ),
    education: <FactSection kind="education" rows={overview.education} context={context} />,
    experience: (
      <FactSection
        kind="experience"
        rows={overview.experiences}
        achievements={overview.achievements}
        context={context}
      />
    ),
    skills: <SkillsSection skills={overview.skills} context={context} />,
    projects: <FactSection kind="project" rows={overview.projects} context={context} />,
    certifications: (
      <FactSection kind="certification" rows={overview.certifications} context={context} />
    ),
    portfolio: <FactSection kind="portfolio" rows={overview.portfolio} context={context} />,
    languages: <FactSection kind="language" rows={overview.languages} context={context} />,
    goals: (
      <OnboardingFormStep
        step="goals"
        target="profile"
        fields={PROFILE_GOAL_FIELDS}
        values={profile}
      />
    ),
    countries: (
      <Card>
        <CardHeader title="Target countries & cities" />
        <div className="p-4">
          <OnboardingLocationsStep initial={overview.targetLocations} countries={countryOptions} />
        </div>
      </Card>
    ),
    roles: (
      <OnboardingFormStep step="roles" target="preferences" fields={ROLE_FIELDS} values={prefs} />
    ),
    preferences: (
      <OnboardingFormStep
        step="preferences"
        target="preferences"
        fields={PREFERENCE_FIELDS}
        values={prefs}
      />
    ),
    authorization: (
      <FactSection kind="authorization" rows={overview.authorizations} context={context} />
    ),
    review: (
      <div className="grid gap-4 md:grid-cols-2">
        <CompletenessCard overview={overview} />
        <div className="flex flex-col gap-4">
          <ReadinessCard overview={overview} />
          <WarningsCard overview={overview} />
        </div>
      </div>
    ),
  };
  const isFormStep = ["basic", "goals", "roles", "preferences", "countries"].includes(step);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Onboarding steps" className="lg:sticky lg:top-6 lg:self-start">
        <p className="text-fg-subtle font-mono text-[11px] tracking-wide uppercase">
          Build your profile
        </p>
        <div className="mt-2 mb-3">
          <ProgressBar value={(done / ONBOARDING_STEPS.length) * 100} label="Onboarding progress" />
          <p className="text-fg-muted mt-1 text-xs">
            {done} of {ONBOARDING_STEPS.length} steps completed
          </p>
        </div>
        <ol className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
          {ONBOARDING_STEPS.map((s, i) => {
            const completed = state.completed.includes(s);
            const skipped = state.skipped.includes(s);
            return (
              <li key={s} className="shrink-0">
                <Link
                  href={`/candidate/onboarding?step=${s}`}
                  aria-current={s === step ? "step" : undefined}
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-md px-2 text-xs whitespace-nowrap",
                    s === step
                      ? "bg-surface-3 text-fg"
                      : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {completed ? (
                    <CheckCircle2 className="text-success size-3.5" aria-label="Completed" />
                  ) : skipped ? (
                    <CircleSlash className="text-fg-subtle size-3.5" aria-label="Skipped" />
                  ) : (
                    <Circle className="text-fg-subtle size-3.5" aria-hidden />
                  )}
                  <span className="text-fg-subtle font-mono text-[10px]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {STEP_INFO[s].title.replace(
                    "Basic professional information",
                    "Basic information",
                  )}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <p className="text-fg-subtle font-mono text-[11px]">
            Step {index + 1} of {ONBOARDING_STEPS.length}
          </p>
          <h1 className="mt-0.5 text-lg font-semibold tracking-tight">{info.title}</h1>
          <p className="text-fg-muted mt-1 text-sm">{info.description}</p>
        </div>
        {content[step]}
        <form
          action={onboardingAction}
          className="border-border flex flex-wrap items-center justify-between gap-2 border-t pt-4"
        >
          <input type="hidden" name="step" value={step} />
          <Button type="submit" name="action" value="exit" variant="ghost">
            Save draft & continue later
          </Button>
          <div className="flex gap-2">
            {step !== "review" && (
              <Button type="submit" name="action" value="skip" variant="secondary">
                Skip for now
              </Button>
            )}
            {!isFormStep && (
              <Button type="submit" name="action" value="complete" variant="primary">
                {step === "review" ? "Finish onboarding" : "Continue"}
              </Button>
            )}
          </div>
        </form>
        {isFormStep && (
          <p className="text-fg-subtle text-xs">
            Use “Save & continue” above to save this step. Everything you save is kept as a draft.
          </p>
        )}
      </div>
    </div>
  );
}
