"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { inputClass } from "@/components/forms/field-control";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { authClient } from "@/lib/auth-client";
import { deleteCandidateDataAction } from "../candidate/actions";

export function DeleteCandidateData() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(deleteCandidateDataAction, INITIAL_ACTION_STATE);
  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        Delete candidate data
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete all candidate data?"
        description="Removes your profile, every fact, preference, document and uploaded file. Your account stays. This cannot be undone."
      >
        {state.ok ? (
          <p role="status" className="text-success text-sm">
            {state.message}
          </p>
        ) : (
          <form action={action} className="flex flex-col gap-3">
            <label htmlFor="confirm-delete" className="text-fg-muted text-xs">
              Type <span className="text-fg font-mono">DELETE</span> to confirm
            </label>
            <input id="confirm-delete" name="confirm" autoComplete="off" className={inputClass} />
            {state.error && (
              <p role="alert" className="text-danger text-sm">
                {state.error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" disabled={pending}>
                {pending ? "Deleting…" : "Delete everything"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

export function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        Delete account
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account?"
        description="Deletes your account, sessions, all candidate data, uploaded files and your activity history. Shared reference data is not affected. This cannot be undone."
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            setPending(true);
            const password = String(new FormData(event.currentTarget).get("password") ?? "");
            const result = await authClient.deleteUser({ password });
            setPending(false);
            if (result.error) {
              setError(result.error.message ?? "Could not delete the account.");
              return;
            }
            router.push("/sign-up");
            router.refresh();
          }}
        >
          <label htmlFor="delete-password" className="text-fg-muted text-xs">
            Confirm with your password
          </label>
          <input
            id="delete-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={inputClass}
          />
          {error && (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? "Deleting…" : "Permanently delete account"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
