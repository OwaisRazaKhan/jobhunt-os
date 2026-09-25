import "server-only";
import type { AtsSourceKey } from "../../sources.schemas";
import { ashbyAdapter } from "./ashby";
import { greenhouseAdapter } from "./greenhouse";
import { leverAdapter } from "./lever";
import type { SourceAdapter } from "./types";

/** Adapter registry. Adding a source = one adapter file + fixtures + tests. */
export const ADAPTERS: Record<AtsSourceKey, SourceAdapter> = {
  ASHBY: ashbyAdapter,
  LEVER: leverAdapter,
  GREENHOUSE: greenhouseAdapter,
};
