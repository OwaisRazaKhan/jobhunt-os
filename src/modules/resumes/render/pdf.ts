import "server-only";
import PDFDocument from "pdfkit";
import type { ResumeDocument } from "../document";
import {
  getTemplate,
  PAGE_SIZES,
  PDF_FONTS,
  type PageFormat,
  type TemplateKey,
} from "../templates";
import { buildRenderModel } from "./layout";
import { toWinAnsi } from "./text";

/**
 * PDF renderer (pdfkit, server-side, no browser, no paid service). Produces a real,
 * text-based PDF: standard fonts, selectable/extractable text, clickable links, single column,
 * no images. Pagination keeps an entry's heading with its first lines.
 */

export interface PdfResult {
  bytes: Uint8Array;
  pages: number;
}

export async function renderResumePdf(
  doc: ResumeDocument,
  opts: { template: TemplateKey | string; pageFormat: PageFormat | string; title?: string },
): Promise<PdfResult> {
  const t = getTemplate(opts.template);
  const size = PAGE_SIZES[(opts.pageFormat === "LETTER" ? "LETTER" : "A4") as PageFormat];
  const model = buildRenderModel(doc);
  const fonts = { body: PDF_FONTS[t.bodyFont], head: PDF_FONTS[t.headingFont] };
  const footer = 18;

  const pdf = new PDFDocument({
    size: [size.width, size.height],
    margins: { top: t.margin, bottom: t.margin + footer, left: t.margin, right: t.margin },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: toWinAnsi(opts.title ?? `${model.name} — Resume`),
      Author: toWinAnsi(model.name),
      Creator: "JOBHUNT OS Resume Studio",
      Producer: "JOBHUNT OS (pdfkit)",
    },
    lang: "en",
    displayTitle: true,
  });

  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    pdf.on("end", resolve);
    pdf.on("error", reject);
  });

  const left = t.margin;
  const width = size.width - t.margin * 2;
  const bottom = () => size.height - t.margin - footer;
  const ensure = (needed: number) => {
    if (pdf.y + needed > bottom()) pdf.addPage();
  };
  const txt = (s: string) => toWinAnsi(s);

  // Header
  pdf.font(fonts.head.bold).fontSize(t.nameSize).fillColor(t.text);
  pdf.text(txt(model.name), left, pdf.y, { width, align: t.nameAlign });
  if (model.headline) {
    pdf.moveDown(0.15).font(fonts.body.regular).fontSize(t.headlineSize).fillColor(t.muted);
    pdf.text(txt(model.headline), left, pdf.y, { width, align: t.nameAlign });
  }
  const contactItems: { text: string; link?: string }[] = [
    ...model.contact.map((c) => ({
      text: c,
      link: c.includes("@") && !c.includes(" ") ? `mailto:${c}` : undefined,
    })),
    ...model.links.map((l) => ({
      text: l.url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
      link: l.url,
    })),
  ];
  if (contactItems.length) {
    pdf.moveDown(0.25).font(fonts.body.regular).fontSize(t.smallSize).fillColor(t.muted);
    const sep = "  |  ";
    const full = contactItems.map((c) => c.text).join(sep);
    if (pdf.widthOfString(txt(full)) <= width) {
      // One line: centre/left it manually so every part can carry its own link.
      let x = t.nameAlign === "center" ? left + (width - pdf.widthOfString(txt(full))) / 2 : left;
      const y = pdf.y;
      contactItems.forEach((c, i) => {
        const part = txt(c.text);
        pdf.text(part, x, y, { lineBreak: false, link: c.link, underline: false });
        x += pdf.widthOfString(part);
        if (i < contactItems.length - 1) {
          pdf.text(sep, x, y, { lineBreak: false });
          x += pdf.widthOfString(sep);
        }
      });
      pdf.text("", left, y + t.smallSize + t.lineGap + 2);
    } else {
      for (const c of contactItems)
        pdf.text(txt(c.text), left, pdf.y, {
          width,
          align: t.nameAlign,
          link: c.link,
          underline: false,
        });
    }
  }
  pdf.moveDown(0.4);

  const sectionHeading = (title: string) => {
    ensure(t.sectionSize + t.bodySize * 3);
    pdf.moveDown(t.sectionGap / t.bodySize / 1.6);
    const label = t.sectionStyle === "plain" ? title : title.toUpperCase();
    pdf
      .font(fonts.head.bold)
      .fontSize(t.sectionSize)
      .fillColor(t.sectionStyle === "accent-caps" ? t.accent : t.text);
    pdf.text(txt(label), left, pdf.y, {
      width,
      characterSpacing: t.sectionStyle === "plain" ? 0 : 0.6,
    });
    if (t.sectionStyle === "rule" || t.sectionStyle === "accent-caps") {
      const y = pdf.y + 1.5;
      pdf
        .save()
        .lineWidth(0.6)
        .strokeColor(t.sectionStyle === "rule" ? t.text : t.accent)
        .moveTo(left, y)
        .lineTo(left + width, y)
        .stroke()
        .restore();
      pdf.y = y + 3;
    } else {
      pdf.y += 2;
    }
    pdf.fillColor(t.text);
  };

  for (const section of model.sections) {
    sectionHeading(section.title);
    if (section.kind === "paragraph" && section.paragraph) {
      pdf.font(fonts.body.regular).fontSize(t.bodySize).fillColor(t.text);
      pdf.text(txt(section.paragraph), left, pdf.y, { width, lineGap: t.lineGap, align: "left" });
    }
    if (section.kind === "inline") {
      for (const row of section.inline ?? []) {
        ensure(t.bodySize * 2);
        const y = pdf.y;
        if (row.label) {
          pdf.font(fonts.body.bold).fontSize(t.bodySize).fillColor(t.text);
          pdf.text(txt(`${row.label}: `), left, y, { continued: true, lineGap: t.lineGap });
          pdf.font(fonts.body.regular).text(txt(row.text), { width, lineGap: t.lineGap });
        } else {
          pdf.font(fonts.body.regular).fontSize(t.bodySize).fillColor(t.text);
          pdf.text(txt(row.text), left, y, { width, lineGap: t.lineGap });
        }
      }
    }
    for (const [index, e] of (section.entries ?? []).entries()) {
      if (index > 0) pdf.y += t.itemGap;
      // Keep the heading with at least two lines of content.
      ensure(t.bodySize * 4 + t.lineGap * 4);
      if (e.title) {
        const y = pdf.y;
        const dates = e.dates ? txt(e.dates) : null;
        pdf.font(fonts.body.regular).fontSize(t.smallSize);
        const datesWidth = dates && t.datesPosition === "right" ? pdf.widthOfString(dates) + 8 : 0;
        pdf
          .font(fonts.body.bold)
          .fontSize(t.bodySize + 0.5)
          .fillColor(t.text);
        pdf.text(txt(e.title), left, y, { width: width - datesWidth, lineGap: 1 });
        const afterTitle = pdf.y;
        if (dates && t.datesPosition === "right") {
          pdf.font(fonts.body.regular).fontSize(t.smallSize).fillColor(t.muted);
          pdf.text(dates, left, y + 1, { width, align: "right", lineBreak: false });
        }
        pdf.y = afterTitle;
        const sub = [e.subtitle, e.location, t.datesPosition === "inline" ? dates : null]
          .filter(Boolean)
          .join("  ·  ");
        if (sub) {
          pdf
            .font(fonts.body.italic)
            .fontSize(t.smallSize + 0.5)
            .fillColor(t.muted);
          pdf.text(txt(sub), left, pdf.y, { width, lineGap: 1 });
        }
      }
      pdf.fillColor(t.text);
      if (e.description) {
        pdf.font(fonts.body.regular).fontSize(t.bodySize);
        pdf.text(txt(e.description), left, pdf.y + 1, { width, lineGap: t.lineGap });
      }
      for (const b of e.bullets) {
        pdf.font(fonts.body.regular).fontSize(t.bodySize);
        const indent = 10;
        const h = pdf.heightOfString(txt(b.text), { width: width - indent, lineGap: t.lineGap });
        ensure(Math.min(h, t.bodySize * 3));
        const y = pdf.y + 1;
        pdf.text(t.bullet, left + 1, y, { lineBreak: false });
        pdf.text(txt(b.text), left + indent, y, { width: width - indent, lineGap: t.lineGap });
      }
      if (e.meta) {
        pdf.font(fonts.body.regular).fontSize(t.smallSize).fillColor(t.muted);
        pdf.text(txt(e.meta), left, pdf.y + 1, { width, lineGap: 1 });
      }
      if (e.link) {
        pdf
          .font(fonts.body.regular)
          .fontSize(t.smallSize)
          .fillColor(t.accent === t.text ? t.muted : t.accent);
        pdf.text(txt(e.link.label), left, pdf.y + 1, { width, link: e.link.url, underline: false });
      }
      pdf.fillColor(t.text);
    }
  }

  // Page numbers only when there is more than one page.
  const range = pdf.bufferedPageRange();
  if (range.count > 1) {
    for (let i = range.start; i < range.start + range.count; i++) {
      pdf.switchToPage(i);
      pdf
        .font(fonts.body.regular)
        .fontSize(t.smallSize - 0.5)
        .fillColor(t.muted);
      pdf.text(`${i + 1} / ${range.count}`, left, size.height - t.margin - 4, {
        width,
        align: "right",
        lineBreak: false,
      });
    }
  }
  pdf.end();
  await done;
  return { bytes: new Uint8Array(Buffer.concat(chunks)), pages: range.count };
}
