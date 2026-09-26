import type { Tone } from "@/components/ui/primitives";
import type { ContentSource, VersionStatus } from "../types";

export { ago } from "@/modules/resumes/ui/labels";

export const STATUS_TONES: Record<VersionStatus, Tone> = {
  DRAFT: "neutral",
  READY_FOR_REVIEW: "info",
  APPROVED: "success",
  REJECTED: "danger",
  ARCHIVED: "neutral",
};

export const SOURCE_TONES: Record<ContentSource, Tone> = {
  AI_GENERATED: "ai",
  AI_ASSISTED: "ai",
  USER_AUTHORED: "neutral",
  IMPORTED: "neutral",
  RESTORED: "neutral",
};

export const SEVERITY_TONES: Record<string, Tone> = {
  PASS: "success",
  INFO: "neutral",
  WARNING: "warning",
  CRITICAL: "danger",
};
