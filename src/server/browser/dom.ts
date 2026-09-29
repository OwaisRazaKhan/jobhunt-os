/**
 * In-page inspection script (executed with Playwright's page.evaluate — read-only DOM access; no
 * page script is injected or modified). Extracts form fields using semantic metadata (labels,
 * aria attributes, names, placeholders) rather than fragile CSS, and detects human-only barriers.
 * The function must stay self-contained (it is serialized into the page).
 */

export interface DomField {
  externalFieldId: string;
  selector: string;
  label: string;
  fieldType: string;
  required: boolean;
  options: string[];
  optionValues: string[];
  maxLength: number | null;
  accept: string | null;
  /** How the control is operated: a radio/checkbox group, a <select>, or a single input */
  control: "group" | "select" | "input";
}

export interface DomSnapshot {
  url: string;
  title: string;
  fields: DomField[];
  barriers: { captcha: boolean; login: boolean; twoFactor: boolean; antiBot: boolean };
  hasSubmit: boolean;
  text: string;
}

export function inspectPageScript(): DomSnapshot {
  const clean = (s: string | null | undefined) =>
    (s ?? "")
      .replace(/\s+/g, " ")
      .replace(/\s*\*\s*$/, "")
      .trim();
  const cssEscape = (s: string) => s.replace(/(["\\])/g, "\\$1");
  const visible = (el: Element) => {
    const h = el as HTMLElement;
    if (h.getAttribute("type") === "file")
      return !h.closest("[hidden]") && getComputedStyle(h.parentElement ?? h).display !== "none";
    const st = getComputedStyle(h);
    return (
      st.display !== "none" &&
      st.visibility !== "hidden" &&
      !h.closest("[hidden]") &&
      h.getAttribute("aria-hidden") !== "true"
    );
  };
  const labelFor = (el: HTMLElement): string => {
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const by = el.getAttribute("aria-labelledby");
    if (by)
      return clean(
        by
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" "),
      );
    if (el.id) {
      const l = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (l) return clean(l.textContent);
    }
    const wrap = el.closest("label");
    if (wrap) return clean(wrap.textContent);
    const fieldset = el.closest("fieldset");
    const legend = fieldset?.querySelector("legend");
    if (legend) return clean(legend.textContent);
    return clean(el.getAttribute("placeholder") ?? el.getAttribute("name") ?? el.id);
  };
  const requiredOf = (el: HTMLElement, label: string) =>
    (el as HTMLInputElement).required ||
    el.getAttribute("aria-required") === "true" ||
    /\*\s*$/.test((el.closest("label")?.textContent ?? "").trim()) ||
    /\(required\)/i.test(label);
  const optionLabel = (input: HTMLInputElement) => {
    if (input.id) {
      const l = document.querySelector(`label[for="${cssEscape(input.id)}"]`);
      if (l) return clean(l.textContent);
    }
    return clean(input.closest("label")?.textContent ?? input.value);
  };

  const fields: DomField[] = [];
  const seenGroups = new Set<string>();
  const elements = Array.from(
    document.querySelectorAll("input, select, textarea"),
  ) as HTMLElement[];
  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") ?? (tag === "input" ? "text" : tag)).toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "search", "password"].includes(type))
      continue;
    if (!visible(el)) continue;
    const name = el.getAttribute("name") ?? "";
    if (
      type === "radio" ||
      (type === "checkbox" &&
        name &&
        document.querySelectorAll(`input[type="checkbox"][name="${cssEscape(name)}"]`).length > 1)
    ) {
      if (!name || seenGroups.has(name)) continue;
      seenGroups.add(name);
      const group = Array.from(
        document.querySelectorAll(`input[name="${cssEscape(name)}"]`),
      ) as HTMLInputElement[];
      const fieldset = el.closest("fieldset");
      const label = clean(
        fieldset?.querySelector("legend")?.textContent ??
          document.querySelector(`[data-group-label="${cssEscape(name)}"]`)?.textContent ??
          name,
      );
      const options = group.map(optionLabel);
      fields.push({
        externalFieldId: name,
        selector: `[name="${cssEscape(name)}"]`,
        label: label || name,
        fieldType:
          type === "radio"
            ? options.length === 2 && options.every((o) => /^(yes|no)$/i.test(o))
              ? "YES_NO"
              : "RADIO"
            : "MULTISELECT",
        required:
          group.some((g) => g.required || g.getAttribute("aria-required") === "true") ||
          fieldset?.getAttribute("aria-required") === "true",
        options,
        optionValues: group.map((g) => g.value),
        maxLength: null,
        accept: null,
        control: "group",
      });
      continue;
    }
    const label = labelFor(el);
    const id = name || el.id || `field_${fields.length}`;
    const selector = name ? `[name="${cssEscape(name)}"]` : el.id ? `#${cssEscape(el.id)}` : "";
    if (!selector) continue;
    let fieldType = "TEXT";
    const options: string[] = [];
    const optionValues: string[] = [];
    if (tag === "textarea") fieldType = "TEXTAREA";
    else if (tag === "select") {
      const sel = el as HTMLSelectElement;
      for (const o of Array.from(sel.options)) {
        if (!o.value && /select|choose|--/i.test(o.text)) continue;
        options.push(clean(o.text));
        optionValues.push(o.value);
      }
      fieldType = sel.multiple
        ? "MULTISELECT"
        : options.length === 2 && options.every((o) => /^(yes|no)$/i.test(o))
          ? "YES_NO"
          : "SELECT";
    } else if (type === "email") fieldType = "EMAIL";
    else if (type === "tel") fieldType = "PHONE";
    else if (type === "url") fieldType = "URL";
    else if (type === "number") fieldType = "NUMBER";
    else if (type === "date") fieldType = "DATE";
    else if (type === "file") fieldType = "FILE";
    else if (type === "checkbox") fieldType = "CHECKBOX";
    const ml = Number(el.getAttribute("maxlength"));
    fields.push({
      externalFieldId: id,
      selector,
      label: label || id,
      fieldType,
      required: requiredOf(el, label),
      options,
      optionValues,
      maxLength: Number.isFinite(ml) && ml > 0 ? ml : null,
      accept: el.getAttribute("accept"),
      control: tag === "select" ? "select" : "input",
    });
  }

  const html = document.documentElement.innerHTML.toLowerCase();
  const text = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
  const captcha =
    !!document.querySelector(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"], [data-sitekey], .g-recaptcha, .h-captcha, .cf-turnstile, [data-captcha]',
    ) ||
    /please (verify|confirm) (that )?you are (a )?human|i'?m not a robot|complete the (security )?(check|challenge)/i.test(
      text,
    );
  const login =
    !!document.querySelector('input[type="password"]') ||
    /\b(sign in|log in) to (continue|apply)\b/i.test(text);
  const twoFactor =
    !!document.querySelector('input[autocomplete="one-time-code"]') ||
    /\b(verification code|two-factor|2fa|authenticator app|one-time (pass)?code)\b/i.test(text);
  const antiBot =
    /\b(access denied|checking your browser|just a moment\.\.\.|unusual traffic|automated (queries|requests)|bot detected|request blocked)\b/i.test(
      text,
    ) || html.includes("cf-browser-verification");
  const hasSubmit =
    !!document.querySelector('button[type="submit"], input[type="submit"]') ||
    Array.from(document.querySelectorAll("button")).some((b) =>
      /submit|apply|send application/i.test(b.textContent ?? ""),
    );
  return {
    url: location.href,
    title: document.title,
    fields,
    barriers: { captcha, login, twoFactor, antiBot },
    hasSubmit,
    text: text.slice(0, 4000),
  };
}

/** Confirmation / rejection signals after a submit click (pure, on page text + URL). */
export function detectSubmissionOutcome(input: {
  url: string;
  previousUrl: string;
  text: string;
  invalidFields: number;
}):
  | { outcome: "CONFIRMED"; confirmationId: string | null; message: string }
  | { outcome: "REJECTED"; message: string }
  | { outcome: "BLOCKED"; message: string }
  | { outcome: "UNKNOWN" } {
  const text = input.text.replace(/\s+/g, " ");
  // Anti-bot / spam refusal: the site did not accept the application. Automation stops here.
  const blocked = text.match(
    /(flagged as (possible |potential )?spam|suspected (spam|bot|automated)|(couldn[’']?t|could not|unable to) submit your application|unusual (activity|traffic)|verify (that )?you('re| are) (a )?human)[^.!]*[.!]?/i,
  );
  if (blocked) return { outcome: "BLOCKED", message: blocked[0].slice(0, 300) };
  const success = text.match(
    /(thank you for (applying|your application)|thanks for applying|your application (has been|was) (submitted|received)|application (submitted|received)( successfully)?|we('ve| have) received your application|successfully applied)[^.!]*[.!]?/i,
  );
  const id = text.match(
    /\b(?:application|confirmation|reference|submission|candidate)\s*(?:id|number|no\.?|#|code)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,39})\b/i,
  );
  if (success)
    return {
      outcome: "CONFIRMED",
      confirmationId: id?.[1] ?? null,
      message: success[0].slice(0, 300),
    };
  const error = text.match(
    /(please (correct|fix|complete) (the )?(errors?|required fields?)|(this field|field) is required|there (was|were) (an )?errors?|could not (submit|be submitted)|submission failed)[^.!]*[.!]?/i,
  );
  if (error || input.invalidFields > 0)
    return {
      outcome: "REJECTED",
      message: (error?.[0] ?? `${input.invalidFields} field(s) were rejected by the form.`).slice(
        0,
        300,
      ),
    };
  return { outcome: "UNKNOWN" };
}
