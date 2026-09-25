import "server-only";
import type { Tx } from "./db";

/**
 * Audit trail writer. Called inside the same transaction as the change it
 * records. Metadata holds field NAMES and non-sensitive context only — never
 * raw personal values (phone, email, document text, descriptions).
 */
export type AuditAction =
  | "profile_created"
  | "profile_updated"
  | "profile_verified"
  | "onboarding_updated"
  | "onboarding_completed"
  | "education_created"
  | "education_updated"
  | "experience_created"
  | "experience_updated"
  | "achievement_created"
  | "achievement_updated"
  | "skill_created"
  | "skill_updated"
  | "project_created"
  | "project_updated"
  | "certification_created"
  | "certification_updated"
  | "portfolio_created"
  | "portfolio_updated"
  | "language_created"
  | "language_updated"
  | "authorization_created"
  | "authorization_updated"
  | "fact_verified"
  | "fact_deleted"
  | "fact_restored"
  | "preference_updated"
  | "target_locations_updated"
  | "document_uploaded"
  | "document_processed"
  | "document_processing_failed"
  | "document_deleted"
  | "document_downloaded"
  | "fact_created"
  | "fact_approved"
  | "fact_edited"
  | "fact_rejected"
  | "data_exported"
  | "sources_initialized"
  | "source_updated"
  | "source_enabled"
  | "source_disabled"
  | "source_auto_paused"
  | "job_created"
  | "job_updated"
  | "job_deleted"
  | "match_requested"
  | "match_completed"
  | "match_failed"
  | "match_invalidated"
  | "match_version_changed"
  | "search_profile_created"
  | "search_profile_updated"
  | "search_profile_duplicated"
  | "search_profile_enabled"
  | "search_profile_disabled"
  | "search_profile_deleted"
  | "search_config_updated"
  | "discovery_started"
  | "discovery_finished"
  | "source_tested";

export interface AuditEntry {
  userId: string;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, string | number | boolean | null | string[]>;
  actorType?: "USER" | "SYSTEM";
  requestId?: string | null;
}

export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: entry.userId,
      actorType: entry.actorType ?? "USER",
      actorId: entry.actorType === "SYSTEM" ? null : entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      metadata: entry.metadata ?? {},
      requestId: entry.requestId ?? null,
    },
  });
}
