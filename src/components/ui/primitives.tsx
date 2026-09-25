import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "ai" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "border-border-strong bg-surface-2 text-fg-muted",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
  info: "border-info/30 bg-info/10 text-info",
  ai: "border-ai/30 bg-ai/10 text-ai",
  accent: "border-accent/30 bg-accent/10 text-accent",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-[11px] leading-none font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn("border-border bg-surface-1 scroll-mt-16 rounded-lg border", className)}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  count,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  count?: number;
}) {
  return (
    <header className="border-border flex items-start justify-between gap-3 border-b px-4 py-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
          {title}
          {count !== undefined && (
            <span className="text-fg-subtle font-mono text-xs font-normal">{count}</span>
          )}
        </h2>
        {description && <p className="text-fg-muted mt-0.5 text-xs">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      {icon && <div className="text-fg-subtle">{icon}</div>}
      <p className="text-fg text-sm font-medium">{title}</p>
      {description && <p className="text-fg-muted max-w-sm text-xs">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="border-border-strong bg-surface-2 text-fg-muted rounded-sm border px-1 font-mono text-[10px]">
      {children}
    </kbd>
  );
}

export function ProgressBar({
  value,
  tone = "accent",
  label,
}: {
  value: number;
  tone?: "accent" | "success" | "warning";
  label: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const color = tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-accent";
  return (
    <div
      className="bg-surface-3 h-1.5 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-label={label}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", color)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="border-border flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-fg-subtle font-mono text-[11px] tracking-wide uppercase">{eyebrow}</p>
        )}
        <h1 className="mt-0.5 text-lg font-semibold tracking-tight">{title}</h1>
        {description && <div className="text-fg-muted mt-1 text-sm">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children?: ReactNode;
}) {
  const styles = {
    info: "border-info/30 bg-info/5",
    warning: "border-warning/30 bg-warning/5",
    danger: "border-danger/30 bg-danger/5",
    success: "border-success/30 bg-success/5",
  }[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-md border px-3 py-2.5 text-sm", styles)}
    >
      {title && <p className="text-fg font-medium">{title}</p>}
      {children && <div className={cn("text-fg-muted", title && "mt-0.5")}>{children}</div>}
    </div>
  );
}
