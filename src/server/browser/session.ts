import "server-only";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { detectSubmissionOutcome, inspectPageScript, type DomField, type DomSnapshot } from "./dom";
import { checkNavigationTarget, checkUrlSyntax, type NavigationPolicy } from "./navigation";

/**
 * Isolated browser session for one application attempt (worker-side only — never imported by UI).
 *  - fresh, non-persistent context: no stored cookies/sessions; destroyed on close
 *  - every request is checked (scheme, host, private addresses); main-frame navigations and redirects
 *    additionally get a DNS check; downloads are refused
 *  - no stealth/fingerprint tricks: the browser identifies itself normally, and CAPTCHA / sign-in /
 *    2FA / anti-bot pages stop the automation for the human
 */

export interface SessionOptions {
  channel: "msedge" | "chrome" | "chromium";
  headless: boolean;
  stepTimeoutMs: number;
  policy: NavigationPolicy;
}

export class NavigationBlockedError extends Error {
  constructor(
    readonly url: string,
    reason: string,
  ) {
    super(reason);
  }
}

export interface OpenResult {
  status: number | null;
  url: string;
}

export interface FillInstruction {
  field: DomField;
  kind: "text" | "select" | "choice" | "multi" | "checkbox" | "file";
  value: string | string[] | boolean;
  /** Absolute temp path for file uploads */
  filePath?: string;
}

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  page: Page | null = null;
  blocked: { url: string; reason: string }[] = [];

  constructor(private readonly options: SessionOptions) {}

  async start() {
    this.browser = await chromium.launch({
      channel: this.options.channel === "chromium" ? undefined : this.options.channel,
      headless: this.options.headless,
    });
    this.context = await this.browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      locale: "en-US",
    });
    this.context.setDefaultTimeout(this.options.stepTimeoutMs);
    await this.context.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      if (url.startsWith("blob:") || url.startsWith("data:image/")) return route.continue();
      const syntax = checkUrlSyntax(url, this.options.policy);
      if (!syntax.ok) {
        this.blocked.push({ url: url.slice(0, 200), reason: syntax.reason });
        return route.abort("blockedbyclient");
      }
      if (request.isNavigationRequest() && request.frame() === this.page?.mainFrame()) {
        const full = await checkNavigationTarget(url, this.options.policy);
        if (!full.ok) {
          this.blocked.push({ url: url.slice(0, 200), reason: full.reason });
          return route.abort("blockedbyclient");
        }
      }
      return route.continue();
    });
    this.page = await this.context.newPage();
    this.page.on("download", (d) => void d.cancel());
    this.page.on("dialog", (d) => void d.dismiss());
  }

  /** Navigate after validating the target (redirects are validated by the route guard). */
  async open(url: string): Promise<OpenResult> {
    const check = await checkNavigationTarget(url, this.options.policy);
    if (!check.ok) throw new NavigationBlockedError(url, check.reason);
    const response = await this.page!.goto(check.url.toString(), { waitUntil: "domcontentloaded" });
    await this.page!.waitForLoadState("networkidle", {
      timeout: Math.min(8_000, this.options.stepTimeoutMs),
    }).catch(() => undefined);
    const last = this.blocked.at(-1);
    if (!response && last) throw new NavigationBlockedError(last.url, last.reason);
    return { status: response?.status() ?? null, url: this.page!.url() };
  }

  async snapshot(): Promise<DomSnapshot> {
    // Serialized as source with a local `__name` shim: bundlers/loaders (tsx/esbuild keepNames) may
    // wrap inner functions with a helper that does not exist inside the page.
    return this.page!.evaluate(
      `(() => { const __name = (f) => f; return (${inspectPageScript.toString()})(); })()`,
    ) as Promise<DomSnapshot>;
  }

  /** Fills one field and reads the value back (never guesses a different option). */
  async fill(instruction: FillInstruction): Promise<{ ok: boolean; detail?: string }> {
    const page = this.page!;
    const { field } = instruction;
    const locator = page.locator(field.selector);
    try {
      switch (instruction.kind) {
        case "text": {
          const el = locator.first();
          await el.fill(String(instruction.value));
          const back = await el.inputValue();
          return back === String(instruction.value)
            ? { ok: true }
            : { ok: false, detail: "The value did not stick (the field changed it)." };
        }
        case "select": {
          const idx = field.options.findIndex((o) => o === instruction.value);
          const value = idx >= 0 ? field.optionValues[idx]! : String(instruction.value);
          const picked = await locator.first().selectOption(value);
          return picked.length ? { ok: true } : { ok: false, detail: "Option not available." };
        }
        case "choice": {
          const idx = field.options.findIndex(
            (o) => o.toLowerCase() === String(instruction.value).toLowerCase(),
          );
          if (idx < 0) return { ok: false, detail: "Option not available." };
          await locator.nth(idx).check();
          return (await locator.nth(idx).isChecked())
            ? { ok: true }
            : { ok: false, detail: "Could not select the option." };
        }
        case "multi": {
          const wanted = new Set((instruction.value as string[]).map((v) => v.toLowerCase()));
          for (let i = 0; i < field.options.length; i++)
            if (wanted.has(field.options[i]!.toLowerCase())) await locator.nth(i).check();
          return { ok: true };
        }
        case "checkbox":
          await locator.first().setChecked(Boolean(instruction.value));
          return { ok: true };
        case "file":
          if (!instruction.filePath) return { ok: false, detail: "No file." };
          await locator.first().setInputFiles(instruction.filePath);
          return { ok: true };
      }
    } catch (error) {
      return { ok: false, detail: (error as Error).message.split("\n")[0]!.slice(0, 200) };
    }
  }

  /** Clicks the form's submit control once and observes the outcome (never clicks twice). */
  async submitAndObserve(confirmationTimeoutMs: number) {
    const page = this.page!;
    const previousUrl = page.url();
    const button = page
      .locator('button[type="submit"], input[type="submit"]')
      .or(page.getByRole("button", { name: /submit|apply|send application/i }))
      .first();
    await button.click({ timeout: this.options.stepTimeoutMs });
    const deadline = Date.now() + confirmationTimeoutMs;
    let last: ReturnType<typeof detectSubmissionOutcome> = { outcome: "UNKNOWN" };
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      try {
        const state = await page.evaluate(() => ({
          url: location.href,
          text: (document.body?.innerText ?? "").slice(0, 6000),
          invalid: document.querySelectorAll(
            '[aria-invalid="true"], .field-error, .error:not(:empty)',
          ).length,
        }));
        last = detectSubmissionOutcome({
          url: state.url,
          previousUrl,
          text: state.text,
          invalidFields: state.invalid,
        });
        if (last.outcome !== "UNKNOWN") return { ...last, url: state.url, text: state.text };
      } catch {
        // navigation in progress
      }
    }
    return { ...last, url: page.url(), text: "" };
  }

  /** Watches (without clicking) for the human submitting the form themselves. */
  async observeManualSubmission(timeoutMs: number, shouldStop: () => Promise<boolean>) {
    const page = this.page!;
    const previousUrl = page.url();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await shouldStop()) return null;
      await page.waitForTimeout(1500);
      try {
        const state = await page.evaluate(() => ({
          url: location.href,
          text: (document.body?.innerText ?? "").slice(0, 6000),
        }));
        const outcome = detectSubmissionOutcome({
          url: state.url,
          previousUrl,
          text: state.text,
          invalidFields: 0,
        });
        if (outcome.outcome === "CONFIRMED" || outcome.outcome === "BLOCKED")
          return { ...outcome, url: state.url };
      } catch {
        // navigation in progress
      }
    }
    return null;
  }

  async screenshot(): Promise<Buffer> {
    return this.page!.screenshot({ fullPage: true, type: "png" });
  }

  async close() {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}
