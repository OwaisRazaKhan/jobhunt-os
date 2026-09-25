/** Result shape returned by every Server Action (never throws to the client). */
export interface ActionState {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Monotonic marker so clients can react to each completed submission. */
  at?: number;
  data?: Record<string, unknown>;
}

export const INITIAL_ACTION_STATE: ActionState = { ok: false };
