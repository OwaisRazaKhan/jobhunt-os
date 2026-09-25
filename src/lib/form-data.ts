/**
 * Convert FormData into a plain object for Zod parsing.
 *  - `name[]`            -> string[] (multi-select checkboxes)
 *  - `name__year/month`  -> partial date "YYYY" | "YYYY-MM"
 *  - `__arrays`          -> comma list of array fields that must exist even when nothing is checked
 *  - fields starting with "_" or "$" are transport metadata and are dropped
 */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = new Set(formData.keys());
  for (const key of keys) {
    if (key.startsWith("_") || key.startsWith("$")) continue;
    if (key.endsWith("__year") || key.endsWith("__month")) continue;
    const values = formData.getAll(key).filter((v): v is string => typeof v === "string");
    if (key.endsWith("[]")) out[key.slice(0, -2)] = values;
    else out[key] = values.length > 1 ? values : values[0];
  }
  for (const key of keys) {
    if (!key.endsWith("__year")) continue;
    const base = key.slice(0, -"__year".length);
    const year = String(formData.get(key) ?? "").trim();
    const month = String(formData.get(`${base}__month`) ?? "").trim();
    out[base] = year ? (month ? `${year}-${month.padStart(2, "0")}` : year) : "";
  }
  const arrays = String(formData.get("__arrays") ?? "");
  for (const name of arrays.split(",").filter(Boolean)) {
    if (!(name in out)) out[name] = [];
  }
  return out;
}
