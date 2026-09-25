"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Accessible modal built on the native <dialog> element: focus trapping,
 * Escape to close and inert background come from the browser.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={`m-auto max-h-[90vh] w-[calc(100%-2rem)] ${wide ? "max-w-2xl" : "max-w-lg"} border-border-strong bg-surface-1 text-fg overflow-hidden rounded-lg border p-0 shadow-2xl backdrop:bg-black/60 open:flex open:flex-col`}
    >
      <div className="border-border flex items-start justify-between gap-4 border-b px-4 py-3">
        <div>
          <h2 id={titleId} className="text-sm font-semibold">
            {title}
          </h2>
          {description && (
            <p id={descId} className="text-fg-muted mt-0.5 text-xs">
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-fg-muted hover:bg-surface-2 hover:text-fg rounded-sm p-1"
          aria-label="Close dialog"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="overflow-y-auto px-4 py-4">{open && children}</div>
    </dialog>
  );
}
