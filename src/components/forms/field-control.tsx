"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import type { FieldDef } from "@/modules/candidate/form-fields";

export interface RefOption {
  value: string;
  label: string;
}

export interface FieldContext {
  countries?: RefOption[];
  experiences?: RefOption[];
  projects?: RefOption[];
}

export const inputClass =
  "h-8 w-full rounded-md border border-border-strong bg-bg px-2.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:border-accent focus-visible:outline-none aria-[invalid=true]:border-danger";

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.join("\n");
  return String(value);
}

export function FieldControl({
  field,
  value,
  error,
  context,
}: {
  field: FieldDef;
  value: unknown;
  error?: string;
  context: FieldContext;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy =
    [error ? errorId : null, field.help ? helpId : null].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    name: field.name,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    required: field.required,
  };

  let control: React.ReactNode;
  switch (field.type) {
    case "textarea":
      control = (
        <textarea
          {...common}
          defaultValue={toText(value)}
          rows={4}
          placeholder={field.placeholder}
          className={cn(inputClass, "h-auto min-h-20 py-1.5 leading-relaxed")}
        />
      );
      break;
    case "list":
      control = (
        <textarea
          {...common}
          defaultValue={toText(value)}
          rows={3}
          placeholder={field.placeholder ?? "One per line"}
          className={cn(inputClass, "h-auto min-h-16 py-1.5 font-mono text-xs leading-relaxed")}
        />
      );
      break;
    case "checkbox":
      return (
        <div className={cn("flex items-center gap-2 pt-1", field.wide && "sm:col-span-2")}>
          <input
            {...common}
            type="checkbox"
            defaultChecked={value === true || value === "on"}
            className="size-4 accent-[var(--accent)]"
          />
          <label htmlFor={id} className="text-fg text-sm">
            {field.label}
          </label>
          {error && (
            <p id={errorId} className="text-danger text-xs">
              {error}
            </p>
          )}
        </div>
      );
    case "select":
      control = (
        <select {...common} defaultValue={toText(value)} className={inputClass}>
          <option value="">—</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case "country":
    case "experienceRef":
    case "projectRef": {
      const options =
        field.type === "country"
          ? context.countries
          : field.type === "experienceRef"
            ? context.experiences
            : context.projects;
      control = (
        <select {...common} defaultValue={toText(value)} className={inputClass}>
          <option value="">{field.type === "country" ? "Select a country" : "None"}</option>
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    }
    case "multiselect": {
      const selected = new Set(Array.isArray(value) ? value.map(String) : []);
      return (
        <fieldset
          className={cn("min-w-0", field.wide && "sm:col-span-2")}
          aria-describedby={describedBy}
        >
          <legend className="text-fg-muted mb-1.5 text-xs font-medium">{field.label}</legend>
          <div className="flex flex-wrap gap-1.5">
            {field.options?.map((o) => (
              <label
                key={o.value}
                className="has-checked:border-accent has-checked:bg-accent/10 has-checked:text-fg border-border-strong text-fg-muted has-focus-visible:outline-accent flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs select-none has-focus-visible:outline-2"
              >
                <input
                  type="checkbox"
                  name={`${field.name}[]`}
                  value={o.value}
                  defaultChecked={selected.has(o.value)}
                  className="sr-only"
                />
                {o.label}
              </label>
            ))}
          </div>
          {field.help && (
            <p id={helpId} className="text-fg-subtle mt-1 text-xs">
              {field.help}
            </p>
          )}
          {error && (
            <p id={errorId} className="text-danger mt-1 text-xs">
              {error}
            </p>
          )}
        </fieldset>
      );
    }
    case "partialDate": {
      const [year, month] = toText(value).split("-");
      return (
        <fieldset className="min-w-0" aria-describedby={describedBy}>
          <legend className="text-fg-muted mb-1 text-xs font-medium">{field.label}</legend>
          <div className="flex gap-1.5">
            <select
              name={`${field.name}__month`}
              defaultValue={month ?? ""}
              aria-label={`${field.label} month`}
              className={cn(inputClass, "w-24")}
            >
              <option value="">Month</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={m}>
                  {MONTH_NAMES[i]}
                </option>
              ))}
            </select>
            <input
              name={`${field.name}__year`}
              defaultValue={year ?? ""}
              inputMode="numeric"
              pattern="\d{4}"
              placeholder="YYYY"
              aria-label={`${field.label} year`}
              aria-invalid={error ? true : undefined}
              className={cn(inputClass, "w-20 font-mono")}
            />
          </div>
          {field.help && (
            <p id={helpId} className="text-fg-subtle mt-1 text-xs">
              {field.help}
            </p>
          )}
          {error && (
            <p id={errorId} className="text-danger mt-1 text-xs">
              {error}
            </p>
          )}
        </fieldset>
      );
    }
    default:
      control = (
        <input
          {...common}
          type={
            field.type === "number"
              ? "number"
              : field.type === "date"
                ? "date"
                : field.type === "url"
                  ? "text"
                  : field.type
          }
          inputMode={field.type === "url" ? "url" : undefined}
          defaultValue={toText(value)}
          placeholder={field.placeholder ?? (field.type === "url" ? "https://" : undefined)}
          min={field.min}
          max={field.max}
          step={field.step}
          className={inputClass}
        />
      );
  }

  return (
    <div className={cn("min-w-0", field.wide && "sm:col-span-2")}>
      <label htmlFor={id} className="text-fg-muted mb-1 block text-xs font-medium">
        {field.label}
        {field.required && (
          <span className="text-danger" aria-hidden>
            {" "}
            *
          </span>
        )}
      </label>
      {control}
      {field.help && !error && (
        <p id={helpId} className="text-fg-subtle mt-1 text-xs">
          {field.help}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-danger mt-1 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
