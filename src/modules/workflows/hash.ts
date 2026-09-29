import { createHash } from "node:crypto";
import { canonicalJson, type WorkflowDefinition } from "./definition";

/** Stable SHA-256 of a definition (canonical JSON, sorted keys). */
export function definitionHash(def: WorkflowDefinition): string {
  return createHash("sha256").update(canonicalJson(def)).digest("hex");
}
