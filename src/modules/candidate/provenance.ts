import type { FactSourceType, VerificationStatus } from "@/generated/prisma/enums";
import type { DocumentType } from "./options";

/**
 * Provenance rules (docs/domain-architecture.md §1.2).
 *
 *  - A fact is never CREATED as VERIFIED. VERIFIED is reachable only through the
 *    explicit user verification use case (verifyFact / individual approval).
 *  - Editing a fact's content resets it to USER_PROVIDED.
 *  - AI output never touches verification_status.
 */
export interface Provenance {
  verificationStatus: Exclude<VerificationStatus, "VERIFIED">;
  sourceType: FactSourceType;
  sourceDocumentId?: string | null;
  sourceFactCandidateId?: string | null;
  sourceExcerpt?: string | null;
  confidence?: number | null;
}

export const MANUAL_PROVENANCE: Provenance = {
  verificationStatus: "USER_PROVIDED",
  sourceType: "MANUAL_ENTRY",
};

export class ProvenanceViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvenanceViolation";
  }
}

/** Guard used by every create path (defence in depth on top of the type). */
export function assertCreatable(provenance: { verificationStatus: string }): void {
  if (provenance.verificationStatus === "VERIFIED") {
    throw new ProvenanceViolation(
      "Facts cannot be created as VERIFIED; only a user verification can set it",
    );
  }
}

/** Source type recorded when a user approves an extracted fact. */
export function sourceTypeForApproval(documentType: string, method: "RULE" | "AI"): FactSourceType {
  if (method === "AI") return "USER_APPROVED_AI_EXTRACTION";
  const map: Partial<Record<DocumentType, FactSourceType>> = {
    CV_RESUME: "CV_IMPORT",
    PORTFOLIO: "PORTFOLIO_IMPORT",
  };
  return map[documentType as DocumentType] ?? "DOCUMENT_IMPORT";
}

export const VERIFICATION_ORDER: Record<VerificationStatus, number> = {
  VERIFIED: 3,
  USER_PROVIDED: 2,
  NEEDS_REVIEW: 1,
  AI_INFERRED: 0,
};

/** Facts usable as ground truth by future generation features. */
export function isUsableStatus(status: VerificationStatus): boolean {
  return status === "VERIFIED" || status === "USER_PROVIDED";
}
