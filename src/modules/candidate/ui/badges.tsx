import { BadgeCheck, CircleDashed, FileText, PenLine, Sparkles, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/primitives";

const VERIFICATION = {
  VERIFIED: {
    tone: "success",
    label: "Verified",
    icon: BadgeCheck,
    title: "You explicitly verified this fact.",
  },
  USER_PROVIDED: {
    tone: "neutral",
    label: "User provided",
    icon: UserRound,
    title: "Entered or accepted by you, not yet verified.",
  },
  NEEDS_REVIEW: {
    tone: "warning",
    label: "Needs review",
    icon: CircleDashed,
    title: "Extracted from a document — review before it is used.",
  },
  AI_INFERRED: {
    tone: "ai",
    label: "AI inferred",
    icon: Sparkles,
    title: "Suggested by AI. Never treated as verified.",
  },
} as const;

export function VerificationBadge({ status }: { status: keyof typeof VERIFICATION }) {
  const v = VERIFICATION[status];
  const Icon = v.icon;
  return (
    <Badge tone={v.tone} title={v.title}>
      <Icon className="size-3" aria-hidden />
      {v.label}
    </Badge>
  );
}

const SOURCES: Record<string, { label: string; icon: typeof FileText }> = {
  MANUAL_ENTRY: { label: "Manual", icon: PenLine },
  CV_IMPORT: { label: "CV import", icon: FileText },
  DOCUMENT_IMPORT: { label: "Document", icon: FileText },
  PORTFOLIO_IMPORT: { label: "Portfolio import", icon: FileText },
  USER_APPROVED_AI_EXTRACTION: { label: "AI extraction · approved", icon: Sparkles },
  SYSTEM: { label: "System", icon: CircleDashed },
  OTHER: { label: "Other", icon: CircleDashed },
};

export function FactSourceBadge({
  sourceType,
  excerpt,
}: {
  sourceType: string;
  excerpt?: string | null;
}) {
  const s = SOURCES[sourceType] ?? SOURCES.OTHER!;
  const Icon = s.icon;
  return (
    <Badge
      tone="neutral"
      title={excerpt ? `Source excerpt: “${excerpt.slice(0, 200)}”` : undefined}
      className="text-fg-subtle"
    >
      <Icon className="size-3" aria-hidden />
      {s.label}
    </Badge>
  );
}

export function MethodBadge({ method }: { method: "RULE" | "AI" }) {
  return method === "AI" ? (
    <Badge tone="ai" title="Found by the local AI model; grounded in the document text.">
      <Sparkles className="size-3" aria-hidden /> AI
    </Badge>
  ) : (
    <Badge tone="neutral" title="Found by deterministic parsing rules.">
      Rule
    </Badge>
  );
}

export function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 70 ? "bg-success" : pct >= 50 ? "bg-warning" : "bg-danger";
  return (
    <span
      className="text-fg-muted inline-flex items-center gap-1.5 font-mono text-[11px]"
      title="Extraction confidence"
    >
      <span className="bg-surface-3 h-1 w-10 overflow-hidden rounded-full">
        <span className={`block h-full ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      {pct}%
    </span>
  );
}
