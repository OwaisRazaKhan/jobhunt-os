import { Badge, type Tone } from "@/components/ui/primitives";
import { HEALTH_LABELS, type SourceHealth, type HealthStatus } from "../source-health";

const HEALTH_TONE: Record<HealthStatus, Tone> = {
  HEALTHY: "success",
  DEGRADED: "warning",
  FAILING: "danger",
  UNTESTED: "neutral",
  DISABLED: "neutral",
  NOT_APPLICABLE: "neutral",
};

export function HealthBadge({ health }: { health: SourceHealth }) {
  return (
    <>
      <Badge tone={HEALTH_TONE[health.status]}>{HEALTH_LABELS[health.status]}</Badge>
      {health.sample > 0 && (
        <span className="text-fg-subtle mt-1 block text-[11px]">
          {health.succeeded}/{health.sample} succeeded
          {health.consecutiveFailures > 0 ? ` · ${health.consecutiveFailures} failed in a row` : ""}
        </span>
      )}
    </>
  );
}
