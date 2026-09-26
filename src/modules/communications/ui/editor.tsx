"use client";

import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { saveCommunicationContentAction } from "@/app/(app)/communications/actions";
import { inputClass } from "@/components/forms/field-control";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { CSS_FONTS } from "@/modules/resumes/templates";
import {
  communicationDocumentSchema,
  paragraphsOf,
  toPlainText,
  type CommunicationDocument,
  type CoverLetterDocument,
} from "../document";
import { buildLetterModel, letterTemplate, renderLetterPlainText } from "../render/layout";

type SaveState = "saved" | "unsaved" | "saving" | "error" | "conflict";
const AUTOSAVE_MS = 1500;

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={cn("flex flex-col gap-1 text-xs", wide && "sm:col-span-2")}>
      <span className="text-fg-muted font-medium">{label}</span>
      {children}
    </label>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          setDone(false);
        }
      }}
    >
      <Copy className="size-3.5" aria-hidden /> {done ? "Copied" : label}
    </Button>
  );
}

export function CommunicationEditor({
  communicationId,
  initialDoc,
  initialHash,
  readOnly,
  readOnlyReason,
  versionLabel,
  recipientEmail,
  template,
}: {
  communicationId: string;
  initialDoc: CommunicationDocument;
  initialHash: string;
  readOnly: boolean;
  readOnlyReason?: string | null;
  versionLabel: string;
  recipientEmail: string | null;
  template: string;
}) {
  const router = useRouter();
  const [doc, setDoc] = useState<CommunicationDocument>(initialDoc);
  const [hash, setHash] = useState(initialHash);
  const [state, setState] = useState<SaveState>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const saving = useRef(false);
  const latest = useRef(doc);
  useEffect(() => {
    latest.current = doc;
  }, [doc]);

  const validation = useMemo(() => communicationDocumentSchema.safeParse(doc), [doc]);
  const problems = validation.success
    ? []
    : validation.error.issues.slice(0, 6).map((i) => `${i.path.join(" › ")}: ${i.message}`);

  const update = (
    patch: Partial<CommunicationDocument> | ((d: CommunicationDocument) => CommunicationDocument),
  ) => {
    if (readOnly) return;
    const next =
      typeof patch === "function" ? patch(doc) : ({ ...doc, ...patch } as CommunicationDocument);
    setDoc(next);
    latest.current = next;
    setState("unsaved");
  };
  const paragraphs = paragraphsOf(doc);
  const setParagraphs = (list: string[]) =>
    update((d) =>
      d.kind === "EMAIL" ? { ...d, bodyParagraphs: list } : { ...d, paragraphs: list },
    );

  const save = useCallback(async () => {
    if (readOnly || saving.current) return;
    const snapshot = latest.current;
    const parsed = communicationDocumentSchema.safeParse(snapshot);
    if (!parsed.success) {
      setState("error");
      setMessage("Fix the highlighted problems — invalid content is never saved.");
      return;
    }
    saving.current = true;
    setState("saving");
    const result = await saveCommunicationContentAction(communicationId, parsed.data, hash);
    saving.current = false;
    if (!result.ok) {
      setState(result.conflict ? "conflict" : "error");
      setMessage(result.error);
      return;
    }
    setHash(result.hash);
    setMessage(
      result.created
        ? `Saved as new version v${result.versionNumber} — the previous version (and any approval of it) stays unchanged.`
        : null,
    );
    setState(latest.current === snapshot ? "saved" : "unsaved");
    router.refresh();
  }, [communicationId, hash, readOnly, router]);

  useEffect(() => {
    if (state !== "unsaved" || !validation.success) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [doc, state, save, validation.success]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (state === "unsaved" || state === "saving" || state === "error") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  const statusText: Record<SaveState, string> = {
    saved: "Saved",
    unsaved: "Unsaved changes",
    saving: "Saving…",
    error: "Save failed",
    conflict: "Changed elsewhere — reload",
  };
  const plain =
    doc.kind === "EMAIL" ? toPlainText(doc) : renderLetterPlainText(buildLetterModel(doc));
  const bodyOnly = doc.kind === "EMAIL" ? toPlainText(doc, { includeSubject: false }) : plain;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="border-border bg-surface-1 sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-fg-muted">{versionLabel}</span>
            {readOnly ? (
              <Badge>Read-only</Badge>
            ) : (
              <span
                role="status"
                aria-live="polite"
                className={cn(
                  "font-medium",
                  state === "saved"
                    ? "text-success"
                    : state === "saving"
                      ? "text-fg-muted"
                      : state === "unsaved"
                        ? "text-warning"
                        : "text-danger",
                )}
              >
                {statusText[state]}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {doc.kind === "EMAIL" && <CopyButton text={doc.subject} label="Subject" />}
            <CopyButton text={plain} label={doc.kind === "EMAIL" ? "Full email" : "Letter text"} />
            {doc.kind === "EMAIL" && <CopyButton text={bodyOnly} label="Body" />}
            {!readOnly && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void save()}
                disabled={state === "saved" || state === "saving"}
              >
                Save now
              </Button>
            )}
            {state === "conflict" && (
              <Button size="sm" variant="primary" onClick={() => window.location.reload()}>
                Reload
              </Button>
            )}
          </div>
        </div>
        {readOnly && readOnlyReason && <p className="text-fg-muted text-xs">{readOnlyReason}</p>}
        {message && (
          <p
            role="status"
            className={cn(
              "text-xs",
              state === "error" || state === "conflict" ? "text-danger" : "text-fg-muted",
            )}
          >
            {message}
          </p>
        )}
        {problems.length > 0 && (
          <div
            role="alert"
            className="border-danger/30 bg-danger/5 text-danger rounded-md border px-3 py-2 text-xs"
          >
            <p className="font-medium">Invalid content (not saved):</p>
            <ul className="mt-1 list-disc pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-3">
          {doc.kind === "COVER_LETTER" && <LetterHeaderFields doc={doc} update={update} />}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {doc.kind === "EMAIL" && (
              <Field label="Subject" wide>
                <input
                  className={inputClass}
                  value={doc.subject}
                  maxLength={200}
                  onChange={(e) => update({ subject: e.target.value })}
                />
              </Field>
            )}
            <Field label="Greeting" wide>
              <input
                className={inputClass}
                value={doc.greeting}
                maxLength={200}
                onChange={(e) => update({ greeting: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-fg-muted text-xs font-medium">
              {doc.kind === "EMAIL" ? "Body" : "Paragraphs"}
            </p>
            {paragraphs.length === 0 && (
              <p className="text-fg-subtle text-xs">
                No paragraphs yet — write your own or generate a draft from your facts.
              </p>
            )}
            {paragraphs.map((p, i) => (
              <div key={i} className="flex items-start gap-1">
                <textarea
                  aria-label={`Paragraph ${i + 1}`}
                  className={cn(inputClass, "h-auto min-h-24 py-1.5 leading-relaxed")}
                  value={p}
                  maxLength={doc.kind === "EMAIL" ? 3000 : 4000}
                  onChange={(e) =>
                    setParagraphs(paragraphs.map((x, j) => (j === i ? e.target.value : x)))
                  }
                />
                <div className="flex flex-col gap-0.5">
                  <IconButton
                    label="Move up"
                    disabled={i === 0}
                    onClick={() => setParagraphs(move(paragraphs, i, i - 1))}
                  >
                    <ArrowUp className="size-3.5" aria-hidden />
                  </IconButton>
                  <IconButton
                    label="Move down"
                    disabled={i === paragraphs.length - 1}
                    onClick={() => setParagraphs(move(paragraphs, i, i + 1))}
                  >
                    <ArrowDown className="size-3.5" aria-hidden />
                  </IconButton>
                  <IconButton
                    label="Remove paragraph"
                    onClick={() => setParagraphs(paragraphs.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </IconButton>
                </div>
              </div>
            ))}
            {!readOnly && paragraphs.length < (doc.kind === "EMAIL" ? 20 : 12) && (
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setParagraphs([...paragraphs, ""])}
                >
                  <Plus className="size-3.5" aria-hidden /> Add paragraph
                </Button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Closing">
              <input
                className={inputClass}
                value={doc.closing}
                maxLength={120}
                onChange={(e) => update({ closing: e.target.value })}
              />
            </Field>
            <Field label="Signature (one line per item)" wide>
              <textarea
                className={cn(inputClass, "h-auto min-h-16 py-1.5")}
                value={doc.signature}
                maxLength={1000}
                onChange={(e) => update({ signature: e.target.value })}
              />
            </Field>
          </div>
        </fieldset>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-fg-muted text-xs font-medium">Preview (what you will copy / export)</p>
        {doc.kind === "EMAIL" ? (
          <EmailPreview doc={doc} recipientEmail={recipientEmail} />
        ) : (
          <LetterPreview doc={doc} template={template} />
        )}
      </div>
    </div>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="text-fg-muted hover:text-fg hover:bg-surface-2 rounded p-1 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function LetterHeaderFields({
  doc,
  update,
}: {
  doc: CoverLetterDocument;
  update: (fn: (d: CommunicationDocument) => CommunicationDocument) => void;
}) {
  const set = (fn: (d: CoverLetterDocument) => CoverLetterDocument) =>
    update((d) => (d.kind === "COVER_LETTER" ? fn(d) : d));
  const [links, setLinks] = useState(doc.header.links.join("\n"));
  return (
    <div className="border-border flex flex-col gap-2 rounded-md border p-3">
      <p className="text-fg-muted text-xs font-medium">
        Header (your details — choose what appears)
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Name">
          <input
            className={inputClass}
            value={doc.header.name ?? ""}
            onChange={(e) =>
              set((d) => ({ ...d, header: { ...d.header, name: e.target.value || null } }))
            }
          />
        </Field>
        <Field label="Email">
          <input
            className={inputClass}
            value={doc.header.email ?? ""}
            onChange={(e) =>
              set((d) => ({ ...d, header: { ...d.header, email: e.target.value || null } }))
            }
          />
        </Field>
        <Field label="Phone">
          <input
            className={inputClass}
            value={doc.header.phone ?? ""}
            onChange={(e) =>
              set((d) => ({ ...d, header: { ...d.header, phone: e.target.value || null } }))
            }
          />
        </Field>
        <Field label="Location">
          <input
            className={inputClass}
            value={doc.header.location ?? ""}
            onChange={(e) =>
              set((d) => ({ ...d, header: { ...d.header, location: e.target.value || null } }))
            }
          />
        </Field>
        <Field label="Links (full https:// URLs, one per line)" wide>
          <textarea
            className={cn(inputClass, "h-auto min-h-12 py-1.5 font-mono text-xs")}
            value={links}
            onChange={(e) => {
              setLinks(e.target.value);
              const list = e.target.value
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
                .slice(0, 4);
              set((d) => ({ ...d, header: { ...d.header, links: list } }));
            }}
          />
        </Field>
        <Field label="Date">
          <input
            type="date"
            className={inputClass}
            value={doc.date ?? ""}
            onChange={(e) => set((d) => ({ ...d, date: e.target.value || null }))}
          />
        </Field>
      </div>
      <p className="text-fg-muted pt-1 text-xs font-medium">Recipient (only what you know)</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="Name">
          <input
            className={inputClass}
            value={doc.recipient.name ?? ""}
            onChange={(e) =>
              set((d) => ({ ...d, recipient: { ...d.recipient, name: e.target.value || null } }))
            }
          />
        </Field>
        <Field label="Title">
          <input
            className={inputClass}
            value={doc.recipient.title ?? ""}
            onChange={(e) =>
              set((d) => ({ ...d, recipient: { ...d.recipient, title: e.target.value || null } }))
            }
          />
        </Field>
        <Field label="Company">
          <input
            className={inputClass}
            value={doc.recipient.company ?? ""}
            onChange={(e) =>
              set((d) => ({ ...d, recipient: { ...d.recipient, company: e.target.value || null } }))
            }
          />
        </Field>
      </div>
    </div>
  );
}

export function EmailPreview({
  doc,
  recipientEmail,
}: {
  doc: Extract<CommunicationDocument, { kind: "EMAIL" }>;
  recipientEmail: string | null;
}) {
  return (
    <div className="border-border bg-bg rounded-lg border text-sm">
      <dl className="border-border grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 border-b px-4 py-3 text-xs">
        <dt className="text-fg-muted">To:</dt>
        <dd className={recipientEmail ? "text-fg" : "text-fg-subtle italic"}>
          {recipientEmail ?? "Recipient not specified."}
        </dd>
        <dt className="text-fg-muted">Subject:</dt>
        <dd className="text-fg font-medium">
          {doc.subject || <span className="text-danger">No subject</span>}
        </dd>
      </dl>
      <div className="text-fg flex flex-col gap-3 px-4 py-4 leading-relaxed whitespace-pre-wrap">
        {doc.greeting && <p>{doc.greeting}</p>}
        {doc.bodyParagraphs.filter(Boolean).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        <p>
          {doc.closing}
          {doc.signature && (
            <>
              <br />
              {doc.signature}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/** HTML preview built from the same render model and template tokens as the PDF/DOCX export. */
export function LetterPreview({ doc, template }: { doc: CoverLetterDocument; template: string }) {
  const m = buildLetterModel(doc);
  const t = letterTemplate(template);
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-300 bg-white shadow-sm">
      <div
        className="mx-auto min-h-[600px] max-w-[640px]"
        style={{
          padding: `${t.margin * 0.75}px`,
          fontFamily: CSS_FONTS[t.bodyFont],
          color: t.text,
          fontSize: `${t.letterBody + 1.5}px`,
          lineHeight: 1.5,
        }}
      >
        {m.name && (
          <p
            style={{
              fontFamily: CSS_FONTS[t.headingFont],
              fontWeight: 700,
              fontSize: `${t.nameSize}px`,
              textAlign: t.nameAlign,
            }}
          >
            {m.name}
          </p>
        )}
        {m.contact.length > 0 && (
          <p style={{ color: t.muted, fontSize: `${t.smallSize + 1.5}px`, textAlign: t.nameAlign }}>
            {m.contact.map((c) => c.text).join("  |  ")}
          </p>
        )}
        {(m.name || m.contact.length > 0) && (
          <hr
            style={{
              margin: "10px 0 16px",
              borderColor:
                t.sectionStyle === "rule"
                  ? t.text
                  : t.sectionStyle === "accent-caps"
                    ? t.accent
                    : "transparent",
            }}
          />
        )}
        {m.date && <p style={{ marginBottom: 14 }}>{m.date}</p>}
        {m.recipient.length > 0 && (
          <p style={{ marginBottom: 14 }}>
            {m.recipient.map((l, i) => (
              <span key={i} className="block">
                {l}
              </span>
            ))}
          </p>
        )}
        {m.greeting && <p style={{ marginBottom: t.paragraphGap + 2 }}>{m.greeting}</p>}
        {m.paragraphs.map((p, i) => (
          <p key={i} style={{ marginBottom: t.paragraphGap + 2 }}>
            {p}
          </p>
        ))}
        {m.closing && <p>{m.closing}</p>}
        {m.signature.map((l, i) => (
          <p
            key={i}
            style={
              i === 0
                ? { fontWeight: 700, marginTop: 4 }
                : { color: t.muted, fontSize: `${t.smallSize + 1.5}px` }
            }
          >
            {l}
          </p>
        ))}
      </div>
    </div>
  );
}
