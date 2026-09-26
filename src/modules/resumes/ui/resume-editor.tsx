"use client";

import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { inputClass } from "@/components/forms/field-control";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { saveResumeContentAction } from "@/app/(app)/resumes/actions";
import {
  newItemId,
  resumeDocumentSchema,
  SECTION_TITLES,
  type ResumeBullet,
  type ResumeDocument,
  type SectionKey,
} from "../document";
import { ResumePreview } from "./resume-preview";

type SaveState = "saved" | "unsaved" | "saving" | "error" | "conflict";
export interface FactOption {
  ref: string;
  kind: string;
  label: string;
}

const AUTOSAVE_MS = 1500;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function move<T>(list: T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function provenance(item: { origin: string; claimStatus: string; factRefs: string[] }): {
  label: string;
  tone: Tone;
  title: string;
} {
  if (item.claimStatus === "UNSUPPORTED")
    return {
      label: "Unsupported",
      tone: "danger",
      title:
        "This text states something your facts do not support. Fix or remove it before approval.",
    };
  if (item.claimStatus === "PARTIALLY_SUPPORTED")
    return {
      label: "Partly supported",
      tone: "warning",
      title: "Some wording goes beyond the cited facts. Review it.",
    };
  if (item.origin === "AI_REWRITE")
    return {
      label: "AI-assisted · validated",
      tone: "ai",
      title: "Reworded by the local AI and validated against your facts.",
    };
  if (item.origin === "MANUAL" && item.factRefs.length === 0)
    return {
      label: "Not linked to a fact",
      tone: "neutral",
      title: "Written by you. Not verified — consider adding it as a candidate fact.",
    };
  if (item.origin === "MANUAL")
    return {
      label: "Edited by you",
      tone: "info",
      title: "Edited by you; checked against the facts it cites.",
    };
  if (item.origin === "PROFILE")
    return { label: "From your profile", tone: "success", title: "From your candidate profile." };
  return {
    label: "From your facts",
    tone: "success",
    title: "Based on verified candidate information.",
  };
}

function ProvenanceBadge({
  item,
  facts,
}: {
  item: { origin: string; claimStatus: string; factRefs: string[] };
  facts: Map<string, FactOption>;
}) {
  const [open, setOpen] = useState(false);
  const p = provenance(item);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="cursor-pointer"
        title={p.title}
      >
        <Badge tone={p.tone}>{p.label}</Badge>
      </button>
      {open && (
        <span className="border-border bg-surface-2 text-fg-muted rounded-md border px-2 py-1 text-[11px]">
          {item.factRefs.length ? (
            <>
              Based on:{" "}
              {item.factRefs
                .map((r) => facts.get(r)?.label ?? "a fact no longer in your usable profile")
                .join(" · ")}
            </>
          ) : (
            "No candidate fact is linked."
          )}
        </span>
      )}
    </span>
  );
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", wide && "sm:col-span-2")}>
      <span className="text-fg-muted text-[11px] font-medium">{label}</span>
      {children}
    </label>
  );
}

function Text({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <input
      className={inputClass}
      value={value ?? ""}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Area({
  value,
  onChange,
  rows = 2,
  label,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  rows?: number;
  label?: string;
}) {
  return (
    <textarea
      className={cn(inputClass, "h-auto min-h-14 py-1.5 leading-relaxed")}
      rows={rows}
      value={value ?? ""}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function IconButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className="h-6 px-1.5"
    >
      {children}
    </Button>
  );
}

function ItemControls({
  index,
  count,
  hidden,
  onMove,
  onToggle,
  onRemove,
  noun,
}: {
  index: number;
  count: number;
  hidden: boolean;
  onMove: (d: number) => void;
  onToggle: () => void;
  onRemove: () => void;
  noun: string;
}) {
  return (
    <span className="flex items-center">
      <IconButton label={`Move ${noun} up`} onClick={() => onMove(-1)} disabled={index === 0}>
        <ArrowUp className="size-3.5" aria-hidden />
      </IconButton>
      <IconButton
        label={`Move ${noun} down`}
        onClick={() => onMove(1)}
        disabled={index === count - 1}
      >
        <ArrowDown className="size-3.5" aria-hidden />
      </IconButton>
      <IconButton label={hidden ? `Show ${noun}` : `Hide ${noun}`} onClick={onToggle}>
        {hidden ? (
          <EyeOff className="size-3.5" aria-hidden />
        ) : (
          <Eye className="size-3.5" aria-hidden />
        )}
      </IconButton>
      <IconButton label={`Remove ${noun} from this resume`} onClick={onRemove}>
        <Trash2 className="size-3.5" aria-hidden />
      </IconButton>
    </span>
  );
}

function manualBullet(): ResumeBullet {
  return {
    id: newItemId("b"),
    text: "",
    hidden: false,
    factRefs: [],
    origin: "MANUAL",
    claimStatus: "UNKNOWN",
    editedAt: null,
  };
}

function BulletList({
  bullets,
  onChange,
  facts,
  onFocus,
}: {
  bullets: ResumeBullet[];
  onChange: (b: ResumeBullet[]) => void;
  facts: Map<string, FactOption>;
  onFocus: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {bullets.map((b, i) => (
        <div
          key={b.id}
          className={cn("border-border rounded-md border p-1.5", b.hidden && "opacity-50")}
        >
          <div className="flex items-center justify-between gap-2">
            <ProvenanceBadge item={b} facts={facts} />
            <ItemControls
              noun="bullet"
              index={i}
              count={bullets.length}
              hidden={b.hidden}
              onMove={(d) => onChange(move(bullets, i, d))}
              onToggle={() =>
                onChange(bullets.map((x) => (x.id === b.id ? { ...x, hidden: !x.hidden } : x)))
              }
              onRemove={() => onChange(bullets.filter((x) => x.id !== b.id))}
            />
          </div>
          <textarea
            className={cn(inputClass, "mt-1 h-auto min-h-10 py-1 text-[13px] leading-relaxed")}
            rows={2}
            value={b.text}
            aria-label={`Bullet ${i + 1}`}
            onFocus={() => onFocus(b.id)}
            onChange={(e) =>
              onChange(bullets.map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x)))
            }
          />
          <span
            className={cn("text-[10px]", b.text.length > 220 ? "text-warning" : "text-fg-subtle")}
          >
            {b.text.length} characters
          </span>
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onChange([...bullets, manualBullet()])}
        className="self-start"
      >
        <Plus className="size-3.5" aria-hidden /> Add bullet
      </Button>
    </div>
  );
}

function SectionShell({
  title,
  children,
  count,
  action,
}: {
  title: string;
  children: ReactNode;
  count?: number;
  action?: ReactNode;
}) {
  return (
    <details open className="border-border bg-surface-1 rounded-lg border">
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-[13px] font-semibold">
        <span>
          {title}
          {count !== undefined && (
            <span className="text-fg-subtle ml-2 font-mono text-xs font-normal">{count}</span>
          )}
        </span>
        {action}
      </summary>
      <div className="border-border flex flex-col gap-3 border-t p-3">{children}</div>
    </details>
  );
}

export function ResumeEditor({
  resumeId,
  initialDoc,
  initialHash,
  readOnly,
  readOnlyReason,
  template,
  pageFormat,
  facts: factList,
  versionLabel,
}: {
  resumeId: string;
  initialDoc: ResumeDocument;
  initialHash: string;
  readOnly: boolean;
  readOnlyReason?: string;
  template: string;
  pageFormat: string;
  facts: FactOption[];
  versionLabel: string;
}) {
  const router = useRouter();
  const facts = useMemo(() => new Map(factList.map((f) => [f.ref, f])), [factList]);
  const [doc, setDoc] = useState<ResumeDocument>(initialDoc);
  const [hash, setHash] = useState(initialHash);
  const [state, setState] = useState<SaveState>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [history, setHistory] = useState<{ past: ResumeDocument[]; future: ResumeDocument[] }>({
    past: [],
    future: [],
  });
  const saving = useRef(false);
  const latest = useRef(doc);
  useEffect(() => {
    latest.current = doc;
  }, [doc]);

  const validation = useMemo(() => resumeDocumentSchema.safeParse(doc), [doc]);
  const problems = validation.success
    ? []
    : validation.error.issues.slice(0, 6).map((i) => `${i.path.join(" › ")}: ${i.message}`);

  const update = useCallback(
    (fn: (d: ResumeDocument) => void) => {
      if (readOnly) return;
      const next = clone(doc);
      fn(next);
      setHistory((h) => ({ past: [...h.past.slice(-49), doc], future: [] }));
      setDoc(next);
      latest.current = next;
      setState("unsaved");
    },
    [readOnly, doc],
  );

  const undo = () => {
    const prev = history.past.at(-1);
    if (!prev) return;
    setHistory((h) => ({ past: h.past.slice(0, -1), future: [...h.future, doc] }));
    setDoc(prev);
    latest.current = prev;
    setState("unsaved");
  };
  const redo = () => {
    const next = history.future.at(-1);
    if (!next) return;
    setHistory((h) => ({ past: [...h.past, doc], future: h.future.slice(0, -1) }));
    setDoc(next);
    latest.current = next;
    setState("unsaved");
  };

  const save = useCallback(async () => {
    if (readOnly || saving.current) return;
    const snapshot = latest.current;
    const parsed = resumeDocumentSchema.safeParse(snapshot);
    if (!parsed.success) {
      setState("error");
      setMessage("Fix the highlighted problems — invalid content is never saved.");
      return;
    }
    saving.current = true;
    setState("saving");
    const result = await saveResumeContentAction(resumeId, parsed.data, hash);
    saving.current = false;
    if (!result.ok) {
      setState(result.conflict ? "conflict" : "error");
      setMessage(result.error);
      return;
    }
    setHash(result.hash);
    setMessage(
      result.created
        ? `Saved as new version v${result.versionNumber} — the previous version stays unchanged.`
        : null,
    );
    setState(latest.current === snapshot ? "saved" : "unsaved");
    if (result.created) router.refresh();
  }, [hash, readOnly, resumeId, router]);

  useEffect(() => {
    if (state !== "unsaved" || !validation.success) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [doc, state, save, validation.success]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (state === "unsaved" || state === "saving" || state === "error") {
        e.preventDefault();
      }
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
  const sectionCount = (key: SectionKey) => {
    switch (key) {
      case "summary":
        return doc.summary ? 1 : 0;
      case "skills":
        return doc.skills.reduce((n, g) => n + g.skills.length, 0);
      default:
        return (doc[key] as unknown[]).length;
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
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
          {!readOnly && (
            <div className="flex items-center gap-1">
              <IconButton label="Undo" onClick={undo} disabled={history.past.length === 0}>
                <Undo2 className="size-3.5" aria-hidden />
              </IconButton>
              <IconButton label="Redo" onClick={redo} disabled={history.future.length === 0}>
                <Redo2 className="size-3.5" aria-hidden />
              </IconButton>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void save()}
                disabled={state === "saved" || state === "saving"}
              >
                Save now
              </Button>
              {state === "conflict" && (
                <Button size="sm" variant="primary" onClick={() => window.location.reload()}>
                  Reload
                </Button>
              )}
            </div>
          )}
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
          <SectionShell title="Header">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Full name">
                <Text
                  value={doc.header.name}
                  onChange={(v) => update((d) => void (d.header.name = v))}
                />
              </Field>
              <Field label="Headline">
                <Text
                  value={doc.header.headline}
                  placeholder="e.g. Marketing & automation"
                  onChange={(v) => update((d) => void (d.header.headline = v || null))}
                />
              </Field>
              <Field label="Email">
                <Text
                  value={doc.header.email}
                  onChange={(v) => update((d) => void (d.header.email = v || null))}
                />
              </Field>
              <Field label="Phone">
                <Text
                  value={doc.header.phone}
                  onChange={(v) => update((d) => void (d.header.phone = v || null))}
                />
              </Field>
              <Field label="Location" wide>
                <Text
                  value={doc.header.location}
                  onChange={(v) => update((d) => void (d.header.location = v || null))}
                />
              </Field>
            </div>
          </SectionShell>

          <SectionShell title="Sections" count={doc.sections.filter((s) => s.visible).length}>
            <p className="text-fg-muted text-xs">
              Order and visibility of sections. Empty sections are never printed.
            </p>
            <ul className="flex flex-col gap-1">
              {doc.sections.map((s, i) => (
                <li
                  key={s.key}
                  className={cn(
                    "border-border flex items-center gap-2 rounded-md border px-2 py-1",
                    !s.visible && "opacity-50",
                  )}
                >
                  <span className="w-24 shrink-0 text-xs font-medium">{SECTION_TITLES[s.key]}</span>
                  <input
                    className={cn(inputClass, "h-7 text-xs")}
                    placeholder="Custom heading (optional)"
                    aria-label={`Heading for ${SECTION_TITLES[s.key]}`}
                    value={s.title ?? ""}
                    onChange={(e) =>
                      update((d) => void (d.sections[i]!.title = e.target.value || null))
                    }
                  />
                  <span className="text-fg-subtle w-6 shrink-0 text-right font-mono text-[10px]">
                    {sectionCount(s.key)}
                  </span>
                  <ItemControls
                    noun="section"
                    index={i}
                    count={doc.sections.length}
                    hidden={!s.visible}
                    onMove={(delta) =>
                      update((d) => void (d.sections = move(d.sections, i, delta)))
                    }
                    onToggle={() =>
                      update((d) => void (d.sections[i]!.visible = !d.sections[i]!.visible))
                    }
                    onRemove={() => update((d) => void (d.sections[i]!.visible = false))}
                  />
                </li>
              ))}
            </ul>
          </SectionShell>

          <SectionShell title="Summary">
            {doc.summary ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <ProvenanceBadge item={doc.summary} facts={facts} />
                  <span className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        update((d) => {
                          if (d.summary)
                            d.summaryVariants = [
                              ...d.summaryVariants,
                              { ...d.summary, id: newItemId("sum") },
                            ].slice(0, 5);
                        })
                      }
                    >
                      Keep as variant
                    </Button>
                    <IconButton
                      label="Remove summary"
                      onClick={() => update((d) => void (d.summary = null))}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </IconButton>
                  </span>
                </div>
                <Area
                  rows={4}
                  label="Summary"
                  value={doc.summary.text}
                  onChange={(v) => update((d) => void (d.summary = { ...d.summary!, text: v }))}
                />
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                onClick={() =>
                  update(
                    (d) =>
                      void (d.summary = {
                        id: newItemId("sum"),
                        text: "",
                        hidden: false,
                        factRefs: [],
                        origin: "MANUAL",
                        claimStatus: "UNKNOWN",
                        editedAt: null,
                      }),
                  )
                }
              >
                <Plus className="size-3.5" aria-hidden /> Write a summary
              </Button>
            )}
            {doc.summaryVariants.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-fg-muted text-[11px] font-medium">
                  Saved variants (not printed)
                </p>
                {doc.summaryVariants.map((v) => (
                  <div
                    key={v.id}
                    className="border-border flex items-start justify-between gap-2 rounded-md border p-2 text-xs"
                  >
                    <span className="text-fg-muted line-clamp-3">{v.text}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          update((d) => {
                            const current = d.summary;
                            d.summary = { ...v };
                            d.summaryVariants = d.summaryVariants
                              .filter((x) => x.id !== v.id)
                              .concat(current ? [current] : []);
                          })
                        }
                      >
                        Use
                      </Button>
                      <IconButton
                        label="Delete variant"
                        onClick={() =>
                          update(
                            (d) =>
                              void (d.summaryVariants = d.summaryVariants.filter(
                                (x) => x.id !== v.id,
                              )),
                          )
                        }
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </IconButton>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SectionShell>

          <SectionShell title="Experience" count={doc.experience.length}>
            {doc.experience.map((e, i) => (
              <div
                key={e.id}
                className={cn(
                  "border-border flex flex-col gap-2 rounded-md border p-2",
                  e.hidden && "opacity-50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <ProvenanceBadge item={e} facts={facts} />
                  <ItemControls
                    noun="experience"
                    index={i}
                    count={doc.experience.length}
                    hidden={e.hidden}
                    onMove={(dl) => update((d) => void (d.experience = move(d.experience, i, dl)))}
                    onToggle={() =>
                      update((d) => void (d.experience[i]!.hidden = !d.experience[i]!.hidden))
                    }
                    onRemove={() => update((d) => void d.experience.splice(i, 1))}
                  />
                </div>
                <div
                  className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                  onFocus={() => setFocus(e.id)}
                >
                  <Field label="Title">
                    <Text
                      value={e.title}
                      onChange={(v) => update((d) => void (d.experience[i]!.title = v))}
                    />
                  </Field>
                  <Field label="Organization">
                    <Text
                      value={e.organization}
                      onChange={(v) => update((d) => void (d.experience[i]!.organization = v))}
                    />
                  </Field>
                  <Field label="Start (YYYY or YYYY-MM)">
                    <Text
                      value={e.startDate}
                      onChange={(v) => update((d) => void (d.experience[i]!.startDate = v || null))}
                    />
                  </Field>
                  <Field label="End (YYYY or YYYY-MM)">
                    <Text
                      value={e.endDate}
                      onChange={(v) => update((d) => void (d.experience[i]!.endDate = v || null))}
                    />
                  </Field>
                  <Field label="Location">
                    <Text
                      value={e.location}
                      onChange={(v) => update((d) => void (d.experience[i]!.location = v || null))}
                    />
                  </Field>
                  <label className="flex items-center gap-2 pt-5 text-xs">
                    <input
                      type="checkbox"
                      checked={e.isCurrent}
                      onChange={(ev) =>
                        update((d) => void (d.experience[i]!.isCurrent = ev.target.checked))
                      }
                      className="size-4 accent-[var(--accent)]"
                    />{" "}
                    Current role
                  </label>
                  <Field label="Description" wide>
                    <Area
                      value={e.description}
                      onChange={(v) =>
                        update((d) => void (d.experience[i]!.description = v || null))
                      }
                    />
                  </Field>
                  <Field label="Technologies (comma separated)" wide>
                    <Text
                      value={e.technologies.join(", ")}
                      onChange={(v) =>
                        update(
                          (d) =>
                            void (d.experience[i]!.technologies = v
                              .split(",")
                              .map((x) => x.trim())
                              .filter(Boolean)),
                        )
                      }
                    />
                  </Field>
                </div>
                <BulletList
                  bullets={e.bullets}
                  facts={facts}
                  onFocus={setFocus}
                  onChange={(b) => update((d) => void (d.experience[i]!.bullets = b))}
                />
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() =>
                update(
                  (d) =>
                    void d.experience.push({
                      id: newItemId("exp"),
                      hidden: false,
                      factRefs: [],
                      origin: "MANUAL",
                      claimStatus: "UNKNOWN",
                      editedAt: null,
                      title: "New role",
                      organization: "Organization",
                      location: null,
                      startDate: null,
                      endDate: null,
                      isCurrent: false,
                      description: null,
                      bullets: [],
                      technologies: [],
                    }),
                )
              }
            >
              <Plus className="size-3.5" aria-hidden /> Add experience (not linked to a fact)
            </Button>
          </SectionShell>

          <SectionShell title="Projects" count={doc.projects.length}>
            {doc.projects.map((p, i) => (
              <div
                key={p.id}
                className={cn(
                  "border-border flex flex-col gap-2 rounded-md border p-2",
                  p.hidden && "opacity-50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <ProvenanceBadge item={p} facts={facts} />
                  <ItemControls
                    noun="project"
                    index={i}
                    count={doc.projects.length}
                    hidden={p.hidden}
                    onMove={(dl) => update((d) => void (d.projects = move(d.projects, i, dl)))}
                    onToggle={() =>
                      update((d) => void (d.projects[i]!.hidden = !d.projects[i]!.hidden))
                    }
                    onRemove={() => update((d) => void d.projects.splice(i, 1))}
                  />
                </div>
                <div
                  className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                  onFocus={() => setFocus(p.id)}
                >
                  <Field label="Name">
                    <Text
                      value={p.name}
                      onChange={(v) => update((d) => void (d.projects[i]!.name = v))}
                    />
                  </Field>
                  <Field label="Role">
                    <Text
                      value={p.role}
                      onChange={(v) => update((d) => void (d.projects[i]!.role = v || null))}
                    />
                  </Field>
                  <Field label="Start">
                    <Text
                      value={p.startDate}
                      onChange={(v) => update((d) => void (d.projects[i]!.startDate = v || null))}
                    />
                  </Field>
                  <Field label="End">
                    <Text
                      value={p.endDate}
                      onChange={(v) => update((d) => void (d.projects[i]!.endDate = v || null))}
                    />
                  </Field>
                  <Field label="Link (https://…)" wide>
                    <Text
                      value={p.url}
                      onChange={(v) => update((d) => void (d.projects[i]!.url = v || null))}
                    />
                  </Field>
                  <Field label="Description" wide>
                    <Area
                      value={p.description}
                      onChange={(v) => update((d) => void (d.projects[i]!.description = v || null))}
                    />
                  </Field>
                  <Field label="Technologies (comma separated)" wide>
                    <Text
                      value={p.technologies.join(", ")}
                      onChange={(v) =>
                        update(
                          (d) =>
                            void (d.projects[i]!.technologies = v
                              .split(",")
                              .map((x) => x.trim())
                              .filter(Boolean)),
                        )
                      }
                    />
                  </Field>
                </div>
                <BulletList
                  bullets={p.bullets}
                  facts={facts}
                  onFocus={setFocus}
                  onChange={(b) => update((d) => void (d.projects[i]!.bullets = b))}
                />
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() =>
                update(
                  (d) =>
                    void d.projects.push({
                      id: newItemId("prj"),
                      hidden: false,
                      factRefs: [],
                      origin: "MANUAL",
                      claimStatus: "UNKNOWN",
                      editedAt: null,
                      name: "New project",
                      role: null,
                      description: null,
                      startDate: null,
                      endDate: null,
                      isCurrent: false,
                      bullets: [],
                      technologies: [],
                      url: null,
                    }),
                )
              }
            >
              <Plus className="size-3.5" aria-hidden /> Add project (not linked to a fact)
            </Button>
          </SectionShell>

          <SectionShell title="Education" count={doc.education.length}>
            {doc.education.map((e, i) => (
              <div
                key={e.id}
                className={cn(
                  "border-border flex flex-col gap-2 rounded-md border p-2",
                  e.hidden && "opacity-50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <ProvenanceBadge item={e} facts={facts} />
                  <ItemControls
                    noun="education"
                    index={i}
                    count={doc.education.length}
                    hidden={e.hidden}
                    onMove={(dl) => update((d) => void (d.education = move(d.education, i, dl)))}
                    onToggle={() =>
                      update((d) => void (d.education[i]!.hidden = !d.education[i]!.hidden))
                    }
                    onRemove={() => update((d) => void d.education.splice(i, 1))}
                  />
                </div>
                <div
                  className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                  onFocus={() => setFocus(e.id)}
                >
                  <Field label="Institution">
                    <Text
                      value={e.institution}
                      onChange={(v) => update((d) => void (d.education[i]!.institution = v))}
                    />
                  </Field>
                  <Field label="Degree">
                    <Text
                      value={e.degree}
                      onChange={(v) => update((d) => void (d.education[i]!.degree = v || null))}
                    />
                  </Field>
                  <Field label="Field of study">
                    <Text
                      value={e.fieldOfStudy}
                      onChange={(v) =>
                        update((d) => void (d.education[i]!.fieldOfStudy = v || null))
                      }
                    />
                  </Field>
                  <Field label="Grade / GPA (only if you have it)">
                    <Text
                      value={e.grade}
                      onChange={(v) => update((d) => void (d.education[i]!.grade = v || null))}
                    />
                  </Field>
                  <Field label="Start">
                    <Text
                      value={e.startDate}
                      onChange={(v) => update((d) => void (d.education[i]!.startDate = v || null))}
                    />
                  </Field>
                  <Field label="End">
                    <Text
                      value={e.endDate}
                      onChange={(v) => update((d) => void (d.education[i]!.endDate = v || null))}
                    />
                  </Field>
                  <Field label="Details / coursework" wide>
                    <Area
                      value={e.details}
                      onChange={(v) => update((d) => void (d.education[i]!.details = v || null))}
                    />
                  </Field>
                </div>
              </div>
            ))}
          </SectionShell>

          <SectionShell title="Skills" count={doc.skills.reduce((n, g) => n + g.skills.length, 0)}>
            {doc.skills.map((g, gi) => (
              <div
                key={g.id}
                className={cn(
                  "border-border flex flex-col gap-2 rounded-md border p-2",
                  g.hidden && "opacity-50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <input
                    className={cn(inputClass, "h-7 max-w-56 text-xs font-medium")}
                    aria-label="Skill group name"
                    value={g.label}
                    onChange={(e) => update((d) => void (d.skills[gi]!.label = e.target.value))}
                  />
                  <ItemControls
                    noun="skill group"
                    index={gi}
                    count={doc.skills.length}
                    hidden={g.hidden}
                    onMove={(dl) => update((d) => void (d.skills = move(d.skills, gi, dl)))}
                    onToggle={() =>
                      update((d) => void (d.skills[gi]!.hidden = !d.skills[gi]!.hidden))
                    }
                    onRemove={() => update((d) => void d.skills.splice(gi, 1))}
                  />
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {g.skills.map((s, si) => (
                    <li
                      key={s.id}
                      className={cn(
                        "border-border-strong flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs",
                        s.hidden && "opacity-50",
                        s.origin === "MANUAL" && s.factRefs.length === 0 && "border-dashed",
                      )}
                      title={provenance(s).title}
                    >
                      {s.name}
                      <button
                        type="button"
                        className="text-fg-subtle hover:text-fg cursor-pointer"
                        aria-label={`Move ${s.name} earlier`}
                        onClick={() =>
                          update(
                            (d) => void (d.skills[gi]!.skills = move(d.skills[gi]!.skills, si, -1)),
                          )
                        }
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className="text-fg-subtle hover:text-fg cursor-pointer"
                        aria-label={s.hidden ? `Show ${s.name}` : `Hide ${s.name}`}
                        onClick={() =>
                          update(
                            (d) =>
                              void (d.skills[gi]!.skills[si]!.hidden =
                                !d.skills[gi]!.skills[si]!.hidden),
                          )
                        }
                      >
                        {s.hidden ? "○" : "●"}
                      </button>
                      <button
                        type="button"
                        className="text-fg-subtle hover:text-danger cursor-pointer"
                        aria-label={`Remove ${s.name}`}
                        onClick={() => update((d) => void d.skills[gi]!.skills.splice(si, 1))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <form
                  className="flex gap-1.5"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    const input = ev.currentTarget.elements.namedItem("skill") as HTMLInputElement;
                    const name = input.value.trim();
                    if (!name) return;
                    update(
                      (d) =>
                        void d.skills[gi]!.skills.push({
                          id: newItemId("sk"),
                          name,
                          hidden: false,
                          factRefs: [],
                          origin: "MANUAL",
                          claimStatus: "UNKNOWN",
                          editedAt: null,
                        }),
                    );
                    input.value = "";
                  }}
                >
                  <input
                    name="skill"
                    className={cn(inputClass, "h-7 text-xs")}
                    placeholder="Add a skill you have (not linked to a fact)"
                    aria-label="New skill"
                  />
                  <Button size="sm" type="submit" variant="ghost">
                    Add
                  </Button>
                </form>
              </div>
            ))}
          </SectionShell>

          <SectionShell title="Certifications" count={doc.certifications.length}>
            {doc.certifications.map((c, i) => (
              <div
                key={c.id}
                className={cn(
                  "border-border grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-2",
                  c.hidden && "opacity-50",
                )}
              >
                <div className="flex items-center justify-between gap-2 sm:col-span-2">
                  <ProvenanceBadge item={c} facts={facts} />
                  <ItemControls
                    noun="certification"
                    index={i}
                    count={doc.certifications.length}
                    hidden={c.hidden}
                    onMove={(dl) =>
                      update((d) => void (d.certifications = move(d.certifications, i, dl)))
                    }
                    onToggle={() =>
                      update(
                        (d) => void (d.certifications[i]!.hidden = !d.certifications[i]!.hidden),
                      )
                    }
                    onRemove={() => update((d) => void d.certifications.splice(i, 1))}
                  />
                </div>
                <Field label="Name">
                  <Text
                    value={c.name}
                    onChange={(v) => update((d) => void (d.certifications[i]!.name = v))}
                  />
                </Field>
                <Field label="Issuer">
                  <Text
                    value={c.issuer}
                    onChange={(v) => update((d) => void (d.certifications[i]!.issuer = v || null))}
                  />
                </Field>
                <Field label="Issued (YYYY-MM)">
                  <Text
                    value={c.issueDate}
                    onChange={(v) =>
                      update((d) => void (d.certifications[i]!.issueDate = v || null))
                    }
                  />
                </Field>
                <Field label="Credential link">
                  <Text
                    value={c.url}
                    onChange={(v) => update((d) => void (d.certifications[i]!.url = v || null))}
                  />
                </Field>
              </div>
            ))}
          </SectionShell>

          <SectionShell title="Languages" count={doc.languages.length}>
            {doc.languages.map((l, i) => (
              <div key={l.id} className={cn("flex items-end gap-2", l.hidden && "opacity-50")}>
                <Field label="Language">
                  <Text
                    value={l.language}
                    onChange={(v) => update((d) => void (d.languages[i]!.language = v))}
                  />
                </Field>
                <Field label="Proficiency">
                  <Text
                    value={l.proficiency}
                    onChange={(v) => update((d) => void (d.languages[i]!.proficiency = v || null))}
                  />
                </Field>
                <ItemControls
                  noun="language"
                  index={i}
                  count={doc.languages.length}
                  hidden={l.hidden}
                  onMove={(dl) => update((d) => void (d.languages = move(d.languages, i, dl)))}
                  onToggle={() =>
                    update((d) => void (d.languages[i]!.hidden = !d.languages[i]!.hidden))
                  }
                  onRemove={() => update((d) => void d.languages.splice(i, 1))}
                />
              </div>
            ))}
          </SectionShell>

          <SectionShell title="Links" count={doc.links.length}>
            {doc.links.map((l, i) => (
              <div key={l.id} className={cn("flex items-end gap-2", l.hidden && "opacity-50")}>
                <Field label="Label">
                  <Text
                    value={l.label}
                    onChange={(v) => update((d) => void (d.links[i]!.label = v))}
                  />
                </Field>
                <Field label="URL">
                  <Text value={l.url} onChange={(v) => update((d) => void (d.links[i]!.url = v))} />
                </Field>
                <ItemControls
                  noun="link"
                  index={i}
                  count={doc.links.length}
                  hidden={l.hidden}
                  onMove={(dl) => update((d) => void (d.links = move(d.links, i, dl)))}
                  onToggle={() => update((d) => void (d.links[i]!.hidden = !d.links[i]!.hidden))}
                  onRemove={() => update((d) => void d.links.splice(i, 1))}
                />
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() =>
                update(
                  (d) =>
                    void d.links.push({
                      id: newItemId("lnk"),
                      label: "Website",
                      url: "https://",
                      hidden: false,
                      factRefs: [],
                      origin: "MANUAL",
                      claimStatus: "UNKNOWN",
                      editedAt: null,
                    }),
                )
              }
            >
              <Plus className="size-3.5" aria-hidden /> Add link
            </Button>
          </SectionShell>

          <SectionShell title="Additional sections" count={doc.additional.length}>
            {doc.additional.map((a, i) => (
              <div
                key={a.id}
                className={cn(
                  "border-border flex flex-col gap-2 rounded-md border p-2",
                  a.hidden && "opacity-50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <input
                    className={cn(inputClass, "h-7 max-w-56 text-xs font-medium")}
                    aria-label="Section title"
                    value={a.title}
                    onChange={(e) => update((d) => void (d.additional[i]!.title = e.target.value))}
                  />
                  <ItemControls
                    noun="section"
                    index={i}
                    count={doc.additional.length}
                    hidden={a.hidden}
                    onMove={(dl) => update((d) => void (d.additional = move(d.additional, i, dl)))}
                    onToggle={() =>
                      update((d) => void (d.additional[i]!.hidden = !d.additional[i]!.hidden))
                    }
                    onRemove={() => update((d) => void d.additional.splice(i, 1))}
                  />
                </div>
                <BulletList
                  bullets={a.bullets}
                  facts={facts}
                  onFocus={setFocus}
                  onChange={(b) => update((d) => void (d.additional[i]!.bullets = b))}
                />
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              {[
                "Awards",
                "Publications",
                "Volunteer Experience",
                "Leadership",
                "Professional Affiliations",
                "Interests",
              ].map((title) => (
                <Button
                  key={title}
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    update(
                      (d) =>
                        void d.additional.push({
                          id: newItemId("add"),
                          hidden: false,
                          title,
                          bullets: [manualBullet()],
                        }),
                    )
                  }
                >
                  <Plus className="size-3.5" aria-hidden /> {title}
                </Button>
              ))}
            </div>
          </SectionShell>
        </fieldset>
      </div>

      <div className="min-w-0 xl:sticky xl:top-2 xl:self-start">
        <ResumePreview
          doc={validation.success ? validation.data : doc}
          template={template}
          pageFormat={pageFormat}
          highlight={focus}
        />
      </div>
    </div>
  );
}
