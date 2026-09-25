/**
 * Candidate Intelligence module — public server API. Other modules and
 * transports (pages, server actions, route handlers) import from here only.
 */
export {
  createFact,
  deleteFact,
  getFact,
  listFacts,
  restoreFact,
  updateFact,
  verifyFact,
  type ActorRef,
} from "./facts.service";
export {
  ensureProfile,
  getPreferences,
  getProfile,
  listCountries,
  setTargetLocations,
  updateOnboarding,
  updatePreferences,
  updateProfile,
  verifyProfile,
  type ProfileView,
} from "./profile.service";
export {
  deleteDocument,
  getDocument,
  getDocumentDownload,
  getDocumentStatus,
  listDocuments,
  processDocument,
  uploadDocument,
} from "./documents.service";
export {
  approveCandidate,
  bulkApproveCandidates,
  bulkRejectCandidates,
  bulkSafetyIssue,
  countPendingCandidates,
  listPendingCandidates,
  rejectCandidate,
} from "./review.service";
export {
  getCandidateFacts,
  getCandidateOverview,
  getFactsByCategory,
  getUsableCandidateFacts,
  getVerifiedCandidateFacts,
  resolveFactRefs,
  type CandidateFact,
  type CandidateOverview,
} from "./knowledge.service";
export {
  deleteCandidateData,
  exportCandidateData,
  listActivity,
  purgeSoftDeleted,
  purgeUserFiles,
} from "./account.service";
