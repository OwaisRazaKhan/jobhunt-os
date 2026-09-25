"use client";

import { cn } from "@/lib/cn";

export interface ChipOption {
  value: string;
  label: string;
  title?: string;
}

/**
 * Controlled multi-select rendered as toggle chips. Submits `name[]` values, so
 * formDataToObject turns it into an array (add the name to `__arrays` for empty selections).
 */
export function ChipGroup({
  name,
  legend,
  options,
  selected,
  onChange,
  help,
  error,
  className,
}: {
  name: string;
  legend: string;
  options: readonly ChipOption[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  help?: string;
  error?: string;
  className?: string;
}) {
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="text-fg-muted mb-1.5 text-xs font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <label
            key={o.value}
            title={o.title}
            className="has-checked:border-accent has-checked:bg-accent/10 has-checked:text-fg border-border-strong text-fg-muted has-focus-visible:outline-accent flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs select-none has-focus-visible:outline-2"
          >
            <input
              type="checkbox"
              name={`${name}[]`}
              value={o.value}
              checked={selected.includes(o.value)}
              onChange={() => toggle(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
      {help && !error && <p className="text-fg-subtle mt-1 text-xs">{help}</p>}
      {error && (
        <p role="alert" className="text-danger mt-1 text-xs">
          {error}
        </p>
      )}
    </fieldset>
  );
}
