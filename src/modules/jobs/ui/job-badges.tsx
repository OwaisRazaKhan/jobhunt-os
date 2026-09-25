import { Badge, type Tone } from "@/components/ui/primitives";
import type { JobStatus, RemoteStatus } from "../types";

const STATUS: Record<JobStatus, { tone: Tone; label: string; title: string }> = {
  OPEN: { tone: "success", label: "Open", title: "Seen at the source on the last sync" },
  STALE: { tone: "warning", label: "Stale", title: "Not seen recently — may be closed" },
  CLOSED: { tone: "neutral", label: "Closed", title: "No longer listed at the source" },
  UNKNOWN: { tone: "neutral", label: "Unknown", title: "Status could not be determined" },
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} title={s.title}>
      {s.label}
    </Badge>
  );
}

const REMOTE: Record<RemoteStatus, { tone: Tone; label: string }> = {
  REMOTE: { tone: "info", label: "Remote" },
  HYBRID: { tone: "accent", label: "Hybrid" },
  ONSITE: { tone: "neutral", label: "On-site" },
  UNKNOWN: { tone: "neutral", label: "—" },
};

export function RemoteBadge({ status }: { status: RemoteStatus }) {
  const r = REMOTE[status];
  if (status === "UNKNOWN") {
    return (
      <span className="text-fg-subtle text-xs" title="Not stated by the source">
        —
      </span>
    );
  }
  return <Badge tone={r.tone}>{r.label}</Badge>;
}
