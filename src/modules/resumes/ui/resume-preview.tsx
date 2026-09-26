import type { CSSProperties } from "react";
import type { ResumeDocument } from "../document";
import { buildRenderModel } from "../render/layout";
import { CSS_FONTS, getTemplate, PAGE_SIZES, type PageFormat } from "../templates";

/**
 * Live HTML preview. Uses the same render model and template tokens as the PDF/DOCX renderers,
 * on a page-sized sheet (points → CSS px at 96/72). Exact pagination is shown by the PDF preview.
 * Text is rendered as React text nodes (escaped) — never as HTML.
 */
export function ResumePreview({
  doc,
  template,
  pageFormat,
  highlight,
}: {
  doc: ResumeDocument;
  template: string;
  pageFormat: string;
  highlight?: string | null;
}) {
  const t = getTemplate(template);
  const size = PAGE_SIZES[(pageFormat === "LETTER" ? "LETTER" : "A4") as PageFormat];
  const model = buildRenderModel(doc);
  const px = (pt: number) => `${(pt * 96) / 72}px`;
  const sheet: CSSProperties = {
    width: px(size.width),
    minHeight: px(size.height),
    padding: px(t.margin),
    fontFamily: CSS_FONTS[t.bodyFont],
    fontSize: px(t.bodySize),
    lineHeight: 1.35,
    color: t.text,
    background: "#ffffff",
    boxSizing: "border-box",
    // A dashed guide at every page height (actual page breaks: PDF preview).
    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent calc(${px(size.height)} - 1px), #d4d4d4 calc(${px(size.height)} - 1px), #d4d4d4 ${px(size.height)})`,
  };
  const heading: CSSProperties = {
    fontFamily: CSS_FONTS[t.headingFont],
    fontSize: px(t.sectionSize),
    fontWeight: 700,
    letterSpacing: t.sectionStyle === "plain" ? 0 : "0.06em",
    textTransform: t.sectionStyle === "plain" ? "none" : "uppercase",
    color: t.sectionStyle === "accent-caps" ? t.accent : t.text,
    borderBottom:
      t.sectionStyle === "rule" || t.sectionStyle === "accent-caps"
        ? `0.8px solid ${t.sectionStyle === "rule" ? t.text : t.accent}`
        : "none",
    marginTop: px(t.sectionGap),
    marginBottom: px(4),
    paddingBottom: px(1),
  };
  const muted = { color: t.muted, fontSize: px(t.smallSize) };
  const mark = (itemId: string): CSSProperties =>
    highlight === itemId ? { outline: "2px solid #c8f04b", outlineOffset: 2, borderRadius: 2 } : {};

  return (
    <div className="overflow-x-auto rounded-md bg-neutral-300/40 p-3" aria-label="Resume preview">
      <article style={sheet} className="mx-auto shadow-sm">
        <header style={{ textAlign: t.nameAlign }}>
          <h1
            style={{
              fontFamily: CSS_FONTS[t.headingFont],
              fontSize: px(t.nameSize),
              fontWeight: 700,
              margin: 0,
              lineHeight: 1.15,
            }}
          >
            {model.name || "Your name"}
          </h1>
          {model.headline && (
            <p style={{ margin: `${px(2)} 0 0`, color: t.muted, fontSize: px(t.headlineSize) }}>
              {model.headline}
            </p>
          )}
          {(model.contact.length > 0 || model.links.length > 0) && (
            <p style={{ ...muted, margin: `${px(4)} 0 0` }}>
              {[
                ...model.contact.map((c) => ({ text: c, url: null as string | null })),
                ...model.links.map((l) => ({
                  text: l.url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
                  url: l.url,
                })),
              ].map((c, i) => (
                <span key={`${c.text}-${i}`}>
                  {i > 0 && "  |  "}
                  {c.url ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      style={{ color: "inherit", textDecoration: "none" }}
                    >
                      {c.text}
                    </a>
                  ) : (
                    c.text
                  )}
                </span>
              ))}
            </p>
          )}
        </header>
        {model.sections.map((s, si) => (
          <section key={`${s.key}-${si}`}>
            <h2 style={heading}>{s.title}</h2>
            {s.paragraph && <p style={{ margin: 0 }}>{s.paragraph}</p>}
            {s.inline?.map((row, i) => (
              <p key={i} style={{ margin: `0 0 ${px(2)}` }}>
                {row.label && <strong>{row.label}: </strong>}
                {row.text}
              </p>
            ))}
            {s.entries?.map((e, i) => (
              <div key={e.id} style={{ marginTop: i > 0 ? px(t.itemGap) : 0, ...mark(e.id) }}>
                {e.title && (
                  <div style={{ display: "flex", justifyContent: "space-between", gap: px(8) }}>
                    <strong style={{ fontSize: px(t.bodySize + 0.5) }}>{e.title}</strong>
                    {e.dates && t.datesPosition === "right" && (
                      <span style={{ ...muted, whiteSpace: "nowrap" }}>{e.dates}</span>
                    )}
                  </div>
                )}
                {[e.subtitle, e.location, t.datesPosition === "inline" ? e.dates : null].filter(
                  Boolean,
                ).length > 0 && (
                  <div style={{ ...muted, fontStyle: "italic", fontSize: px(t.smallSize + 0.5) }}>
                    {[e.subtitle, e.location, t.datesPosition === "inline" ? e.dates : null]
                      .filter(Boolean)
                      .join("  ·  ")}
                  </div>
                )}
                {e.description && <p style={{ margin: `${px(1)} 0 0` }}>{e.description}</p>}
                {e.bullets.length > 0 && (
                  <ul style={{ margin: `${px(2)} 0 0`, paddingLeft: px(12), listStyle: "none" }}>
                    {e.bullets.map((b) => (
                      <li
                        key={b.id}
                        style={{ position: "relative", marginBottom: px(1.5), ...mark(b.id) }}
                      >
                        <span aria-hidden style={{ position: "absolute", left: px(-10) }}>
                          {t.bullet}
                        </span>
                        {b.text}
                      </li>
                    ))}
                  </ul>
                )}
                {e.meta && <div style={{ ...muted, marginTop: px(1) }}>{e.meta}</div>}
                {e.link && (
                  <a
                    href={e.link.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    style={{
                      ...muted,
                      color: t.accent === t.text ? t.muted : t.accent,
                      textDecoration: "none",
                    }}
                  >
                    {e.link.label}
                  </a>
                )}
              </div>
            ))}
          </section>
        ))}
        {model.sections.length === 0 && (
          <p style={muted}>Nothing to show yet — add content in the editor.</p>
        )}
      </article>
    </div>
  );
}
