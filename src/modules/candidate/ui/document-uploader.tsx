"use client";

import { CheckCircle2, FileUp, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { inputClass } from "@/components/forms/field-control";
import { Button, buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { DOCUMENT_TYPES, optionLabel } from "../options";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; name: string }
  | { kind: "processing"; id: string; name: string }
  | { kind: "done"; id: string; name: string; pending: number; aiStatus: string | null }
  | { kind: "failed"; message: string; id?: string };

const ACCEPT =
  ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

export function DocumentUploader({
  maxMb,
  aiAvailable,
  defaultType = "CV_RESUME",
}: {
  maxMb: number;
  aiAvailable: boolean;
  defaultType?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [documentType, setDocumentType] = useState(defaultType);
  const [useAi, setUseAi] = useState(aiAvailable);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (phase.kind !== "processing") return;
    let cancelled = false;
    const poll = async () => {
      for (let attempt = 0; attempt < 240 && !cancelled; attempt++) {
        await new Promise((r) => setTimeout(r, 1500));
        const res = await fetch(`/api/v1/candidate/documents/${phase.id}`, {
          cache: "no-store",
        }).catch(() => null);
        if (!res?.ok) continue;
        const { data } = (await res.json()) as {
          data: {
            status: string;
            pending: number;
            aiStatus: string | null;
            errorMessage: string | null;
          };
        };
        if (data.status === "PROCESSED") {
          setPhase({
            kind: "done",
            id: phase.id,
            name: phase.name,
            pending: data.pending,
            aiStatus: data.aiStatus,
          });
          router.refresh();
          return;
        }
        if (data.status === "FAILED") {
          setPhase({
            kind: "failed",
            id: phase.id,
            message:
              data.errorMessage ?? "CV extraction failed. You can enter the information manually.",
          });
          router.refresh();
          return;
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [phase, router]);

  async function upload(file: File) {
    if (file.size > maxMb * 1024 * 1024) {
      setPhase({ kind: "failed", message: `Document too large. The maximum size is ${maxMb} MB.` });
      return;
    }
    setPhase({ kind: "uploading", name: file.name });
    const body = new FormData();
    body.set("file", file);
    body.set("documentType", documentType);
    body.set("useAi", String(useAi));
    const res = await fetch("/api/v1/candidate/documents", { method: "POST", body }).catch(
      () => null,
    );
    if (!res) {
      setPhase({ kind: "failed", message: "Network error. Please try again." });
      return;
    }
    const json = (await res.json().catch(() => ({}))) as {
      data?: { id: string };
      error?: { message: string };
    };
    if (!res.ok || !json.data) {
      setPhase({
        kind: "failed",
        message: json.error?.message ?? "Upload failed. Please try again.",
      });
      return;
    }
    setPhase({ kind: "processing", id: json.data.id, name: file.name });
    router.refresh();
  }

  const busy = phase.kind === "uploading" || phase.kind === "processing";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor="document-type" className="text-fg-muted mb-1 block text-xs font-medium">
            Document type
          </label>
          <select
            id="document-type"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            className={inputClass}
            disabled={busy}
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {optionLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <label
          className="text-fg-muted flex items-center gap-2 self-end pb-1.5 text-xs"
          title={aiAvailable ? "Runs on your local Ollama model" : "Local AI is not reachable"}
        >
          <input
            type="checkbox"
            checked={useAi}
            onChange={(e) => setUseAi(e.target.checked)}
            disabled={!aiAvailable || busy}
            className="size-4 accent-[var(--accent)]"
          />
          Use local AI {aiAvailable ? "" : "(offline)"}
        </label>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file && !busy) void upload(file);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors",
          dragging ? "border-accent bg-accent/5" : "border-border-strong bg-bg",
        )}
      >
        <FileUp className="text-fg-subtle size-6" aria-hidden />
        <p className="text-fg text-sm">Drop a PDF, DOCX or TXT here</p>
        <p className="text-fg-muted text-xs">Up to {maxMb} MB · stored privately in your account</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          id="document-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Choose file
        </Button>
      </div>

      <div aria-live="polite">
        {phase.kind === "uploading" && (
          <p className="text-fg-muted flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Uploading {phase.name}…
          </p>
        )}
        {phase.kind === "processing" && (
          <p className="text-fg-muted flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Extracting text and identifying
            possible facts in {phase.name}…
          </p>
        )}
        {phase.kind === "done" && (
          <div className="border-success/30 bg-success/5 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
            <p className="text-fg flex items-center gap-2 text-sm">
              <CheckCircle2 className="text-success size-4" aria-hidden />
              We found {phase.pending} possible fact{phase.pending === 1 ? "" : "s"} in {phase.name}
              .
              {phase.aiStatus !== "COMPLETED" && (
                <span className="text-fg-muted text-xs">
                  AI extraction is currently unavailable — rule-based extraction was used.
                </span>
              )}
            </p>
            {phase.pending > 0 && (
              <Link
                href={`/candidate/review?document=${phase.id}`}
                className={buttonClass("primary", "sm")}
              >
                Review facts
              </Link>
            )}
          </div>
        )}
        {phase.kind === "failed" && (
          <p
            role="alert"
            className="border-danger/30 bg-danger/5 text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {phase.message}
          </p>
        )}
      </div>
    </div>
  );
}
